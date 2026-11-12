import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildHomeCatalogSnapshotKey,
  compactHomeCatalogRows,
  HomeCatalogSnapshotStore,
  isHomeCatalogSnapshotFresh
} from "./homeCatalogSnapshotStore.js";

const descriptors = [
  {
    addonBaseUrl: "https://a.example/",
    addonId: "a",
    type: "movie",
    catalogId: "top"
  },
  {
    addonBaseUrl: "https://b.example/",
    addonId: "b",
    type: "series",
    catalogId: "new"
  }
];

test("snapshot key is stable for the same profile, addons and Home order", () => {
  const prefs = { order: ["a:movie:top"], disabled: [], customTitles: {} };
  const first = buildHomeCatalogSnapshotKey({
    profileId: "2",
    addonDescriptors: descriptors,
    homeCatalogPrefs: prefs
  });
  const second = buildHomeCatalogSnapshotKey({
    profileId: "2",
    addonDescriptors: [...descriptors].reverse(),
    homeCatalogPrefs: { ...prefs, order: [...prefs.order] }
  });
  assert.equal(first, second);
  assert.match(first, /^2:/);
});

test("snapshot key changes when the profile or addons change", () => {
  const prefs = { order: ["a:movie:top"], disabled: [], customTitles: {} };
  const base = buildHomeCatalogSnapshotKey({
    profileId: "2",
    addonDescriptors: descriptors,
    homeCatalogPrefs: prefs
  });
  assert.notEqual(
    base,
    buildHomeCatalogSnapshotKey({
      profileId: "3",
      addonDescriptors: descriptors,
      homeCatalogPrefs: prefs
    })
  );
  assert.notEqual(
    base,
    buildHomeCatalogSnapshotKey({
      profileId: "2",
      addonDescriptors: descriptors.slice(0, 1),
      homeCatalogPrefs: prefs
    })
  );
});

test("row order and visibility keep the cached rows, titles do not", () => {
  const prefs = { order: ["a:movie:top"], disabled: [], customTitles: {} };
  const base = buildHomeCatalogSnapshotKey({
    profileId: "2",
    addonDescriptors: descriptors,
    homeCatalogPrefs: prefs
  });
  assert.equal(
    base,
    buildHomeCatalogSnapshotKey({
      profileId: "2",
      addonDescriptors: descriptors,
      homeCatalogPrefs: {
        order: ["b:series:new", "a:movie:top"],
        disabled: ["a:movie:top"],
        customTitles: {}
      }
    }),
    "order and visibility are applied at paint time"
  );
  assert.notEqual(
    base,
    buildHomeCatalogSnapshotKey({
      profileId: "2",
      addonDescriptors: descriptors,
      homeCatalogPrefs: {
        ...prefs,
        customTitles: { "a:movie:top": "My row" }
      }
    }),
    "the stored row name carries the custom title"
  );
});

function row(key, itemCount = 2) {
  return {
    addonId: "a",
    addonName: "A",
    addonBaseUrl: "https://a.example/",
    catalogId: "top",
    catalogName: "Top",
    apiType: "movie",
    homeCatalogKey: key,
    homeCatalogDisableKey: key,
    loadingItems: [{ id: "loading" }],
    result: {
      status: "success",
      data: {
        items: Array.from({ length: itemCount }, (_, index) => ({
          id: `tt${index}`,
          name: `Title ${index}`,
          poster: `https://image.tmdb.org/t/p/w500/${index}.jpg`
        }))
      }
    }
  };
}

test("only successful catalog rows are written, with bounded items and no loading rows", () => {
  const collection = { rowKind: "collection", homeCatalogKey: "collection:1" };
  const failed = { ...row("failed"), result: { status: "error" } };
  const compact = compactHomeCatalogRows([
    collection,
    failed,
    row("a:movie:top", 200),
    { ...row("empty"), result: { status: "success", data: { items: [] } } }
  ]);
  assert.equal(compact.length, 1);
  assert.equal(compact[0].homeCatalogKey, "a:movie:top");
  assert.equal(compact[0].loadingItems, null);
  assert.equal(compact[0].result.data.items.length, 100);
  assert.equal(compact[0].result.data.items[0].poster, "https://image.tmdb.org/t/p/w500/0.jpg");
});

