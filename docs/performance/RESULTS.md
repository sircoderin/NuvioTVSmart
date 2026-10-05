# Nuvio TV optimization verification

Verified on the user's LG 43UQ70003LB, webOS 7.6.0, actual browser Chromium 87. Final package installed: `space.nuvio.webos_1.2.2_all.ipk`. Existing service configuration preserved and checked for equality; credentials omitted.

## Changes

- Separate rendering capacity from browser API support: webOS 2022/2023 uses constrained rendering, without enabling legacy API fallbacks.
- Disable costly motion, retain explicit visible states for animation-dependent menus/loading/parental warnings, and avoid the hero image's forced layout.
- Allocate expanded poster images/layers when focused. Existing constrained catalog previews limit each row to ten items.
- Keep player buttons mounted during state changes; remove redundant pause renders.
- Prepare immutable badge rule snapshots, bound compiled-rule and stream-match caches, and accelerate a narrowly recognized class of positive whole-line lookahead rules. Preserve other regex behavior, including multiline/capturing expressions.
- Stop matching/preloading badges for every incoming stream. Visible cards request their artwork.
- Use virtual lists above 20 streams on constrained TVs, with a smaller nearby window; prepare badge settings once per window.
- Retain the selected stream's identity during source insertion/reordering and preserve filter focus while later sources arrive.
- Cancel picker work when a source is selected, protecting the playback handoff from late result renders. Retain resume lookup behavior and stale-navigation protection.

## TV results

These are short controlled samples, not broad benchmarks or a guarantee of Stremio parity.

| Measurement                           | Original                     | Optimized           |
| ------------------------------------- | ---------------------------- | ------------------- |
| Subtitle menu open, key to next frame | 3,627–4,926 ms               | 376–497 ms          |
| Subtitle next row                     | 191–436 ms                   | 9–60 ms             |
| Home navigation p95 key to next frame | 108–129 ms                   | 40 ms               |
| Home frame-time p95                   | 167–467 ms in slower samples | 17 ms               |
| Search open, key to next frame        | 856 ms                       | 475 ms              |
| Character insertion CDP roundtrip     | first 222 ms, then 11–16 ms  | 9–24 ms             |
| Fully populated UI elements           | approximately 10,700         | approximately 4,100 |
| Fully populated JS heap snapshot      | approximately 92 MB          | approximately 47 MB |

An actual-rules benchmark on the TV used 24 synthetic Abbott release descriptions and the user's 55 active filters: original matching 403 ms, optimized cold matching 90 ms, repeated matching 6 ms, identical badge results. This isolates badge matching; it is not overall stream-load latency.

Fresh final-build test: selected a real Abbott Elementary S2E16 1080p source with **three sources still loading**, and playback reached video `readyState=4`, 1920×1080. Only eight stream cards were mounted when selected. No need to wait for all sources. A separate first-row test encountered an add-on donation link and correctly failed playback; that row is not media.

Final playback left paused, subtitle menu closed, and no temporary CSS overrides, detached rows, or active timing probes remained. Reduced-motion visibility smoke checks passed for parental overlays, loading identity/spokes, stream panel, library picker, and profile PIN opening layer.

## Startup

Measured on the same TV by reloading the app under CDP after the webOS companion service had been idle for at least 60 seconds, so its Node process had to launch again. One sample per build; the reload excludes webOS's own app-process launch.

Before the change, `routeAfterAuthentication` waited for `sync_pull_profile_locks`. On webOS every Supabase request went through the companion service, whose `supabaseProxy` command first booted the 5.2 MB media runtime. The first account requests therefore took 6.3–7.4 s, while the page sat idle with no CPU or network activity. A direct request from the app page returned 200 in 87–105 ms.

| Build                                                | Lock request | Home route opens |
| ---------------------------------------------------- | ------------ | ---------------- |
| Original (two samples)                               | 6.3 s        | 7.3–8.4 s        |
| Service proxies in-process (no media runtime)        | 4.4 s        | 6.0 s            |
| Plus launch warm-up and deferred badge prerender     | 3.8 s        | 5.7 s            |
| Direct backend requests on non-legacy webOS (2 runs) | 0.13 s       | 1.8–2.3 s        |

In the original sample, the focused Continue Watching row appeared at 9.5 s. The later samples did not record that marker. After the change, the startup account sync (profiles, settings, collections, library, addons) finished about 6 s earlier. The remaining Home cost is CPU: catalog rows render and re-render for several seconds after the route opens.

Addon enabled-state reads during startup took 0.74 s of CPU because each check re-normalized the stored addon envelopes; with cached envelopes they took 0.05 s (one reload sample each, after the change in `addonRepository.js`).

