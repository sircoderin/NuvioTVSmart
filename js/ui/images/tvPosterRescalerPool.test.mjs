import { test } from "node:test";
import assert from "node:assert/strict";

// The pool has to be driven for real to show these: both defects are about
// what happens between a job being queued and a worker answering, so a mocked
// worker is the only way to hold a job open and inspect the result.
Object.defineProperty(globalThis, "navigator", {
  value: { hardwareConcurrency: 2, deviceMemory: 1 },
  configurable: true
});

const created = [];
const revoked = [];
let nextUrl = 0;
URL.createObjectURL = () => `blob:fake-${(nextUrl += 1)}`;
URL.revokeObjectURL = (url) => revoked.push(url);

class FakeWorker {
  constructor() {
    this.posted = [];
    this.terminated = false;
    created.push(this);
  }
  postMessage(message) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}
globalThis.Worker = FakeWorker;

const { rescaleHomeArtwork, releaseHomeArtwork, resetHomeArtworkRescaler } =
  await import("./tvPosterRescaler.js");

function reset() {
  resetHomeArtworkRescaler();
  created.length = 0;
  revoked.length = 0;
}

/** Answer every job the pool has handed out, newest batch included. */
function drain() {
  let answered = 0;
  for (let round = 0; round < 2000; round += 1) {
    const worker = created.find((candidate) => !candidate.terminated && candidate.posted.length);
    if (!worker) {
      return answered;
    }
    const job = worker.posted.shift();
    worker.onmessage({ data: { id: job.id, ok: true, blob: { size: 1 } } });
    answered += 1;
  }
  return answered;
}

const BOX = { width: 220, height: 338, fit: "cover" };

test("two cards sharing one rescale each hold a reference to its url", async () => {
  reset();
  // Both cards ask for the same artwork before the worker answers, so they
  // share one job and one url.
  const first = rescaleHomeArtwork("https://art/shared.jpg", BOX);
  const second = rescaleHomeArtwork("https://art/shared.jpg", BOX);
  drain();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b, "both cards must get the same url");

  // One card scrolls away and hands its reference back. The other is still
  // painting from the url, so it must survive cache pressure.
  releaseHomeArtwork(a);
  for (let index = 0; index < 220; index += 1) {
    const filler = rescaleHomeArtwork(`https://art/filler-${index}.jpg`, BOX);
    drain();
    releaseHomeArtwork(await filler);
  }
  assert.ok(
    !revoked.includes(a),
    "a url a second card is still painting must not be revoked when the cache is trimmed"
  );
});

test("a shared url is reclaimed once every card has released it", async () => {
  reset();
  const first = rescaleHomeArtwork("https://art/both.jpg", BOX);
  const second = rescaleHomeArtwork("https://art/both.jpg", BOX);
  drain();
  const [a, b] = await Promise.all([first, second]);
  releaseHomeArtwork(a);
  releaseHomeArtwork(b);
  for (let index = 0; index < 220; index += 1) {
    const filler = rescaleHomeArtwork(`https://art/spill-${index}.jpg`, BOX);
    drain();
    releaseHomeArtwork(await filler);
  }
  assert.ok(revoked.includes(a), "nothing holds the url any more, so the slot must be reclaimed");
});

test("tearing the pool down settles the jobs a worker is still holding", async () => {
  reset();
  const running = rescaleHomeArtwork("https://art/inflight.jpg", BOX);
  assert.ok(
    created.some((worker) => worker.posted.length),
    "the job must actually be with a worker before teardown"
  );
  resetHomeArtworkRescaler();
  assert.equal(
    await running,
    null,
    "a caller waiting on a dead pool must fall back to the original url"
  );
});

test("tearing the pool down settles queued jobs and every shared waiter", async () => {
  reset();
  // More jobs than workers, so some are still in the queue at teardown.
  const promises = [
    rescaleHomeArtwork("https://art/q1.jpg", BOX),
    rescaleHomeArtwork("https://art/q2.jpg", BOX),
    rescaleHomeArtwork("https://art/q3.jpg", BOX),
    rescaleHomeArtwork("https://art/q4.jpg", BOX),
    rescaleHomeArtwork("https://art/q1.jpg", BOX)
  ];
  resetHomeArtworkRescaler();
  assert.deepEqual(await Promise.all(promises), [null, null, null, null, null]);
});

test("teardown never produces a url from a dead pool", async () => {
  reset();
  const running = rescaleHomeArtwork("https://art/late.jpg", BOX);
  const worker = created.find((candidate) => candidate.posted.length);
  const job = worker.posted.shift();
  resetHomeArtworkRescaler();
  // A reply that was already in flight when the pool went away.
  worker.onmessage({ data: { id: job.id, ok: true, blob: { size: 1 } } });
  assert.equal(await running, null, "artwork from a torn-down pool must never be handed to a card");
});

test("an unsupported fit is refused before any worker is started", async () => {
  reset();
  assert.equal(
    await rescaleHomeArtwork("https://art/x.jpg", { width: 220, height: 338, fit: "contain" }),
    null
  );
  assert.equal(created.length, 0, "nothing should spin up for artwork that cannot be rescaled");
});

