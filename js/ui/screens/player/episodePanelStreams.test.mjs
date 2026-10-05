import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { createPlayerScreenMethods65 } =
  await import("./playerScreenMethods-65-render-parental-guide-overlay.js");
const { createPlayerScreenMethods66 } =
  await import("./playerScreenMethods-66-get-filtered-episode-panel-streams.js");
const { createPlayerScreenMethods67 } =
  await import("./playerScreenMethods-67-render-episode-streams-view.js");
const { streamRepository } = await import("../../../data/repository/streamRepository.js");
const { StreamBadgeSettingsStore } =
  await import("../../../data/local/streamBadgeSettingsStore.js");

const methods = {
  ...createPlayerScreenMethods65(),
  ...createPlayerScreenMethods66(),
  ...createPlayerScreenMethods67()
};
const makeStreams = (count, addonName = "Addon") =>
  Array.from({ length: count }, (_, i) => ({
    id: `${addonName}-${i}`,
    url: `https://example.test/${addonName}/${i}.mp4`,
    label: `${addonName} ${i}`,
    addonName
  }));
const makeScreen = (overrides = {}) => ({
  ...methods,
  episodes: [{ id: "show:1:2", season: 1, episode: 2, title: "Two" }],
  episodePanelIndex: 0,
  episodePanelVisible: true,
  episodePanelMode: "streams",
  episodePanelStreams: [],
  episodePanelStreamFilter: "all",
  episodePanelStreamFocus: { zone: "actions", index: 0 },
  params: { itemType: "series" },
  ...overrides
});

async function withStubs(run) {
  const originals = {
    snapshot: StreamBadgeSettingsStore.snapshot,
    pause: streamRepository.setLocalPluginSearchPaused
  };
  StreamBadgeSettingsStore.snapshot = () => ({ showAddonLogo: false, rules: { imports: [] } });
  streamRepository.setLocalPluginSearchPaused = () => {};
  try {
    await run();
  } finally {
    StreamBadgeSettingsStore.snapshot = originals.snapshot;
    streamRepository.setLocalPluginSearchPaused = originals.pause;
  }
}

test("a long stream list renders one batch of cards near focus", () =>
  withStubs(() => {
    const screen = makeScreen({ episodePanelStreams: makeStreams(199) });
    const countCards = (markup) => markup.match(/data-episode-stream-index=/g)?.length || 0;
    assert.equal(countCards(screen.renderEpisodeStreamsView()), 10);
    screen.episodePanelStreamFocus = { zone: "streams", index: 40 };
    const cards = countCards(screen.renderEpisodeStreamsView());
    assert.ok(
      cards > 40 && cards < 60,
      `focus stays rendered without the whole list, got ${cards}`
    );
  }));

test("streams show per source and the first-ranked source keeps focus", () =>
  withStubs(async () => {
    for (const userMoved of [false, true]) {
      let finish;
      let onChunk;
      const screen = makeScreen({
        getStreamCacheKey: () => "key",
        renderEpisodePanel() {},
        getPlayableStreamsForVideo(_id, _type, options) {
          onChunk = options.onChunk;
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
      });
      const loading = screen.openEpisodeStreamsView();
      const [quick] = makeStreams(1, "Quick");
      const [preferred] = makeStreams(1, "Preferred");
      onChunk([quick]);
      assert.deepEqual(screen.episodePanelStreams, [quick], "first source shows before the rest");
      assert.equal(screen.episodePanelStreamsLoading, true);
      if (userMoved) {
        screen.episodePanelStreamFocusUserMoved = true;
      }
      onChunk([preferred, quick]);
      assert.deepEqual(screen.episodePanelStreamFocus, {
        zone: "streams",
        index: userMoved ? 1 : 0
      });
      finish([preferred, quick]);
      await loading;
      assert.equal(screen.episodePanelStreamsLoading, false);
    }
  }));

test("moving through streams updates focus in place", () =>
  withStubs(() => {
    const node = (attributes, classes = []) => ({
      attributes,
      dataset: {},
      classList: {
        set: new Set(classes),
        add(name) {
          this.set.add(name);
        },
        remove(name) {
          this.set.delete(name);
        },
        contains(name) {
          return this.set.has(name);
        }
      }
    });
    const cards = [0, 1, 2].map((i) =>
      node({ "data-episode-stream-index": String(i) }, i === 0 ? ["focused"] : [])
    );
    const panel = node({});
    panel.dataset.episodePanelMode = "streams";
    panel.querySelector = (selector) =>
      cards.find(
        (card) =>
          selector ===
          `[data-episode-stream-index="${card.attributes["data-episode-stream-index"]}"]`
      ) || null;
    panel.querySelectorAll = (selector) =>
      selector === ".focused" ? cards.filter((card) => card.classList.contains("focused")) : [];
    let renders = 0;
    const screen = makeScreen({
      episodePanelStreams: makeStreams(3),
      episodePanelStreamFocus: { zone: "streams", index: 0 },
      episodePanelStreamRenderLimit: 30,
      uiRefs: { root: { querySelector: () => panel } },
      renderEpisodePanel() {
        renders++;
      },
      scrollEpisodePanelIntoView() {}
    });
    screen.handleEpisodePanelKey({ keyCode: 40 });
    assert.equal(renders, 0, "a focus move must not rebuild the stream cards");
    assert.deepEqual(
      cards.map((card) => card.classList.contains("focused")),
      [false, true, false]
    );
    assert.equal(screen.episodePanelStreamFocusUserMoved, true);
  }));
