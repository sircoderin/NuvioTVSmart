import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const {
  homeCatalogLoadCount,
  homeCatalogWindowTarget,
  initialHomeCatalogDescriptors,
  orderHomeCatalogDescriptors
} = await import("./homeCatalogWindow.js");
const { createHomeScreenMethods21 } = await import("./homeScreenMethods-21-load-data.js");
const { Router } = await import("../../navigation/routerState.js");

const catalog = (id) => ({
  homeCatalogKey: `addon_movie_${id}`,
  homeCatalogDisableKey: `url_movie_${id}_${id}`
});
const keys = (descriptors) =>
  descriptors.map((descriptor) => descriptor.homeCatalogKey.replace("addon_movie_", ""));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("catalogs follow the Home order and skip hidden catalogs", () => {
  const ordered = orderHomeCatalogDescriptors(["a", "b", "c", "d", "e"].map(catalog), {
    orderedKeys: ["c", "a", "e", "b"].map((id) => `addon_movie_${id}`),
    disabledKeys: ["addon_movie_e", "url_movie_b_b"]
  });
  assert.deepEqual(keys(ordered), ["c", "a", "d"], "unordered catalogs follow in manifest order");
});

test("the first request covers the first rows and the hero catalogs", () => {
  const ordered = ["a", "b", "c", "d", "e"].map(catalog);
  assert.deepEqual(
    keys(initialHomeCatalogDescriptors(ordered, { count: 2, heroCatalogKeys: ["addon_movie_d"] })),
    ["a", "b", "d"]
  );
});

test("virtual Home requests every catalog; other layouts start with the first rows", () => {
  assert.equal(homeCatalogLoadCount({ total: 40, initialCount: 5, virtualRows: true }), 40);
  assert.equal(homeCatalogLoadCount({ total: 40, initialCount: 5 }), 5);
  assert.equal(
    homeCatalogLoadCount({ total: 40, initialCount: 5, background: true, previousCount: 12 }),
    12,
    "a refresh keeps the rows the user already reached"
  );
});

test("the window reaches the preload rows past the focused catalog row", () => {
  const rows = [
    { homeCatalogKey: "addon_movie_a" },
    { homeCatalogKey: "collection_x", rowKind: "collection" },
    { homeCatalogKey: "addon_movie_b" }
  ];
  assert.equal(
    homeCatalogWindowTarget(rows, "addon_movie_b", 5),
    7,
    "collection rows are not catalogs"
  );
  assert.equal(homeCatalogWindowTarget(rows, "continue_watching", 5), 5);
});

function windowScreen({ requestedCount = 2, rows = ["a", "b"] } = {}) {
  const descriptors = ["a", "b", "c", "d", "e", "f", "g", "h"].map(catalog);
  const requests = [];
  const screen = {
    ...createHomeScreenMethods21(),
    homeLoadToken: 1,
    rows: rows.map((id) => ({
      ...catalog(id),
      result: { status: "success", data: { items: [] } }
    })),
    collections: [],
    homeCatalogDescriptors: descriptors,
    homeCatalogWindowCount: requestedCount,
    homeCatalogRequestedKeys: new Set(
      descriptors.slice(0, requestedCount).map((d) => d.homeCatalogKey)
    ),
    getDeferredRowBatchDelay: () => 0,
    isMainNode: (node) => Boolean(node),
    getNodeRowKey: (node) => node.rowKey,
    sortAndFilterRows: (list) => list,
    collectHeroCandidates: () => [],
    pickInitialHero: () => null,
    refreshWatchedTitleState: async () => {},
    requestBackgroundRender() {},
    retryPendingCatalogRows() {},
    fetchCatalogRows: async (list) => {
      requests.push(keys(list));
      return list.map((d) => ({ ...d, result: { status: "success", data: { items: [] } } }));
    }
  };
  return { screen, requests };
}

test("focusing a row requests the catalogs up to the preload rows once", async () => {
  const originalGetCurrent = Router.getCurrent;
  Router.getCurrent = () => "home";
  try {
    const { screen, requests } = windowScreen();
    screen.ensureHomeCatalogWindowForNode({ rowKey: "addon_movie_b" });
    screen.ensureHomeCatalogWindowForNode({ rowKey: "addon_movie_b" });
    await flush();
    assert.deepEqual(requests, [["c", "d", "e", "f", "g"]]);
    assert.deepEqual(keys(screen.rows), ["a", "b", "c", "d", "e", "f", "g"]);
  } finally {
    Router.getCurrent = originalGetCurrent;
  }
});

