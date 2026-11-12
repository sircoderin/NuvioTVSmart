import * as internals from "./homeScreenContext.js";
import { startHomeContinueWatchingLoad } from "./homeContinueWatchingLoad.js";
import { updateHomeLoadingStatus } from "./homeLoadingStatus.js";
import { HomeCatalogSnapshotStore, buildHomeCatalogSnapshotKey } from "../../../data/local/homeCatalogSnapshotStore.js";

const SNAPSHOT_READ_TIMEOUT_MS = 500;
const SNAPSHOT_WRITE_INTERVAL_MS = 60 * 1000;

function readSnapshotWithTimeout(options) {
  let timeoutId = null;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(null), SNAPSHOT_READ_TIMEOUT_MS);
  });
  return Promise.race([HomeCatalogSnapshotStore.read(options).catch(() => null), timeout]).then(
    (value) => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      return value;
    },
    () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      return null;
    }
  );
}

// Constrained TVs skip the catalog cache: opening and reading it there takes
// seconds, so it never paints before the network, and reading and writing the
// rows still cost the main thread during startup.
function usesHomeCatalogSnapshot(screen) {
  return !screen?.isPerformanceConstrained?.();
}

function persistHomeCatalogSnapshot(screen, token, { force = false } = {}) {
  const key = screen?.homeCatalogSnapshotKey;
  if (!key || token !== screen.homeLoadToken || !usesHomeCatalogSnapshot(screen)) return;
  const now = Date.now();
  if (!force && now - Number(screen.lastHomeCatalogSnapshotWriteAt || 0) < SNAPSHOT_WRITE_INTERVAL_MS) {
    return;
  }
  screen.lastHomeCatalogSnapshotWriteAt = now;
  void HomeCatalogSnapshotStore.write({ key, rows: screen.rows }).catch(() => {});
}

