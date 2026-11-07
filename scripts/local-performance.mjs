// Local A/B performance harness for the webOS build. It serves the staged
// webOS app to headless Chromium that identifies as the TV's Chromium 87
// (so the app selects its constrained TV code paths), throttles the CPU, and
// replays recorded network responses. Numbers are for comparing builds on the
// same machine; they are not TV timings.
import http from "node:http";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(repoRoot, ".cache", "perf-local");
const option = (name, fallback) => {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

if (flag("help")) {
  console.log(`Usage: npm run perf:local -- [options]

Serves .cache/webos-package/app (stage it with --build) to headless Chromium
posing as the TV's Chromium 87, with CPU throttling and recorded network.

  --build              build with NUVIO_BUILD_CHROMIUM=87 and stage the webOS app first
  --record             refetch every response from the real network and save it
  --offline            replay only; unrecorded requests fail (default: unrecorded
                       requests are fetched once and saved, then replayed)
  --catalogs=N         Home rows served by a synthetic catalog addon built from
                       recorded Cinemeta posters (default 60; 0 disables)
  --runs=N             measured launches after one priming launch (default 3)
  --cpu=N              CPU slowdown factor (default 8)
  --latency=MS         replayed API/catalog response delay (default 150)
  --image-latency=MS   replayed image response delay (default 20)
  --keys=SPEC          D-pad sequence after Home settles (default Down*10,Right*6,Up*10)
  --key-gap=MS         wall time between keys (default 450)
  --state=FILE         JSON object of localStorage entries for the first launch
                       (default: a guest profile with the default addons)
  --label=NAME         result name (default: short commit hash, +dirty)
  --compare=FILE       print this run against an earlier result JSON
  --cpu-profile        save a CPU profile of the first measured launch and print
                       its top self-time functions
  --screenshot         save a screenshot after each launch settles (results folder)
  --chrome=PATH        Chromium binary (default: Playwright's cached headless shell,
                       or NUVIO_PERF_CHROME)

Results: .cache/perf-local/results/<label>.json. Fixtures: .cache/perf-local/fixtures.
Every launch reuses one browser profile, so launches after the first are warm
relaunches with stored data, as on the TV.`);
  process.exit(0);
}

const settings = {
  runs: Math.max(1, Number(option("runs", 3))),
  cpu: Math.max(1, Number(option("cpu", 8))),
  latency: Math.max(0, Number(option("latency", 150))),
  imageLatency: Math.max(0, Number(option("image-latency", 20))),
  keys: option("keys", "Down*10,Right*6,Up*10"),
  keyGap: Math.max(50, Number(option("key-gap", 450))),
  record: flag("record"),
  offline: flag("offline"),
  catalogs: Math.max(0, Number(option("catalogs", 60))),
  cpuProfile: flag("cpu-profile"),
  screenshot: flag("screenshot")
};
const TV_USER_AGENT =
  "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager";
const appDir = path.join(repoRoot, ".cache", "webos-package", "app");
const fixtureDir = path.join(cacheDir, "fixtures");
const resultDir = path.join(cacheDir, "results");
const SETTLE_QUIET_MS = 3000;
const BOOT_TIMEOUT_MS = 90000;

const SYNTHETIC_ADDON = "https://perf-catalogs.nuvio.test";
const SYNTHETIC_PAGE = 30;
const DEFAULT_STATE = {
  skipAuthQrGate: true,
  rememberLastProfile: true,
  hasEverSelectedProfile: true,
  activeProfileId: "1",
  hasSeenAuthQrOnFirstLaunch: true,
  experienceMode: { mode: "ADVANCED" }
};

function defaultState() {
  const urls = ["https://v3-cinemeta.strem.io", "https://opensubtitles-v3.strem.io"];
  if (settings.catalogs) urls.push(SYNTHETIC_ADDON);
  return { ...DEFAULT_STATE, installedAddonUrls: urls };
}

// Cinemeta's popular lists supply real titles and poster URLs; the synthetic
// rows rotate through them so neighbouring rows differ.
const metaPools = { movie: null, series: null };
async function loadMetaPool(type) {
  if (metaPools[type]) return metaPools[type];
  const url = `https://v3-cinemeta.strem.io/catalog/${type}/top.json`;
  const file = fixturePath("GET", url);
  let body;
  try {
    body = await readFile(`${file}.body`, "utf8");
  } catch {
    if (settings.offline) throw new Error(`No recorded ${url}; run once without --offline.`);
    const response = await fetch(url);
    body = await response.text();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.body`, body);
    await writeFile(
      `${file}.json`,
      JSON.stringify({
        url,
        method: "GET",
        status: response.status,
        contentType: "application/json"
      })
    );
  }
  metaPools[type] = (JSON.parse(body).metas || []).filter((meta) => meta.poster);
  return metaPools[type];
}

async function syntheticAddonResponse(url) {
  const { pathname } = new URL(url);
  if (pathname === "/manifest.json") {
    const catalogs = Array.from({ length: settings.catalogs }, (_, index) => ({
      type: index % 2 ? "series" : "movie",
      id: `perf-${index + 1}`,
      name: `Perf row ${index + 1}`,
      extra: [{ name: "skip" }]
    }));
    return {
      id: "test.nuvio.perf-catalogs",
      version: "1.0.0",
      name: "Perf catalogs",
      description: "Synthetic Home rows for the local performance harness",
      resources: ["catalog"],
      types: ["movie", "series"],
      idPrefixes: ["tt"],
      catalogs
    };
  }
  const match = pathname.match(/^\/catalog\/(movie|series)\/perf-(\d+)(?:\/skip=(\d+))?\.json$/);
  if (!match) return null;
  const pool = await loadMetaPool(match[1]);
  const row = Number(match[2]);
  const skip = Number(match[3] || 0);
  if (!pool.length || skip >= pool.length * 2) return { metas: [] };
  const metas = Array.from({ length: SYNTHETIC_PAGE }, (_, index) => {
    const meta = pool[(row * 7 + skip + index) % pool.length];
    return {
      id: meta.id,
      type: match[1],
      name: meta.name,
      poster: meta.poster,
      background: meta.background,
      logo: meta.logo,
      description: meta.description,
      releaseInfo: meta.releaseInfo,
      imdbRating: meta.imdbRating,
      genres: meta.genres
    };
  });
  return { metas };
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function findChrome() {
  const explicit = option("chrome", process.env.NUVIO_PERF_CHROME);
  if (explicit) return explicit;
  const base = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const linuxBase = path.join(os.homedir(), ".cache", "ms-playwright");
  for (const root of [base, linuxBase]) {
    if (!existsSync(root)) continue;
    const shells = readdirSync(root)
      .filter((name) => name.startsWith("chromium_headless_shell-"))
      .sort()
      .reverse();
    for (const shell of shells) {
      for (const sub of readdirSync(path.join(root, shell))) {
        const candidate = path.join(root, shell, sub, "chrome-headless-shell");
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error("No Chromium found. Pass --chrome=PATH or set NUVIO_PERF_CHROME.");
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, ...env }
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))
    );
  });
}

async function buildApp() {
  const env = { NUVIO_BUILD_CHROMIUM: "87" };
  const privateProperties = path.join(repoRoot, ".cache", "tv-performance", "tv-build.properties");
  if (existsSync(privateProperties)) env.NUVIO_LOCAL_PROPERTIES = privateProperties;
  await run("npm", ["run", "build"], env);
  await run("node", ["scripts/package-webos.mjs", "--stage-only"], env);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".xml": "application/xml; charset=utf-8",
  ".ttf": "font/ttf"
};

function startAppServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    let file = path.join(appDir, decodeURIComponent(url.pathname));
    if (!file.startsWith(appDir)) {
      response.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-cache"
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }))
  );
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
        return;
      }
      for (const handler of this.listeners.get(message.method) || []) handler(message.params);
    };
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }

  close() {
    try {
      this.socket.close();
    } catch {}
  }
}

async function launchChrome(chromePath, userDataDir) {
  const child = spawn(
    chromePath,
    [
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "--window-size=1920,1080",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--autoplay-policy=no-user-gesture-required",
      "about:blank"
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  const wsUrl = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chromium did not start")), 15000);
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("exit", (code) => reject(new Error(`Chromium exited ${code}: ${output.slice(-400)}`)));
  });
  const cdp = new Cdp(wsUrl);
  await cdp.open();
  return { child, cdp };
}

function fixturePath(method, url) {
  const hash = crypto.createHash("sha1").update(`${method} ${url}`).digest("hex");
  return path.join(fixtureDir, hash.slice(0, 2), hash);
}

const CORS = [
  { name: "access-control-allow-origin", value: "*" },
  { name: "access-control-allow-headers", value: "*" },
  { name: "access-control-allow-methods", value: "GET,POST,PUT,PATCH,DELETE,OPTIONS" }
];

function isImage(resourceType, contentType) {
  return resourceType === "Image" || /^image\//.test(contentType || "");
}

async function handleExternalRequest(cdp, sessionId, params, stats) {
  const { requestId, request, resourceType } = params;
  const method = request.method;
  if (method === "OPTIONS") {
    await cdp.send(
      "Fetch.fulfillRequest",
      { requestId, responseCode: 204, responseHeaders: CORS },
      sessionId
    );
    return;
  }
  // The release check opens an update dialog over Home and takes focus.
  if (new URL(request.url).hostname === "api.github.com") {
    await fulfill(cdp, sessionId, requestId, 404, "application/json", Buffer.from("{}"));
    return;
  }
  if (request.url.startsWith(SYNTHETIC_ADDON)) {
    const payload = await syntheticAddonResponse(request.url).catch(() => null);
    if (settings.latency) await new Promise((resolve) => setTimeout(resolve, settings.latency));
    await fulfill(
      cdp,
      sessionId,
      requestId,
      payload ? 200 : 404,
      "application/json",
      Buffer.from(JSON.stringify(payload || {}))
    );
    return;
  }
  const file = fixturePath(method, request.url);
  const recorded = !settings.record && existsSync(`${file}.json`);
  if (!recorded && !settings.offline) {
    try {
      const response = await fetch(request.url, {
        method,
        headers: Object.fromEntries(
          Object.entries(request.headers || {}).filter(
            ([name]) => !/^(host|origin|referer|user-agent)$/i.test(name)
          )
        ),
        body: request.postData,
        redirect: "follow"
      });
      const body = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "";
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.body`, body);
      await writeFile(
        `${file}.json`,
        JSON.stringify({ url: request.url, method, status: response.status, contentType })
      );
      stats.recorded += 1;
      stats.missingUrls.add(new URL(request.url).host);
      await fulfill(cdp, sessionId, requestId, response.status, contentType, body);
    } catch (error) {
      stats.failed += 1;
      await cdp
        .send("Fetch.failRequest", { requestId, errorReason: "Failed" }, sessionId)
        .catch(() => {});
    }
    return;
  }
  try {
    const meta = JSON.parse(await readFile(`${file}.json`, "utf8"));
    const body = await readFile(`${file}.body`);
    const delay = isImage(resourceType, meta.contentType)
      ? settings.imageLatency
      : settings.latency;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    stats.replayed += 1;
    await fulfill(cdp, sessionId, requestId, meta.status, meta.contentType, body);
  } catch {
    stats.missing += 1;
    stats.missingUrls.add(new URL(request.url).host);
    await cdp
      .send("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" }, sessionId)
      .catch(() => {});
  }
}