test("scrolling near the end of Home extends the window", async () => {
  const originalGetCurrent = Router.getCurrent;
  Router.getCurrent = () => "home";
  try {
    const { screen, requests } = windowScreen();
    screen.ensureHomeCatalogWindowForViewport({
      scrollHeight: 3000,
      scrollTop: 0,
      clientHeight: 1000
    });
    assert.deepEqual(requests, [], "two screens below the viewport are left");
    screen.ensureHomeCatalogWindowForViewport({
      scrollHeight: 3000,
      scrollTop: 1200,
      clientHeight: 1000
    });
    await flush();
    assert.deepEqual(requests, [["c", "d", "e", "f", "g"]]);
  } finally {
    Router.getCurrent = originalGetCurrent;
  }
});

test("rows from a superseded load are not merged", async () => {
  const originalGetCurrent = Router.getCurrent;
  Router.getCurrent = () => "home";
  try {
    const { screen } = windowScreen();
    let finish;
    screen.fetchCatalogRows = (list) =>
      new Promise((resolve) => {
        finish = () =>
          resolve(list.map((d) => ({ ...d, result: { status: "success", data: { items: [] } } })));
      });
    screen.ensureHomeCatalogWindowForNode({ rowKey: "addon_movie_b" });
    screen.homeLoadToken = 2;
    finish();
    await flush();
    assert.deepEqual(keys(screen.rows), ["a", "b"]);
  } finally {
    Router.getCurrent = originalGetCurrent;
  }
});

function deferralScreen(methods, { virtualRows }) {
  const lastRowCard = { id: "last" };
  const middleCard = { id: "middle" };
  return {
    ...methods,
    layoutMode: virtualRows ? "modern" : "classic",
    hasUserInteractedSinceHomePaint: true,
    shouldSuspendModernViewportFocusSync: () => false,
    usesVirtualHomeRows: () => virtualRows,
    isPerformanceConstrained: () => true,
    isLegacyTvRuntime: () => false,
    lastHomeInputAt: Date.now(),
    navModel: { rows: [[middleCard], [lastRowCard]] },
    lastRowCard,
    middleCard,
    focused: lastRowCard,
    getCurrentFocusedNode() {
      return this.focused;
    }
  };
}

test("rows loaded ahead render at once while focus is on the last row", async () => {
  const { createHomeScreenMethods04 } =
    await import("./homeScreenMethods-04-get-hero-focus-delay.js");
  const screen = deferralScreen(createHomeScreenMethods04(), { virtualRows: false });
  assert.equal(screen.shouldDeferHomeRenderForInput(), false);
  screen.focused = screen.middleCard;
  assert.equal(screen.shouldDeferHomeRenderForInput(), true, "other rows keep the input deferral");
});

test("virtual rows keep the input deferral on the last row", async () => {
  const { createHomeScreenMethods04 } =
    await import("./homeScreenMethods-04-get-hero-focus-delay.js");
  const screen = deferralScreen(createHomeScreenMethods04(), { virtualRows: true });
  assert.equal(screen.shouldDeferHomeRenderForInput(), true);
});

test("moving down from the last mounted row mounts rows loaded since the render", async () => {
  const { createHomeRowVirtualizationMethods } = await import("./homeRowVirtualization.js");
  const { HomeRowVirtualWindow } = await import("./homeRowVirtualWindow.js");
  const row = (id) => ({ homeCatalogKey: id, result: { data: { items: [{ id }] } } });
  const model = new HomeRowVirtualWindow();
  model.setRows(["a", "b", "c"].map(row));
  const mounted = [];
  const screen = {
    ...createHomeRowVirtualizationMethods(),
    layoutMode: "modern",
    isPerformanceConstrained: () => true,
    homeRowVirtualWindow: model,
    rows: ["a", "b", "c", "d", "e"].map(row),
    getNodeRowKey: (node) => node.rowKey,
    captureVirtualHomeRowMetrics() {},
    mountVirtualHomeWindow() {
      mounted.push(model.entries.slice(model.start, model.end).map((entry) => entry.key));
    },
    getNavigationRowNodes: (key) => [{ rowKey: key }]
  };
  assert.deepEqual(screen.getVirtualHomeAdjacentRow({ rowKey: "c" }, 1), [{ rowKey: "d" }]);
  assert.deepEqual(mounted, [["a", "b", "c", "d", "e"]]);

  screen.rows = ["a", "b", "c", "d", "e"].map(row);
  assert.deepEqual(screen.getVirtualHomeAdjacentRow({ rowKey: "e" }, 1), [], "the end of Home");
  assert.equal(mounted.length, 1, "nothing new to mount");
});

