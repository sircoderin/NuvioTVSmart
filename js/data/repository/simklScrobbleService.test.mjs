import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  get length() {
    return storage.size;
  },
  key: (index) => [...storage.keys()][index] ?? null,
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear()
};
globalThis.__NUVIO_ENV__ = { SIMKL_CLIENT_ID: "test-client" };
console.warn = () => {};

const requests = [];
let respond = () => new Response("{}", { status: 200 });
globalThis.fetch = (url, init = {}) => {
  const request = { path: new URL(url).pathname, keepalive: init.keepalive === true };
  requests.push(request);
  return Promise.resolve(respond(request, init));
};

const { SimklAuthStore } = await import("../local/simklAuthStore.js");
const { SimklScrobbleService } = await import("./simklScrobbleService.js");
const { simklRequest } = await import("./simklAuthService.js");
SimklAuthStore.saveToken("token");

const context = {
  contentId: "tt0926084",
  imdbId: "tt0926084",
  contentType: "movie",
  title: "Movie",
  progressPercent: 42
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitForRequests(count) {
  const deadline = Date.now() + 3000;
  while (requests.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await settle();
}

// Writes are spaced by the rate limiter, so the start may wait about a second.
async function startSession(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  SimklScrobbleService.start(context);
  t.mock.timers.tick(15000);
  t.mock.timers.reset();
  await waitForRequests(1);
}

function reset(t) {
  requests.length = 0;
  respond = () => new Response("{}", { status: 200 });
  SimklScrobbleService.cancel();
  t.after(() => SimklScrobbleService.cancel());
}

test("closing the app reports the stop at once, in a request that outlives the page", async (t) => {
  reset(t);
  let releaseSync;
  respond = (request) =>
    request.path === "/sync/activities"
      ? new Promise((resolve) => {
          releaseSync = () => resolve(new Response("{}", { status: 200 }));
        })
      : new Response("{}", { status: 200 });
  const sync = simklRequest("/sync/activities");
  await settle();

  SimklScrobbleService.stop(context, { urgent: true });
  await settle();
  assert.deepEqual(requests.at(-1), { path: "/scrobble/stop", keepalive: true });
  releaseSync();
  await sync;
});

test("hiding playback reports a pause at once, ahead of a pause still queued", async (t) => {
  reset(t);
  await startSession(t);
  assert.deepEqual(requests, [{ path: "/scrobble/start", keepalive: false }]);

  SimklScrobbleService.pause(context);
  SimklScrobbleService.suspend(context);
  await settle();
  assert.deepEqual(requests.slice(1), [{ path: "/scrobble/pause", keepalive: true }]);

  await waitForRequests(3);
  assert.deepEqual(requests.at(-1), { path: "/scrobble/pause", keepalive: false });
});

test("hiding the app sends nothing when no playback was reported", async (t) => {
  reset(t);
  SimklScrobbleService.suspend(context);
  await settle();
  assert.deepEqual(requests, []);
});

test("a runtime that refuses keepalive still sends the report", async (t) => {
  reset(t);
  respond = (request) =>
    request.keepalive
      ? Promise.reject(new TypeError("keepalive unsupported"))
      : new Response("{}", { status: 200 });
  SimklScrobbleService.stop(context, { urgent: true });
  await settle();
  await settle();
  assert.deepEqual(requests, [
    { path: "/scrobble/stop", keepalive: true },
    { path: "/scrobble/stop", keepalive: false }
  ]);
});
