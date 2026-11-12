import { HOME_BOOT_LOADING_STATUS_ID as ELEMENT_ID } from "./homeBootSnapshotPaint.js";

// Tells the viewer that Home is still loading and may change under them. The
// launch snapshot paints the same element before the app bundle runs; the app
// adopts it and keeps it up until every phase below has finished.
const phases = {
  catalogs: null,
  continueWatching: false
};

let element = null;
let textNode = null;
let pendingText = null;
let renderedText = null;
let frame = null;

function formatCatalogs({ loaded, total }) {
  const count =
    Number(total) > 0 ? ` ${Math.min(Math.max(Number(loaded) || 0, 0), total)}/${total}` : "";
  return `Loading catalogs${count}`;
}

export function homeLoadingStatusText(state = phases) {
  if (state.catalogs) return formatCatalogs(state.catalogs);
  if (state.continueWatching) return "Loading Continue Watching";
  return null;
}

function flush() {
  frame = null;
  if (!textNode || pendingText === null || pendingText === renderedText) {
    return;
  }
  // Single text node update; the element is contained so Home is not relaid out.
  textNode.textContent = pendingText;
  renderedText = pendingText;
}

function attach() {
  const doc = globalThis.document;
  element = doc.getElementById(ELEMENT_ID);
  textNode = element?.querySelector(".home-loading-status-text") || null;
  if (element && textNode) {
    element.setAttribute("data-adopted", "1");
    renderedText = textNode.textContent;
    return;
  }
  element?.parentNode?.removeChild(element);
  element = doc.createElement("div");
  element.id = ELEMENT_ID;
  element.className = "home-loading-status";
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "off");
  const spinner = doc.createElement("span");
  spinner.className = "home-loading-status-spinner";
  spinner.setAttribute("aria-hidden", "true");
  textNode = doc.createElement("span");
  textNode.className = "home-loading-status-text";
  textNode.textContent = pendingText;
  renderedText = pendingText;
  element.appendChild(spinner);
  element.appendChild(textNode);
  doc.body.appendChild(element);
}

function detach() {
  if (frame !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frame);
  }
  frame = null;
  pendingText = null;
  renderedText = null;
  // The snapshot's copy may be up although this module never attached to it.
  const node = element || globalThis.document?.getElementById(ELEMENT_ID);
  node?.parentNode?.removeChild(node);
  element = null;
  textNode = null;
}

/**
 * Updates the loading phases: `continueWatching` is a boolean, `catalogs` is
 * `{ loaded, total }` while catalogs load and null once done.
 */
export function updateHomeLoadingStatus(patch = {}) {
  Object.keys(patch).forEach((key) => {
    if (key in phases) phases[key] = patch[key];
  });
  const text = homeLoadingStatusText();
  if (text === null) {
    detach();
    return;
  }
  pendingText = text;
  if (!element || !element.isConnected) {
    attach();
  }
  if (pendingText !== renderedText && frame === null) {
    frame = requestAnimationFrame(flush);
  }
}

/** Drops every phase, for a launch that leaves Home. */
export function resetHomeLoadingStatus() {
  phases.catalogs = null;
  phases.continueWatching = false;
  detach();
}
