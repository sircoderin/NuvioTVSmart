import assert from "node:assert/strict";
import { test } from "node:test";

if (!globalThis.localStorage) {
  const storage = new Map();
  globalThis.localStorage = {
    get length() {
      return storage.size;
    },
    key: (index) => [...storage.keys()][index] ?? null,
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
}
globalThis.__NUVIO_ENV__ = {};

const { createStreamScreenMethods10 } = await import("./streamScreenMethods-10-play-stream.js");
const { streamRepository } = await import("../../../data/repository/streamRepository.js");
const { watchProgressRepository } =
  await import("../../../data/repository/watchProgressRepository.js");
const { Router } = await import("../../navigation/routerState.js");

const MINUTE_MS = 60 * 1000;
const DURATION_MS = 146 * MINUTE_MS;

async function playFromPicker(t, screenState) {
  const navigate = Router.navigate;
  const getCurrent = Router.getCurrent;
  const pause = streamRepository.setLocalPluginSearchPaused;
  let navigated = null;
  Router.navigate = (route, params) => {
    navigated = { route, params };
  };
  Router.getCurrent = () => "stream";
  streamRepository.setLocalPluginSearchPaused = () => {};
  t.after(() => {
    Router.navigate = navigate;
    Router.getCurrent = getCurrent;
    streamRepository.setLocalPluginSearchPaused = pause;
  });
  const screen = {
    ...createStreamScreenMethods10(),
    streams: [{ id: "file", url: "https://example.test/movie.mkv", name: "1080p" }],
    loadToken: 1,
    getFilteredStreams() {
      return this.streams;
    },
    cancelScheduledRender() {},
    cancelAutoPlayCountdown() {},
    cancelAutoPlaySelectionWait() {},
    getBackdropUrl: () => "",
    ...screenState
  };
  await screen.playStream("file");
  return navigated;
}

// Opened from Continue Watching at 1:10:00, watched to 1:40:00, Back, play again.
const pickerParams = {
  itemType: "movie",
  itemId: "tt0926084",
  imdbId: "tt0926084",
  itemTitle: "Movie",
  resumePositionMs: 70 * MINUTE_MS,
  resumeDurationMs: DURATION_MS
};

test("playing again after Back from the player resumes where that playback stopped", async (t) => {
  await watchProgressRepository.saveProgress(
    {
      contentId: "tt0926084",
      contentType: "movie",
      imdbId: "tt0926084",
      positionMs: 100 * MINUTE_MS,
      durationMs: DURATION_MS
    },
    { syncRemote: false }
  );
  const navigated = await playFromPicker(t, {
    params: { ...pickerParams },
    routeResumeStale: true
  });
  assert.equal(navigated?.route, "player");
  assert.equal(navigated.params.resumePositionMs, 100 * MINUTE_MS);
});

test("a fresh open keeps the resume point it was given", async (t) => {
  const navigated = await playFromPicker(t, { params: { ...pickerParams } });
  assert.equal(navigated.params.resumePositionMs, 70 * MINUTE_MS);
});
