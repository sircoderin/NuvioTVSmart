import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear()
};
const { addonRepository } = await import("./addonRepository.js");

test("addon enabled states reuse a parse until storage or profiles change", () => {
  const url = "https://addon.example.test/manifest.json";
  let normalizeCalls = 0;
  const normalize = addonRepository.normalizeAddonEnabledStates;
  addonRepository.normalizeAddonEnabledStates = function (value) {
    normalizeCalls += 1;
    return normalize.call(this, value);
  };
  try {
    addonRepository.setAddonEnabledStates([{ url, enabled: false }]);
    assert.equal(addonRepository.isAddonEnabled(url), false);
    const callsAfterRead = normalizeCalls;
    addonRepository.getAddonEnabledStates();
    addonRepository.isAddonEnabled(url);
    assert.equal(normalizeCalls, callsAfterRead, "repeated reads use the cached envelope");

    const states = addonRepository.getAddonEnabledStates();
    Object.keys(states).forEach((key) => {
      states[key] = true;
    });
    assert.equal(addonRepository.isAddonEnabled(url), false, "returned states stay detached");

    const envelope = JSON.parse(storage.get("installedAddonEnabledStates"));
    Object.keys(envelope.profiles["1"]).forEach((key) => {
      envelope.profiles["1"][key] = true;
    });
    storage.set("installedAddonEnabledStates", JSON.stringify(envelope));
    assert.equal(addonRepository.isAddonEnabled(url), true, "external writes are observed");

    const callsBeforeProfiles = normalizeCalls;
    storage.set("profiles", JSON.stringify([{ id: "2", usesPrimaryAddons: true }]));
    addonRepository.getAddonEnabledStates();
    assert.ok(normalizeCalls > callsBeforeProfiles, "a profile list change re-normalizes");
  } finally {
    addonRepository.normalizeAddonEnabledStates = normalize;
    storage.clear();
  }
});
