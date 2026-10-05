import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { createRouterMethods03 } = await import("../../navigation/routerMethods-03-back.js");
const { createHomeScreenMethods04 } =
  await import("./homeScreenMethods-04-get-hero-focus-delay.js");
const { Router } = await import("../../navigation/routerState.js");

const routeLog = () => {
  const methods = createRouterMethods03();
  return {
    recordRouteVisit: methods.recordRouteVisit,
    getRouteVisitSequence: methods.getRouteVisitSequence,
    getRoutesVisitedSince: methods.getRoutesVisitedSince
  };
};

test("route visit log reports routes shown since a sequence", () => {
  const router = routeLog();
  router.recordRouteVisit("home");
  const left = router.getRouteVisitSequence();
  router.recordRouteVisit("settings");
  router.recordRouteVisit("home");
  assert.deepEqual(router.getRoutesVisitedSince(left), ["settings", "home"]);
  assert.equal(router.getRoutesVisitedSince(null), null);
  for (let index = 0; index < 60; index += 1) {
    router.recordRouteVisit("detail");
  }
  assert.equal(router.getRoutesVisitedSince(left), null, "a truncated log cannot prove what ran");
});

test("Home skips its resume reload only after passive routes with unchanged inputs", () => {
  const originals = {
    getRoutesVisitedSince: Router.getRoutesVisitedSince
  };
  let visited = ["settings", "home"];
  Router.getRoutesVisitedSince = () => visited;
  let signature = "inputs-a";
  const screen = {
    ...createHomeScreenMethods04(),
    buildHomeResumeSignature: () => signature,
    homeLeftRouteSequence: 1
  };
  try {
    screen.rememberHomeResumeInputs();
    assert.equal(screen.canSkipHomeResumeRefresh(), true);

    visited = ["detail", "player", "home"];
    assert.equal(screen.canSkipHomeResumeRefresh(), false, "playback can change Continue Watching");

    visited = ["settings", "home"];
    signature = "inputs-b";
    assert.equal(screen.canSkipHomeResumeRefresh(), false, "changed settings require a reload");

    signature = "inputs-a";
    screen.lastHomeFullLoadAtMs = Date.now() - 10 * 60 * 1000;
    assert.equal(screen.canSkipHomeResumeRefresh(), false, "old data is refreshed");

    screen.lastHomeFullLoadAtMs = Date.now();
    visited = null;
    assert.equal(screen.canSkipHomeResumeRefresh(), false);
  } finally {
    Router.getRoutesVisitedSince = originals.getRoutesVisitedSince;
  }
});
