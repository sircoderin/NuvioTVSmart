import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { createPlayerScreenMethods62 } =
  await import("./playerScreenMethods-62-render-audio-control-item.js");
const { createPlayerScreenMethods63 } =
  await import("./playerScreenMethods-63-get-source-request-key.js");
const { StreamBadgeSettingsStore } =
  await import("../../../data/local/streamBadgeSettingsStore.js");

test("the sources panel renders one batch of a long stream list", () => {
  const originalSnapshot = StreamBadgeSettingsStore.snapshot;
  StreamBadgeSettingsStore.snapshot = () => ({ showAddonLogo: false, rules: { imports: [] } });
  let markup = "";
  const panel = {
    childNodes: [],
    classList: { toggle() {} },
    querySelector: () => null,
    set innerHTML(value) {
      markup = value;
    }
  };
  const screen = {
    ...createPlayerScreenMethods62(),
    ...createPlayerScreenMethods63(),
    uiRefs: { sourcesPanel: panel },
    sourcesPanelVisible: true,
    sourceFilter: "all",
    sourcesFocus: { zone: "filter", index: 0 },
    currentStreamIndex: 0,
    params: {},
    streamCandidates: Array.from({ length: 199 }, (_, i) => ({
      id: String(i),
      url: `https://example.test/${i}.mp4`,
      label: `Stream ${i}`,
      addonName: "Addon"
    }))
  };
  const countCards = () => markup.match(/data-sources-zone="list"/g)?.length || 0;
  try {
    screen.renderSourcesPanel();
    assert.equal(countCards(), 10);
    screen.sourcesFocus = { zone: "list", index: 60 };
    screen.renderSourcesPanel();
    assert.ok(countCards() > 60 && countCards() < 80, `focus stays rendered, got ${countCards()}`);
  } finally {
    StreamBadgeSettingsStore.snapshot = originalSnapshot;
  }
});
