/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods66() {
  const { streamRepository, shouldAppendStreamCards, isSelectKeyCode, t, clamp, normalizeItemType } = internals;

  return {
    getFilteredEpisodePanelStreams() {
      const streams = Array.isArray(this.episodePanelStreams) ? this.episodePanelStreams : [];
      if (this.episodePanelStreamFilter === "all") {
        return streams;
      }
      return streams.filter((stream) => String(stream?.addonName || "") === this.episodePanelStreamFilter);
    },
    closeEpisodeStreamsView() {
      streamRepository.setLocalPluginSearchPaused(true);
      this.episodePanelMode = "episodes";
      this.episodePanelStreamsLoading = false;
      this.episodePanelStreamsError = "";
      this.episodePanelFocusZone = "episodes";
      this.renderEpisodePanel();
    },
    async openEpisodeStreamsView({ forceReload = false } = {}) {
      streamRepository.setLocalPluginSearchPaused(false);
      const selected = this.episodes[this.episodePanelIndex] || null;
      if (!selected?.id) {
        return;
      }
      this.episodePanelMode = "streams";
      this.episodePanelStreamVideoId = String(selected.id);
      this.episodePanelStreamFilter = "all";
      this.episodePanelStreamFocus = { zone: "actions", index: 0 };
      this.episodePanelStreamFocusUserMoved = false;
      this.episodePanelStreamRenderLimit = 0;
      this.episodePanelStreams = [];
      this.episodePanelStreamsError = "";
      this.episodePanelStreamsLoading = true;
      this.renderEpisodePanel();

      const itemType = this.params?.itemType || "series";
      const cacheKey = this.getStreamCacheKey(selected.id, normalizeItemType(itemType), selected.season, selected.episode);
      if (forceReload) {
        this.streamCandidatesByVideoId?.delete?.(cacheKey);
      }
      const token = Number(this.episodePanelStreamLoadToken || 0) + 1;
      this.episodePanelStreamLoadToken = token;
      const isCurrentLoad = () =>
        token === this.episodePanelStreamLoadToken &&
        this.episodePanelVisible &&
        this.episodePanelMode === "streams" &&
        String(this.episodePanelStreamVideoId || "") === String(selected.id);
      try {
        const streams = await this.getPlayableStreamsForVideo(selected.id, itemType, {
          season: selected.season,
          episode: selected.episode,
          forceRefresh: forceReload,
          onChunk: (partialStreams) => {
            if (isCurrentLoad()) {
              this.applyEpisodePanelStreams(partialStreams);
              this.scheduleEpisodePanelRender();
            }
          }
        });
        if (!isCurrentLoad()) {
          return;
        }
        this.episodePanelStreamsLoading = false;
        this.applyEpisodePanelStreams(streams);
      } catch (_error) {
        if (token !== this.episodePanelStreamLoadToken) {
          return;
        }
        this.episodePanelStreams = [];
        this.episodePanelStreamsLoading = false;
        this.episodePanelStreamsError = t("panel_failed_load_streams", {}, "Failed to load streams");
        this.episodePanelStreamFocus = { zone: "actions", index: 0 };
      }
      this.renderEpisodePanel();
    },
    applyEpisodePanelStreams(streams = []) {
      const streamKey = (stream) => String(stream?.id || stream?.url || "");
      const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
      const focusedStream = focus.zone === "streams" ? this.getFilteredEpisodePanelStreams()[focus.index] : null;
      const focusedFilter = focus.zone === "filters" ? this.getEpisodePanelStreamFilters()[focus.index] : null;
      this.episodePanelStreams = streams;
      const filters = this.getEpisodePanelStreamFilters();
      if (!filters.includes(this.episodePanelStreamFilter)) {
        this.episodePanelStreamFilter = "all";
      }
      const filtered = this.getFilteredEpisodePanelStreams();
      if (!this.episodePanelStreamFocusUserMoved) {
        this.episodePanelStreamFocus = filtered.length ? { zone: "streams", index: 0 } : { zone: "actions", index: 0 };
      } else if (focusedStream) {
        const index = filtered.findIndex((stream) => streamKey(stream) === streamKey(focusedStream));
        this.episodePanelStreamFocus = { zone: "streams", index: Math.max(0, index) };
      } else if (focusedFilter) {
        this.episodePanelStreamFocus = { zone: "filters", index: Math.max(0, filters.indexOf(focusedFilter)) };
      }
    },
    scheduleEpisodePanelRender() {
      if (this.episodePanelRenderTimer) {
        return;
      }
      this.episodePanelRenderTimer = setTimeout(() => {
        this.episodePanelRenderTimer = null;
        if (this.episodePanelVisible) {
          this.renderEpisodePanel();
        }
      }, 0);
    },
    hasEpisodeStreamFilterRow() {
      return this.getEpisodePanelStreamFilters().length > 1;
    },
    moveEpisodeStreamFocus(direction) {
      const filters = this.getEpisodePanelStreamFilters();
      const streams = this.getFilteredEpisodePanelStreams();
      const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
      let index = Number(focus.index || 0);

      if (focus.zone === "close") {
        if (direction === "down") {
          this.episodePanelStreamFocus = { zone: "actions", index: 0 };
        }
        return;
      }
      if (focus.zone === "actions") {
        if (direction === "left" || direction === "right") {
          this.episodePanelStreamFocus = {
            zone: "actions",
            index: clamp(index + (direction === "right" ? 1 : -1), 0, 1)
          };
        } else if (direction === "up") {
          this.episodePanelStreamFocus = { zone: "close", index: 0 };
        } else if (direction === "down") {
          this.episodePanelStreamFocus = this.hasEpisodeStreamFilterRow()
            ? {
                zone: "filters",
                index: clamp(filters.indexOf(this.episodePanelStreamFilter), 0, filters.length - 1)
              }
            : { zone: "streams", index: 0 };
        }
        return;
      }
      if (focus.zone === "filters") {
        if (direction === "left" || direction === "right") {
          this.episodePanelStreamFocus = {
            zone: "filters",
            index: clamp(index + (direction === "right" ? 1 : -1), 0, Math.max(0, filters.length - 1))
          };
        } else if (direction === "up") {
          this.episodePanelStreamFocus = { zone: "actions", index: 0 };
        } else if (direction === "down" && streams.length) {
          this.episodePanelStreamFocus = { zone: "streams", index: 0 };
        }
        return;
      }
      if (focus.zone === "streams") {
        if (direction === "up") {
          if (index > 0) {
            this.episodePanelStreamFocus = { zone: "streams", index: index - 1 };
          } else if (this.hasEpisodeStreamFilterRow()) {
            this.episodePanelStreamFocus = {
              zone: "filters",
              index: clamp(filters.indexOf(this.episodePanelStreamFilter), 0, Math.max(0, filters.length - 1))
            };
          } else {
            this.episodePanelStreamFocus = { zone: "actions", index: 0 };
          }
        } else if (direction === "down") {
          this.episodePanelStreamFocus = {
            zone: "streams",
            index: clamp(index + 1, 0, Math.max(0, streams.length - 1))
          };
        }
      }
    },
    async activateEpisodeStreamFocus() {
      const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
      if (focus.zone === "close") {
        this.hideEpisodePanel();
        return;
      }
      if (focus.zone === "actions") {
        if (Number(focus.index || 0) === 0) {
          this.closeEpisodeStreamsView();
        } else {
          await this.openEpisodeStreamsView({ forceReload: true });
        }
        return;
      }
      if (focus.zone === "filters") {
        const filters = this.getEpisodePanelStreamFilters();
        this.episodePanelStreamFilter = filters[clamp(Number(focus.index || 0), 0, Math.max(0, filters.length - 1))] || "all";
        this.episodePanelStreamRenderLimit = 0;
        this.episodePanelStreamFocus = {
          zone: "filters",
          index: Math.max(0, filters.indexOf(this.episodePanelStreamFilter))
        };
        this.renderEpisodePanel();
        return;
      }
      const streams = this.getFilteredEpisodePanelStreams();
      const selectedStream = streams[clamp(Number(focus.index || 0), 0, Math.max(0, streams.length - 1))] || null;
      if (selectedStream) {
        await this.playEpisodeFromPanel(selectedStream);
      }
    },
    handleEpisodePanelKey(event) {
      if (!this.episodePanelVisible) {
        return false;
      }
      const keyCode = Number(event?.keyCode || event?.which || event?.originalKeyCode || 0);
      const isNavigationKey = keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || isSelectKeyCode(keyCode);
      if (!isNavigationKey) {
        return false;
      }
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();

      if (this.episodePanelMode === "streams") {
        if (!isSelectKeyCode(keyCode)) {
          this.episodePanelStreamFocusUserMoved = true;
        }
        if (keyCode === 37) {
          this.moveEpisodeStreamFocus("left");
        } else if (keyCode === 38) {
          this.moveEpisodeStreamFocus("up");
        } else if (keyCode === 39) {
          this.moveEpisodeStreamFocus("right");
        } else if (keyCode === 40) {
          this.moveEpisodeStreamFocus("down");
        } else if (isSelectKeyCode(keyCode)) {
          void this.activateEpisodeStreamFocus();
          return true;
        }
        this.syncEpisodePanelFocusDom();
        return true;
      }

      const seasons = this.getEpisodePanelSeasons();
      const hasSeasonTabs = seasons.length > 1;
      const entries = this.getEpisodePanelEntries();
      const currentPosition = Math.max(
        0,
        entries.findIndex((entry) => entry.index === this.episodePanelIndex)
      );

      if (keyCode === 38) {
        if (this.episodePanelFocusZone === "episodes") {
          if (currentPosition > 0) {
            this.moveEpisodePanel(-1);
          } else {
            this.episodePanelFocusZone = hasSeasonTabs ? "seasons" : "close";
            this.syncEpisodePanelFocusDom();
          }
          return true;
        }
        if (this.episodePanelFocusZone === "seasons") {
          this.episodePanelFocusZone = "close";
          this.syncEpisodePanelFocusDom();
          return true;
        }
        return true;
      }

      if (keyCode === 40) {
        if (this.episodePanelFocusZone === "close") {
          this.episodePanelFocusZone = hasSeasonTabs ? "seasons" : "episodes";
          this.syncEpisodePanelFocusDom();
          return true;
        }
        if (this.episodePanelFocusZone === "seasons") {
          this.episodePanelFocusZone = "episodes";
          this.syncEpisodePanelFocusDom();
          return true;
        }
        this.moveEpisodePanel(1);
        return true;
      }

      if (keyCode === 37 || keyCode === 39) {
        if (this.episodePanelFocusZone === "seasons") {
          this.moveEpisodePanelSeason(keyCode === 37 ? -1 : 1);
        }
        return true;
      }

      if (isSelectKeyCode(keyCode)) {
        if (this.episodePanelFocusZone === "close") {
          this.hideEpisodePanel();
          return true;
        }
        if (this.episodePanelFocusZone === "seasons") {
          this.episodePanelFocusZone = "episodes";
          this.syncEpisodePanelFocusDom();
          return true;
        }
        this.playEpisodeFromPanel();
        return true;
      }

      return true;
    },
    getEpisodePanelFocusNode(panel) {
      if (this.episodePanelMode !== "streams") {
        const zone = this.episodePanelFocusZone || "episodes";
        if (zone === "close") {
          return panel.querySelector("[data-episode-action='close']");
        }
        if (zone === "seasons") {
          return panel.querySelector(".player-episode-season-tab.selected");
        }
        return panel.querySelector(`[data-episode-index="${Number(this.episodePanelIndex)}"]`);
      }
      const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
      const index = Number(focus.index || 0);
      if (focus.zone === "close") {
        return panel.querySelector("[data-episode-action='close']");
      }
      if (focus.zone === "actions") {
        return panel.querySelectorAll("[data-episode-stream-action]")[index] || null;
      }
      if (focus.zone === "filters") {
        return panel.querySelector(`[data-episode-stream-filter-index="${index}"]`);
      }
      if (shouldAppendStreamCards(index, Number(this.episodePanelStreamRenderLimit || 0))) {
        this.appendEpisodeStreamCards(index + 1);
      }
      return panel.querySelector(`[data-episode-stream-index="${index}"]`);
    },
    syncEpisodePanelFocusDom() {
      const panel = this.uiRefs?.root?.querySelector("#episodeSidePanel");
      const mode = this.episodePanelMode === "streams" ? "streams" : "episodes";
      const focusedNode =
        panel && !panel.classList.contains("is-exiting") && panel.dataset.episodePanelMode === mode
          ? this.getEpisodePanelFocusNode(panel)
          : null;
      if (!focusedNode) {
        this.renderEpisodePanel();
        return;
      }
      this.renderedEpisodePanelMarkup = null;
      panel.querySelectorAll(".focused").forEach((node) => {
        if (node !== focusedNode) {
          node.classList.remove("focused");
        }
      });
      focusedNode.classList.add("focused");
      if (mode === "episodes") {
        panel.querySelectorAll(".player-episode-item.selected").forEach((node) => {
          node.classList.toggle("selected", node.dataset.episodeIndex === String(this.episodePanelIndex));
        });
        panel.querySelector(`[data-episode-index="${Number(this.episodePanelIndex)}"]`)?.classList.add("selected");
      }
      this.scrollEpisodePanelIntoView();
    },
    scrollEpisodePanelIntoView() {
      const panel = this.uiRefs?.root?.querySelector("#episodeSidePanel");
      if (!panel || !this.episodePanelVisible) {
        return;
      }

      const scrollVerticallyWithin = (container, target, padding = 12) => {
        if (!container || !target) {
          return;
        }
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (targetRect.top < containerRect.top + padding) {
          container.scrollTop -= containerRect.top + padding - targetRect.top;
        } else if (targetRect.bottom > containerRect.bottom - padding) {
          container.scrollTop += targetRect.bottom - (containerRect.bottom - padding);
        }
      };

      const scrollHorizontallyWithin = (container, target, padding = 8) => {
        if (!container || !target) {
          return;
        }
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (targetRect.left < containerRect.left + padding) {
          container.scrollLeft -= containerRect.left + padding - targetRect.left;
        } else if (targetRect.right > containerRect.right - padding) {
          container.scrollLeft += targetRect.right - (containerRect.right - padding);
        }
      };

      const selected = panel.querySelector(".player-episode-item.focused") || panel.querySelector(".player-episode-item.selected");
      scrollVerticallyWithin(panel.querySelector(".player-episode-list"), selected);

      const focusedSeason = panel.querySelector(".player-episode-season-tab.focused");
      scrollHorizontallyWithin(panel.querySelector(".player-episode-season-tabs"), focusedSeason);

      const focusedStream = panel.querySelector(".player-episode-stream-card.focused");
      scrollVerticallyWithin(panel.querySelector(".player-episode-stream-list"), focusedStream);

      const focusedFilter = panel.querySelector(".player-episode-stream-filter.focused");
      scrollHorizontallyWithin(panel.querySelector(".player-episode-stream-filters"), focusedFilter);

      try {
        const focused = panel.querySelector(".focused");
        focused?.focus?.({ preventScroll: true });
      } catch (_) {
        // Some TV WebKit builds reject programmatic focus during DOM replacement.
      }
    }
  };
}
