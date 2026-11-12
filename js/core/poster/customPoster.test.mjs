import { test } from "node:test";
import assert from "node:assert/strict";

import { customPosterForItem, posterFallbackAttributes } from "./customPoster.js";

const SETTINGS = { customPosterUrlPattern: "", customPosterEnabledScreens: [] };

test("every screen gets the same bounded TMDB artwork as Home", () => {
  const item = customPosterForItem(
    {
      id: "tt1",
      poster: "https://image.tmdb.org/t/p/original/poster.jpg",
      backdrop: "https://image.tmdb.org/t/p/original/backdrop.jpg",
      landscapePoster: "https://image.tmdb.org/t/p/w780/landscape.jpg"
    },
    "library",
    "poster",
    SETTINGS
  );
  assert.equal(item.poster, "https://image.tmdb.org/t/p/w500/poster.jpg");
  assert.equal(item.backdrop, "https://image.tmdb.org/t/p/w1280/backdrop.jpg");
  assert.equal(item.landscapePoster, "https://image.tmdb.org/t/p/w1280/landscape.jpg");
});

test("non-TMDB and custom poster URLs are left byte-for-byte unchanged", () => {
  const item = customPosterForItem(
    {
      id: "tt1",
      poster: "https://addon.example/art/poster.webp?token=abc",
      background: "https://addon.example/art/backdrop.jpg"
    },
    "search",
    "poster",
    SETTINGS
  );
  assert.equal(item.poster, "https://addon.example/art/poster.webp?token=abc");
  assert.equal(item.background, "https://addon.example/art/backdrop.jpg");
});

test("the custom-poster fallback keeps the bounded TMDB size too", () => {
  const attributes = posterFallbackAttributes({
    rawPosterUrl: "https://image.tmdb.org/t/p/original/fallback.jpg"
  });
  assert.equal(attributes, ' data-original-poster="https://image.tmdb.org/t/p/w500/fallback.jpg"');
});

test("a TV asks a resizing poster service for card-sized artwork, nobody else does", async () => {
  const { Platform } = await import("../../platform/index.js");
  const settings = {
    customPosterUrlPattern:
      "https://easyposters.realbestia.com/key/poster/{imdb_id}.jpg?type={type}&shape={shape}",
    customPosterEnabledScreens: ["home"]
  };
  const poster = (pattern = settings.customPosterUrlPattern) =>
    customPosterForItem(
      { id: "tt1", type: "movie", poster: "https://addon.example/p.jpg" },
      "home",
      "poster",
      { ...settings, customPosterUrlPattern: pattern }
    ).poster;
  const plain = "https://easyposters.realbestia.com/key/poster/tt1.jpg?type=movie&shape=poster";
  assert.equal(poster(), plain, "a browser keeps the service's own size");

  const previous = globalThis.__NUVIO_PLATFORM__;
  globalThis.__NUVIO_PLATFORM__ = "tizen";
  Platform.current = null;
  try {
    assert.match(poster(), /^https:\/\/easyposters\.realbestia\.com\/.*&w=(342|500)$/);
    assert.equal(poster(`${settings.customPosterUrlPattern}&w=800`), `${plain}&w=800`);
    assert.match(
      customPosterForItem({ id: "tt1", poster: plain }, "home", "poster", SETTINGS).poster,
      /&w=(342|500)$/,
      "a poster the addon itself took from the service is sized too"
    );
    assert.equal(
      poster("https://other.example/{imdb_id}.jpg"),
      "https://other.example/tt1.jpg",
      "a service without a width parameter is left alone"
    );
  } finally {
    if (previous === undefined) delete globalThis.__NUVIO_PLATFORM__;
    else globalThis.__NUVIO_PLATFORM__ = previous;
    Platform.current = null;
  }
});

test("a constrained TV takes card-sized TMDB and TheTVDB posters, falling back to the addon's", async (t) => {
  const { Platform } = await import("../../platform/index.js");
  const { resetTvRuntimePerformanceProfile } =
    await import("../../platform/tvRuntimePerformance.js");
  const { resetPreferredTmdbCardPosterSizeForTests } = await import("../tmdb/tmdbImageUrl.js");
  const previous = globalThis.__NUVIO_PLATFORM__;
  const previousCanvas = globalThis.OffscreenCanvas;
  const reset = () => {
    Platform.current = null;
    resetTvRuntimePerformanceProfile();
    resetPreferredTmdbCardPosterSizeForTests();
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.__NUVIO_PLATFORM__;
    else globalThis.__NUVIO_PLATFORM__ = previous;
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
    reset();
  });
  // OffscreenCanvas alone does not shrink anything: the rescaler is off on
  // constrained TVs, so the posters themselves have to be small.
  globalThis.__NUVIO_PLATFORM__ = "webos";
  globalThis.OffscreenCanvas = class {};
  reset();
  const card = (poster) => customPosterForItem({ id: "tt1", poster }, "home", "poster", SETTINGS);

  assert.equal(
    card("https://image.tmdb.org/t/p/w600_and_h900_bestv2/a.jpg").poster,
    "https://image.tmdb.org/t/p/w342/a.jpg"
  );
  assert.equal(
    card("https://image.tmdb.org/t/p/w500/a.jpg").poster,
    "https://image.tmdb.org/t/p/w342/a.jpg"
  );

  const tvdb = "https://artworks.thetvdb.com/banners/v4/series/81189/posters/5f5b.jpg";
  const thumbnail = card(tvdb);
  assert.equal(
    thumbnail.poster,
    "https://artworks.thetvdb.com/banners/v4/series/81189/posters/5f5b_t.jpg"
  );
  assert.equal(thumbnail.rawPosterUrl, tvdb, "the full-size poster is the fallback");
  assert.equal(card(thumbnail.poster).poster, thumbnail.poster, "a thumbnail is not shrunk twice");
  assert.equal(
    card("https://artworks.thetvdb.com/banners/series/81189/posters/62e1.png").poster,
    "https://artworks.thetvdb.com/banners/series/81189/posters/62e1_t.png"
  );

  const legacy = card("https://artworks.thetvdb.com/banners/posters/81189-1.jpg");
  assert.equal(legacy.poster, "https://artworks.thetvdb.com/banners/posters/81189-1.jpg");
  assert.equal(legacy.rawPosterUrl, undefined);

  delete globalThis.__NUVIO_PLATFORM__;
  reset();
  assert.equal(card(tvdb).poster, tvdb, "a browser keeps the full-size poster");
});
