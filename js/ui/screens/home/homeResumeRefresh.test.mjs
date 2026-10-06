import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { createHomeScreenMethods04 } =
  await import("./homeScreenMethods-04-get-hero-focus-delay.js");
const { Router } = await import("../../navigation/routerState.js");

test("Home resumes without a reload until the inputs it is built from change", () => {
  let signature = "inputs-a";
  const screen = {
    ...createHomeScreenMethods04(),
    buildHomeResumeSignature: () => signature
  };
  assert.equal(screen.canResumeHomeWithoutReload(), false, "Home that never loaded reloads");
  screen.rememberHomeResumeInputs();
  assert.equal(screen.canResumeHomeWithoutReload(), true);

  signature = "inputs-b";
  assert.equal(screen.canResumeHomeWithoutReload(), false, "changed settings require a reload");

  signature = "";
  screen.rememberHomeResumeInputs();
  assert.equal(screen.canResumeHomeWithoutReload(), false, "unreadable inputs reload");
});

test("a watched-title refresh renders only when the watched set changes", async () => {
  const { createHomeScreenMethods20 } = await import("./homeScreenMethods-20-mount.js");
  const { watchedTitleStateRepository } =
    await import("../../../data/repository/watchedTitleStateRepository.js");
  const originals = {
    project: watchedTitleStateRepository.getTitleWatchedItems,
    current: Router.getCurrent
  };
  let projected = [{ id: "tt1", type: "movie" }];
  watchedTitleStateRepository.getTitleWatchedItems = async () => projected;
  Router.getCurrent = () => "home";
  let renders = 0;
  const screen = {
    ...createHomeScreenMethods20(),
    homeLoadToken: 1,
    rows: [{ result: { data: { items: [{ id: "tt1" }, { id: "tt2" }] } } }],
    watchedItems: [],
    requestBackgroundRender() {
      renders += 1;
    }
  };
  try {
    await screen.refreshWatchedTitleState();
    assert.equal(renders, 1);
    await screen.refreshWatchedTitleState();
    assert.equal(renders, 1, "an identical watched set does not re-render Home");
    projected = [...projected, { id: "tt2", type: "movie" }];
    await screen.refreshWatchedTitleState();
    assert.equal(renders, 2);
  } finally {
    watchedTitleStateRepository.getTitleWatchedItems = originals.project;
    Router.getCurrent = originals.current;
  }
});
