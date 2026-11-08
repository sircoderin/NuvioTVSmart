import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { createHomeScreenMethods27 } =
  await import("./homeScreenMethods-27-enrich-continue-watching.js");

function rows(count, touched) {
  return Array.from({ length: count }, (_, rowIndex) => ({
    homeCatalogKey: `row-${rowIndex}`,
    type: "movie",
    result: {
      data: {
        items: Array.from({ length: 6 }, (_, itemIndex) => {
          const item = {
            id: `tt${rowIndex}-${itemIndex}`,
            type: "movie",
            name: `Title ${rowIndex}-${itemIndex}`
          };
          return new Proxy(item, {
            get(target, key) {
              touched.add(rowIndex);
              return target[key];
            }
          });
        })
      }
    }
  }));
}

test("hero candidates are the first ten unique items, read from as few rows as needed", () => {
  const home = createHomeScreenMethods27();
  const touched = new Set();
  const candidates = home.collectHeroCandidates.call({ layoutPrefs: {} }, rows(50, touched));
  assert.deepEqual(
    candidates.map((item) => item.id),
    ["tt0-0", "tt0-1", "tt0-2", "tt0-3", "tt1-0", "tt1-1", "tt1-2", "tt1-3", "tt2-0", "tt2-1"]
  );
  assert.deepEqual([...touched], [0, 1, 2], "rows after the tenth candidate are not normalized");
});

test("hero candidates follow the selected hero catalogs and skip duplicates", () => {
  const home = createHomeScreenMethods27();
  const source = rows(5, new Set());
  source[3].result.data.items[1] = source[3].result.data.items[0];
  const candidates = home.collectHeroCandidates.call(
    { layoutPrefs: { heroCatalogKeys: ["row-3"] } },
    source
  );
  assert.deepEqual(
    candidates.map((item) => item.id),
    ["tt3-0", "tt3-2", "tt3-3"]
  );
});
