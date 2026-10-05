import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureExpandedPosterMarkup } from "./expandedPosterMarkup.js";

function fixture() {
  function element(tag) {
    return {
      tagName: tag.toUpperCase(),
      dataset: {},
      children: [],
      classList: { add() {}, remove() {} },
      setAttribute() {},
      appendChild(node) {
        this.children.push(node);
        node.parent = this;
      },
      remove() {
        this.parent.children = this.parent.children.filter((child) => child !== this);
      },
      querySelector(selector) {
        return this.children.find((child) => `.${child.className}` === selector) || null;
      }
    };
  }
  const frame = element("div");
  const card = {
    dataset: { posterSrc: "poster.jpg", logoSrc: "logo.png", itemTitle: "Title" },
    ownerDocument: { createElement: element },
    classList: { remove() {} },
    querySelector: () => frame
  };
  return { card, frame };
}

test("expanded artwork is allocated once per focused card and refreshed when metadata changes", () => {
  const { card, frame } = fixture();
  assert.equal(frame.children.length, 0);
  ensureExpandedPosterMarkup(card);
  assert.equal(frame.children.length, 4);
  const backdrop = frame.children[0];
  assert.equal(backdrop.dataset.src, "poster.jpg");
  assert.equal(frame.children[3].children[0].dataset.src, "logo.png");
  ensureExpandedPosterMarkup(card);
  assert.equal(frame.children[0], backdrop);
  card.dataset.backdropSrc = "new-backdrop.jpg";
  card.dataset.logoSrc = "";
  card.dataset.itemTitle = "<Title & Friends>";
  ensureExpandedPosterMarkup(card);
  assert.equal(frame.children.length, 4);
  assert.equal(frame.children[0].dataset.src, "new-backdrop.jpg");
  assert.equal(frame.children[3].children[0].textContent, "<Title & Friends>");
});

test("cards whose artwork was generated eagerly retain their existing layers", () => {
  const { card, frame } = fixture();
  const existing = card.ownerDocument.createElement("img");
  existing.className = "home-poster-expanded-backdrop";
  frame.appendChild(existing);
  ensureExpandedPosterMarkup(card);
  assert.equal(frame.children.length, 1);
  assert.equal(frame.children[0], existing);
});
