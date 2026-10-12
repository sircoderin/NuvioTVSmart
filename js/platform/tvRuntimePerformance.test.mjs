import assert from "node:assert/strict";
import { test } from "node:test";
import { Platform } from "./index.js";
import {
  getTvRuntimePerformanceProfile,
  getTvHeroTransitionMode,
  resetTvRuntimePerformanceProfile
} from "./tvRuntimePerformance.js";

function profile(platform, chromium, mode = "auto") {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousOverride = globalThis.__NUVIO_PLATFORM__;
  const previousAdapter = Platform.current;
  const previousStorage = globalThis.localStorage;
  try {
    globalThis.localStorage = { getItem: () => JSON.stringify(mode) };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: `Chrome/${chromium}.0` }
    });
    globalThis.__NUVIO_PLATFORM__ = platform;
    Platform.current = null;
    resetTvRuntimePerformanceProfile();
    return getTvRuntimePerformanceProfile();
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
    if (previousOverride === undefined) delete globalThis.__NUVIO_PLATFORM__;
    else globalThis.__NUVIO_PLATFORM__ = previousOverride;
    Platform.current = previousAdapter;
    resetTvRuntimePerformanceProfile();
  }
}

test("webOS 2022 and 2023 use lighter rendering without legacy API fallbacks", () => {
  for (const chromium of [87, 94]) {
    const result = profile("webos", chromium);
    assert.equal(result.isPerformanceConstrained, true);
    assert.equal(result.isLegacyTvRuntime, false);
    assert.equal(getTvHeroTransitionMode(result), "single-layer");
  }
});

test("newer webOS and desktop keep modern rendering", () => {
  assert.equal(profile("webos", 108).isPerformanceConstrained, false);
  assert.equal(profile("browser", 87).isPerformanceConstrained, false);
});

test("old and unidentified webOS retain their existing fallbacks", () => {
  for (const chromium of [68, 0]) {
    const result = profile("webos", chromium);
    assert.equal(result.isPerformanceConstrained, true);
    assert.equal(result.isLegacyTvRuntime, true);
  }
});

test("rendering overrides do not change legacy API classification", () => {
  assert.equal(profile("webos", 87, "full").isPerformanceConstrained, false);
  assert.equal(profile("webos", 87, "full").isLegacyTvRuntime, false);
  assert.equal(profile("webos", 68, "full").isLegacyTvRuntime, true);
  assert.equal(profile("webos", 108, "reduced").isPerformanceConstrained, true);
  assert.equal(profile("webos", 108, "reduced").isLegacyTvRuntime, false);
});