function fulfill(cdp, sessionId, requestId, status, contentType, body) {
  return cdp
    .send(
      "Fetch.fulfillRequest",
      {
        requestId,
        responseCode: status || 200,
        responseHeaders: [
          ...CORS,
          ...(contentType ? [{ name: "content-type", value: contentType }] : [])
        ],
        body: body.toString("base64")
      },
      sessionId
    )
    .catch(() => {});
}

// Installed before any app script. It records paint/long-task timings and the
// first moments Home posters are visible and Home is interactive.
const PAGE_PROBE = String.raw`(() => {
  const probe = (window.__perfLocal = {
    longTasks: [], keys: [], marks: {}, firstPosterSource: ""
  });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        probe.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ entryTypes: ["longtask"] });
  } catch (_) {}
  const visibleImage = (root) => {
    if (!root || root.offsetParent === null && getComputedStyle(root).position !== "fixed") return false;
    for (const img of root.querySelectorAll(".home-content-card img, .home-continue-card img")) {
      if (img.complete && img.naturalWidth > 0) {
        const rect = img.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < innerHeight && rect.width > 0) return true;
      }
    }
    return false;
  };
  const timer = setInterval(() => {
    const now = performance.now();
    const home = document.getElementById("home");
    const snapshot = document.getElementById("nuvio-boot-snapshot");
    if (!probe.marks.firstPoster) {
      if (visibleImage(snapshot)) { probe.marks.firstPoster = now; probe.firstPosterSource = "snapshot"; }
      else if (visibleImage(home)) { probe.marks.firstPoster = now; probe.firstPosterSource = "home"; }
    }
    if (!probe.marks.homeInteractive && home && home.querySelector(".focused") &&
        home.querySelector(".home-content-card, .home-continue-card")) {
      probe.marks.homeInteractive = now;
    }
    if (probe.marks.homeInteractive && probe.marks.firstPoster && !snapshot) clearInterval(timer);
  }, 50);
  window.addEventListener("keydown", (event) => {
    const start = performance.now();
    const sample = { key: event.key, nextFrameMs: null, settledMs: null };
    probe.keys.push(sample);
    requestAnimationFrame(() => {
      sample.nextFrameMs = performance.now() - start;
      setTimeout(() => { sample.settledMs = performance.now() - start; }, 0);
    });
  }, true);
})();`;

