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
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
}
globalThis.__NUVIO_ENV__ = {};

const { deduplicateInProgress } = await import("./watchProgressRepository.js");

const STOPPED_AT = 1794129266726;

function deviceMovie(overrides = {}) {
  return {
    contentId: "tt0295297",
    contentType: "movie",
    imdbId: "tt0295297",
    positionMs: 24991,
    durationMs: 9141728,
    source: "simkl_local",
    updatedAt: STOPPED_AT,
    ...overrides
  };
}

function simklMovie(overrides = {}) {
  return {
    contentId: "tt0295297",
    videoId: "tt0295297",
    contentType: "movie",
    imdbId: "tt0295297",
    tmdbId: 672,
    positionMs: 0,
    durationMs: 9660000,
    progressPercent: 0.27,
    source: "simkl_playback",
    updatedAt: STOPPED_AT + 274,
    ...overrides
  };
}

test("a movie stopped on the device and echoed by the tracker appears once, from the device", () => {
  const result = deduplicateInProgress([simklMovie(), deviceMovie()]);

  assert.equal(result.length, 1);
  assert.equal(result[0].source, "simkl_local");
  assert.equal(result[0].positionMs, 24991);
});

test("a movie matched only through an aliased id is still merged", () => {
  const result = deduplicateInProgress([
    simklMovie({ contentId: "tmdb:672", videoId: "tmdb:672" }),
    deviceMovie()
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].source, "simkl_local");
});

test("tracker progress recorded well after the device's wins", () => {
  const later = simklMovie({ updatedAt: STOPPED_AT + 2 * 60 * 60 * 1000, progressPercent: 40 });
  const result = deduplicateInProgress([deviceMovie(), later]);

  assert.equal(result.length, 1);
  assert.equal(result[0].source, "simkl_playback");
});

test("different movies are both kept", () => {
  const result = deduplicateInProgress([
    deviceMovie(),
    simklMovie({ contentId: "tt0241527", videoId: "tt0241527", imdbId: "tt0241527", tmdbId: 671 })
  ]);

  assert.equal(result.length, 2);
});

test("cloud files are not merged with the title they play", () => {
  const cloud = {
    contentId: "cloud:file-1",
    contentType: "cloud",
    imdbId: "tt0295297",
    positionMs: 60000,
    durationMs: 9141728,
    source: "cloud_local",
    updatedAt: STOPPED_AT + 1000
  };
  const result = deduplicateInProgress([deviceMovie(), cloud]);

  assert.equal(result.length, 2);
});
