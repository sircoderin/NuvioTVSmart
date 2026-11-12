import assert from "node:assert/strict";
import { test } from "node:test";

let frames = [];
globalThis.requestAnimationFrame = (callback) => frames.push(callback);
globalThis.cancelAnimationFrame = () => {};
const runFrames = () => {
  const pending = frames;
  frames = [];
  pending.forEach((callback) => callback());
};

function makeNode() {
  let text = "";
  const node = {
    attributes: {},
    children: [],
    writes: 0,
    parentNode: null,
    get isConnected() {
      return Boolean(node.parentNode);
    },
    setAttribute(name, value) {
      node.attributes[name] = value;
    },
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
    },
    removeChild(child) {
      node.children = node.children.filter((entry) => entry !== child);
      child.parentNode = null;
    },
    querySelector(selector) {
      const className = selector.replace(/^\./, "");
      return node.children.find((child) => child.className === className) || null;
    },
    get textContent() {
      return text;
    },
    set textContent(value) {
      text = value;
      node.writes += 1;
    }
  };
  return node;
}

const body = makeNode();
globalThis.document = {
  body,
  createElement: makeNode,
  getElementById: (id) => body.children.find((child) => child.id === id) || null
};
const pill = () => body.children[0] || null;
const pillText = () => pill()?.querySelector(".home-loading-status-text")?.textContent;

const { updateHomeLoadingStatus, resetHomeLoadingStatus } = await import("./homeLoadingStatus.js");

test("the pill has a spinner and coalesces text updates into one write", () => {
  updateHomeLoadingStatus({ catalogs: { loaded: 0, total: 55 } });
  updateHomeLoadingStatus({ catalogs: { loaded: 1, total: 55 } });
  updateHomeLoadingStatus({ catalogs: { loaded: 12, total: 55 } });
  assert.equal(body.children.length, 1);
  assert.ok(pill().querySelector(".home-loading-status-spinner"));
  const text = pill().querySelector(".home-loading-status-text");
  assert.equal(text.textContent, "Loading catalogs 0/55");
  runFrames();
  assert.equal(text.textContent, "Loading catalogs 12/55");
  assert.equal(text.writes, 2);
  resetHomeLoadingStatus();
});

test("Continue Watching keeps the pill up after the catalogs are in", () => {
  updateHomeLoadingStatus({ continueWatching: true });
  updateHomeLoadingStatus({ catalogs: { loaded: 3, total: 4 } });
  assert.equal(pillText(), "Loading Continue Watching");
  runFrames();
  assert.equal(pillText(), "Loading catalogs 3/4", "catalogs are named while they load");
  updateHomeLoadingStatus({ catalogs: null });
  runFrames();
  assert.equal(pillText(), "Loading Continue Watching");
  updateHomeLoadingStatus({ continueWatching: false });
  assert.equal(body.children.length, 0);
});

test("the pill painted with the launch snapshot is adopted, then removed", () => {
  const painted = makeNode();
  painted.id = "homeLoadingStatus";
  const spinner = makeNode();
  spinner.className = "home-loading-status-spinner";
  const text = makeNode();
  text.className = "home-loading-status-text";
  text.textContent = "Starting up";
  painted.appendChild(spinner);
  painted.appendChild(text);
  body.appendChild(painted);

  updateHomeLoadingStatus({ continueWatching: true });
  assert.equal(body.children.length, 1);
  assert.equal(pill(), painted);
  assert.equal(painted.attributes["data-adopted"], "1");
  runFrames();
  assert.equal(text.textContent, "Loading Continue Watching");
  resetHomeLoadingStatus();
  assert.equal(body.children.length, 0);
});

test("leaving for another screen removes a snapshot pill the app never adopted", () => {
  const painted = makeNode();
  painted.id = "homeLoadingStatus";
  body.appendChild(painted);
  resetHomeLoadingStatus();
  assert.equal(body.children.length, 0);
});

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { createHomeScreenMethods21 } = await import("./homeScreenMethods-21-load-data.js");

test("Home counts its catalogs in and takes the status down when the load ends", () => {
  const home = createHomeScreenMethods21();
  const catalogs = ["a", "b", "c", "d"].map((id) => ({ homeCatalogKey: id }));
  home.startHomeLoadingStatus(1, catalogs, [{ homeCatalogKey: "a" }]);
  assert.equal(pillText(), "Loading catalogs 1/4");

  home.noteHomeLoadingStatusRow(2, { homeCatalogKey: "b" });
  home.noteHomeLoadingStatusRow(1, { homeCatalogKey: "z" });
  home.noteHomeLoadingStatusRow(1, { homeCatalogKey: "c" });
  home.noteHomeLoadingStatusRow(1, { homeCatalogKey: "c" });
  runFrames();
  assert.equal(pillText(), "Loading catalogs 2/4", "only this load's catalogs count, once each");

  home.finishHomeLoadingStatus(2);
  assert.equal(body.children.length, 1, "a newer load's end does not take it down");
  home.finishHomeLoadingStatus(1);
  assert.equal(body.children.length, 0);

  home.startHomeLoadingStatus(3, catalogs, catalogs);
  assert.equal(body.children.length, 0, "nothing is shown when every catalog is already in");
});

test("leaving Home clears Continue Watching too", () => {
  const home = createHomeScreenMethods21();
  home.homeContinueWatchingStatusToken = 4;
  updateHomeLoadingStatus({ continueWatching: true });
  home.startHomeLoadingStatus(4, [{ homeCatalogKey: "a" }, { homeCatalogKey: "b" }], []);
  home.finishHomeLoadingStatus();
  assert.equal(body.children.length, 0);
  assert.equal(home.homeContinueWatchingStatusToken, null);
});
