import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { createHomeScreenMethods22 } = await import("./homeScreenMethods-22-pick-initial-hero.js");
const { catalogRepository } = await import("../../../data/repository/catalogRepository.js");
const { Router } = await import("../../navigation/routerState.js");

const methods = createHomeScreenMethods22();
const screen = {
  ...methods,
  getLoadingRowItemCount: () => 0,
  filterUnreleasedResult: (result) => result
};
const descriptor = (catalogId) => ({
  addonId: "addon",
  addonBaseUrl: "https://addon.example",
  type: "movie",
  catalogId
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function stubCatalogs() {
  const requested = [];
  const pending = new Map();
  const original = catalogRepository.getCatalog;
  catalogRepository.getCatalog = ({ catalogId }) => {
    requested.push(catalogId);
    return new Promise((resolve) =>
      pending.set(catalogId, () => resolve({ status: "success", data: { items: [] } }))
    );
  };
  return { requested, pending, restore: () => (catalogRepository.getCatalog = original) };
}

test("a slow catalog does not hold back the catalogs after it", async () => {
  const catalogs = stubCatalogs();
  try {
    const arrived = [];
    const done = screen.fetchCatalogRows(["slow", "b", "c", "d"].map(descriptor), {
      concurrency: 2,
      onRow: (row) => arrived.push(row.catalogId)
    });
    await flush();
    assert.deepEqual(catalogs.requested, ["slow", "b"], "at most two requests in flight");
    catalogs.pending.get("b")();
    await flush();
    assert.deepEqual(
      catalogs.requested,
      ["slow", "b", "c"],
      "a finished request frees its slot at once"
    );
    catalogs.pending.get("c")();
    await flush();
    catalogs.pending.get("d")();
    await flush();
    assert.deepEqual(arrived, ["b", "c", "d"]);
    catalogs.pending.get("slow")();
    const rows = await done;
    assert.deepEqual(
      rows.map((row) => row.catalogId),
      ["slow", "b", "c", "d"],
      "rows keep descriptor order"
    );
  } finally {
    catalogs.restore();
  }
});

test("a superseded load stops starting catalog requests", async () => {
  const catalogs = stubCatalogs();
  try {
    let current = true;
    const done = screen.fetchCatalogRows(["a", "b", "c"].map(descriptor), {
      concurrency: 1,
      shouldContinue: () => current
    });
    await flush();
    current = false;
    catalogs.pending.get("a")();
    const rows = await done;
    assert.deepEqual(catalogs.requested, ["a"]);
    assert.deepEqual(
      rows.map((row) => row.catalogId),
      ["a"]
    );
  } finally {
    catalogs.restore();
  }
});

function retryingHome(rows) {
  const published = [];
  return {
    ...screen,
    rows,
    homeLoadToken: 1,
    collections: [],
    heroItem: { id: "hero" },
    getDeferredCatalogBatchSize: () => 4,
    sortAndFilterRows: (next) => next,
    collectHeroCandidates: () => [],
    captureHomeHeroState: () => ({}),
    publishLoadedHomeRows: (heroBefore) => published.push(heroBefore),
    requestBackgroundRender: () => assert.fail("a retried row does not force a full Home render"),
    published
  };
}

async function timedOutRows(home, catalogIds) {
  const rows = await home.fetchCatalogRows(catalogIds.map(descriptor), {
    allowLoading: true,
    timeoutMs: 1
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  return rows;
}

test("a catalog that missed the timeout is retried from its first request", async (t) => {
  const getCurrent = Router.getCurrent;
  Router.getCurrent = () => "home";
  t.after(() => (Router.getCurrent = getCurrent));
  const catalogs = stubCatalogs();
  try {
    const home = retryingHome([]);
    const pendingRows = timedOutRows(home, ["late"]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    home.rows = await pendingRows;
    assert.equal(home.rows[0].result.status, "loading");

    home.retryPendingCatalogRows();
    await flush();
    catalogs.pending.get("late")();
    await flush();
    await flush();
    assert.deepEqual(catalogs.requested, ["late"], "the catalog is fetched once");
    assert.equal(home.rows[0].result.status, "success");
    assert.equal(home.published.length, 1, "the row goes through the loaded-rows path");
  } finally {
    catalogs.restore();
  }
});

test("a catalog whose first request failed is fetched again", async (t) => {
  const getCurrent = Router.getCurrent;
  Router.getCurrent = () => "home";
  t.after(() => (Router.getCurrent = getCurrent));
  const original = catalogRepository.getCatalog;
  const requested = [];
  let fail = null;
  catalogRepository.getCatalog = ({ catalogId }) => {
    requested.push(catalogId);
    if (requested.length === 1) {
      return new Promise((resolve) => (fail = () => resolve({ status: "error", message: "502" })));
    }
    return Promise.resolve({ status: "success", data: { items: [{ id: "tt1" }] } });
  };
  try {
    const home = retryingHome([]);
    home.rows = await timedOutRows(home, ["flaky"]);
    home.retryPendingCatalogRows();
    fail();
    for (let i = 0; i < 4; i += 1) await flush();
    assert.deepEqual(requested, ["flaky", "flaky"]);
    assert.equal(home.rows[0].result.status, "success");
  } finally {
    catalogRepository.getCatalog = original;
  }
});
