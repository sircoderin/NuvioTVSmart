import assert from "node:assert/strict";
import { test } from "node:test";
import { HomeRowVirtualWindow, HOME_VIRTUAL_ROW_COUNT } from "./homeRowVirtualWindow.js";
import { renderModernCatalogRows } from "./modernHomeLayout.js";
import { createHomeRowVirtualizationMethods } from "./homeRowVirtualization.js";

const row = (index, count = 15) => ({
  homeCatalogKey: `row_${index}`,
  catalogId: String(index),
  type: "movie",
  result: {
    status: "success",
    data: { items: Array.from({ length: count }, (_, i) => ({ id: `${index}_${i}` })) }
  }
});

test("catalog DOM stays bounded through 70 rows in both directions", () => {
  const model = new HomeRowVirtualWindow();
  model.setRows(Array.from({ length: 70 }, (_, i) => row(i)));
  for (const index of [
    ...Array.from({ length: 70 }, (_, i) => i),
    ...Array.from({ length: 70 }, (_, i) => 69 - i)
  ]) {
    model.include(`row_${index}`);
    const window = model.snapshot();
    assert.ok(window.indices.has(index), "destination is mounted before focus moves");
    assert.ok(window.indices.size <= HOME_VIRTUAL_ROW_COUNT);
    if (index > 0 && index < 69) {
      assert.ok(window.indices.has(index - 1));
      assert.ok(window.indices.has(index + 1));
    }
  }
  assert.equal(model.start, 0);
});

test("variable row heights and spacer gaps preserve the logical page height", () => {
  const model = new HomeRowVirtualWindow();
  model.setRows(Array.from({ length: 30 }, (_, i) => row(i)));
  for (let i = 0; i < 30; i++) model.heights.set(`row_${i}`, i % 2 ? 250 : 430);
  const total = model.offsetAt(30) - 24;
  for (const focus of [0, 10, 29]) {
    model.include(`row_${focus}`);
    const window = model.snapshot();
    const mountedHeight = [...window.indices].reduce((height, i) => height + model.heightAt(i), 0);
    const children = window.indices.size + Number(window.top > 0) + Number(window.bottom > 0);
    assert.equal(window.top + mountedHeight + window.bottom + (children - 1) * 24, total);
  }
  assert.equal(model.indexAt(model.offsetAt(12) + 10), 12);
});

test("catalog changes retain key-based positions and discard removed caches", () => {
  const model = new HomeRowVirtualWindow();
  const rows = Array.from({ length: 30 }, (_, i) => row(i));
  model.setRows(rows);
  model.include("row_15");
  const anchor = model.entries[model.start].key;
  model.trackStates.set("row_15", 900);
  model.itemCounts.set("row_15", 25);
  model.heights.set("row_0", 430);
  model.setRows([row(100), ...rows.slice(1)]);
  assert.equal(model.entries[model.start].key, anchor);
  assert.equal(model.trackStates.get("row_15"), 900);
  assert.equal(model.itemCounts.get("row_15"), 25);
  assert.equal(model.heights.has("row_0"), false);
});

test("rendering skips offscreen card generation and preserves original row indices", () => {
  const rows = Array.from({ length: 70 }, (_, i) => row(i, 30));
  rows[2] = row(2, 0);
  const model = new HomeRowVirtualWindow();
  model.setRows(rows);
  model.include("row_40");
  model.itemCounts.set("row_40", 25);
  const calls = [];
  const { markup } = renderModernCatalogRows({
    rows,
    rowItemLimit: 10,
    rowWindow: model.snapshot(),
    createPosterCardMarkup(item, rowIndex, itemIndex) {
      calls.push({ rowIndex, itemIndex });
      return `<button>${item.id}</button>`;
    },
    formatCatalogRowTitle: () => "Catalog",
    escapeHtml: (value) => value
  });
  assert.equal(new Set(calls.map((call) => call.rowIndex)).size, HOME_VIRTUAL_ROW_COUNT);
  assert.equal(
    calls.filter((call) => call.rowIndex === 40).length,
    25,
    "remount retains paginated cards"
  );
  assert.ok(calls.every((call) => model.snapshot().indices.has(call.rowIndex)));
  assert.ok(markup.includes('data-row-index="40"'));
  assert.ok(markup.includes('data-virtual-edge="top"'));
  assert.ok(!markup.includes('data-row-key="row_0"'));
});

