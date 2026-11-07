import { HomeRowVirtualWindow } from "./homeRowVirtualWindow.js";
import { renderModernCatalogRows } from "./modernHomeLayout.js";
import { updateHomeCatalogDom } from "./homeDomUpdate.js";

export function createHomeRowVirtualizationMethods() {
  return {
    usesVirtualHomeRows() {
      return this.layoutMode === "modern" && this.isPerformanceConstrained();
    },

    prepareVirtualHomeRows(focusState) {
      if (!this.usesVirtualHomeRows()) {
        this.homeRowVirtualWindow = null;
        return null;
      }
      const sizingKey = JSON.stringify(this.layoutPrefs);
      if (!this.homeRowVirtualWindow || sizingKey !== this.homeRowVirtualSizingKey) {
        this.homeRowVirtualWindow = new HomeRowVirtualWindow();
        this.homeRowVirtualSizingKey = sizingKey;
      }
      const model = this.homeRowVirtualWindow;
      this.captureVirtualHomeRowMetrics();
      model.setRows(this.rows || []);
      if (focusState?.rowKey) {
        model.include(focusState.rowKey);
        if (focusState.itemIndex >= 0) {
          model.itemCounts.set(
            focusState.rowKey,
            Math.max(model.itemCounts.get(focusState.rowKey) || 0, focusState.itemIndex + 1)
          );
        }
      }
      for (const [key, value] of Object.entries(focusState?.trackStates || {}))
        model.trackStates.set(key, value);
      return model.snapshot();
    },

    captureVirtualHomeRowMetrics() {
      const model = this.homeRowVirtualWindow;
      if (!model || !this.container || this.homeDomPreserved) return;
      const sections = this.container.querySelectorAll(".home-modern-catalogs .home-modern-row");
      const samples = [];
      for (const section of sections) {
        const key = section.dataset.rowKey;
        const track = section.querySelector(".home-track");
        if (track) {
          model.trackStates.set(key, track.scrollLeft);
          model.itemCounts.set(key, track.querySelectorAll(".home-content-card").length);
        }
        // Expansion is temporary; its larger height must not become a spacer.
        if (section.querySelector(".is-expanded")) continue;
        const height = section.getBoundingClientRect().height;
        if (height > 0) {
          model.heights.set(key, height);
          samples.push(height);
        }
      }
      if (samples.length) {
        samples.sort((a, b) => a - b);
        model.estimatedHeight = samples[Math.floor(samples.length / 2)];
      }
    },

    finishVirtualHomeRowUpdate() {
      const model = this.homeRowVirtualWindow;
      const catalogs = this.container?.querySelector(".home-catalogs-virtual");
      const viewport = this.getHomeViewport();
      if (!model || !catalogs || !viewport) return;
      // Retained rows keep their scroll position, and their heights only feed
      // the spacers once they leave the window, which captures them first.
      // Only rows mounted since the last update need restoring and measuring.
      const settled =
        this.homeRowVirtualSettledRows || (this.homeRowVirtualSettledRows = new WeakSet());
      const entering = Array.from(catalogs.querySelectorAll(".home-modern-row")).filter(
        (section) => !settled.has(section)
      );
      if (!entering.length) return;
      for (const section of entering) {
        const track = section.querySelector(".home-track");
        const scrollLeft = model.trackStates.get(track?.dataset.trackRowKey);
        if (track && Number.isFinite(scrollLeft)) track.scrollLeft = scrollLeft;
        settled.add(section);
      }
      // Anchor the mounted window while replacing estimated prefix heights.
      const anchor = catalogs.querySelector(".home-modern-row");
      const before = anchor?.getBoundingClientRect().top;
      this.captureVirtualHomeRowMetrics();
      this.syncVirtualHomeRowSpacers();
      if (anchor && Number.isFinite(before))
        viewport.scrollTop += anchor.getBoundingClientRect().top - before;
    },

    syncVirtualHomeRowSpacers() {
      const catalogs = this.container?.querySelector(".home-catalogs-virtual");
      if (!catalogs || !this.homeRowVirtualWindow) return;
      const window = this.homeRowVirtualWindow.snapshot();
      for (const edge of ["top", "bottom"]) {
        const spacer = catalogs.querySelector(`[data-virtual-edge="${edge}"]`);
        if (spacer) {
          spacer.style.height = `${window[edge]}px`;
          spacer.hidden = window[edge] <= 0;
        }
      }
    },

    mountVirtualHomeWindow() {
      const model = this.homeRowVirtualWindow;
      const catalogs = this.container?.querySelector(".home-catalogs-virtual");
      if (!model || !catalogs || !this.modernCatalogRenderOptions) return;
      const viewport = this.getHomeViewport();
      const scrollTop = viewport.scrollTop;
      const focused = this.getCurrentFocusedNode();
      const anchor = focused?.closest?.(".home-modern-row");
      const anchorTop = anchor?.getBoundingClientRect().top;
      const entries = model.entries.slice(model.start, model.end);
      const mountedKeys = new Set(
        Array.from(catalogs.querySelectorAll(".home-modern-row"), (node) => node.dataset.rowKey)
      );
      const rowWindow = model.snapshot();
      rowWindow.indices = new Set(
        entries.filter((entry) => !mountedKeys.has(entry.key)).map((entry) => entry.index)
      );
      const payload = renderModernCatalogRows({
        ...this.modernCatalogRenderOptions,
        rows: this.rows,
        rowWindow,
        focusedRowKey: this.getNodeRowKey(focused),
        focusedItemIndex: Number(focused?.dataset?.navCol ?? -1),
        expandFocusedPoster: false
      });
      this.teardownModernTrackScrollPagination();
      updateHomeCatalogDom(
        catalogs,
        payload.markup,
        entries.map((entry) => entry.key)
      );
      // Establish the new logical geometry before restoring scroll. Compensating
      // for the window's prefix change afterward would double-scroll pointer
      // jumps (there is no retained catalog focus anchor in that case).
      this.syncVirtualHomeRowSpacers();
      payload.catalogSeeAllMap.forEach((value, key) => this.catalogSeeAllMap.set(key, value));
      // Local window updates invalidate the whole-render equality shortcut.
      this.renderedMarkup = null;
      this.invalidateNavigationModel();
      this.buildNavigationModel();
      viewport.scrollTop =
        scrollTop + (anchor?.isConnected ? anchor.getBoundingClientRect().top - anchorTop : 0);
      this.finishVirtualHomeRowUpdate();
      this.setupModernTrackScrollPagination();
      this.scheduleHomeLazyImageHydration(null, { refreshIndex: true });
    },

    ensureVirtualHomeRowMounted(rowKey) {
      const model = this.homeRowVirtualWindow;
      if (!model || !this.usesVirtualHomeRows()) return;
      if (model.include(rowKey)) {
        this.captureVirtualHomeRowMetrics();
        this.mountVirtualHomeWindow();
      }
    },

    getVirtualHomeAdjacentRow(current, delta) {
      const model = this.homeRowVirtualWindow;
      if (!model || !this.usesVirtualHomeRows()) return undefined;
      const key = this.getNodeRowKey(current);
      const index = model.entries.findIndex((entry) => entry.key === key);
      let next;
      if (index >= 0) {
        next = model.entries[index + delta];
        if (!next) {
          if (delta > 0) return [];
          const continueRows = this.navModel.rows.filter(
            (nodes) => !nodes[0]?.closest(".home-modern-row")
          );
          return continueRows[continueRows.length - 1] || [];
        }
      } else {
        if (delta < 0) return undefined;
        const row = Number(current.dataset.navRow || 0);
        const nextMounted = this.navModel.rows[row + 1];
        if (nextMounted && !nextMounted[0]?.closest(".home-modern-row")) return undefined;
        next = model.entries[0];
      }
      if (!next) return [];
      this.ensureVirtualHomeRowMounted(next.key);
      return this.getNavigationRowNodes(next.key);
    },

    syncVirtualHomeRowsForViewport() {
      const model = this.homeRowVirtualWindow;
      const viewport = this.getHomeViewport();
      const catalogs = this.container?.querySelector(".home-catalogs-virtual");
      if (
        !model ||
        !viewport ||
        !catalogs ||
        this.homeHoldFocusLocked ||
        this.isSidebarFocusActive()
      )
        return;
      // D-pad scroll follows a focus target already mounted by logical navigation.
      if (this._mainVertRaf || this.isModernVerticalScrollActive()) return;
      const offset = viewport.getBoundingClientRect().top - catalogs.getBoundingClientRect().top;
      const index = model.indexAt(Math.max(0, offset));
      const key = model.entries[index]?.key;
      if (!key || (index >= model.start + 2 && index < model.end - 2)) return;
      if (!model.include(key)) return;
      this.captureVirtualHomeRowMetrics();
      const focused = this.getCurrentFocusedNode();
      const focusKey = this.getNodeRowKey(focused);
      const focusIndex = model.entries.findIndex((entry) => entry.key === focusKey);
      if (focusIndex >= 0 && (focusIndex < model.start || focusIndex >= model.end)) {
        this.cancelPendingHeroFocus();
        this.cancelFocusedPosterFlow();
        this.collapseFocusedPoster();
        this.setCurrentFocusedNode(null);
        focused?.classList.remove("focused");
      }
      this.mountVirtualHomeWindow();
      this.syncMainFocusToViewport({ suppressFlows: false });
    }
  };
}
