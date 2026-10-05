import assert from "node:assert/strict";
import { test } from "node:test";

const { createHomeRowBatcher } = await import("./homeRowMerge.js");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("deferred rows are published together once per window", async () => {
  const flushes = [];
  const batcher = createHomeRowBatcher({
    delayMs: 40,
    onFlush: (rows) => flushes.push(rows.map((row) => row.homeCatalogKey))
  });
  batcher.add({ homeCatalogKey: "a" });
  await wait(15);
  batcher.add({ homeCatalogKey: "b" });
  batcher.add({ homeCatalogKey: "a", refreshed: true });
  await wait(15);
  batcher.add({ homeCatalogKey: "c" });
  await wait(30);
  assert.deepEqual(flushes, [["a", "b", "c"]], "a trickle of rows does not postpone the window");

  batcher.add({ homeCatalogKey: "d" });
  batcher.cancel();
  await wait(60);
  assert.equal(flushes.length, 1, "cancel drops rows the final merge already covers");
});
