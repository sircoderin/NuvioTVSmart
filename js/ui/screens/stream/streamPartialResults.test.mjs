import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { createStreamScreenMethods04 } = await import("./streamScreenMethods-04-load-streams.js");
const { createStreamScreenMethods10 } = await import("./streamScreenMethods-10-play-stream.js");
const { createStreamScreenMethods01 } =
  await import("./streamScreenMethods-01-cancel-scheduled-render.js");
const { createStreamScreenMethods09 } = await import("./streamScreenMethods-09-render.js");
const { streamRepository } = await import("../../../data/repository/streamRepository.js");
const { StreamBadgeSettingsStore } =
  await import("../../../data/local/streamBadgeSettingsStore.js");
const { Router } = await import("../../navigation/routerState.js");
const { Platform } = await import("../../../platform/index.js");
const { resetTvRuntimePerformanceProfile } =
  await import("../../../platform/tvRuntimePerformance.js");

test("the first source can play while a second source is still pending", async () => {
  const originals = {
    getStreams: streamRepository.getStreamsFromAllAddons,
    snapshot: StreamBadgeSettingsStore.snapshot,
    navigate: Router.navigate,
    pause: streamRepository.setLocalPluginSearchPaused
  };
  let finish;
  const pendingSource = new Promise((resolve) => {
    finish = resolve;
  });
  let options;
  let navigated;
  streamRepository.getStreamsFromAllAddons = (_type, _id, nextOptions) => {
    options = nextOptions;
    return pendingSource;
  };
  StreamBadgeSettingsStore.snapshot = () => ({ showAddonLogo: false, rules: { imports: [] } });
  Router.navigate = (route, params) => {
    navigated = { route, params };
  };
  streamRepository.setLocalPluginSearchPaused = () => {};
  const renders = [];
  const screen = {
    ...createStreamScreenMethods04(),
    ...createStreamScreenMethods10(),
    streams: [],
    loadToken: 1,
    hasRenderedStreamRouteShell: true,
    params: {
      itemType: "series",
      itemId: "series",
      videoId: "series:2:16",
      resumePositionMs: 60000,
      resumeDurationMs: 1800000
    },
    requestRender(options) {
      renders.push(options);
    },
    applyAddonLogos: (streams) => streams,
    scheduleDebridPreparation() {},
    maybeAutoResumeStream() {},
    maybeAutoPlayStream() {},
    scheduleErrorChipCleanup() {},
    getFilteredStreams() {
      return this.streams;
    },
    cancelScheduledRender() {},
    cancelAutoPlayCountdown() {},
    cancelAutoPlaySelectionWait() {},
    getBackdropUrl: () => ""
  };
  const fastGroup = {
    addonName: "Fast",
    addonOrderIndex: 0,
    streams: [{ id: "fast", url: "https://example.test/fast.mp4", name: "Fast 1080p" }]
  };
  let loading;
  try {
    loading = screen.loadStreams();
    assert.ok(options);
    options.onAddon({ name: "Fast", orderIndex: 0 });
    options.onAddon({ name: "Slow", orderIndex: 1 });
    options.onChunk({ status: "success", data: [fastGroup] });
    assert.equal(screen.loading, false);
    assert.equal(screen.streamSearchCompleted, false);
    assert.equal(screen.sourceChips.find((chip) => chip.name === "Slow").status, "loading");
    assert.equal(renders.at(-1).delayMs, 0);
    const signal = options.signal;
    await screen.playStream(screen.streams[0].id);
    assert.equal(signal.aborted, true, "selecting a source stops picker loading immediately");
    options.onChunk({
      status: "success",
      data: [{ ...fastGroup, streams: [{ id: "late", url: "https://example.test/late.mp4" }] }]
    });
    assert.equal(
      screen.streams.length,
      1,
      "late sources cannot rebuild the picker during selection"
    );
    assert.equal(navigated.route, "player");
    assert.equal(navigated.params.streamUrl, "https://example.test/fast.mp4");
    assert.equal(navigated.params.resumePositionMs, 60000);
    assert.equal(screen.streamSearchCompleted, false, "selection must not await the slow source");
  } finally {
    finish({ status: "success", data: [fastGroup] });
    await loading;
    streamRepository.getStreamsFromAllAddons = originals.getStreams;
    StreamBadgeSettingsStore.snapshot = originals.snapshot;
    Router.navigate = originals.navigate;
    streamRepository.setLocalPluginSearchPaused = originals.pause;
  }
});