function seedScript(state) {
  return `(() => { try {
    if (localStorage.getItem("__perfLocalSeeded")) return;
    const state = ${JSON.stringify(state)};
    for (const [key, value] of Object.entries(state))
      localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem("__perfLocalSeeded", "1");
  } catch (_) {} })();`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function quantile(values, q) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function parseKeys(spec) {
  const codes = { Down: 40, Up: 38, Left: 37, Right: 39, Enter: 13, Back: 8 };
  return spec
    .split(",")
    .filter(Boolean)
    .flatMap((part) => {
      const [name, count = "1"] = part.split("*");
      if (!codes[name]) throw new Error(`Unknown key ${name}`);
      return Array.from({ length: Number(count) }, () => name);
    })
    .map((name) => ({
      name,
      code: codes[name],
      key: ["Down", "Up", "Left", "Right"].includes(name) ? `Arrow${name}` : name
    }));
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  );
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function launchOnce({ chromePath, userDataDir, appUrl, state, measureKeys, cpuProfile }) {
  const { child, cdp } = await launchChrome(chromePath, userDataDir);
  const stats = { recorded: 0, replayed: 0, missing: 0, failed: 0, missingUrls: new Set() };
  const errors = [];
  try {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const page = targetInfos.find((target) => target.type === "page");
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId: page.targetId,
      flatten: true
    });
    const send = (method, params) => cdp.send(method, params, sessionId);
    cdp.on("Fetch.requestPaused", (params) => {
      const url = new URL(params.request.url);
      if (url.hostname === "127.0.0.1" || url.protocol === "data:") {
        send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
        return;
      }
      void handleExternalRequest(cdp, sessionId, params, stats);
    });
    cdp.on("Runtime.exceptionThrown", (params) => {
      errors.push(params.exceptionDetails?.exception?.description?.split("\n")[0] || "exception");
    });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Performance.enable", { timeDomain: "timeTicks" });
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send("Emulation.setUserAgentOverride", { userAgent: TV_USER_AGENT });
    await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: seedScript(state) });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_PROBE });
    await send("Emulation.setCPUThrottlingRate", { rate: settings.cpu });
    if (cpuProfile) {
      await send("Profiler.enable");
      await send("Profiler.setSamplingInterval", { interval: 500 });
      await send("Profiler.start");
    }
    const loaded = Date.now();
    await send("Page.navigate", { url: appUrl });

    // Boot: wait for interactive Home, then for a quiet period without long tasks.
    let marks = {};
    let settledAt = null;
    while (Date.now() - loaded < BOOT_TIMEOUT_MS) {
      await sleep(250);
      const snapshot = await evaluate(
        cdp,
        sessionId,
        `(() => { const p = window.__perfLocal; if (!p) return null;
          const last = p.longTasks.length ? p.longTasks[p.longTasks.length - 1] : null;
          return { marks: p.marks, now: performance.now(),
            lastLongTaskEnd: last ? last.start + last.duration : 0 }; })()`
      ).catch(() => null);
      if (!snapshot) continue;
      marks = snapshot.marks;
      if (
        marks.homeInteractive &&
        snapshot.now - Math.max(marks.homeInteractive, snapshot.lastLongTaskEnd) >= SETTLE_QUIET_MS
      ) {
        settledAt = Math.max(marks.homeInteractive, snapshot.lastLongTaskEnd);
        break;
      }
    }
    let profile = null;
    if (cpuProfile) profile = (await send("Profiler.stop")).profile;
    if (settings.screenshot) {
      await send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(
        path.join(resultDir, `screen-${Date.now()}.png`),
        Buffer.from(data, "base64")
      );
      await send("Emulation.setCPUThrottlingRate", { rate: settings.cpu });
    }
    const boot = await evaluate(
      cdp,
      sessionId,
      `(() => { const p = window.__perfLocal;
        const fcp = performance.getEntriesByName("first-contentful-paint")[0];
        const settled = ${settledAt ?? "performance.now()"};
        const tasks = p.longTasks.filter((t) => t.start <= settled);
        return {
          firstContentfulPaint: fcp ? fcp.startTime : null,
          firstPoster: p.marks.firstPoster || null,
          firstPosterSource: p.firstPosterSource,
          homeInteractive: p.marks.homeInteractive || null,
          settled: ${settledAt === null ? "null" : "settled"},
          longTaskCount: tasks.length,
          longTaskTotal: tasks.reduce((sum, t) => sum + t.duration, 0),
          longTaskMax: tasks.reduce((max, t) => Math.max(max, t.duration), 0),
          homeElements: document.querySelectorAll("#home *").length,
          documentElements: document.getElementsByTagName("*").length,
          route: document.querySelector(".screen[style*='block'], .screen.active")?.id || ""
        }; })()`
    );
    const metrics = Object.fromEntries(
      (await send("Performance.getMetrics")).metrics.map((metric) => [metric.name, metric.value])
    );
    boot.taskSeconds = metrics.TaskDuration;
    boot.scriptSeconds = metrics.ScriptDuration;
    boot.layoutSeconds = metrics.LayoutDuration;
    boot.styleSeconds = metrics.RecalcStyleDuration;
    boot.heapMb = metrics.JSHeapUsedSize / 1048576;

    let navigation = null;
    if (measureKeys.length && boot.homeInteractive) {
      const before = await evaluate(
        cdp,
        sessionId,
        `({ keys: __perfLocal.keys.length, tasks: __perfLocal.longTasks.length })`
      );
      for (const key of measureKeys) {
        const event = {
          key: key.key,
          code: key.key,
          windowsVirtualKeyCode: key.code,
          nativeVirtualKeyCode: key.code
        };
        await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...event });
        await send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
        await sleep(settings.keyGap);
      }
      await sleep(1500);
      navigation = await evaluate(
        cdp,
        sessionId,
        `(() => { const keys = __perfLocal.keys.slice(${before.keys});
          const tasks = __perfLocal.longTasks.slice(${before.tasks});
          return { keys, longTaskTotal: tasks.reduce((s, t) => s + t.duration, 0),
            longTaskMax: tasks.reduce((m, t) => Math.max(m, t.duration), 0),
            homeElements: document.querySelectorAll("#home *").length }; })()`
      );
      const nextFrame = navigation.keys.map((sample) => sample.nextFrameMs);
      const settledKey = navigation.keys.map((sample) => sample.settledMs);
      navigation = {
        keys: navigation.keys.length,
        nextFrameMedian: quantile(nextFrame, 0.5),
        nextFrameP95: quantile(nextFrame, 0.95),
        nextFrameMax: quantile(nextFrame, 1),
        settledMedian: quantile(settledKey, 0.5),
        settledP95: quantile(settledKey, 0.95),
        longTaskTotal: navigation.longTaskTotal,
        longTaskMax: navigation.longTaskMax,
        homeElements: navigation.homeElements
      };
    }
    return {
      boot,
      navigation,
      network: { ...stats, missingUrls: [...stats.missingUrls] },
      errors,
      profile
    };
  } finally {
    await cdp.send("Browser.close").catch(() => {});
    cdp.close();
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        child.once("exit", resolve);
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5000);
      }
    });
  }
}

