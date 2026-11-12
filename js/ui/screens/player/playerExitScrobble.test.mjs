import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_ENV__ = {};

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) || []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) || []).filter((entry) => entry !== listener)
      );
    },
    dispatch(type) {
      (listeners.get(type) || []).forEach((listener) => listener({ type }));
    }
  };
}

globalThis.window = eventTarget();
globalThis.document = Object.assign(eventTarget(), { visibilityState: "visible" });

const { createPlayerScreenMethods11 } =
  await import("./playerScreenMethods-11-release-current-engine-fs-stream-best-effort.js");
const { TrackingScrobbleService } =
  await import("../../../data/repository/trackingScrobbleService.js");
const { PlayerController } = await import("../../../core/player/playerController.js");

function playerWithTracking(t) {
  const calls = [];
  const originals = {
    isEnabled: TrackingScrobbleService.isEnabled,
    suspend: TrackingScrobbleService.suspend,
    stop: TrackingScrobbleService.stop,
    flush: PlayerController.flushCurrentProgress
  };
  TrackingScrobbleService.isEnabled = () => true;
  TrackingScrobbleService.suspend = (context) => calls.push(["suspend", context]);
  TrackingScrobbleService.stop = (context, options) => calls.push(["stop", context, options]);
  PlayerController.flushCurrentProgress = async () => {};
  const player = {
    ...createPlayerScreenMethods11(),
    hasPresentedPlaybackFrame: true,
    buildScrobbleContext: () => ({ contentId: "tt1" }),
    sendEngineFsRemoveOnPageExit() {},
    releaseCurrentEngineFsStreamBestEffort() {}
  };
  player.bindPlayerExitCleanup();
  t.after(() => {
    player.unbindPlayerExitCleanup();
    Object.assign(TrackingScrobbleService, {
      isEnabled: originals.isEnabled,
      suspend: originals.suspend,
      stop: originals.stop
    });
    PlayerController.flushCurrentProgress = originals.flush;
    document.visibilityState = "visible";
  });
  return { player, calls };
}

test("hiding the player reports the position to the trackers", (t) => {
  const { calls } = playerWithTracking(t);
  document.visibilityState = "hidden";
  document.dispatch("visibilitychange");
  assert.deepEqual(calls, [["suspend", { contentId: "tt1" }]]);

  calls.length = 0;
  document.visibilityState = "visible";
  document.dispatch("visibilitychange");
  assert.deepEqual(calls, [], "showing it again reports nothing");
});

test("closing the app sends an urgent stop", (t) => {
  const { calls } = playerWithTracking(t);
  window.dispatch("pagehide");
  assert.deepEqual(calls, [["stop", { contentId: "tt1" }, { urgent: true }]]);
});

test("a player that left stops listening", (t) => {
  const { player, calls } = playerWithTracking(t);
  player.unbindPlayerExitCleanup();
  document.visibilityState = "hidden";
  document.dispatch("visibilitychange");
  assert.deepEqual(calls, []);
});