async function loadedRowsScreen() {
  const { createHomeRowVirtualizationMethods } = await import("./homeRowVirtualization.js");
  const { HomeRowVirtualWindow } = await import("./homeRowVirtualWindow.js");
  const row = (id) => ({ homeCatalogKey: id, result: { data: { items: [{ id }] } } });
  const rows = ["a", "b", "c"].map(row);
  const model = new HomeRowVirtualWindow();
  model.setRows(rows);
  const mounts = [];
  const catalogs = {
    querySelectorAll: () =>
      model.entries
        .slice(model.start, model.end)
        .map((entry) => ({ dataset: { rowKey: entry.key } }))
  };
  const screen = {
    ...createHomeRowVirtualizationMethods(),
    layoutMode: "modern",
    isPerformanceConstrained: () => true,
    homeRowVirtualWindow: model,
    homeRowVirtualMountedRows: new Map(rows.map((r) => [r.homeCatalogKey, r])),
    rows,
    container: { querySelector: () => catalogs },
    getCurrentFocusedNode: () => null,
    getNodeRowKey: (node) => node?.rowKey || "",
    captureVirtualHomeRowMetrics() {},
    syncVirtualHomeRowSpacers() {},
    mountVirtualHomeWindow() {
      mounts.push(model.entries.slice(model.start, model.end).map((entry) => entry.key));
    }
  };
  return { screen, row, mounts };
}

test("a catalog batch that only adds rows mounts them without a full render", async () => {
  const { screen, row, mounts } = await loadedRowsScreen();
  screen.rows = [...screen.rows, row("d"), row("e")];
  assert.equal(screen.mountLoadedVirtualHomeRows(), true);
  assert.deepEqual(mounts, [["a", "b", "c", "d", "e"]]);
});

test("a catalog batch that changes a mounted row needs a full render", async () => {
  const { screen, row, mounts } = await loadedRowsScreen();
  screen.rows = [screen.rows[0], row("b"), screen.rows[2], row("d")];
  assert.equal(screen.mountLoadedVirtualHomeRows(), false);
  assert.deepEqual(mounts, []);
});

test("loaded rows render Home in full when the hero changes", () => {
  const renders = [];
  const screen = {
    ...createHomeScreenMethods21(),
    heroItem: null,
    heroCandidates: [],
    mountLoadedVirtualHomeRows: () => true,
    requestBackgroundRender: () => renders.push("render")
  };
  const before = screen.captureHomeHeroState();
  screen.publishLoadedHomeRows(before);
  assert.deepEqual(renders, [], "rows alone mount in place");
  screen.heroCandidates = [{ id: "tt1" }, { id: "tt2" }];
  screen.publishLoadedHomeRows(before);
  assert.deepEqual(renders, ["render"], "hero indicators come from the full render");
});

test("rows that arrive inside the window keep the focused row mounted", async () => {
  const { screen, row, mounts } = await loadedRowsScreen();
  const model = screen.homeRowVirtualWindow;
  const initial = Array.from({ length: 9 }, (_, index) => row(`r${index}`));
  screen.rows = initial;
  model.setRows(initial);
  screen.homeRowVirtualMountedRows = new Map(initial.map((r) => [r.homeCatalogKey, r]));
  screen.getCurrentFocusedNode = () => ({ rowKey: "r7" });
  // Catalogs ordered above the focused row finish after focus moved past them.
  screen.rows = [initial[0], initial[1], row("x1"), row("x2"), row("x3"), ...initial.slice(2)];
  assert.equal(screen.mountLoadedVirtualHomeRows(), true);
  assert.ok(mounts.at(-1).includes("r7"), `focused row left the window: ${mounts.at(-1)}`);
});