test("a shortened row pages on from its last stored item", () => {
  const long = row("a:movie:top", 150);
  Object.assign(long.result.data, { supportsSkip: true, hasMore: true, nextSkip: 150 });
  const [compact] = compactHomeCatalogRows([long]);
  assert.equal(compact.result.data.nextSkip, 100);
  assert.equal(compact.result.data.hasMore, true);
});

test("snapshot freshness rejects another version, missing rows and expired records", () => {
  const now = 1_000_000_000;
  const fresh = { version: 2, savedAt: now - 1000, rowsJson: "[]" };
  assert.equal(isHomeCatalogSnapshotFresh(fresh, now), true);
  assert.equal(isHomeCatalogSnapshotFresh({ ...fresh, version: 1 }, now), false);
  assert.equal(isHomeCatalogSnapshotFresh({ ...fresh, rowsJson: null }, now), false);
  assert.equal(
    isHomeCatalogSnapshotFresh({ ...fresh, savedAt: now - 13 * 60 * 60 * 1000 }, now),
    false
  );
  assert.equal(
    isHomeCatalogSnapshotFresh(
      { ...fresh, savedAt: now - 10 * 24 * 60 * 60 * 1000 },
      now,
      Infinity
    ),
    true,
    "a caller that refreshes the rows accepts any age"
  );
});

function installFakeIndexedDb() {
  const records = new Map();
  const request = (run) => {
    const result = {};
    queueMicrotask(() => {
      result.result = run();
      result.onsuccess?.();
    });
    return result;
  };
  const store = {
    put: (record) => {
      records.set(record.key, record);
      return {};
    },
    get: (key) => request(() => records.get(key)),
    delete: (key) => {
      records.delete(key);
      return {};
    },
    clear: () => {
      records.clear();
      return {};
    },
    getAll: () => request(() => [...records.values()]),
    getAllKeys: () => request(() => [...records.keys()])
  };
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction: () => {
      const transaction = { objectStore: () => store };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    }
  };
  globalThis.indexedDB = {
    open: () => {
      const result = {};
      queueMicrotask(() => {
        result.result = database;
        result.onupgradeneeded?.();
        result.onsuccess?.();
      });
      return result;
    }
  };
  return records;
}

test("snapshot store round-trips, expires and clears by profile", async () => {
  const records = installFakeIndexedDb();
  try {
    const key = buildHomeCatalogSnapshotKey({
      profileId: "2",
      addonDescriptors: descriptors,
      homeCatalogPrefs: { order: [], disabled: [], customTitles: {} }
    });
    await HomeCatalogSnapshotStore.clearAll();
    assert.equal(await HomeCatalogSnapshotStore.read({ key }), null);

    const written = row("a:movie:top");
    written.type = "movie";
    written.result.data.apiType = "movie";
    written.result.data.items = written.result.data.items.map((item) => ({
      ...item,
      addonBaseUrl: written.addonBaseUrl,
      addonId: written.addonId,
      addonName: written.addonName,
      catalogType: "movie"
    }));
    assert.equal(await HomeCatalogSnapshotStore.write({ key, rows: [written] }), true);
    const storedItem = JSON.parse(records.get(key).rowsJson)[0].result.data.items[0];
    assert.equal("addonBaseUrl" in storedItem, false, "row fields are stored once per row");
    const entry = await HomeCatalogSnapshotStore.readEntry({ key });
    assert.ok(Date.now() - entry.savedAt < 1000);
    const stored = entry.rows;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].type, "movie", "the row keeps its descriptor");
    assert.deepEqual(stored[0].result.data.items, written.result.data.items);

    const record = records.get(key);
    record.savedAt = Date.now() - 13 * 60 * 60 * 1000;
    records.set(key, record);
    assert.equal((await HomeCatalogSnapshotStore.read({ key, maxAgeMs: Infinity }))?.length, 1);
    assert.equal(await HomeCatalogSnapshotStore.read({ key }), null);

    await HomeCatalogSnapshotStore.write({ key, rows: [row("a:movie:top")] });
    assert.equal(await HomeCatalogSnapshotStore.clearProfile("2"), true);
    assert.equal(await HomeCatalogSnapshotStore.read({ key }), null);
  } finally {
    delete globalThis.indexedDB;
  }
});
