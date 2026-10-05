import assert from "node:assert/strict";
import { test } from "node:test";

const { composeLocalPayload, homeCatalogPrefsFromPayload, remotePayloadChangesHome } =
  await import("./homeCatalogSettingsPayload.js");

const entry = (catalogId) => ({
  key: `addon_movie_${catalogId}`,
  disableKey: `https://addon.example_movie_${catalogId}_${catalogId}`,
  addonId: "addon",
  type: "movie",
  catalogId
});
const catalogEntries = ["a", "b", "c", "d"].map(entry);
const remoteItem = (catalogId, order, extra = {}) => ({
  addon_id: "addon",
  type: "movie",
  catalog_id: catalogId,
  enabled: true,
  order,
  custom_title: "",
  is_collection: false,
  collection_id: "",
  ...extra
});
const local = (prefs, hideUnreleasedContent = false) =>
  composeLocalPayload({ catalogEntries, collectionEntries: [], prefs, hideUnreleasedContent });
const changes = (remoteItems, prefs, remoteExtra = {}) =>
  remotePayloadChangesHome({
    remotePayload: { hide_unreleased_content: false, items: remoteItems, ...remoteExtra },
    localPayload: local(prefs),
    catalogEntries,
    collectionEntries: []
  });

test("local payload keeps the saved order and appends unsaved catalogs", () => {
  const payload = local({
    order: ["c", "a"].map((id) => `addon_movie_${id}`),
    disabled: [entry("b").disableKey]
  });
  assert.deepEqual(
    payload.items.map((item) => [item.catalog_id, item.order, item.enabled]),
    [
      ["c", 0, true],
      ["a", 1, true],
      ["b", 2, false],
      ["d", 3, true]
    ]
  );
});

test("catalogs missing from the remote list do not count as a Home change", () => {
  // Another device saved the list before catalogs c and d were installed here.
  const prefs = { order: ["a", "b"].map((id) => `addon_movie_${id}`) };
  assert.equal(changes([remoteItem("a", 0), remoteItem("b", 1)], prefs), false);
});

test("remote order, visibility, titles and unreleased filtering are Home changes", () => {
  const prefs = { order: ["a", "b"].map((id) => `addon_movie_${id}`) };
  assert.equal(changes([remoteItem("b", 0), remoteItem("a", 1)], prefs), true, "reordered");
  assert.equal(
    changes([remoteItem("a", 0), remoteItem("b", 1, { enabled: false })], prefs),
    true,
    "hidden"
  );
  assert.equal(
    changes([remoteItem("a", 0, { custom_title: "Picks" }), remoteItem("b", 1)], prefs),
    true,
    "renamed"
  );
  assert.equal(
    changes([remoteItem("a", 0), remoteItem("b", 1)], prefs, { hide_unreleased_content: true }),
    true,
    "unreleased filter"
  );
});

test("catalogs missing from the remote list keep their local order", () => {
  // Home appends unsaved catalogs as their rows arrive, so d can precede c.
  const prefs = { order: ["a", "b", "d", "c"].map((id) => `addon_movie_${id}`) };
  const remotePayload = {
    hide_unreleased_content: false,
    items: [remoteItem("a", 0), remoteItem("b", 1)]
  };
  assert.deepEqual(
    homeCatalogPrefsFromPayload(remotePayload, local(prefs)).order,
    ["a", "b", "d", "c"].map((id) => `addon_movie_${id}`),
    "the stored order lists every catalog, so Home does not append them again"
  );
  assert.equal(changes(remotePayload.items, prefs), false);
});

test("a local-only catalog that applying the remote would move is a Home change", () => {
  // Locally c sits between a and b; after applying the remote it moves after them.
  const prefs = { order: ["a", "c", "b"].map((id) => `addon_movie_${id}`) };
  assert.equal(changes([remoteItem("a", 0), remoteItem("b", 1)], prefs), true);
});