export function createHomeScreenMethods21() {
  const {
    Router,
    addonRepository,
    catalogRepository,
    watchProgressRepository,
    watchedItemsRepository,
    LayoutPreferences,
    HomeCatalogStore,
    CollectionsStore,
    ProfileManager,
    StartupSyncService,
    WatchProgressSource,
    buildWatchedTitleIdSet,
    buildCatalogOrderKey,
    buildCatalogDisableKey,
    catalogShouldShowOnHome,
    catalogSkipStep,
    catalogSupportsExtra,
    getSidebarProfileState,
    CW_MAX_VISIBLE_ITEMS,
    HOME_ADDON_MANIFEST_TIMEOUT_MS,
    HOME_PERF_DEBUG,
    mergeRefreshedHomeRows,
    createHomeRowBatcher,
    orderHomeCatalogDescriptors,
    initialHomeCatalogDescriptors,
    homeCatalogLoadCount,
    homeCatalogWindowTarget,
    HOME_CATALOG_PRELOAD_ROWS,
    shouldApplyLateContinueWatchingFocus,
    homePerfNow,
    logHomePerf,
    uniqueById,
    getContinueWatchingNextUpSeedOptions,
    buildSidebarProfileSignature,
    buildHeroIdentity
  } = internals;

  return {
    async loadData({ background = false, preserveReturnState = false, refreshManifests = true } = {}) {
      const loadStart = HOME_PERF_DEBUG ? homePerfNow() : 0;
      const token = this.homeLoadToken;
      this.loadedHomeRouteInputSignature = "";
      const preserveHomeReturnState = Boolean(background && preserveReturnState);
      const preservedHeroItem = preserveHomeReturnState ? this.heroItem : null;
      const preservedHeroIdentity = preserveHomeReturnState ? buildHeroIdentity(this.heroItem) : "";
      const prefs = LayoutPreferences.get();
      this.layoutPrefs = prefs;
      this.renderedSyncSensitiveSignature = this.buildSyncSensitiveHomeSignature();
      this.rememberHomeResumeInputs();
      // Async catalog/progress refreshes must not collapse a focused sidebar.
      // Android keeps this presentation state outside the Home data flow.
      this.sidebarExpanded = Boolean(this.sidebarExpanded);
      this.layoutMode = String(prefs.homeLayout || "classic").toLowerCase();
      const nextUpSeedOptions = getContinueWatchingNextUpSeedOptions();
      const watchedItemsPromise = watchedItemsRepository.getAll(2000).catch(() => []);
      watchedItemsPromise.then((watchedItems) => {
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        this.watchedItems = Array.isArray(watchedItems) ? watchedItems : [];
        this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
        this.requestBackgroundRender();
        void this.refreshWatchedTitleState({ token });
      });

      const continueWatchingSourceKey = watchProgressRepository.getContinueWatchingSourceKey();
      const continueWatchingSource = watchProgressRepository.getContinueWatchingSource();
      const startupSyncPendingAtLoad =
        continueWatchingSource === WatchProgressSource.NUVIO_SYNC && StartupSyncService.isCurrentProfilePullPending();
      const startupSyncPullPromiseAtLoad = startupSyncPendingAtLoad ? StartupSyncService.getCurrentProfilePullPromise() : null;
      const preserveContinueWatching = Boolean(background && this.continueWatchingDisplay?.length);
      const hydratedFromSnapshot = Boolean(
        !background && this.continueWatchingHydratedFromSnapshot && this.continueWatchingDisplay?.length
      );
      const hasExistingContinueWatchingDisplay = Boolean(
        (preserveContinueWatching || hydratedFromSnapshot) && this.continueWatchingDisplay?.length
      );
      const suppressContinueWatchingLoading = preserveContinueWatching || hydratedFromSnapshot;
      const progressErrors = { all: null, recent: null };
      const sidebarProfilePromise = getSidebarProfileState().catch(() => null);
      const progressAllPromise = watchProgressRepository.getAllForContinueWatching().catch((error) => {
        progressErrors.all = error;
        return [];
      });
      const recentProgressPromise = watchProgressRepository.getRecent(CW_MAX_VISIBLE_ITEMS, { enrichMetadata: false }).catch((error) => {
        progressErrors.recent = error;
        return [];
      });
      // Continue Watching is reconciled fire-and-forget in the block below, so a
      // slow addon or Trakt call never blocks catalog rows. The section paints
      // from the cached snapshot when available, or raw progress before enrichment.

      if (!background) {
        this.homeContinueWatchingStatusToken = token;
        updateHomeLoadingStatus({ continueWatching: true });
      }
      const continueWatchingLoad = startHomeContinueWatchingLoad.call(this, {
        token,
        watchedItemsPromise,
        progressAllPromise,
        recentProgressPromise,
        progressErrors,
        continueWatchingSourceKey,
        continueWatchingSource,
        startupSyncPendingAtLoad,
        startupSyncPullPromiseAtLoad,
        nextUpSeedOptions,
        prefs,
        background,
        preserveHomeReturnState,
        suppressContinueWatchingLoading,
        hasExistingContinueWatchingDisplay
      });
      if (!background) {
        // Held until Next Up and artwork are in: the row changes until then.
        void Promise.resolve(continueWatchingLoad).finally(() => {
          if (this.homeContinueWatchingStatusToken === token) {
            this.homeContinueWatchingStatusToken = null;
            updateHomeLoadingStatus({ continueWatching: false });
          }
        });
      }

      const addons = refreshManifests
        ? await addonRepository.getInstalledAddons({
            includeMediaServers: true,
            staleWhileRevalidate: true,
            timeoutMs: HOME_ADDON_MANIFEST_TIMEOUT_MS
          })
        : await addonRepository.getInstalledAddons({ cacheOnly: true });
      this.collections = CollectionsStore.get();
      const catalogDescriptors = [];

      addons.forEach((addon) => {
        addon.catalogs
          .filter((catalog) => catalogShouldShowOnHome(catalog))
          .forEach((catalog) => {
            catalogDescriptors.push({
              addonBaseUrl: addon.baseUrl,
              addonId: addon.id,
              addonName: addon.displayName,
              catalogId: catalog.id,
              catalogName: catalog.name,
              type: catalog.apiType,
              supportsSkip: catalogSupportsExtra(catalog, "skip"),
              skipStep: catalogSkipStep(catalog)
            });
          });
      });

      // Installed-addon state can contain the same manifest catalog more than
      // once. Collapse only descriptors that would issue the exact same request;
      // addons that reuse ids on different base URLs must retain the existing
      // last-row-wins behavior.
      const seenCatalogDescriptors = new Set();
      const uniqueCatalogDescriptors = catalogDescriptors.filter((descriptor) => {
        const descriptorKey = JSON.stringify([
          descriptor?.addonBaseUrl || "",
          descriptor?.addonId || "",
          descriptor?.addonName || "",
          descriptor?.catalogId || "",
          descriptor?.catalogName || "",
          descriptor?.type || ""
        ]);
        if (seenCatalogDescriptors.has(descriptorKey)) {
          return false;
        }
        seenCatalogDescriptors.add(descriptorKey);
        return true;
      });
      if (HOME_PERF_DEBUG) {
        logHomePerf("catalogDescriptors", {
          requested: catalogDescriptors.length,
          unique: uniqueCatalogDescriptors.length,
          duplicates: catalogDescriptors.length - uniqueCatalogDescriptors.length
        });
      }

      // Seed missing order keys from manifest order before progressive requests
      // can add rows in network-completion order.
      const orderedCatalogKeys = HomeCatalogStore.ensureOrderKeys(
        uniqueCatalogDescriptors.map((catalog) => buildCatalogOrderKey(catalog.addonId, catalog.type, catalog.catalogId))
      );
      const displayDescriptors = orderHomeCatalogDescriptors(
        uniqueCatalogDescriptors.map((catalog) => ({
          ...catalog,
          homeCatalogKey: buildCatalogOrderKey(catalog.addonId, catalog.type, catalog.catalogId),
          homeCatalogDisableKey: buildCatalogDisableKey(catalog.addonBaseUrl, catalog.type, catalog.catalogId, catalog.catalogName)
        })),
        { orderedKeys: orderedCatalogKeys, disabledKeys: HomeCatalogStore.get().disabled || [] }
      );
      const routeInputSignature = this.buildHomeRouteInputSignature(addons);
      const homeCatalogSnapshotKey = buildHomeCatalogSnapshotKey({
        profileId: ProfileManager.getActiveProfileId(),
        addonDescriptors: uniqueCatalogDescriptors,
        homeCatalogPrefs: HomeCatalogStore.get()
      });
      this.homeCatalogSnapshotKey = homeCatalogSnapshotKey;

      // Home requests catalogs in display order as far as the user can reach.
      const initialCatalogLoad = this.getInitialCatalogLoadCount();
      const windowCount = homeCatalogLoadCount({
        total: displayDescriptors.length,
        initialCount: initialCatalogLoad,
        virtualRows: Boolean(this.usesVirtualHomeRows?.()),
        background,
        previousCount: this.homeCatalogWindowCount
      });
      const initialDescriptors = initialHomeCatalogDescriptors(displayDescriptors, {
        count: initialCatalogLoad,
        heroCatalogKeys: prefs.heroCatalogKeys || []
      });
      const initialKeys = new Set(initialDescriptors.map((catalog) => catalog.homeCatalogKey));
      const deferredDescriptors = displayDescriptors.slice(0, windowCount).filter((catalog) => !initialKeys.has(catalog.homeCatalogKey));
      this.homeCatalogDescriptors = displayDescriptors;
      this.homeCatalogWindowCount = windowCount;
      this.homeCatalogRequestedKeys = new Set([...initialKeys, ...deferredDescriptors.map((catalog) => catalog.homeCatalogKey)]);

      if (!background) {
        // Counted from the first request, not from when the first rows land.
        this.startHomeLoadingStatus(token, [...initialDescriptors, ...deferredDescriptors]);
      }
      const progressiveInitialRows = new Map();
      const initialRowsPromise = this.fetchCatalogRows(initialDescriptors, {
        allowLoading: true,
        onRow: (row) => {
          if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
            return;
          }
          this.noteHomeLoadingStatusRow(token, row);
          // Progressive first paint exists for a cold load with nothing on screen.
          // During a background refresh a full Home is already rendered, so
          // painting one-to-six rows over it is a regression, not progress.
          if (background) {
            return;
          }
          progressiveInitialRows.set(row.homeCatalogKey, row);
          // Merge with anything already on screen (a disk snapshot or a
          // previous row) instead of replacing it with the first network row.
          const combinedByKey = new Map((this.rows || []).map((entry) => [entry.homeCatalogKey, entry]));
          progressiveInitialRows.forEach((entry, key) => combinedByKey.set(key, entry));
          this.rows = this.sortAndFilterRows(Array.from(combinedByKey.values()), this.collections);
          this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
          if (!this.heroItem) {
            this.heroItem = this.pickInitialHero();
          }
          this.releaseInitialHomeLoading();
          this.hasLoadedOnce = true;
          this.requestBackgroundRender();
          this.maybeStartPendingHomeBackgroundRefresh();
        }
      });
      if (!background && !this.hasLoadedOnce && usesHomeCatalogSnapshot(this)) {
        // Read the last successful catalog in parallel with the network. If
        // the addons answer first, the progressive rows above already won and
        // this snapshot is ignored; if the disk answers first, Home paints
        // while the same network refresh continues.
        const cachedRows = await Promise.race([
          readSnapshotWithTimeout({ key: homeCatalogSnapshotKey }),
          initialRowsPromise.then(() => null).catch(() => null)
        ]);
        if (cachedRows?.length && token === this.homeLoadToken && Router.getCurrent() === "home" && !this.hasLoadedOnce) {
          this.loadedProfileId = String(ProfileManager.getActiveProfileId() || "");
          this.rows = this.sortAndFilterRows(cachedRows, this.collections);
          this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
          this.heroItem = this.pickInitialHero();
          this.releaseInitialHomeLoading();
          this.hasLoadedOnce = true;
          this.render();
        }
      }
      // Start the visible rows first. Overlap one deferred batch only on a
      // foreground load where the runtime can afford the extra requests.
      // Keep the actual promises: the repository caches completed results only,
      // so a second request while prefetch is pending would duplicate the work.
      const prefetchedResults = new Map();
      if (!background && !this.isPerformanceConstrained() && !this.isLegacyTvRuntime()) {
        const prefetchCount = Math.min(8, Math.max(0, this.getDeferredCatalogBatchSize()));
        deferredDescriptors.slice(0, prefetchCount).forEach((catalog) => {
          prefetchedResults.set(
            catalog,
            catalogRepository.getCatalog({
              addonBaseUrl: catalog.addonBaseUrl,
              addonId: catalog.addonId,
              addonName: catalog.addonName,
              catalogId: catalog.catalogId,
              catalogName: catalog.catalogName,
              type: catalog.type,
              skip: 0,
              skipStep: catalog.skipStep,
              supportsSkip: catalog.supportsSkip !== false
            })
          );
        });
        void Promise.allSettled(prefetchedResults.values());
      }
      const initialRows = await initialRowsPromise;
      if (token !== this.homeLoadToken) {
        return;
      }
      if (initialDescriptors.length) {
        // Match Android's catalog freshness window from the last page-one
        // request. A later no-op sync can refresh these rows in place without
        // rebuilding Continue Watching, the hero, or the Home shell.
        this.lastHomeCatalogRefreshAtMs = Date.now();
      }
      // A background refresh resolves only the initial catalog batch first, so
      // assigning it directly discards every already-rendered row outside that
      // batch. Merge the configured rows and let fresh data replace duplicates.
      const configuredCatalogKeys = new Set(
        uniqueCatalogDescriptors.map((catalog) => buildCatalogOrderKey(catalog.addonId, catalog.type, catalog.catalogId))
      );
      const nextInitialRows = mergeRefreshedHomeRows(this.rows, initialRows, configuredCatalogKeys, {
        background
      });
      this.rows = this.sortAndFilterRows(nextInitialRows, this.collections);
      persistHomeCatalogSnapshot(this, token);
      if (preserveContinueWatching) {
        this.continueWatchingLoading = false;
      } else if (
        !background &&
        this.layoutMode === "modern" &&
        this.layoutPrefs?.continueWatchingEnabled !== false &&
        this.continueWatchingHydratedFromSnapshot &&
        this.continueWatchingDisplay?.length
      ) {
        // CW already painted instantly from the snapshot — focus it on this render.
        // Fresh data reconciles fire-and-forget below.
        if (
          shouldApplyLateContinueWatchingFocus({
            background,
            hasUserInteracted: this.hasUserInteractedSinceHomePaint,
            suppressInitialFocus: this.suppressInitialContinueWatchingFocus,
            hasAppliedInitialFocus: this.hasAppliedInitialContinueWatchingFocus
          })
        ) {
          this.forceInitialContinueWatchingFocus = true;
        }
      }
      this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
      if (preserveHomeReturnState) {
        const currentHeroIdentity = buildHeroIdentity(this.heroItem);
        const shouldRestorePreservedHero =
          Boolean(preservedHeroItem) && (!preservedHeroIdentity || currentHeroIdentity === preservedHeroIdentity);
        if (shouldRestorePreservedHero) {
          this.heroItem = preservedHeroItem;
        } else if (!this.heroItem) {
          this.heroItem = this.pickInitialHero();
        }
        const heroIdentity = buildHeroIdentity(this.heroItem);
        const matchedHeroIndex = this.heroCandidates.findIndex((candidate) => buildHeroIdentity(candidate) === heroIdentity);
        if (matchedHeroIndex >= 0) {
          this.heroIndex = matchedHeroIndex;
        }
      } else if (!this.hasUserInteractedSinceHomePaint) {
        this.heroIndex = 0;
        this.heroItem = this.pickInitialHero();
      }
      this.loadedProfileId = String(ProfileManager.getActiveProfileId() || "");
      this.loadedWatchProgressSourceKey = watchProgressRepository.getContinueWatchingSourceKey();
      this.releaseInitialHomeLoading();
      this.hasLoadedOnce = true;
      this.loadedHomeRouteInputSignature = routeInputSignature;
      this.rememberHomeResumeInputs();
      this.render();
      this.maybeStartPendingHomeBackgroundRefresh();
      logHomePerf("loadData", {
        phase: "first-render",
        ms: Number((homePerfNow() - loadStart).toFixed(2)),
        background: Boolean(background),
        rows: Number(this.rows?.length || 0),
        continueWatching: Number(this.continueWatchingDisplay?.length || 0),
        nextUpCandidates: Number(this.nextUpProgressCandidates?.length || 0),
        layoutMode: this.layoutMode
      });
      const previousSidebarProfileSignature = buildSidebarProfileSignature(this.sidebarProfile);
      sidebarProfilePromise.then((profile) => {
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        if (profile && buildSidebarProfileSignature(profile) !== previousSidebarProfileSignature) {
          this.sidebarProfile = profile;
          this.requestBackgroundRender();
        }
      });

      initialRows.forEach((row) => this.noteHomeLoadingStatusRow(token, row));
      void this.loadHomeCatalogRange(deferredDescriptors, { token, prefetchedResults }).then(() => {
        persistHomeCatalogSnapshot(this, token, { force: true });
        this.finishHomeLoadingStatus(token);
      });
      this.ensureHomeCatalogWindowForNode(this.getCurrentFocusedNode());

      if (this.layoutMode !== "modern") {
        this.enrichHero(this.heroCandidates[0] || null)
          .then(() => {
            if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
              return;
            }
            this.applyHeroToDom();
          })
          .catch((error) => {
            console.warn("Hero async enrichment failed", error);
          });
      }

      this.retryPendingCatalogRows();
    },
    loadHomeCatalogRange(descriptors = [], { token = this.homeLoadToken, prefetchedResults = null } = {}) {
      if (!descriptors.length) {
        return Promise.resolve([]);
      }
      // Publish completed rows in batches; requestBackgroundRender keeps the
      // legacy-TV render delay and navigation deferral in effect.
      const rangeRows = createHomeRowBatcher({
        delayMs: this.getDeferredRowBatchDelay(),
        onFlush: (rows) => {
          if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
            return;
          }
          const heroBefore = this.captureHomeHeroState();
          const combinedByKey = new Map((this.rows || []).map((entry) => [entry.homeCatalogKey, entry]));
          rows.forEach((row) => combinedByKey.set(row.homeCatalogKey, row));
          this.rows = this.sortAndFilterRows(Array.from(combinedByKey.values()), this.collections);
          this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
          if (!this.heroItem) {
            this.heroItem = this.pickInitialHero();
          }
          void this.refreshWatchedTitleState({ token });
          this.publishLoadedHomeRows(heroBefore);
        }
      });
      // Request the whole range at once: responses reach the page only between
      // main-thread tasks, so a cap on requests in flight lets each Home render
      // delay the next catalogs.
      return this.fetchCatalogRows(descriptors, {
        allowLoading: true,
        prefetchedResults,
        shouldContinue: () => token === this.homeLoadToken,
        onRow: (row) => {
          if (token === this.homeLoadToken && Router.getCurrent() === "home") {
            this.noteHomeLoadingStatusRow(token, row);
            rangeRows.add(row);
          }
        }
      })
        .then((extraRows) => {
          rangeRows.cancel();
          if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
            return [];
          }
          const heroBefore = this.captureHomeHeroState();
          const combinedByKey = new Map();
          [...this.rows, ...extraRows].forEach((row) => {
            combinedByKey.set(row.homeCatalogKey, row);
          });
          this.rows = this.sortAndFilterRows(Array.from(combinedByKey.values()), this.collections);
          this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
          if (!this.heroItem) {
            this.heroItem = this.pickInitialHero();
          }
          void this.refreshWatchedTitleState({ token });
          persistHomeCatalogSnapshot(this, token);
          this.publishLoadedHomeRows(heroBefore);
          this.retryPendingCatalogRows();
          return extraRows;
        })
        .catch((error) => {
          console.warn("Deferred home rows load failed", error);
          return [];
        });
    },
    // Tells the viewer when a cold load has every catalog in, so they know when
    // Home stops changing under them.
    startHomeLoadingStatus(token, descriptors, loadedRows = []) {
      const keys = new Set(descriptors.map((catalog) => catalog.homeCatalogKey));
      const loaded = new Set(loadedRows.map((row) => row?.homeCatalogKey).filter((key) => keys.has(key)));
      if (loaded.size >= keys.size) {
        this.homeLoadingStatus = null;
        updateHomeLoadingStatus({ catalogs: null });
        return;
      }
      this.homeLoadingStatus = { token, keys, loaded };
      updateHomeLoadingStatus({ catalogs: { loaded: loaded.size, total: keys.size } });
    },
    noteHomeLoadingStatusRow(token, row) {
      const status = this.homeLoadingStatus;
      if (!status || status.token !== token || !status.keys.has(row?.homeCatalogKey)) {
        return;
      }
      status.loaded.add(row.homeCatalogKey);
      updateHomeLoadingStatus({ catalogs: { loaded: status.loaded.size, total: status.keys.size } });
    },
    // Without a token: Home is being left, and nothing it loads is shown.
    finishHomeLoadingStatus(token = null) {
      if (token !== null && this.homeLoadingStatus?.token !== token) {
        return;
      }
      this.homeLoadingStatus = null;
      if (token === null) {
        this.homeContinueWatchingStatusToken = null;
        updateHomeLoadingStatus({ catalogs: null, continueWatching: false });
        return;
      }
      updateHomeLoadingStatus({ catalogs: null });
    },
    captureHomeHeroState() {
      return {
        item: this.heroItem,
        candidates: (this.heroCandidates || []).map((item) => String(item?.id || "")).join("\n")
      };
    },
    // The hero and its indicators come from the full render; rows that only
    // add to virtual Home mount without one.
    publishLoadedHomeRows(heroBefore) {
      const heroAfter = this.captureHomeHeroState();
      const heroUnchanged = heroBefore.item === heroAfter.item && heroBefore.candidates === heroAfter.candidates;
      if (!heroUnchanged || !this.mountLoadedVirtualHomeRows?.()) {
        this.requestBackgroundRender();
      }
    },
    extendHomeCatalogWindow(targetCount) {
      const descriptors = Array.isArray(this.homeCatalogDescriptors) ? this.homeCatalogDescriptors : [];
      const target = Math.min(descriptors.length, Math.max(0, Math.trunc(Number(targetCount) || 0)));
      if (target <= Number(this.homeCatalogWindowCount || 0)) {
        return false;
      }
      this.homeCatalogWindowCount = target;
      const requested = this.homeCatalogRequestedKeys || new Set();
      const next = descriptors.slice(0, target).filter((catalog) => !requested.has(catalog.homeCatalogKey));
      next.forEach((catalog) => requested.add(catalog.homeCatalogKey));
      this.homeCatalogRequestedKeys = requested;
      void this.loadHomeCatalogRange(next, { token: this.homeLoadToken });
      return next.length > 0;
    },
    ensureHomeCatalogWindowForNode(node) {
      if (!Array.isArray(this.homeCatalogDescriptors) || !node || !this.isMainNode(node)) {
        return false;
      }
      return this.extendHomeCatalogWindow(homeCatalogWindowTarget(this.rows || [], this.getNodeRowKey(node), HOME_CATALOG_PRELOAD_ROWS));
    },
    ensureHomeCatalogWindowForViewport(viewport) {
      if (!Array.isArray(this.homeCatalogDescriptors) || !viewport) {
        return false;
      }
      // Pointer scrolling reaches rows without moving focus.
      const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (remaining > viewport.clientHeight) {
        return false;
      }
      return this.extendHomeCatalogWindow(Number(this.homeCatalogWindowCount || 0) + HOME_CATALOG_PRELOAD_ROWS);
    }
  };
}