Home re-rendered about 70 times in the first 25 s after a reload, and half of that render time was `outerHTML` serialization in `homeDomUpdate.js`. On the TV's live Home markup (845 KB, 63 rows, 4,135 elements), one incremental update took 0.96–1.28 s before and 0.25–0.36 s after limiting signatures to rows and cards; a full mount took 1.26 s before and 0.67 s after. Both versions produced identical HTML for eight markup changes (unchanged, removed row, reordered rows, changed title, added card, changed image, wrapper class and attribute changes). One run; a repeat run reloaded the app because the test held many detached copies of Home.

A temporary render log on a normal launch then showed 14–15 Home renders in the first 25 s. Catalog rows from one addon kept arriving for about 20 s, and every watched-title refresh requested another render even when nothing changed. Batching deferred rows (1 s windows) and rendering after a watched refresh only when the watched set changes reduced Home render CPU in a 25 s startup reload from 7.4 s to 5.0 s (10.5 s before the signature change); idle time in that window rose from 0.9 s to 5.3 s. One reload sample per build. In that sample posters appeared 3.1 s after the app bundle started loading, against 2.6 s before; the first catalog batch still renders row by row, so this is probably network variation, but a single sample cannot rule it out.

Startup traces with all 70 catalog rows enabled (30 s Chrome trace of a reload; app relaunched before each run in the final build, because repeated debugger reloads inflated the JS heap to 125–188 MB). In every launch the startup sync reported a Home catalog settings change: the shared remote list named 58 catalogs while this TV listed 70, and applying it dropped the other 12 from the saved order, so Home re-appended them in row-arrival order. The resulting second Home load fetched 50 catalogs twice (about 120 catalog requests). With the corrected comparison, four reloads skipped the post-sync reload and the build sends 70 catalog requests. Rows still finish arriving 23–27 s after reload (24–25 s before), and Home render CPU (7.5–9.4 s) and slow-frame time are within run-to-run variation. Catalog responses take about 0.2 s; rows are late because each batch of four starts only after the previous batch is processed, and Home renders of 0.5–2.4 s hold that processing back. Two samples per build.

Requesting all deferred catalogs at once (instead of four in flight) on the same TV, two fresh launches per build, all 70 rows: the last catalog loaded at 5.5–7.4 s instead of 19.5–24.2 s, and all rows were on Home at 9.3–11.3 s instead of 23.0–26.8 s. Home render CPU in the 30 s window fell from 7.5–9.4 s to 1.7–2.1 s, long tasks from 15.6–19.6 s to 6.2–7.7 s, and slow-frame time between 15 and 25 s from 6.0–9.1 s to 0–1.0 s. The worst single stall rose slightly (2.1–2.3 s to 2.7 s), because more rows land in one batched render. Home navigation on the settled screen stayed within budget (16 keys, 4–49 ms key to next frame).

## Player episode panel

Measured on the same TV with CDP key events: open the panel, move six episodes down, press Enter on an uncached episode (199 streams from all sources), then move through the stream list. One sample per build. The baseline video was paused; the new build was measured while it played, and the viewer pressed some extra keys during that run.

Before the change, every key rebuilt the whole panel. In the stream view that meant all 199 cards: markup parsing (2.4 s), layout reads while scrolling the focused card into view (1 s), and HTML escaping for badges (0.8 s). Enter also bypassed the stream search cache and showed nothing until every source finished.

| Step                                   | Before       | After                     |
| -------------------------------------- | ------------ | ------------------------- |
| Move between episodes (key to frame)   | 88–167 ms    | 18–121 ms                 |
| Enter until the first streams show     | 8.4 s        | 1.1 s                     |
| Enter until every source finished      | 8.4 s        | 5.7 s (network)           |
| Move between streams (key to frame)    | 3.9–4.9 s    | 23–126 ms                 |
| Reach the end of a rendered card batch | (whole list) | 494 ms to append 10 cards |

## Checks and remaining limits

- 37 unit/regression tests pass, including first-source playback while a slow source remains pending, late-source focus preservation, bounded card rendering, and the episode panel stream list.
- Repository lint, production build, webOS packaging, and plugin forwarding/Node 8 contract check pass.
- The npm test wrapper references two absent `tests/test-plugin-*.mjs` files; the available tests and forwarding check were invoked directly.
- Some startup, resume, and player transitions still take hundreds of milliseconds or longer. Remote resume lookup and provider/network resolution remain asynchronous dependencies; this change does not skip resume state to conceal their latency.
- Stremio's public stremio-web repository was inspected for architectural guidance. It is not the official LG app, and no LG-specific implementation equivalence is claimed.
