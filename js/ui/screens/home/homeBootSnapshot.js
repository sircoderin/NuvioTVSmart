import {
  HOME_BOOT_SNAPSHOT_ELEMENT_ID,
  HOME_BOOT_SNAPSHOT_FORMAT,
  HOME_BOOT_SNAPSHOT_STORAGE_KEY
} from "./homeBootSnapshotPaint.js";

// The snapshot covers the first screen of Home: the hero, Continue Watching
// and the first catalog rows, with each row cut to what fits on screen.
const SNAPSHOT_ROWS = 2;
const SNAPSHOT_CARDS_PER_ROW = 8;
const SNAPSHOT_MAX_LENGTH = 400000;
// Home aligns its first row a few pixels below the top; the copy is painted unscrolled.
const SNAPSHOT_MAX_SCROLL_TOP = 120;
// Saving waits until Home has stopped rendering for this long, and retries
// while Home is scrolled away from the top or covered by a dialog.
const CAPTURE_DELAY_MS = 5000;
const CAPTURE_RETRY_MS = 4000;
const CAPTURE_MAX_RETRIES = 15;
// The snapshot stays up until the live Home shows its first poster, at most this long.
const RELEASE_IMAGE_WAIT_MS = 1500;
const RUNTIME_CLASSES = [
  "focused",
  "is-expanded",
  "is-trailer-active",
  "is-expanded-backdrop-ready"
];
const REMOVED_SELECTOR = [
  "video",
  "audio",
  "iframe",
  "canvas",
  "script",
  "[data-virtual-edge]",
  ".home-poster-expanded-backdrop",
  ".home-poster-expanded-gradient",
  ".home-poster-expanded-brand"
].join(",");

let directHomeEntry = false;
let captureTimer = 0;
let lastSavedHtml = "";
let releasing = false;

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function snapshotElement() {
  return globalThis.document?.getElementById?.(HOME_BOOT_SNAPSHOT_ELEMENT_ID) || null;
}

/**
 * Records whether this launch opened Home without a profile picker or sign-in.
 * Only such launches save a snapshot, and a launch that showed a picker drops
 * the saved one, because the next launch would likely show the picker again.
 */
export function setHomeBootSnapshotEntry(direct) {
  directHomeEntry = Boolean(direct);
  if (!directHomeEntry) {
    clearHomeBootSnapshot();
  }
}

export function clearHomeBootSnapshot() {
  lastSavedHtml = "";
  try {
    storage()?.removeItem(HOME_BOOT_SNAPSHOT_STORAGE_KEY);
  } catch {}
}

export function isHomeBootSnapshotVisible() {
  return Boolean(snapshotElement());
}

export function releaseHomeBootSnapshot() {
  const node = snapshotElement();
  releasing = false;
  node?.parentNode?.removeChild(node);
}

function firstVisiblePoster(container) {
  const height = globalThis.innerHeight || 1080;
  for (const image of container.querySelectorAll(
    ".home-content-card img, .home-continue-card img"
  )) {
    const rect = image.getBoundingClientRect();
    if (rect.width > 0 && rect.bottom > 0 && rect.top < height) return image;
  }
  return null;
}

/** Removes the snapshot once the live Home underneath has painted a poster. */
export function releaseHomeBootSnapshotWhenPainted(container) {
  if (releasing || !snapshotElement()) return;
  releasing = true;
  const reveal = () => {
    if (!releasing) return;
    const frame = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 16));
    frame(() => frame(releaseHomeBootSnapshot));
  };
  const image = container ? firstVisiblePoster(container) : null;
  if (!image || (image.complete && image.naturalWidth > 0)) {
    reveal();
    return;
  }
  const timer = setTimeout(reveal, RELEASE_IMAGE_WAIT_MS);
  const done = () => {
    clearTimeout(timer);
    reveal();
  };
  image.addEventListener("load", done, { once: true });
  image.addEventListener("error", done, { once: true });
}

function removeAll(root, selector) {
  for (const node of Array.from(root.querySelectorAll(selector))) {
    node.parentNode?.removeChild(node);
  }
}

/**
 * Copies the visible part of Home as static markup: no ids (the copy must not
 * shadow live elements), no runtime focus/expansion state and no media.
 */