test("constrained TVs bound card rendering while an ordinary source list grows", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousPlatform = globalThis.__NUVIO_PLATFORM__;
  const previousAdapter = Platform.current;
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Chrome/87.0" }
    });
    globalThis.__NUVIO_PLATFORM__ = "webos";
    Platform.current = null;
    resetTvRuntimePerformanceProfile();
    const screen = {
      ...createStreamScreenMethods01(),
      streams: [],
      isLegacyWebOsRoute: () => false,
      focusState: { row: 0 },
      listScrollTop: 0
    };
    const streams = Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      url: `https://example.test/${i}.mp4`
    }));
    assert.equal(screen.shouldUseStreamVirtualization(streams), true);
    let cards = 0;
    screen.renderStreamCard = () => {
      cards++;
      return "<article></article>";
    };
    screen.renderStreamVirtualMarkup(streams, true, {});
    assert.ok(cards < 20, `only nearby cards should be rendered, got ${cards}`);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
    if (previousPlatform === undefined) delete globalThis.__NUVIO_PLATFORM__;
    else globalThis.__NUVIO_PLATFORM__ = previousPlatform;
    Platform.current = previousAdapter;
    resetTvRuntimePerformanceProfile();
  }
});

test("late source insertion preserves the selected stream through virtualization", () => {
  const methods = { ...createStreamScreenMethods01(), ...createStreamScreenMethods09() };
  const previous = [
    { id: "first", url: "https://example.test/first.mp4" },
    { id: "selected", url: "https://example.test/selected.mp4" }
  ];
  const stopBeforeMarkup = new Error("focus checked before rendering markup");
  const originalSnapshot = StreamBadgeSettingsStore.snapshot;
  StreamBadgeSettingsStore.snapshot = () => ({ showAddonLogo: false, rules: { imports: [] } });
  try {
    for (const virtualized of [false, true]) {
      const next = [{ id: "earlier", url: "https://example.test/earlier.mp4" }, ...previous];
      const screen = {
        ...methods,
        focusState: { zone: "card", row: 1, action: "play" },
        focusedElement: { dataset: { streamId: "selected" } },
        renderedStreamListStreams: previous,
        listScrollTop: 0,
        cancelScheduledRender() {},
        getHeaderMeta: () => ({}),
        getBackdropUrl: () => "",
        buildSourceChipMarkup: () => "",
        getFilteredStreams: () => next,
        hasPendingSourceLoads: () => true,
        shouldUseStreamVirtualization: () => virtualized,
        renderStreamCard() {
          throw stopBeforeMarkup;
        },
        renderStreamVirtualMarkup() {
          throw stopBeforeMarkup;
        }
      };
      assert.throws(
        () => screen.render(),
        (error) => error === stopBeforeMarkup
      );
      assert.equal(
        screen.focusState.row,
        2,
        "focus follows the selected stream rather than its old row"
      );
      assert.equal(screen.focusState.action, "play");
    }
  } finally {
    StreamBadgeSettingsStore.snapshot = originalSnapshot;
  }
});

test("a slower first-ranked source takes initial focus until the user moves", async () => {
  const originals = {
    getStreams: streamRepository.getStreamsFromAllAddons,
    snapshot: StreamBadgeSettingsStore.snapshot
  };
  StreamBadgeSettingsStore.snapshot = () => ({ showAddonLogo: false, rules: { imports: [] } });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const group = (addonName, addonOrderIndex, id) => ({
    addonName,
    addonOrderIndex,
    streams: [{ id, url: `https://example.test/${id}.mp4`, name: id }]
  });
  try {
    for (const userMoved of [false, true]) {
      let options;
      let finish;
      streamRepository.getStreamsFromAllAddons = (_type, _id, nextOptions) => {
        options = nextOptions;
        return new Promise((resolve) => {
          finish = resolve;
        });
      };
      const screen = {
        ...createStreamScreenMethods04(),
        streams: [],
        loadToken: 1,
        hasRenderedStreamRouteShell: true,
        params: { itemType: "movie", itemId: "movie", videoId: "movie" },
        requestRender() {},
        applyAddonLogos: (streams) => streams,
        scheduleDebridPreparation() {},
        maybeAutoResumeStream() {},
        maybeAutoPlayStream() {},
        scheduleErrorChipCleanup() {},
        getFilteredStreams() {
          return this.streams;
        }
      };
      const loading = screen.loadStreams();
      options.onAddon({ name: "Preferred", orderIndex: 0 });
      options.onAddon({ name: "Quick", orderIndex: 1 });
      options.onChunk({ status: "success", data: [group("Quick", 1, "quick")] });
      await flush();
      if (userMoved) {
        screen.streamFocusUserMoved = true;
        screen.focusState = { zone: "card", row: 0, action: "native" };
      }
      options.onChunk({ status: "success", data: [group("Preferred", 0, "preferred")] });
      await flush();
      assert.deepEqual(
        screen.streams.map((stream) => stream.id),
        ["preferred", "quick"]
      );
      if (userMoved) {
        assert.equal(
          screen.streamVirtualFocusReset,
          undefined,
          "user focus is left to identity tracking"
        );
        assert.equal(screen.focusState.action, "native");
      } else {
        assert.equal(screen.focusState.row, 0);
        assert.equal(
          screen.streamVirtualFocusReset,
          true,
          "render must not pin focus to the quick source"
        );
      }
      finish({ status: "success", data: [] });
      await loading;
    }
  } finally {
    streamRepository.getStreamsFromAllAddons = originals.getStreams;
    StreamBadgeSettingsStore.snapshot = originals.snapshot;
  }
});
