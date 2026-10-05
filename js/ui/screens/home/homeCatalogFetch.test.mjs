import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { createHomeScreenMethods22 } = await import("./homeScreenMethods-22-pick-initial-hero.js");
const { catalogRepository } = await import("../../../data/repository/catalogRepository.js");

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