function summarizeProfile(profile, limit = 15) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const deltas = profile.timeDeltas || [];
  profile.samples.forEach((id, index) => {
    const node = nodes.get(id);
    const frame = node.callFrame;
    if (["(idle)", "(program)", "(root)"].includes(frame.functionName)) return;
    const file = frame.url ? frame.url.split("/").pop().split("?")[0] : "";
    const key = `${frame.functionName || "(anonymous)"} ${file}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (deltas[index] || 0) / 1000);
  });
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, ms]) => ({ name, ms: Math.round(ms) }));
}

function medianOf(runs, pick) {
  return quantile(runs.map(pick), 0.5);
}

function summarize(runs) {
  const nav = runs.filter((entry) => entry.navigation);
  return {
    firstPosterMs: round(medianOf(runs, (r) => r.boot.firstPoster)),
    homeInteractiveMs: round(medianOf(runs, (r) => r.boot.homeInteractive)),
    settledMs: round(medianOf(runs, (r) => r.boot.settled)),
    bootLongTaskTotalMs: round(medianOf(runs, (r) => r.boot.longTaskTotal)),
    bootLongTaskMaxMs: round(medianOf(runs, (r) => r.boot.longTaskMax)),
    bootScriptMs: round(medianOf(runs, (r) => r.boot.scriptSeconds * 1000)),
    bootLayoutStyleMs: round(
      medianOf(runs, (r) => (r.boot.layoutSeconds + r.boot.styleSeconds) * 1000)
    ),
    homeElements: round(medianOf(runs, (r) => r.boot.homeElements)),
    keyNextFrameMedianMs: round(medianOf(nav, (r) => r.navigation.nextFrameMedian)),
    keyNextFrameP95Ms: round(medianOf(nav, (r) => r.navigation.nextFrameP95)),
    keySettledP95Ms: round(medianOf(nav, (r) => r.navigation.settledP95)),
    navLongTaskTotalMs: round(medianOf(nav, (r) => r.navigation.longTaskTotal)),
    navLongTaskMaxMs: round(medianOf(nav, (r) => r.navigation.longTaskMax))
  };
}

function printTable(summary, baseline) {
  const rows = Object.entries(summary).map(([name, value]) => {
    const before = baseline?.[name];
    const delta =
      Number.isFinite(before) && Number.isFinite(value) && before !== 0
        ? `${value - before >= 0 ? "+" : ""}${Math.round(((value - before) / before) * 100)}%`
        : "";
    return [name, before ?? "", value ?? "", delta];
  });
  const header = baseline ? ["metric", "baseline", "current", "change"] : ["metric", "value"];
  const table = [header, ...rows.map((row) => (baseline ? row : [row[0], row[2]]))];
  const widths = header.map((_, column) =>
    Math.max(...table.map((row) => String(row[column]).length))
  );
  for (const row of table) {
    console.log(row.map((cell, column) => String(cell).padEnd(widths[column])).join("  "));
  }
}

async function main() {
  if (flag("build")) await buildApp();
  if (!existsSync(path.join(appDir, "index.html")))
    throw new Error("No staged webOS app. Run with --build first.");
  const chromePath = findChrome();
  const state = option("state")
    ? JSON.parse(await readFile(path.resolve(option("state")), "utf8"))
    : defaultState();
  const commit = git(["rev-parse", "--short", "HEAD"]);
  const dirty = git(["status", "--porcelain"]) ? "+dirty" : "";
  const label = option("label", `${commit}${dirty}`);
  const userDataDir = path.join(cacheDir, "browser-profile");
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });
  await mkdir(resultDir, { recursive: true });
  const { server, port } = await startAppServer();
  const appUrl = `http://127.0.0.1:${port}/index.html`;
  const keys = parseKeys(settings.keys);
  try {
    console.log(
      `priming launch (${settings.record ? "recording network" : settings.offline ? "replay only" : "replaying, recording new requests"}, cpu ${settings.cpu}x, ${settings.catalogs} synthetic rows)...`
    );
    const prime = await launchOnce({
      chromePath,
      userDataDir,
      appUrl,
      state,
      measureKeys: keys,
      cpuProfile: false
    });
    console.log(
      `  home interactive ${round(prime.boot.homeInteractive)} ms; network ${JSON.stringify(prime.network)}`
    );
    if (!prime.boot.homeInteractive) {
      console.log(`  route: ${prime.boot.route}; errors: ${prime.errors.slice(0, 5).join(" | ")}`);
      throw new Error("Home never became interactive in the priming launch.");
    }
    const runs = [];
    for (let index = 0; index < settings.runs; index += 1) {
      const result = await launchOnce({
        chromePath,
        userDataDir,
        appUrl,
        state,
        measureKeys: keys,
        cpuProfile: settings.cpuProfile && index === 0
      });
      console.log(
        `run ${index + 1}/${settings.runs}: poster ${round(result.boot.firstPoster)} ms (${result.boot.firstPosterSource || "none"}), interactive ${round(result.boot.homeInteractive)} ms, settled ${round(result.boot.settled)} ms, key p95 ${round(result.navigation?.nextFrameP95)} ms` +
          (result.network.missing ? `, ${result.network.missing} missing fixtures` : "") +
          (result.network.recorded ? `, ${result.network.recorded} newly recorded` : "")
      );
      if (result.profile) {
        const profilePath = path.join(resultDir, `${label}.cpuprofile`);
        await writeFile(profilePath, JSON.stringify(result.profile));
        console.log(`  CPU profile: ${profilePath}`);
        console.log("  top self time (first launch, throttled ms):");
        for (const entry of summarizeProfile(result.profile))
          console.log(`    ${String(entry.ms).padStart(6)}  ${entry.name}`);
        result.profileTop = summarizeProfile(result.profile, 40);
        delete result.profile;
      }
      runs.push(result);
    }
    const summary = summarize(runs);
    const output = {
      label,
      commit,
      dirty: Boolean(dirty),
      date: new Date().toISOString(),
      settings: { ...settings, chrome: path.basename(chromePath) },
      summary,
      runs
    };
    const resultPath = path.join(resultDir, `${label}.json`);
    await writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`\n${label} (median of ${runs.length} launches)`);
    const baseline = option("compare")
      ? JSON.parse(await readFile(path.resolve(option("compare")), "utf8"))
      : null;
    if (baseline) console.log(`compared with ${baseline.label}`);
    printTable(summary, baseline?.summary);
    console.log(`\nsaved ${resultPath}`);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
