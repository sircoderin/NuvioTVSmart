import assert from "node:assert/strict";
import { test } from "node:test";

const keys = new EventTarget();
globalThis.addEventListener = keys.addEventListener.bind(keys);
globalThis.removeEventListener = keys.removeEventListener.bind(keys);
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;

let snapshot = null;
globalThis.document = { getElementById: () => snapshot };

const { releaseHomeBootSnapshotWhenPainted, isHomeBootSnapshotVisible } =
  await import("./homeBootSnapshot.js");

function showSnapshot() {
  snapshot = { parentNode: { removeChild: () => (snapshot = null) } };
}

function poster({ src = null, pending = null, complete = false, left = 0 } = {}) {
  return {
    isConnected: true,
    complete,
    dataset: pending ? { src: pending } : {},
    getAttribute: (name) => (name === "src" ? src : null),
    getBoundingClientRect: () => ({ top: 100, bottom: 438, left, right: left + 220, width: 220 })
  };
}

const home = (images) => ({ querySelectorAll: () => images });

test("the snapshot stays until every poster on screen has painted", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  showSnapshot();
  const loaded = poster({ src: "https://art/cw.jpg", complete: true });
  const loading = poster({ src: "https://art/row.jpg" });
  const waiting = poster({ pending: "https://art/next.jpg", left: 300 });
  const offscreen = poster({ pending: "https://art/far.jpg", left: 2400 });
  releaseHomeBootSnapshotWhenPainted(home([loaded, loading, waiting, offscreen]));

  t.mock.timers.tick(500);
  assert.ok(isHomeBootSnapshotVisible(), "one painted poster is not enough");
  loading.complete = true;
  t.mock.timers.tick(200);
  assert.ok(isHomeBootSnapshotVisible(), "a poster still waiting for its url keeps it up");
  waiting.dataset = {};
  waiting.getAttribute = () => "blob:next";
  waiting.complete = true;
  t.mock.timers.tick(100);
  assert.equal(isHomeBootSnapshotVisible(), false, "posters off screen are not waited for");
});

test("the snapshot comes down after a cap even if posters are slow", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  showSnapshot();
  releaseHomeBootSnapshotWhenPainted(home([poster({ src: "https://art/slow.jpg" })]));
  t.mock.timers.tick(2900);
  assert.ok(isHomeBootSnapshotVisible());
  t.mock.timers.tick(200);
  assert.equal(isHomeBootSnapshotVisible(), false);
});

test("a key press shows the live Home at once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  showSnapshot();
  releaseHomeBootSnapshotWhenPainted(home([poster({ src: "https://art/slow.jpg" })]));
  keys.dispatchEvent(new Event("keydown"));
  assert.equal(isHomeBootSnapshotVisible(), false, "focus never moves behind a static picture");
});