export function buildHomeBootSnapshotMarkup(
  container,
  { rows = SNAPSHOT_ROWS, cardsPerRow = SNAPSHOT_CARDS_PER_ROW } = {}
) {
  const copy = container.cloneNode(true);
  removeAll(copy, REMOVED_SELECTOR);
  Array.from(copy.querySelectorAll(".home-modern-row, .home-catalogs .home-row"))
    .slice(rows)
    .forEach((row) => row.parentNode?.removeChild(row));
  for (const track of copy.querySelectorAll(".home-track")) {
    Array.from(track.children)
      .slice(cardsPerRow)
      .forEach((card) => track.removeChild(card));
  }
  // Rescaled artwork lives at blob: URLs that end with this page.
  for (const image of copy.querySelectorAll('img[src^="blob:"]')) {
    const original =
      image.getAttribute("data-original-src") || image.getAttribute("data-original-poster");
    if (original) image.setAttribute("src", original);
    else image.removeAttribute("src");
  }
  for (const image of copy.querySelectorAll("img")) image.setAttribute("decoding", "async");
  for (const node of copy.querySelectorAll("[id]")) node.removeAttribute("id");
  for (const name of RUNTIME_CLASSES) {
    for (const node of Array.from(copy.getElementsByClassName(name))) node.classList.remove(name);
  }
  return copy.innerHTML;
}

function activeProfileId() {
  try {
    return JSON.parse(storage()?.getItem("activeProfileId") || "null");
  } catch {
    return null;
  }
}

/** @returns {"saved" | "unchanged" | "retry" | "skip"} */
function captureHomeBootSnapshot(screen, router) {
  const container = screen?.container;
  const buildId = globalThis.__NUVIO_BUILD_ID__;
  const doc = globalThis.document;
  const profileId = activeProfileId();
  if (
    !directHomeEntry ||
    !buildId ||
    !container ||
    profileId === null ||
    router?.getCurrent?.() !== "home" ||
    container.style.display !== "block" ||
    container.classList.contains("home-dom-preserved") ||
    screen.isInitialHomeLoading ||
    !container.querySelector(".home-content-card, .home-continue-card")
  ) {
    return "skip";
  }
  if (
    doc?.visibilityState === "hidden" ||
    doc?.body?.classList.contains("nuvio-modal-open") ||
    Number(screen.getHomeViewport?.()?.scrollTop || 0) > SNAPSHOT_MAX_SCROLL_TOP
  ) {
    return "retry";
  }
  const html = buildHomeBootSnapshotMarkup(container);
  if (!html || html.length > SNAPSHOT_MAX_LENGTH) return "skip";
  if (html === lastSavedHtml) return "unchanged";
  const root = doc.documentElement;
  const rootClass = Array.from(new Set([...root.classList, ...doc.body.classList])).join(" ");
  const homeClass = Array.from(container.classList)
    .filter((name) => name !== "home-dom-preserved")
    .join(" ");
  try {
    storage()?.setItem(
      HOME_BOOT_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        format: HOME_BOOT_SNAPSHOT_FORMAT,
        buildId,
        profileId: String(profileId),
        savedAt: Date.now(),
        rootClass,
        rootStyle: root.getAttribute("style") || "",
        homeClass,
        html
      })
    );
    lastSavedHtml = html;
    return "saved";
  } catch {
    return "skip";
  }
}

function scheduleCapture(screen, router, delay, retriesLeft) {
  clearTimeout(captureTimer);
  captureTimer = setTimeout(() => {
    const idle = globalThis.requestIdleCallback;
    const run = () => {
      const result = captureHomeBootSnapshot(screen, router);
      if (result === "retry" && retriesLeft > 0) {
        scheduleCapture(screen, router, CAPTURE_RETRY_MS, retriesLeft - 1);
      }
    };
    if (typeof idle === "function") idle(run, { timeout: 2000 });
    else run();
  }, delay);
}

/**
 * Called after every Home render: reveals the live Home once it has content,
 * and saves a fresh snapshot after renders settle.
 */
export function syncHomeBootSnapshot(screen, router) {
  const container = screen?.container;
  if (
    container &&
    !screen.isInitialHomeLoading &&
    snapshotElement() &&
    container.querySelector(".home-content-card, .home-continue-card")
  ) {
    releaseHomeBootSnapshotWhenPainted(container);
  }
  if (!directHomeEntry || !globalThis.__NUVIO_BUILD_ID__) return;
  scheduleCapture(screen, router, CAPTURE_DELAY_MS, CAPTURE_MAX_RETRIES);
}

export const homeBootSnapshotInternals = { captureHomeBootSnapshot };
