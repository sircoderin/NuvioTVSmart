const ELEMENT_ID = "homeLoadingStatus";

let element = null;
let pendingText = null;
let renderedText = null;
let frame = null;

function formatText({ loaded, total }) {
  const count =
    Number(total) > 0 ? ` ${Math.min(Math.max(Number(loaded) || 0, 0), total)}/${total}` : "";
  return `Loading catalogs${count}`;
}

function flush() {
  frame = null;
  if (!element || pendingText === null || pendingText === renderedText) {
    return;
  }
  // Single text node update; the element is contained so Home is not relaid out.
  element.textContent = pendingText;
  renderedText = pendingText;
}

function schedule() {
  if (frame === null) {
    frame = requestAnimationFrame(flush);
  }
}

export function showHomeLoadingStatus(progress = {}) {
  pendingText = formatText(progress);
  if (!element) {
    element = document.createElement("div");
    element.id = ELEMENT_ID;
    element.className = "home-loading-status";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "off");
    element.textContent = pendingText;
    renderedText = pendingText;
    document.body.appendChild(element);
    return;
  }
  if (pendingText !== renderedText) {
    schedule();
  }
}

export function hideHomeLoadingStatus() {
  if (frame !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frame);
  }
  frame = null;
  pendingText = null;
  renderedText = null;
  if (element) {
    element.parentNode?.removeChild(element);
    element = null;
  }
}
