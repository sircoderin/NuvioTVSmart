import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import {
  HOME_BOOT_SNAPSHOT_ELEMENT_ID,
  HOME_BOOT_SNAPSHOT_FORMAT,
  HOME_BOOT_SNAPSHOT_STORAGE_KEY,
  homeBootSnapshotPaintConfig,
  paintHomeBootSnapshot
} from "./homeBootSnapshotPaint.js";

function element(tagName) {
  return {
    tagName,
    attributes: {},
    style: {},
    children: [],
    parentNode: null,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return name in this.attributes ? this.attributes[name] : null;
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((node) => node !== child);
      child.parentNode = null;
    }
  };
}

function createWindow(entries, { launchParams } = {}) {
  const stored = new Map(
    Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)])
  );
  const body = element("body");
  const timers = [];
  return {
    body,
    timers,
    document: { body, createElement: element },
    localStorage: { getItem: (key) => (stored.has(key) ? stored.get(key) : null) },
    PalmSystem: launchParams === undefined ? undefined : { launchParams },
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    }
  };
}

const snapshot = {
  format: HOME_BOOT_SNAPSHOT_FORMAT,
  buildId: "build-a",
  profileId: "2",
  rootClass: "performance-constrained",
  rootStyle: "--bg-color: #000",
  homeClass: "screen",
  html: '<div class="home-shell">Home</div>'
};
const state = (overrides = {}) => ({
  [HOME_BOOT_SNAPSHOT_STORAGE_KEY]: snapshot,
  activeProfileId: "2",
  ...overrides
});

test("paints the saved Home over the page for the same build and profile", () => {
  const win = createWindow(state());
  assert.equal(paintHomeBootSnapshot(win, homeBootSnapshotPaintConfig("build-a")), true);
  const [root] = win.body.children;
  assert.equal(root.id, HOME_BOOT_SNAPSHOT_ELEMENT_ID);
  assert.equal(root.className, "performance-constrained");
  assert.match(root.attributes.style, /^--bg-color: #000;position:fixed;/);
  assert.match(root.attributes.style, /contain:strict/);
  assert.equal(root.children[0].innerHTML, snapshot.html);
  assert.equal(root.children[0].style.display, "block");
  assert.ok(win.__NUVIO_BOOT_SNAPSHOT__);

  const [timeout] = win.timers;
  timeout.callback();
  assert.equal(win.body.children.length, 0, "a snapshot the app never releases expires");
});

for (const [name, entries, options, buildId] of [
  ["another build saved it", state(), {}, "build-b"],
  ["no build id is known", state(), {}, ""],
  ["another profile is active", state({ activeProfileId: "1" }), {}, "build-a"],
  [
    "a non-Home screen will be restored",
    state({ webos_last_resume_route: { route: "library", savedAt: Date.now() - 1000 } }),
    {},
    "build-a"
  ],
  [
    "the launch carries a title deep link",
    state(),
    { launchParams: JSON.stringify({ contentTarget: "nuvio://movie/tt1" }) },
    "build-a"
  ],
  [
    "the format is older",
    state({ [HOME_BOOT_SNAPSHOT_STORAGE_KEY]: { ...snapshot, format: 0 } }),
    {},
    "build-a"
  ]
]) {
  test(`skips the paint when ${name}`, () => {
    const win = createWindow(entries, options);
    assert.equal(paintHomeBootSnapshot(win, homeBootSnapshotPaintConfig(buildId)), false);
    assert.equal(win.body.children.length, 0);
  });
}

test("paints when the stored resume screen has expired or is Home", () => {
  for (const resume of [
    { route: "library", savedAt: Date.now() - 21 * 60 * 1000 },
    { route: "home", savedAt: Date.now() }
  ]) {
    const win = createWindow(state({ webos_last_resume_route: resume }));
    assert.equal(paintHomeBootSnapshot(win, homeBootSnapshotPaintConfig("build-a")), true);
  }
});

test("runs as an inline ES5 script without module scope", () => {
  const source = paintHomeBootSnapshot.toString();
  assert.doesNotMatch(source, /=>|`|\b(?:let|const|class)\b|\?\.|\?\?/);
  const win = createWindow(state());
  const context = vm.createContext({
    win,
    config: homeBootSnapshotPaintConfig("build-a"),
    JSON,
    Date,
    String,
    Number
  });
  assert.equal(vm.runInContext(`(${source})(win, config)`, context), true);
});

test("paints the loading pill above the snapshot and removes it only if never adopted", () => {
  const win = createWindow(state());
  assert.equal(paintHomeBootSnapshot(win, homeBootSnapshotPaintConfig("build-a")), true);
  const pill = win.body.children.find((child) => child.id === "homeLoadingStatus");
  assert.ok(pill, "the pill is painted with the snapshot");
  assert.equal(pill.children[1].textContent, "Starting up");
  pill.setAttribute("data-adopted", "1");
  win.timers[0].callback();
  assert.ok(win.body.children.includes(pill), "an adopted pill stays for the app to manage");

  const stale = createWindow(state());
  paintHomeBootSnapshot(stale, homeBootSnapshotPaintConfig("build-a"));
  stale.timers[0].callback();
  assert.equal(stale.body.children.length, 0);
});
