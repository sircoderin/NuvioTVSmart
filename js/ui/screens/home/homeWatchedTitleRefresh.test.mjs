import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { createHomeScreenMethods20 } = await import("./homeScreenMethods-20-mount.js");
const { watchedTitleStateRepository } =
  await import("../../../data/repository/watchedTitleStateRepository.js");
const { Router } = await import("../../navigation/routerState.js");

const catalogRow = (key, ids) => ({
  homeCatalogKey: key,
  type: "movie",
  result: { status: "success", data: { items: ids.map((id) => ({ id, type: "movie", name: id })) } }
});

// Only the rows in `mounted` are in the DOM, each with one card per item.
function virtualHome(rows, mounted) {
  const sections = mounted.map((key) => {
    const row = rows.find((entry) => entry.homeCatalogKey === key);
    const cards = row.result.data.items.map((_, index) => ({
      dataset: { itemIndex: String(index) }
    }));
    return { dataset: { rowKey: key }, querySelectorAll: () => cards };
  });
  const catalogs = { querySelectorAll: () => sections };
  let renders = 0;
  const home = {
    ...createHomeScreenMethods20(),
    rows,
    homeLoadToken: 1,
    watchedItems: [{ id: "tt1", type: "movie" }],
    watchedTitleIds: new Set(["tt1"]),
    renderedWatchedTitleIds: new Set(["tt1"]),
    modernCatalogRenderOptions: { watchedTitleIds: new Set(["tt1"]) },
    container: {
      querySelector: (selector) => (selector === ".home-catalogs-virtual" ? catalogs : null)
    },
    usesVirtualHomeRows: () => true,
    requestBackgroundRender: () => (renders += 1)
  };
  return { home, renders: () => renders };
}

async function refreshWith(t, home, watchedIds) {
  const getCurrent = Router.getCurrent;
  Router.getCurrent = () => "home";
  t.after(() => (Router.getCurrent = getCurrent));
  t.mock.method(watchedTitleStateRepository, "getTitleWatchedItems", async () =>
    watchedIds.map((id) => ({ id, type: "movie" }))
  );
  await home.refreshWatchedTitleState({ token: 1 });
}

test("titles watched in rows not mounted yet do not re-render Home", async (t) => {
  const rows = [catalogRow("a", ["tt1", "tt2"]), catalogRow("b", ["tt3", "tt4"])];
  const { home, renders } = virtualHome(rows, ["a"]);
  await refreshWith(t, home, ["tt1", "tt3"]);
  assert.equal(renders(), 0);
  assert.ok(
    home.modernCatalogRenderOptions.watchedTitleIds.has("tt3"),
    "rows mounted later show the new badge"
  );
  assert.equal(home.renderedWatchedTitleIds, home.watchedTitleIds);
});

test("a newly watched title on a mounted poster re-renders Home", async (t) => {
  const rows = [catalogRow("a", ["tt1", "tt2"]), catalogRow("b", ["tt3", "tt4"])];
  const { home, renders } = virtualHome(rows, ["a"]);
  await refreshWith(t, home, ["tt1", "tt2"]);
  assert.equal(renders(), 1);
});

test("Home without virtual rows still re-renders for a changed watched set", async (t) => {
  const rows = [catalogRow("a", ["tt1", "tt2"]), catalogRow("b", ["tt3", "tt4"])];
  const { home, renders } = virtualHome(rows, ["a"]);
  home.usesVirtualHomeRows = () => false;
  await refreshWith(t, home, ["tt1", "tt3"]);
  assert.equal(renders(), 1);
});
