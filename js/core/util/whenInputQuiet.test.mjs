import assert from "node:assert/strict";
import { test } from "node:test";

const target = new EventTarget();
globalThis.addEventListener = target.addEventListener.bind(target);
const { whenInputQuiet } = await import("./whenInputQuiet.js");

test("the task waits until the remote has been idle for the quiet period", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let ran = false;
  const done = whenInputQuiet(
    () => {
      ran = true;
      return "ok";
    },
    { quietMs: 5000 }
  );
  t.mock.timers.tick(3000);
  target.dispatchEvent(new Event("keydown"));
  t.mock.timers.tick(4000);
  assert.equal(ran, false, "a key press restarts the quiet period");
  t.mock.timers.tick(1000);
  assert.equal(await done, "ok");
  assert.equal(ran, true);
});
