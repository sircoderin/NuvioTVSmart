// The webOS startup audio gate can settle after the loading overlay is gone.
// The UI tick must release it and show the parental guide without a user action.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { createPlayerScreenMethods30 } =
  await import("../js/ui/screens/player/playerScreenMethods-30-schedule-buffering-spinner-refresh.js");

function createScreen({ ready, gateActive = true, shown = false } = {}) {
  const events = [];
  const screen = {
    ...createPlayerScreenMethods30(),
    startupAudioGateActive: gateActive,
    parentalGuideShown: shown,
    isStartupGateReleaseReady: () => ready,
    releaseStartupAudioGate: () => {
      events.push("release");
      screen.startupAudioGateActive = false;
      screen.startupAudioGateDeadline = 0;
    },
    maybeShowParentalGuideOverlay: () => {
      events.push("show");
      if (!screen.startupAudioGateActive) {
        screen.parentalGuideShown = true;
      }
    }
  };
  return { screen, events };
}

test("keeps the gate while audio preference discovery is still pending", () => {
  const { screen, events } = createScreen({ ready: false });

  screen.syncStartupGateAndParentalGuide();

  assert.deepEqual(events, ["show"]);
  assert.equal(screen.startupAudioGateActive, true);
  assert.equal(screen.parentalGuideShown, false);
});

test("releases the gate and shows the parental guide once startup is settled", () => {
  const { screen, events } = createScreen({ ready: true });

  screen.syncStartupGateAndParentalGuide();

  assert.deepEqual(events, ["release", "show"]);
  assert.equal(screen.startupAudioGateActive, false);
  assert.equal(screen.parentalGuideShown, true);
});

test("does not release or show again after the startup sequence completed", () => {
  const { screen, events } = createScreen({ ready: true, gateActive: false, shown: true });

  screen.syncStartupGateAndParentalGuide();

  assert.deepEqual(events, []);
});

const { PlayerController } = await import("../js/core/player/playerController.js");

for (const blockedBy of [null, "loading", "dismiss", "error", "external"]) {
  test(`tick releases the presentation mute after loading hid early (${blockedBy})`, () => {
    const video = { muted: true, defaultMuted: true, volume: 1 };
    Object.assign(PlayerController, {
      video,
      startupAudioGateActive: false,
      startupPresentationAudioMuted: true,
      webOsDtsAudioState: null
    });
    const { screen } = createScreen({ ready: false, gateActive: false, shown: true });
    Object.assign(screen, {
      loadingVisible: blockedBy === "loading",
      isStartupLogoDismissReady: () => blockedBy !== "dismiss",
      isStartupErrorVisible: () => blockedBy === "error",
      isExternalFrameMode: () => blockedBy === "external"
    });

    screen.syncStartupGateAndParentalGuide();

    assert.equal(PlayerController.startupPresentationAudioMuted, blockedBy !== null);
    assert.equal(video.muted, blockedBy !== null);
  });
}
