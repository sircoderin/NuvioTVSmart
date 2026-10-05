import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear()
};
const { createProfileScopedStore } = await import("./profileScopedStore.js");

test("profile-scoped reads reuse a parse until the stored text changes", () => {
  let normalizeCalls = 0;
  const store = createProfileScopedStore({
    key: "cacheTestPrefs",
    normalize: (value) => {
      normalizeCalls += 1;
      return { size: Number(value.size || 1), tags: Array.isArray(value.tags) ? value.tags : [] };
    }
  });
  store.replaceForProfile("1", { size: 2, tags: ["a"] }, { silentSync: true });
  const callsAfterWrite = normalizeCalls;
  const first = store.getForProfile("1");
  store.getForProfile("1");
  assert.equal(normalizeCalls, callsAfterWrite + 1, "the second read uses the cached envelope");

  first.tags.push("mutated");
  assert.deepEqual(
    store.getForProfile("1").tags,
    ["a"],
    "returned values stay detached from the cache"
  );

  const envelope = JSON.parse(storage.get("cacheTestPrefs"));
  envelope.profiles["1"].size = 5;
  storage.set("cacheTestPrefs", JSON.stringify(envelope));
  assert.equal(store.getForProfile("1").size, 5, "external writes are observed");

  store.getForProfile("2");
  assert.equal(store.getForProfile("2").size, 5, "new profiles are seeded and persisted");
  storage.delete("cacheTestPrefs");
  assert.equal(store.getForProfile("1").size, 1);
});