test("logical navigation crosses mounted boundaries and returns to Continue Watching", () => {
  const methods = createHomeRowVirtualizationMethods();
  const model = new HomeRowVirtualWindow();
  model.setRows(Array.from({ length: 30 }, (_, i) => row(i)));
  const card = (key, catalog = true) => ({ key, dataset: { navRow: "0" }, closest: () => catalog });
  const cw = card("continue_watching", false);
  const mounted = [];
  const screen = {
    ...methods,
    homeRowVirtualWindow: model,
    usesVirtualHomeRows: () => true,
    getNodeRowKey: (node) => node.key,
    getNavigationRowNodes: (key) => [card(key)],
    ensureVirtualHomeRowMounted(key) {
      model.include(key);
      mounted.push(key);
    },
    navModel: { rows: [[cw], [card("row_15")]] }
  };
  model.include("row_15");
  assert.equal(screen.getVirtualHomeAdjacentRow(cw, 1)[0].key, "row_0");
  assert.equal(model.start, 0);
  assert.equal(screen.getVirtualHomeAdjacentRow(card("row_8"), 1)[0].key, "row_9");
  assert.ok(model.snapshot().indices.has(9));
  assert.deepEqual(screen.getVirtualHomeAdjacentRow(card("row_0"), -1), [cw]);
  assert.deepEqual(screen.getVirtualHomeAdjacentRow(card("row_29"), 1), []);
  assert.deepEqual(mounted, ["row_0", "row_9"]);
});

test("only constrained Modern Home enables row virtualization", () => {
  const screen = {
    ...createHomeRowVirtualizationMethods(),
    layoutMode: "modern",
    isPerformanceConstrained: () => true
  };
  assert.equal(screen.usesVirtualHomeRows(), true);
  screen.layoutMode = "classic";
  assert.equal(screen.usesVirtualHomeRows(), false);
  screen.layoutMode = "modern";
  screen.isPerformanceConstrained = () => false;
  assert.equal(screen.usesVirtualHomeRows(), false);
});

test("pointer jumps mount the visible catalogs and update the hero with focus", () => {
  const model = new HomeRowVirtualWindow();
  model.setRows(Array.from({ length: 70 }, (_, i) => row(i)));
  let mounted = false;
  let focusOptions;
  const screen = {
    ...createHomeRowVirtualizationMethods(),
    homeRowVirtualWindow: model,
    container: { querySelector: () => ({ getBoundingClientRect: () => ({ top: -10000 }) }) },
    getHomeViewport: () => ({ getBoundingClientRect: () => ({ top: 0 }) }),
    isSidebarFocusActive: () => false,
    isModernVerticalScrollActive: () => false,
    captureVirtualHomeRowMetrics() {},
    getCurrentFocusedNode: () => null,
    getNodeRowKey: () => "",
    mountVirtualHomeWindow() {
      mounted = true;
    },
    syncMainFocusToViewport(options) {
      focusOptions = options;
    }
  };
  screen.syncVirtualHomeRowsForViewport();
  assert.equal(mounted, true);
  assert.ok(model.snapshot().indices.has(model.indexAt(10000)));
  assert.equal(focusOptions.suppressFlows, false, "the hero must follow pointer-selected focus");
});

test("renders that keep the mounted rows skip geometry reads and scroll writes", () => {
  const model = new HomeRowVirtualWindow();
  model.setRows(Array.from({ length: 20 }, (_, i) => row(i)));
  model.trackStates.set("row_0", 120);
  const counts = { reads: 0, scrollWrites: 0 };
  const makeSection = (key) => {
    let scrollLeft = 0;
    const track = {
      dataset: { trackRowKey: key },
      get scrollLeft() {
        return scrollLeft;
      },
      set scrollLeft(value) {
        counts.scrollWrites += 1;
        scrollLeft = value;
      },
      querySelectorAll: () => []
    };
    return {
      dataset: { rowKey: key },
      querySelector: (selector) => (selector === ".home-track" ? track : null),
      getBoundingClientRect() {
        counts.reads += 1;
        return { top: 0, height: 300 };
      }
    };
  };
  let sections = [makeSection("row_0"), makeSection("row_1")];
  const catalogs = {
    querySelector: (selector) => (selector === ".home-modern-row" ? sections[0] : null),
    querySelectorAll: () => sections
  };
  const screen = {
    ...createHomeRowVirtualizationMethods(),
    homeRowVirtualWindow: model,
    container: {
      querySelector: (selector) => (selector === ".home-catalogs-virtual" ? catalogs : null),
      querySelectorAll: () => sections
    },
    getHomeViewport: () => ({ scrollTop: 0 })
  };

  screen.finishVirtualHomeRowUpdate();
  assert.ok(counts.reads > 0, "freshly mounted rows are measured");
  assert.equal(sections[0].querySelector(".home-track").scrollLeft, 120);

  counts.reads = 0;
  counts.scrollWrites = 0;
  screen.finishVirtualHomeRowUpdate();
  assert.deepEqual(counts, { reads: 0, scrollWrites: 0 });

  sections = [sections[1], makeSection("row_2")];
  screen.finishVirtualHomeRowUpdate();
  assert.ok(counts.reads > 0, "an entering row is measured");
  assert.equal(counts.scrollWrites, 0, "retained tracks keep their own scroll position");
});
