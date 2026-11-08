// Reloads the TV app and presses D-pad keys as soon as Home is interactive,
// while catalogs are still loading. Used by tv-performance.mjs --early-nav.
const KEYS = [
  ...Array(8).fill(["ArrowDown", 40]),
  ...Array(6).fill(["ArrowRight", 39]),
  ...Array(8).fill(["ArrowUp", 38])
];
const KEY_GAP_MS = 350;
const INTERACTIVE_TIMEOUT_MS = 60000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Installed before the app loads. Key latency is timed from event.timeStamp,
// so time a key waits behind other work counts. "settled" is the first task
// after the next frame, which shows how much work was queued behind the key.
const PROBE = String.raw`(() => {
  window.__NUVIO_DEBUG_HOME_PERF__ = true;
  const probe = (window.__nuvioEarlyNavProbe = { longTasks: [], keys: [], renders: [], marks: {} });
  const info = console.info.bind(console);
  console.info = (label, data) => {
    if (label === "[home-perf] render" && data) probe.renders.push({ end: performance.now(), ms: data.ms });
    else if (typeof label !== "string" || !label.startsWith("[home-perf]")) info(label, data);
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) probe.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ entryTypes: ["longtask"] });
  } catch (_) {}
  const timer = setInterval(() => {
    const home = document.getElementById("home");
    if (home && home.querySelector(".focused") && home.querySelector(".home-content-card, .home-continue-card")) {
      probe.marks.homeInteractive = performance.now();
      clearInterval(timer);
    }
  }, 50);
  window.addEventListener("keydown", (event) => {
    const start = event.timeStamp > 0 ? event.timeStamp : performance.now();
    const sample = { key: event.key, at: start, queuedMs: performance.now() - start, nextFrameMs: null, settledMs: null, focus: "" };
    probe.keys.push(sample);
    requestAnimationFrame(() => {
      sample.nextFrameMs = performance.now() - start;
      setTimeout(() => {
        sample.settledMs = performance.now() - start;
        const node = document.querySelector("#home .focused");
        const row = node && node.closest("[data-row-key]");
        sample.focus = row ? row.dataset.rowKey : node ? node.className.split(" ")[0] : "none";
      }, 0);
    });
  }, true);
})();`;

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))])
    : null;
}

export async function runEarlyHomeNavigation({ call, evaluate, profile = false }) {
  await call("Page.enable");
  const { identifier } = await call("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
  try {
    await call("Page.reload", { ignoreCache: false });
    await sleep(1500);
    const waitStart = Date.now();
    let interactive = null;
    while (!interactive && Date.now() - waitStart < INTERACTIVE_TIMEOUT_MS) {
      interactive = await evaluate(
        "window.__nuvioEarlyNavProbe && window.__nuvioEarlyNavProbe.marks.homeInteractive"
      ).catch(() => null);
      if (!interactive) await sleep(100);
    }
    if (!interactive) throw new Error("Home did not become interactive within 60 s.");
    if (profile) {
      await call("Profiler.enable");
      await call("Profiler.setSamplingInterval", { interval: 2000 });
      await call("Profiler.start");
    }
    const navStart = await evaluate("performance.now()");
    for (const [key, code] of KEYS) {
      const event = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
      await call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...event });
      await call("Input.dispatchKeyEvent", { type: "keyUp", ...event });
      await sleep(KEY_GAP_MS);
    }
    await sleep(2500);
    const cpuProfile = profile ? (await call("Profiler.stop")).profile : null;
    const data = await evaluate(`(() => {
      const p = window.__nuvioEarlyNavProbe, s = ${navStart};
      return { interactive: p.marks.homeInteractive, navStart: s, keys: p.keys,
        renders: p.renders.map((r) => ({ start: r.end - r.ms, ms: r.ms })),
        longTasks: p.longTasks.filter((t) => t.start >= s) };
    })()`);
    const lastKeyAt = data.keys.length ? data.keys[data.keys.length - 1].at : data.navStart;
    const navRenders = data.renders.filter((r) => r.start >= data.navStart);
    const duringKeys = navRenders.filter((r) => r.start <= lastKeyAt);
    const summary = {
      homeInteractiveMs: Math.round(data.interactive),
      keys: data.keys.length,
      nextFrameP50: quantile(
        data.keys.map((k) => k.nextFrameMs),
        0.5
      ),
      nextFrameP95: quantile(
        data.keys.map((k) => k.nextFrameMs),
        0.95
      ),
      settledP95: quantile(
        data.keys.map((k) => k.settledMs),
        0.95
      ),
      worstKeys: data.keys
        .map((k) => Math.round(k.settledMs))
        .sort((a, b) => b - a)
        .slice(0, 5),
      queuedMax: quantile(
        data.keys.map((k) => k.queuedMs),
        1
      ),
      longTaskTotal: Math.round(data.longTasks.reduce((sum, t) => sum + t.duration, 0)),
      longTaskMax: Math.round(data.longTasks.reduce((max, t) => Math.max(max, t.duration), 0)),
      homeRendersDuringKeys: duringKeys.map((r) => Math.round(r.ms)),
      homeRendersAfterKeys: navRenders.length - duringKeys.length,
      focusPath: data.keys.map((k) => k.focus)
    };
    return { summary, data, cpuProfile };
  } finally {
    await call("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => {});
  }
}