/** An Image that loads (or fails) as soon as its src is set. */
function fakeImage(loads) {
  return class {
    set src(value) {
      this.naturalWidth = loads ? 1 : 0;
      (loads ? this.onload : this.onerror)?.();
    }
  };
}

/** Answer the url probe and every job, with urls the worker created. */
function drainWithWorkerUrls() {
  for (let round = 0; round < 2000; round += 1) {
    const worker = created.find(
      (candidate) =>
        !candidate.terminated && candidate.posted.some((message) => message.probe || message.id)
    );
    if (!worker) return;
    const index = worker.posted.findIndex((message) => message.probe || message.id);
    const [message] = worker.posted.splice(index, 1);
    if (message.probe) worker.onmessage({ data: { probeUrl: "blob:probe" } });
    else
      worker.onmessage({
        data: message.publishUrl
          ? { id: message.id, ok: true, objectUrl: `blob:worker-${message.id}` }
          : { id: message.id, ok: true, blob: { size: 1 } }
      });
  }
}

async function withImage(loads, run) {
  globalThis.Image = fakeImage(loads);
  try {
    reset();
    await run();
  } finally {
    delete globalThis.Image;
    reset();
  }
}

test("workers create poster urls once the page has displayed one of theirs", () =>
  withImage(true, async () => {
    const first = rescaleHomeArtwork("https://art/first.jpg", BOX);
    drainWithWorkerUrls();
    await first;
    const second = rescaleHomeArtwork("https://art/second.jpg", BOX);
    drainWithWorkerUrls();
    assert.match(await second, /^blob:worker-/);
    assert.ok(
      created.some((worker) => worker.posted.some((message) => message.revoke === "blob:probe")),
      "the probe url is revoked by the worker that created it"
    );
  }));

test("a retired worker's urls are not handed out again", () =>
  withImage(true, async () => {
    const warmup = rescaleHomeArtwork("https://art/warmup.jpg", BOX);
    drainWithWorkerUrls();
    await warmup;
    const first = rescaleHomeArtwork("https://art/dies.jpg", BOX);
    drainWithWorkerUrls();
    const url = await first;
    assert.match(url, /^blob:worker-/);
    for (const worker of created.filter((candidate) => !candidate.terminated)) worker.onerror();
    const again = rescaleHomeArtwork("https://art/dies.jpg", BOX);
    drainWithWorkerUrls();
    assert.notEqual(await again, url, "the dead url must not come back from the cache");
  }));

test("pages that cannot display worker urls keep creating them on the main thread", () =>
  withImage(false, async () => {
    rescaleHomeArtwork("https://art/first.jpg", BOX);
    drainWithWorkerUrls();
    const pending = rescaleHomeArtwork("https://art/second.jpg", BOX);
    drainWithWorkerUrls();
    assert.match(await pending, /^blob:fake-/);
  }));

test("trimming the cache revokes worker urls through the worker", () =>
  withImage(true, async () => {
    rescaleHomeArtwork("https://art/warmup.jpg", BOX);
    drainWithWorkerUrls();
    const url = rescaleHomeArtwork("https://art/kept.jpg", BOX);
    drainWithWorkerUrls();
    const kept = await url;
    assert.match(kept, /^blob:worker-/);
    releaseHomeArtwork(kept);
    for (let index = 0; index < 220; index += 1) {
      const filler = rescaleHomeArtwork(`https://art/trim-${index}.jpg`, BOX);
      drainWithWorkerUrls();
      releaseHomeArtwork(await filler);
    }
    assert.ok(
      created.some((worker) => worker.posted.some((message) => message.revoke === kept)),
      "the worker that created the url is asked to revoke it"
    );
    assert.ok(!revoked.includes(kept), "the page does not revoke a url it did not create");
  }));

/** Answer every waiting job with the same outcome. */
function drainFailed(result) {
  for (let round = 0; round < 2000; round += 1) {
    const worker = created.find((candidate) => !candidate.terminated && candidate.posted.length);
    if (!worker) return;
    const job = worker.posted.shift();
    worker.onmessage({ data: { id: job.id, ...result } });
  }
}

function postedJobs() {
  return created.reduce((total, worker) => total + worker.posted.length, 0);
}

test("a source that cannot be rescaled is not fetched again this session", async () => {
  reset();
  const box = { width: 220, height: 338, fit: "cover" };
  const first = rescaleHomeArtwork("https://art/not-jpeg.webp", box);
  drainFailed({ ok: false, reason: "not jpeg" });
  assert.equal(await first, null);
  assert.equal(postedJobs(), 0);

  assert.equal(await rescaleHomeArtwork("https://art/not-jpeg.webp", box), null);
  assert.equal(postedJobs(), 0, "the known non-JPEG source must not spin up another job");
});

test("a transient failure is still retried", async () => {
  reset();
  const box = { width: 220, height: 338, fit: "cover" };
  for (const reason of ["http 500", "http 404", "timeout"]) {
    reset();
    const first = rescaleHomeArtwork("https://art/flaky.jpg", box);
    drainFailed({ ok: false, reason });
    assert.equal(await first, null);

    const second = rescaleHomeArtwork("https://art/flaky.jpg", box);
    assert.ok(postedJobs() > 0, `${reason} must not be treated as permanent`);
    drain();
    assert.equal(typeof (await second), "string");
  }
});
