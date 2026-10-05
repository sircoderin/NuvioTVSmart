import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { createPlayerScreenMethods28 } =
  await import("./playerScreenMethods-28-unbind-video-events.js");

test("playback changes preserve focused controls and do not rewrite unchanged icons", () => {
  let controls = [
    { action: "playPause", primary: true, icon: "pause.svg", title: "Pause" },
    { action: "subtitles", icon: "subtitles.svg", title: "Subtitles" }
  ];
  let buttons = [];
  let rebuilds = 0;
  const originalDocument = globalThis.document;
  globalThis.document = { activeElement: null };
  const wrap = {
    querySelectorAll: () => buttons,
    set innerHTML(value) {
      rebuilds++;
      buttons = [...value.matchAll(/data-action="([^"]+)"/g)].map((match) => ({
        dataset: { action: match[1] },
        writes: 0,
        classList: { toggle() {} },
        set innerHTML(value) {
          this.writes++;
          this.content = value;
        },
        focus() {
          globalThis.document.activeElement = this;
        },
        blur() {
          if (globalThis.document.activeElement === this) globalThis.document.activeElement = null;
        }
      }));
    }
  };
  const screen = {
    ...createPlayerScreenMethods28(),
    uiRefs: { controlButtons: wrap },
    controlFocusZone: "buttons",
    controlFocusIndex: 0,
    isExternalFrameMode: () => false,
    isPostPlayVisible: () => false,
    isPostPlayLoading: () => false,
    getControlDefinitions: () => controls,
    syncSkipIntroFocusState() {},
    renderNextEpisodeCard() {},
    syncNextEpisodeCardFocusState() {},
    syncPlayerOverlayLayoutState() {},
    renderBitmapSubtitleAtCurrentTime() {}
  };
  try {
    screen.renderControlButtons();
    const originalButtons = [...buttons];
    controls = [{ ...controls[0], icon: "play.svg", title: "Play" }, controls[1]];
    screen.renderControlButtons();
    assert.equal(rebuilds, 1);
    assert.deepEqual(buttons, originalButtons);
    assert.equal(globalThis.document.activeElement, originalButtons[0]);
    assert.equal(buttons[0].writes, 1);
    assert.match(buttons[0].content, /play\.svg/);
    assert.equal(buttons[0].title, "Play");
    assert.equal(buttons[1].writes, 0);
    screen.renderControlButtons();
    assert.equal(buttons[0].writes, 1, "duplicate playback events must not replace icons");
    controls = [{ action: "backFromMore", label: "Back" }];
    screen.renderControlButtons();
    assert.equal(rebuilds, 2, "a different menu still rebuilds its controls");
    assert.equal(buttons[0].dataset.action, "backFromMore");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
