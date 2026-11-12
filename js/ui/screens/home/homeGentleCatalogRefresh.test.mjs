import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };

const { createHomeScreenMethods04 } =
  await import("./homeScreenMethods-04-get-hero-focus-delay.js");
const { Router } = await import("../../navigation/routerState.js");

function home(t, route = { current: "home" }) {
  const getCurrent = Router.getCurrent;
  Router.getCurrent = () => route.current;
  t.after(() => {
    Router.getCurrent = getCurrent;
  });
  const fetched = [];
  const screen = {
    ...createHomeScreenMethods04(),
    homeLoadToken: 1,
    lastHomeKeyDownAt: 0,
    async fetchCatalogRows(descriptors) {
      fetched.push({ ids: descriptors.map((descriptor) => descriptor.id), at: Date.now() });
      return descriptors.map((descriptor) => ({ homeCatalogKey: descriptor.id }));
    }
  };
  return { screen, fetched, route };
}

const settle = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

test("catalogs are fetched one at a time, only after keys have been idle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  const { screen, fetched } = home(t);
  screen.lastHomeKeyDownAt = Date.now();
  const done = screen.fetchCatalogRowsGently([{ id: "a" }, { id: "b" }], 1);

  await settle();
  assert.deepEqual(fetched, [], "nothing is fetched while the viewer is pressing keys");
  for (let step = 0; step < 5; step += 1) {
    t.mock.timers.tick(500);
    await settle();
  }
  const rows = await done;
  assert.deepEqual(
    fetched.map((entry) => entry.ids),
    [["a"], ["b"]]
  );
  assert.ok(fetched[0].at - screen.lastHomeKeyDownAt >= 2500);
  assert.deepEqual(
    rows.map((row) => row.homeCatalogKey),
    ["a", "b"]
  );
});

test("a refresh after a cached start waits until startup is over", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  const { screen, fetched } = home(t);
  screen.homeCatalogRefreshNotBefore = Date.now() + 15_000;
  const done = screen.fetchCatalogRowsGently([{ id: "a" }], 1);
  t.mock.timers.tick(14_000);
  await settle();
  assert.deepEqual(fetched, []);
  t.mock.timers.tick(1_000);
  await done;
  assert.equal(fetched.length, 1);
});

test("leaving Home stops the refresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  const { screen, fetched, route } = home(t);
  screen.fetchCatalogRows = async (descriptors) => {
    fetched.push(descriptors[0].id);
    route.current = "player";
    return [{ homeCatalogKey: descriptors[0].id }];
  };
  const rows = await screen.fetchCatalogRowsGently([{ id: "a" }, { id: "b" }], 1);
  assert.deepEqual(fetched, ["a"]);
  assert.equal(rows.length, 1);
});
