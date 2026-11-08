import { buildModernRowKey } from "./modernHomeLayout.js";

export const HOME_VIRTUAL_ROW_COUNT = 9;
export const HOME_VIRTUAL_ROW_GAP = 24;

export function homeVirtualRowKey(row) {
  return String(row?.homeCatalogKey || buildModernRowKey(row));
}

// Catalog data outlives its DOM. This model stores only keys, geometry and
// horizontal positions, never detached cards or decoded artwork.
export class HomeRowVirtualWindow {
  constructor() {
    this.entries = [];
    this.heights = new Map();
    this.trackStates = new Map();
    this.itemCounts = new Map();
    this.start = 0;
    this.end = 0;
    this.estimatedHeight = 400;
  }

  setRows(rows) {
    const anchorKey = this.entries[this.start]?.key;
    this.entries = rows.flatMap((row, index) => {
      const items = row?.result?.data?.items;
      return items?.length || row?.loadingItems?.length
        ? [{ key: homeVirtualRowKey(row), index }]
        : [];
    });
    const keys = new Set(this.entries.map((entry) => entry.key));
    for (const cache of [this.heights, this.trackStates, this.itemCounts]) {
      for (const key of cache.keys()) if (!keys.has(key)) cache.delete(key);
    }
    const anchor = this.entries.findIndex((entry) => entry.key === anchorKey);
    this.setStart(anchor >= 0 ? anchor : this.start);
  }

  setStart(start) {
    this.start = Math.max(
      0,
      Math.min(Math.floor(start), Math.max(0, this.entries.length - HOME_VIRTUAL_ROW_COUNT))
    );
    this.end = Math.min(this.entries.length, this.start + HOME_VIRTUAL_ROW_COUNT);
  }

  include(key) {
    const index = this.entries.findIndex((entry) => entry.key === key);
    if (index < 0) return false;
    const before = this.start;
    // Keep two rows ready in either direction, shifting in chunks rather than
    // remounting on every key. Adjacent navigation always retains the old focus.
    if (index < this.start + 2 || index >= this.end - 2) this.setStart(index - 3);
    return before !== this.start;
  }

  heightAt(index) {
    return this.heights.get(this.entries[index]?.key) || this.estimatedHeight;
  }

  offsetAt(index) {
    let offset = 0;
    for (let i = 0; i < index; i++) offset += this.heightAt(i) + HOME_VIRTUAL_ROW_GAP;
    return offset;
  }

  indexAt(offset) {
    let top = 0;
    for (let i = 0; i < this.entries.length; i++) {
      top += this.heightAt(i) + HOME_VIRTUAL_ROW_GAP;
      if (top > offset) return i;
    }
    return Math.max(0, this.entries.length - 1);
  }

  snapshot() {
    return {
      indices: new Set(this.entries.slice(this.start, this.end).map((entry) => entry.index)),
      top: this.start ? Math.max(0, this.offsetAt(this.start) - HOME_VIRTUAL_ROW_GAP) : 0,
      bottom:
        this.end < this.entries.length
          ? Math.max(
              0,
              this.offsetAt(this.entries.length) - this.offsetAt(this.end) - HOME_VIRTUAL_ROW_GAP
            )
          : 0,
      itemCounts: this.itemCounts
    };
  }
}
