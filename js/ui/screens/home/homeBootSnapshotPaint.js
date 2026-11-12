// Shared by the app (which saves the snapshot) and the packaged index.html
// (which paints it before the app bundle loads).
export const HOME_BOOT_SNAPSHOT_STORAGE_KEY = "homeBootSnapshot";
export const HOME_BOOT_SNAPSHOT_ELEMENT_ID = "nuvio-boot-snapshot";
export const HOME_BOOT_SNAPSHOT_FORMAT = 1;
export const HOME_BOOT_SNAPSHOT_TIMEOUT_MS = 30000;
const WEBOS_RESUME_ROUTE_KEY = "webos_last_resume_route";
const WEBOS_RESUME_ROUTE_TTL_MS = 20 * 60 * 1000;

// Shared with homeLoadingStatus.js, which adopts the pill painted here.
export const HOME_BOOT_LOADING_STATUS_ID = "homeLoadingStatus";
export const HOME_BOOT_LOADING_STATUS_TEXT = "Starting up";

export function homeBootSnapshotPaintConfig(buildId) {
  return {
    loadingStatusId: HOME_BOOT_LOADING_STATUS_ID,
    loadingStatusText: HOME_BOOT_LOADING_STATUS_TEXT,
    buildId: String(buildId || ""),
    storageKey: HOME_BOOT_SNAPSHOT_STORAGE_KEY,
    elementId: HOME_BOOT_SNAPSHOT_ELEMENT_ID,
    format: HOME_BOOT_SNAPSHOT_FORMAT,
    timeoutMs: HOME_BOOT_SNAPSHOT_TIMEOUT_MS,
    resumeRouteKey: WEBOS_RESUME_ROUTE_KEY,
    resumeRouteTtlMs: WEBOS_RESUME_ROUTE_TTL_MS
  };
}

/**
 * Paints the last saved Home, read-only, over the page while the app bundle
 * loads. It is serialized into index.html, so it must stay self-contained ES5
 * and must not reference anything outside its parameters. Skips the paint when
 * this launch will not open on Home: another profile, a restored screen, a
 * deep link, or a snapshot from a different build.
 *
 * @returns {boolean} whether the snapshot was painted
 */
export function paintHomeBootSnapshot(win, config) {
  var doc = win.document;
  var storage;
  var snapshot;
  var profileId;
  var resume;
  var launch;
  var system;
  var root;
  var home;
  var status = null;
  var spinner;
  var label;
  try {
    storage = win.localStorage;
    snapshot = JSON.parse(storage.getItem(config.storageKey) || "null");
    if (
      !snapshot ||
      snapshot.format !== config.format ||
      !config.buildId ||
      snapshot.buildId !== config.buildId ||
      !snapshot.html
    ) {
      return false;
    }
    profileId = JSON.parse(storage.getItem("activeProfileId") || "null");
    if (profileId === null || String(profileId) !== String(snapshot.profileId)) {
      return false;
    }
    resume = JSON.parse(storage.getItem(config.resumeRouteKey) || "null");
    if (
      resume &&
      resume.route &&
      resume.route !== "home" &&
      Date.now() - Number(resume.savedAt || 0) <= config.resumeRouteTtlMs
    ) {
      return false;
    }
    system = win.webOSSystem || win.PalmSystem;
    launch = system && system.launchParams;
    if (typeof launch === "string") {
      launch = launch ? JSON.parse(launch) : null;
    }
    if (launch && launch.contentTarget) {
      return false;
    }

    root = doc.createElement("div");
    root.id = config.elementId;
    root.className = String(snapshot.rootClass || "");
    root.setAttribute("aria-hidden", "true");
    root.setAttribute(
      "style",
      String(snapshot.rootStyle || "") +
        ";position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483000;" +
        "overflow:hidden;pointer-events:none;background:var(--bg-color);contain:strict;"
    );
    home = doc.createElement("div");
    home.className = String(snapshot.homeClass || "screen");
    home.style.display = "block";
    home.innerHTML = snapshot.html;
    root.appendChild(home);
    doc.body.appendChild(root);
    // The picture looks ready before the app takes keys; say it is not.
    if (config.loadingStatusId) {
      status = doc.createElement("div");
      status.id = config.loadingStatusId;
      status.className = "home-loading-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "off");
      spinner = doc.createElement("span");
      spinner.className = "home-loading-status-spinner";
      spinner.setAttribute("aria-hidden", "true");
      label = doc.createElement("span");
      label.className = "home-loading-status-text";
      label.textContent = String(config.loadingStatusText || "");
      status.appendChild(spinner);
      status.appendChild(label);
      doc.body.appendChild(status);
    }
    win.__NUVIO_BOOT_SNAPSHOT__ = { shownAt: Date.now() };
    win.setTimeout(function removeStaleBootSnapshot() {
      if (root.parentNode) {
        root.parentNode.removeChild(root);
      }
      // The app adopts the pill; one it never took over must not stay up.
      if (status && status.parentNode && !status.getAttribute("data-adopted")) {
        status.parentNode.removeChild(status);
      }
    }, config.timeoutMs);
    return true;
  } catch (_error) {
    return false;
  }
}
