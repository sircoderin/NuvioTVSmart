import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { Platform } = await import("../index.js");
const { resetTvRuntimePerformanceProfile } = await import("../tvRuntimePerformance.js");
const { markWebOsDirectSupabaseFetchFailed, shouldFetchWebOsSupabaseDirectly } =
  await import("./webosSupabaseProxy.js");

const BACKEND_URL = "https://api.nuvio.tv/rest/v1/rpc/sync_pull_profile_locks";

function withWebOsChromium(chromium, run) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousOverride = globalThis.__NUVIO_PLATFORM__;
  const previousAdapter = Platform.current;
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: `Web0S; Chrome/${chromium}.0` }
    });
    globalThis.__NUVIO_PLATFORM__ = "webos";
    Platform.current = null;
    resetTvRuntimePerformanceProfile();
    return run();
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
    if (previousOverride === undefined) delete globalThis.__NUVIO_PLATFORM__;
    else globalThis.__NUVIO_PLATFORM__ = previousOverride;
    Platform.current = previousAdapter;
    resetTvRuntimePerformanceProfile();
  }
}

test("current webOS fetches the backend directly until a direct request fails", () => {
  withWebOsChromium(79, () => {
    assert.equal(
      shouldFetchWebOsSupabaseDirectly(BACKEND_URL),
      false,
      "legacy webOS keeps the proxy"
    );
  });
  withWebOsChromium(87, () => {
    assert.equal(shouldFetchWebOsSupabaseDirectly("https://example.com/x"), false);
    assert.equal(shouldFetchWebOsSupabaseDirectly(BACKEND_URL), true);
    markWebOsDirectSupabaseFetchFailed();
    assert.equal(shouldFetchWebOsSupabaseDirectly(BACKEND_URL), false);
  });
});
