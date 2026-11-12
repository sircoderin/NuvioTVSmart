import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
const reads = new Map();
globalThis.localStorage = {
  getItem: (key) => {
    reads.set(key, (reads.get(key) || 0) + 1);
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear()
};

const { SimklSyncService } = await import("./simklSyncService.js");
const { deduplicateInProgress } = await import("./watchProgressRepository.js");
const { TraktSettingsStore, SimklAnimeIdPreference } =
  await import("../local/traktSettingsStore.js");

function movie(imdb, title, mal = null) {
  return {
    mediaType: mal ? "anime" : "movies",
    status: "completed",
    last_watched_at: "2026-01-02T00:00:00Z",
    movie: { title, ids: { imdb, ...(mal ? { mal } : {}) } }
  };
}

function store(entries, playback = [], lastSyncedAt = 1) {
  storage.set(
    "simklSyncState",
    JSON.stringify({
      version: 1,
      profiles: {
        1: { schemaVersion: 3, initialized: true, entries, playback, lastSyncedAt }
      }
    })
  );
}

/** How often `run` parses the stored Simkl snapshot text. */
async function countParses(run) {
  const parse = JSON.parse;
  let parses = 0;
  JSON.parse = (text, ...rest) => {
    if (typeof text === "string" && text.includes('"entries"')) parses += 1;
    return parse(text, ...rest);
  };
  try {
    await run();
  } finally {
    JSON.parse = parse;
  }
  return parses;
}

test("repeated history lookups parse the stored snapshot once", async () => {
  const entries = Array.from({ length: 50 }, (_, index) => movie(`tt${1000 + index}`, `M${index}`));
  store(entries, [{ movie: { title: "M3", ids: { imdb: "tt1003" } }, progress: 40 }]);
  reads.clear();
  const parses = await countParses(async () => {
    for (let round = 0; round < 3; round += 1) {
      await SimklSyncService.getWatchedItems();
      await SimklSyncService.getProgressSnapshot();
      SimklSyncService.findEntry(SimklSyncService.getSnapshot(), { contentId: "tt1040" });
      SimklSyncService.isTrackedAsWatching("tt1040");
    }
  });
  assert.equal(parses, 1, "the snapshot text is parsed once until it changes");
  assert.ok(
    (reads.get("traktSettings") || 0) <= 25,
    `tracking settings are read per lookup, not per entry (read ${reads.get("traktSettings")} times)`
  );
});

test("history items handed out stay detached from the cache", async () => {
  store([movie("tt1", "One")]);
  const [first] = await SimklSyncService.getWatchedItems();
  first.title = "changed";
  const [again] = await SimklSyncService.getWatchedItems();
  assert.equal(again.title, "One");
});

test("a changed snapshot or anime preference is observed", async () => {
  store([movie("tt1", "One")]);
  assert.equal((await SimklSyncService.getWatchedItems()).length, 1);
  store([movie("tt1", "One"), movie("tt2", "Two")]);
  assert.equal((await SimklSyncService.getWatchedItems()).length, 2, "external writes are seen");

  store([movie("tt9", "Anime", 77)]);
  assert.equal((await SimklSyncService.getWatchedItems())[0].contentId, "tt9");
  TraktSettingsStore.set({ simklAnimeIdPreference: SimklAnimeIdPreference.MAL });
  try {
    assert.equal((await SimklSyncService.getWatchedItems())[0].contentId, "mal:77");
    assert.equal(
      SimklSyncService.findEntry(SimklSyncService.getSnapshot(), { contentId: "mal:77" })?.movie
        .title,
      "Anime"
    );
  } finally {
    TraktSettingsStore.set({ simklAnimeIdPreference: SimklAnimeIdPreference.IMDB });
  }
});

test("findEntry returns the first entry that matches any candidate id", async () => {
  store([movie("tt5", "First"), movie("tt6", "Second"), movie("tt5", "Duplicate")]);
  const snapshot = SimklSyncService.getSnapshot();
  assert.equal(
    SimklSyncService.findEntry(snapshot, { contentId: "tt6", imdbId: "tt5" })?.movie.title,
    "First"
  );
  assert.equal(SimklSyncService.findEntry(snapshot, { contentId: "TT6" })?.movie.title, "Second");
  assert.equal(SimklSyncService.findEntry(snapshot, { contentId: "tt404" }), undefined);
  assert.equal(await countParses(() => SimklSyncService.getSnapshot()), 0);
});

const HOUR_MS = 60 * 60 * 1000;

function partialOnDevice(imdbId, updatedAt) {
  return {
    contentId: imdbId,
    contentType: "movie",
    imdbId,
    videoId: imdbId,
    positionMs: 30 * 60 * 1000,
    durationMs: 120 * 60 * 1000,
    updatedAt
  };
}

async function continueWatchingWith(deviceItem) {
  const { historyItems } = await SimklSyncService.getProgressSnapshot();
  return deduplicateInProgress([...historyItems, deviceItem]).map((item) => item.contentId);
}

test("a movie Simkl lists as watched without a date keeps its newer partial progress", async () => {
  const syncedAt = Date.now();
  store([{ ...movie("tt5", "Undated"), last_watched_at: null }], [], syncedAt);
  assert.deepEqual(await continueWatchingWith(partialOnDevice("tt5", syncedAt - HOUR_MS)), ["tt5"]);
});

test("a movie finished on another device after the partial progress leaves Continue Watching", async () => {
  const finishedAt = Date.now();
  store([{ ...movie("tt6", "Finished"), last_watched_at: new Date(finishedAt).toISOString() }]);
  assert.deepEqual(await continueWatchingWith(partialOnDevice("tt6", finishedAt - HOUR_MS)), []);
});
