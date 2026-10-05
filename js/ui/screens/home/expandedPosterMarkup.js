// Expanded artwork belongs to the focused card. Creating it on demand avoids
// allocating multiple hidden images and layers for every catalog preview.
const artworkByCard = new WeakMap();

export function ensureExpandedPosterMarkup(card) {
  const frame = card?.querySelector(".home-poster-frame");
  if (!frame) return;
  const data = card.dataset;
  const backdropSrc = data.backdropSrc || data.posterSrc || "";
  const logoSrc = data.logoSrc || "";
  const title = data.itemTitle || "Untitled";
  const key = JSON.stringify([backdropSrc, logoSrc, title]);
  const previous = artworkByCard.get(card);
  if (previous?.key === key) return;
  if (!previous && frame.querySelector(".home-poster-expanded-backdrop")) return;
  previous?.nodes.forEach((node) => node.remove());
  card.classList.remove("is-expanded-backdrop-ready");
  const doc = card.ownerDocument;
  const element = (tag, className) => {
    const node = doc.createElement(tag);
    node.className = className;
    return node;
  };
  const backdrop = element(backdropSrc ? "img" : "div", "home-poster-expanded-backdrop");
  backdrop.setAttribute("aria-hidden", "true");
  if (backdropSrc) {
    backdrop.dataset.src = backdropSrc;
    backdrop.decoding = "async";
    backdrop.loading = "lazy";
    backdrop.alt = "";
  } else backdrop.classList.add("placeholder");
  const trailer = element("div", "home-poster-trailer-layer");
  const gradient = element("div", "home-poster-expanded-gradient");
  const brand = element("div", "home-poster-expanded-brand");
  const branding = element(
    logoSrc ? "img" : "div",
    logoSrc ? "home-poster-expanded-logo" : "home-poster-expanded-title"
  );
  if (logoSrc) {
    branding.dataset.src = logoSrc;
    branding.decoding = "async";
    branding.loading = "lazy";
    branding.alt = title;
  } else {
    branding.dir = "auto";
    branding.textContent = title;
  }
  brand.appendChild(branding);
  const nodes = [backdrop, trailer, gradient, brand];
  nodes.forEach((node) => frame.appendChild(node));
  artworkByCard.set(card, { key, nodes });
}
