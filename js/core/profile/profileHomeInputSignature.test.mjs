import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear()
};

const { ProfileSettingsSyncService } = await import("./profileSettingsSyncService.js");
const { FEATURE_ADAPTERS } =
  await import("./profileSettingsSyncServiceHelpers-04-feature-adapters.js");
const { buildComparableFeaturesFromLocal } =
  await import("./profileSettingsSyncServiceHelpers-05-supported-feature-names.js");
const { stableStringify } = await import("./profileSettingsSyncServiceHelpers-01-pull-rpc.js");

test("the Home input signature reads only the settings Home is built from", () => {
  const original = FEATURE_ADAPTERS.player_settings.export;
  FEATURE_ADAPTERS.player_settings.export = () => {
    throw new Error("player settings do not shape Home");
  };
  try {
    assert.equal(typeof ProfileSettingsSyncService.getHomeInputSignature("1"), "string");
  } finally {
    FEATURE_ADAPTERS.player_settings.export = original;
  }
});

test("the Home input signature is unchanged for the settings it covers", () => {
  const all = buildComparableFeaturesFromLocal("1");
  assert.equal(
    ProfileSettingsSyncService.getHomeInputSignature("1"),
    stableStringify({
      theme: all.theme_settings,
      layout: all.layout_settings,
      experience: all.experience_settings,
      trailer: all.trailer_settings,
      tmdb: all.tmdb_settings,
      mdblist: all.mdblist_settings,
      trakt: all.trakt_settings,
      streamBadges: all.stream_badge_settings
    })
  );
});
