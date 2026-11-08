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

const body = {
  children: [],
  appendChild(node) {
    node.parentNode = body;
    body.children.push(node);
  },
  removeChild(node) {
    body.children = body.children.filter((child) => child !== node);
    node.parentNode = null;
  }
};
globalThis.document = {
  body,
  createElement: () => {
    let text = "";
    return {
      writes: 0,
      setAttribute() {},
      get textContent() {
        return text;
      },
      set textContent(value) {
        text = value;
        this.writes += 1;
      }
    };
  }
};

const { showHomeLoadingStatus, hideHomeLoadingStatus } = await import("./homeLoadingStatus.js");

test("show creates one element and coalesces updates into one write", () => {
  showHomeLoadingStatus({ loaded: 0, total: 55 });
  showHomeLoadingStatus({ loaded: 1, total: 55 });
  showHomeLoadingStatus({ loaded: 12, total: 55 });
  assert.equal(body.children.length, 1);
  const node = body.children[0];
  assert.equal(node.textContent, "Loading catalogs 0/55");
  runFrames();
  assert.equal(node.textContent, "Loading catalogs 12/55");
  assert.equal(node.writes, 2);
});

test("identical updates do not rewrite", () => {
  const node = body.children[0];
  showHomeLoadingStatus({ loaded: 12, total: 55 });
  runFrames();
  assert.equal(node.writes, 2);
});

test("hide removes and is idempotent", () => {
  hideHomeLoadingStatus();
  hideHomeLoadingStatus();
  assert.equal(body.children.length, 0);
  showHomeLoadingStatus({ loaded: 0, total: 0 });
  assert.equal(body.children[0].textContent, "Loading catalogs");
  hideHomeLoadingStatus();
});

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { createHomeScreenMethods21 } = await import("./homeScreenMethods-21-load-data.js");

test("Home counts its catalogs in and takes the status down when the load ends", () => {
  const home = createHomeScreenMethods21();
  const catalogs = ["a", "b", "c", "d"].map((id) => ({ homeCatalogKey: id }));
  home.startHomeLoadingStatus(1, catalogs, [{ homeCatalogKey: "a" }]);
  assert.equal(body.children[0].textContent, "Loading catalogs 1/4");

  home.noteHomeLoadingStatusRow(2, { homeCatalogKey: "b" });
  home.noteHomeLoadingStatusRow(1, { homeCatalogKey: "z" });
  home.noteHomeLoadingStatusRow(1, { homeCatalogKey: "c" });
  home.noteHomeLoadingStatusRow(1, { homeCatalogKey: "c" });
  runFrames();
  assert.equal(
    body.children[0].textContent,
    "Loading catalogs 2/4",
    "only this load's catalogs count, once each"
  );

  home.finishHomeLoadingStatus(2);
  assert.equal(body.children.length, 1, "a newer load's end does not take it down");
  home.finishHomeLoadingStatus(1);
  assert.equal(body.children.length, 0);

  home.startHomeLoadingStatus(3, catalogs, catalogs);
  assert.equal(body.children.length, 0, "nothing is shown when every catalog is already in");
});
