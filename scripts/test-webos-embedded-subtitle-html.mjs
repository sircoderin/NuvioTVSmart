import assert from "node:assert/strict";
import test from "node:test";

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "webos";

const { createPlayerScreenMethods44 } =
  await import("../js/ui/screens/player/playerScreenMethods-44-load-web-os-embedded-text-subtitle-window.js");
const { localMediaEmbeddedSubtitleRepository } =
  await import("../js/data/repository/localMediaEmbeddedSubtitleRepository.js");
const { PlayerController } = await import("../js/core/player/playerController.js");

const SRT_WINDOW = {
  windowStartSeconds: 0,
  windowEndSeconds: 60,
  codecId: "S_TEXT/UTF8",
  body: "1\n00:00:01,000 --> 00:00:03,000\nHello there\n"
};

function createScreen(subtitleRenderMode) {
  const methods = createPlayerScreenMethods44();
  const track = { sourceTrackId: 3, codec: "subrip" };
  const screen = Object.assign(Object.create(methods), {
    subtitleRenderMode,
    webOsEmbeddedTextSubtitleTrack: track,
    selectedEmbeddedSubtitleTrackIndex: 0,
    getTrackProbeUrl: () => "http://media.test/movie.mkv",
    parseSubtitleCues: (body) =>
      body.includes("Hello") ? [{ start: 1, end: 3, text: "Hello there" }] : [],
    renderHtmlSubtitleOverlayCue() {},
    renderHtmlSubtitleOverlayAtCurrentTime() {},
    scheduleHtmlSubtitleOverlayRender() {},
    destroyAssSubtitleRenderer() {},
    scheduleWebOsEmbeddedTextSubtitleWindowRefresh() {}
  });
  return screen;
}

for (const mode of ["native", "html"]) {
  test(`webOS embedded SRT uses the HTML overlay in ${mode} render mode`, async (t) => {
    const nativeVisibility = [];
    t.mock.method(localMediaEmbeddedSubtitleRepository, "getWindow", async () => SRT_WINDOW);
    t.mock.method(PlayerController, "setWebOsEmbeddedSubtitleNativeVisibility", (visible) => {
      nativeVisibility.push(visible);
      return true;
    });
    const screen = createScreen(mode);

    assert.equal(await screen.loadWebOsEmbeddedTextSubtitleWindow(1), true);
    assert.equal(screen.webOsEmbeddedTextSubtitleUsingHtml, true);
    assert.deepEqual(screen.htmlSubtitleCues, [{ start: 1, end: 3, text: "Hello there" }]);
    assert.deepEqual(nativeVisibility, [false]);
  });
}

test("webOS embedded SRT keeps the TV renderer when the window has no cues", async (t) => {
  const nativeVisibility = [];
  t.mock.method(localMediaEmbeddedSubtitleRepository, "getWindow", async () => ({
    ...SRT_WINDOW,
    body: ""
  }));
  t.mock.method(PlayerController, "setWebOsEmbeddedSubtitleNativeVisibility", (visible) => {
    nativeVisibility.push(visible);
    return true;
  });
  const screen = createScreen("native");

  assert.equal(await screen.loadWebOsEmbeddedTextSubtitleWindow(1), false);
  assert.notEqual(screen.webOsEmbeddedTextSubtitleUsingHtml, true);
  assert.deepEqual(nativeVisibility, []);
});
