import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { homeCatalogWindowTarget, initialHomeCatalogDescriptors, orderHomeCatalogDescriptors } =
  await import("./homeCatalogWindow.js");
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

test("rows loaded ahead render at once while focus is on the last row", async () => {
  const { createHomeScreenMethods04 } =
    await import("./homeScreenMethods-04-get-hero-focus-delay.js");
  const methods = createHomeScreenMethods04();
  const lastRowCard = { id: "last" };
  const middleCard = { id: "middle" };
  const screen = {
    ...methods,
    layoutMode: "modern",
    hasUserInteractedSinceHomePaint: true,
    shouldSuspendModernViewportFocusSync: () => false,
    isPerformanceConstrained: () => true,
    isLegacyTvRuntime: () => false,
    lastHomeInputAt: Date.now(),
    navModel: { rows: [[middleCard], [lastRowCard]] },
    focused: lastRowCard,
    getCurrentFocusedNode() {
      return this.focused;
    }
  };
  assert.equal(screen.shouldDeferHomeRenderForInput(), false);
  screen.focused = middleCard;
  assert.equal(screen.shouldDeferHomeRenderForInput(), true, "other rows keep the input deferral");
});
