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

Moving down Home with all 70 rows loaded (25 Down presses, 400 ms apart, 20 s after a fresh launch; three runs per build) spent most of each move in `CompositeLayers`. Every row track had `transform: translateZ(0)`, which gave each row three compositor layers (221 in total). On constrained TVs the tracks no longer get a 3D transform: 8 layers remain, total long-task time fell from 19.1–30.1 s to 15.7–17.0 s, and median key-to-next-frame was 51–59 ms instead of 47–106 ms. The worst long task still reached 1.8–3.3 s (2.4–6.1 s before): Home is now painted as one large layer, so each move still spends 0.2–0.65 s in `CompositeLayers`, and lazy image hydration forces layouts of up to 0.7 s. Horizontal navigation in Continue Watching stayed within 7–51 ms per key.

Loading Home catalogs by range (first rows plus five rows past focus) on the same TV, with all 70 rows enabled, two fresh launches: startup sent 5 catalog requests instead of 70, the worst stall fell from 2.7 s to 0.8–1.0 s, long tasks in the first 30 s from 6.2–7.7 s to 3.5–3.7 s, Home render CPU from 1.7–2.1 s to 0.5–0.6 s, and the last long task ended at 7.3–11.9 s instead of 12.2–18.5 s. First posters appeared at 3.3–3.6 s (3.3–4.5 s before). The comparison runs predate the row-track layer change, which affects browsing rather than startup. Moving down with 25 Down presses (three runs), loading kept ahead of focus: focus reached rows 23–25 while 21–27 catalogs were requested. Median key-to-next-frame was 39–67 ms, p95 143–426 ms, and the worst long task 1.8–2.0 s, against 51–59 ms, 165–2,637 ms and 1.8–3.3 s with every row loaded. A prototype that also mounted a skeleton row for every catalog was slower: 2.1 s worst startup stall and 934 ms p95 while browsing.

## Returning to Home

On every return from another screen, the original Home ran a full background refresh. It refreshed addon manifests, rebuilt every row and re-rendered Home. An earlier fork change skipped it only after Settings and profile selection. The rebuilt rows never contained newer catalog data, because `catalogRepository` caches catalog responses for the session. With the full refresh limited to changes in Home's inputs, returning from Library and from Search (one run each, fork build, Home loaded) sent no addon manifest requests and made no DOM changes under `#home` in the 8 s after the return. The Continue Watching refresh sent 5 requests. No timing was taken for the original return path.

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

## October 2026 issue follow-up checkpoint

See [ISSUES-1055-1059.md](ISSUES-1055-1059.md) for what was tried, targeted upstream 1.2.4 measurements, the final Home candidate check and limitations. Neither experiment demonstrated a reliable solution; the experimental checkout was retired without merging its code. These results are separate from the fork benchmarks above. The TV is back on the asset-verified merged performance-fork 1.2.4, with configuration preserved, playback paused and experiment probes removed.

## October 12, 2026: Modern Home row virtualization trial

Implemented and installed a trial on the same LG 43UQ70003LB / Chromium 87,
performance-fork 1.2.4. Constrained Modern Home now mounts at most nine
catalog/collection rows. Catalog data remains available; this is a DOM window,
not a cap on the user's catalogs. Continue Watching/upcoming and the hero remain
outside the window. Full rendering and Classic/Grid retain their existing paths.

The virtualizer stores measured row heights, horizontal scroll positions and
rendered card counts by key, with two aggregate spacers for offscreen rows.
Logical D-pad navigation mounts the destination before moving focus. Window
shifts create only incoming rows and preserve overlapping nodes; generating and
reconciling every window row was measurably more expensive. A pointer-scroll
double-compensation bug was corrected by establishing spacer geometry before
restoring scroll. Pointer focus also schedules the existing hero/poster effects.

TV samples: start on catalog index 4, Modern layout with hero, 25 Down keys,
400 ms between completed CDP dispatches; caches were not cleared. Key timing is
keydown-listener to next animation-frame callback, not completed image display.

| Sample                      | Final catalog index | Mounted catalog rows | Home elements | Median / p95 key-to-frame | Worst long task |
| --------------------------- | ------------------- | -------------------- | ------------- | ------------------------- | --------------- |
| Pre-change performance fork | 29                  | 38                   | 3,754         | 31 / 107 ms               | 3,678 ms        |
| Spacer-corrected candidate  | 29                  | 9                    | 928           | 14 / 172 ms               | 718 ms          |
| Final installed build       | 28                  | 9                    | 987           | 86 / 317 ms               | 4,161 ms        |

One key in the final run reached a catalog boundary before the next catalog
data arrived; navigation continued after it loaded. The pre-change run had 38
loaded rows, the spacer-corrected candidate 35, and the final run 34. These are
small, network/cache-dependent samples, not identical settled workloads. The
DOM bound is verified, but **a reliable navigation speedup is not established**:
the good candidate sample did not repeat, and multi-second stalls remain.
No benchmark of Native Legacy was taken and no native parity is claimed.

A 25-key Up run on the spacer-corrected build returned index 29 to 4, with nine
rows throughout, exact scroll/focus alignment, median 64 ms, p95 357 ms and worst
long task 422 ms. Earlier remount checks also restored the remembered card
column. A temporary per-track 3D-transform experiment on the bounded window
made downward p95 1,987 ms; it was removed and is not part of the implementation.

The final build was checked for pointer jumps to the top and deep into Home,
visible focus and eventual hero identity, and Details/Back preserving row and
scroll position. TV screenshots were inspected. The installed JavaScript
matches the extracted IPK byte-for-byte; inspector stylesheet text matches IPK
bytes after accounting for its Windows-1252 decoding. Configuration matches
the preserved configuration. Compare extracted package assets rather than
staging files: the webOS packager minifies JavaScript again.

All 62 unit tests, repository lint, production build and webOS packaging pass.
Seven new tests cover bounded traversal of 70 rows, variable-height spacers,
key-based cache retention, skipping offscreen card generation, logical
navigation, runtime/layout gating and pointer hero updates. Raw measurements,
screenshots, installed sources, private configuration and IPK stay local under
ignored paths. The trial is left installed for evaluation; Home is at the top.
Final cleanup confirmed paused video, no temporary styles, detached experiment
rows, active probes or saved runtime-class overrides.

## Home boot snapshot (local harness, not yet measured on the TV)

The app saves the first screen of Home (hero, Continue Watching, two catalog
rows of eight cards) to `localStorage` once Home has settled at the top. The
packaged `index.html` paints it, read-only, before the app bundle loads; the
live Home replaces it once its first poster has painted.

Measured with `npm run perf:local` (headless Chromium posing as Chromium 87,
CPU 8x slower, recorded network with 150 ms API latency, 60 synthetic catalog
rows plus Cinemeta, guest profile), five warm relaunches per side, same build,
`--no-snapshot` deleting the saved snapshot before each launch:

| Median of 5 launches             | No snapshot | Snapshot |
| -------------------------------- | ----------- | -------- |
| First poster visible             | 1,513 ms    | 549 ms   |
| Live Home interactive (focused)  | 1,396 ms    | 1,488 ms |
| Settled (3 s without long tasks) | 1,695 ms    | 1,605 ms |
| Long tasks until settled         | 875 ms      | 763 ms   |
| Layout + style recalculation     | 187 ms      | 233 ms   |
| D-pad key to next frame, p95     | 37 ms       | 35 ms    |

Before the overlay used `contain: strict`, the copied DOM took part in the
app's own style and layout passes: interactive was 1,759 ms (+26%) and long
tasks 1,157 ms. Rescaled posters are `blob:` URLs that end with the page; the
snapshot stores their original URLs instead. These are relative numbers for
comparing builds on one machine. Absolute TV timings, and whether full-size
snapshot posters cost more decode time on the TV than they save, still need a
TV measurement.

## Early Home navigation while rows load (local harness, not yet measured on the TV)

On the TV, D-pad navigation stuttered for roughly the first ten seconds after
launch. In the harness at CPU 25x (about the TV's speed; its SoC is the LG
k8lp, four Cortex-A55 cores), pressing keys as soon as Home was interactive
(`--early-keys --key-gap=300 '--keys=Down*16,Up*6'`) reproduced it: full Home
renders of 200–440 ms ran between key presses. They came through
`requestRender`, whose input deferral made an exception when focus was on the
last navigation row, so rows loaded ahead of focus could appear while Down
was held. Modern Home on constrained TVs only mounts about six rows early on,
so a quick Down run reached that row and every catalog batch then rendered
the whole Home mid-navigation.

Virtual rows no longer take that exception: moving down from the last mounted
row adds rows loaded since the last render to the virtual window and mounts
the next one, and the full render waits until input stops. Alternating A/B,
six launches per build:

| Median of 6 launches              | Before   | After                  |
| --------------------------------- | -------- | ---------------------- |
| Full Home renders during the keys | 4        | 1 (after the last key) |
| Slowest key, worst launch         | 546 ms   | 293 ms                 |
| Longest key wait in the queue     | 103 ms   | 19 ms                  |
| Longest task during navigation    | 356 ms   | 249 ms                 |
| Key to next frame, p95            | 126 ms   | 154 ms                 |
| Long tasks during navigation      | 2,222 ms | 2,206 ms               |

The stalls are gone, but each Down at the bottom while rows are loading now
mounts rows itself (about 200 ms at 25x), so typical slow keys are a little
slower and total navigation CPU is unchanged. That cost is building row
markup and snapshotting it for the Home DOM diff (`remember`/`signature` in
`homeDomUpdate.js`), which the keyed Home render is meant to remove.

## Early Home navigation on the TV (November 8, 2026)

LG 43UQ70003LB (webOS 7.6, k8lp), modern Home, 55 catalogs, signed-in
profile. `npm run perf:tv -- --early-nav` reloads the app and presses 8 Down,
6 Right and 8 Up keys 350 ms apart as soon as Home is interactive. Two runs
per build; "settled" is the first task after the key's next frame, so it
includes work queued behind the key.

| Build                                        | Slowest key (settled) | Longest task    | Next frame p95 | Long tasks during keys | Full renders during keys |
| -------------------------------------------- | --------------------- | --------------- | -------------- | ---------------------- | ------------------------ |
| Before (ab26c949, one clean run)             | 6.2 s                 | 1.9 s           | 937 ms         | 8.0 s                  | 0                        |
| Last-row deferral (81d532d4)                 | 4.4 s / 6.3 s         | 0.7 s / 3.7 s   | 417 / 901 ms   | 7.4 / 9.5 s            | 0 / 1 (3.3 s)            |
| Batches mount without full render (37bef267) | 1.4 s / 1.1 s         | 0.45 s / 0.47 s | 488 / 216 ms   | 7.6 / 4.9 s            | 0 / 0                    |
| All catalogs requested up front (dcfa49d0)   | 5.5 s / 1.1 s         | 3.6 s / 0.27 s  | 942 / 171 ms   | 8.8 / 3.8 s            | 1 (0.5 s) / 0            |
| Worker-created poster urls (49c45da7)        | 3.6 s / 1.5 s         | 3.2 s / 0.84 s  | 442 / 436 ms   | 8.0 / 5.4 s            | 1 (0.55 s) / 1 (0.3 s)   |
| Badge prerender waits for quiet (35b0e2ff)   | 2.1 s / 1.3 s         | 0.58 s / 0.57 s | 564 / 311 ms   | 4.3 / 4.7 s            | 1 (0.25 s) / 1 (0.25 s)  |

Findings:

- A CPU profile of the first build showed full Home renders of up to 5 s and
  gaps of 50–370 ms between samples, about 2.8 s in total, in which the whole
  renderer stalled; the function on top at that moment received the gap
  (`atob`, `addEventListener`). Steady costs were lazy-image hydration and
  eviction (layout reads), the hero description bounds, `createObjectURL` for
  rescaled posters and `focus()` (the style update for the class change made
  just before it).
- Home requested one catalog per Down press, about 500 ms apart, although each
  request took 120–650 ms; 13 of 55 catalogs were requested in a run, and a row
  reached the screen 0.5–1.8 s after its data (the constrained-TV 1 s row batch
  plus main-thread work). With every catalog requested once the first rows are
  on screen, all 55 arrived 1.4–2.0 s after Home was interactive and the JS heap
  was 20.5 MB.
- Out-of-order catalog arrival unmounted the focused row in one run of
  0036e224 (keys after it did nothing, which looked fast); dcfa49d0 keeps the
  focused row in the window.
- A profiled run of 49c45da7 showed `URL.createObjectURL` on the main thread
  falling from 874 ms to 115 ms (the rest is not poster work), and
  `toDataURL` at 825 ms: the startup stream badge prerender drawing every badge
  image to a PNG data URL. 35b0e2ff runs that prerender once the remote has
  been idle for 5 s.
- Stalls of several seconds still occur in some runs on every build (3.6 s in
  the first dcfa49d0 run, after all catalogs had arrived; 3.7 s on 81d532d4).
  Their cause is not identified yet. None appeared in the three runs after
  49c45da7's profiled run (that run and both 35b0e2ff runs), which is too few
  to call them gone. The 35b0e2ff runs each had one full render of about
  250 ms during the keys; its trigger is not traced yet.

## Opening a title from Home on the TV (November 8, 2026)

Opening a title from Home did no network wait before the details appeared: the
metadata was already cached. The details screen appeared 1.1–1.7 s after OK
(three opens of one movie, account tracking with Simkl) because one main-thread
task of 0.9–1.4 s ran first. A localStorage count for one open showed why:
`traktSettings` and `trackingSourceMemory` were each read 2,018 times,
`simklAuthState` 1,426 times, `activeProfileId` 10,024 times, and the 64 KB
Simkl snapshot was parsed 21 times (5.2 MB of stored JSON read in total).
Back read another 2.6 MB. Two lookups repeated per history item:
`watchProgressRepository.getRecent` resolved the selected tracking source
(several settings stores) for every item, and the Simkl service read the
anime id preference for every entry, re-parsed its snapshot and rebuilt the
watched projection on each call, and `findEntry` rebuilt every entry's id
aliases per lookup.

With the source resolved once per call, the Simkl snapshot parsed once per
stored text, the projection cached per snapshot (callers get copies) and an
alias index per entries array, the same movie opened in 297 and 227 ms (single
task 278 and 210 ms), and a series in 680 and 342 ms (the first open after a
launch is the slower one). Per open, settings reads fell to 85 and
`activeProfileId` reads to about 430. Back's longest task fell from 666 ms to
about 210–250 ms.

Going back also re-hydrated every poster: 800 ms after leaving Home, all
artwork was handed back and the rescale workers were torn down, so a return
fetched, decoded and rescaled the visible posters again. Home now keeps its
artwork for 30 s after leaving, and starting playback releases it 800 ms after
the player route opens. In two open-and-back rounds all 14 posters on screen
were still painted 150 ms after Back.

Still open: about 100 `layoutPreferences` reads per details open (a clone of a
7 KB value each), and the first open after a launch still takes about 0.7 s.

## Launch snapshot handover on the TV (November 8, 2026)

On a fresh reload the launch snapshot came down at 5.3 s, as soon as the live
Home painted one image (a Continue Watching card). None of the 7 posters in
the visible catalog row had painted yet; they filled in between 6.2 and 9.2 s,
because each waited for the rescale workers although the snapshot had just
loaded the same urls. The snapshot now stays until every on-screen poster has
painted (3 s at most, or the first key press), and on-screen posters take the
url the snapshot already decoded. In two reloads the visible row was 7/7
painted before the snapshot came down (4.6 and 6.0 s) and stayed painted.

A "Loading catalogs n/55" pill now shows top right during a cold load and
disappears when every requested catalog is in. In one reload it was visible
from 7.2 s (snapshot removal) to 9.0 s; the only long task after it was 150 ms.

## Freezes after Home appears on the TV (November 8, 2026)

Traced cold reloads (DevTools timeline plus a 1 ms CPU profile, 22 keys from
the first catalog row, key latency from `event.timeStamp`). Before these
changes no run showed a single multi-second stall while the keys were being
pressed. Instead the main thread was about 98% busy for 5–12 s while the 55
catalogs arrived. In that window JSON parsing of catalog responses took
1.1–1.2 s, GC 0.7–1.2 s and native rendering about 4.5 s. Collecting hero
candidates cost about 0.4 s (normalizing the first items of every catalog to
keep ten), the Home input signature 0.2 s per check (exporting every synced
feature) and sidebar member avatars 0.2 s. Those three no longer appear in
the profiles.

The freezes were full Home renders that had been postponed while keys were
held. Each ran as one task the moment input paused:

- 1.4 s (run t3): two to four catalogs miss the 3.5 s row timeout on most
  cold starts, although their responses finish within 4 s. Home dropped those
  responses, fetched and parsed each catalog again, and forced a full render
  for each retried row. A timed-out request now keeps running and the retry
  waits for it. Retried rows mount like other late rows. In the next two
  runs no catalog was fetched twice, but none timed out either, so the
  retry path itself is covered by unit tests only.
- 1.2 s (run t5): every catalog batch re-projects watched titles, and the set
  grows with titles from rows that are not mounted yet; each growth asked for
  a full render. Rows mounted later already use the current set, so the full
  render now runs only when a mounted poster's badge changes.

| Run | Build             | Interactive | Key median / worst | Longest task after interactive                |
| --- | ----------------- | ----------- | ------------------ | --------------------------------------------- |
| t3  | three small fixes | 7.3 s       | 0.67 / 2.57 s      | 1.51 s (postponed render)                     |
| t4  | three small fixes | 5.7 s       | 0.52 / 1.65 s      | 0.30 s                                        |
| t5  | + retry fix       | 6.1 s       | 0.67 / 5.10 s      | 3.42 s (see below), 1.19 s (postponed render) |
| t6  | + retry fix       | 5.7 s       | 0.50 / 1.82 s      | 0.32 s                                        |
| t7  | + watched fix     | 4.9 s       | 0.88 / 1.56 s      | 0.42 s                                        |
| t8  | + watched fix     | 7.4 s       | 1.22 / 2.80 s      | 0.37 s                                        |

The 3.4 s task in t5 was a key press whose focus() style recalculation
touched 8 elements but took 1.5 s: the main thread got 1.1 s of CPU in
3.4 s of wall time. The traced threads (GPU, Viz, compositor, workers)
together used about one of the four cores, so the rest went to processes
outside the trace. This could not be attributed or reproduced.

Key latency still varies widely between runs and did not clearly improve.
Keys pressed while catalogs are still arriving queue behind catalog parsing,
GC and rendering, so they settle 1–2.8 s late. That saturation, not single
long tasks, is what remains. Moving catalog fetch, parse and trimming into a
worker would take the JSON parse and most of its garbage off the main thread.

## Upstream 1.4.0 merge on the TV (November 12, 2026)

`npm run perf:tv -- --early-nav`, two runs per build, from the first catalog
row with 55 catalogs. "Before" is the 1.3.8 fork build installed on November
8; "after" is the 1.4.0 merge (plus the stream resume fix), measured after
Home had settled once at the top so the boot snapshot and the new catalog
snapshot were saved. Long tasks here cover the whole run, not only the time
after Home is interactive as in the traced runs above.

| Run       | Interactive | Next frame p50 / p95 | Settled p95 | Worst key | Long tasks total / max | Last row on screen |
| --------- | ----------- | -------------------- | ----------- | --------- | ---------------------- | ------------------ |
| before r1 | 6.6 s       | 110 / 948 ms         | 8.14 s      | 8.83 s    | 13.2 / 5.85 s          | 14.1 s             |
| before r2 | 4.9 s       | 97 / 351 ms          | 1.81 s      | 7.48 s    | 7.3 / 1.72 s           | 10.2 s             |
| after r1  | 3.8 s       | 108 / 598 ms         | 3.05 s      | 3.53 s    | 4.6 / 0.47 s           | 11.9 s             |
| after r2  | 3.3 s       | 68 / 346 ms          | 1.12 s      | 1.50 s    | 2.1 / 0.32 s           | 7.1 s              |

In before r1 a 5.9 s task held 13 of the 22 keys on the first row. Each
merged run had one Home render while keys were pressed (71 and 81 ms). The
two builds vary more between runs than the earlier traced runs did, so two
runs show no regression from the merge rather than a measured speedup.
`--css-smoke` confirmed the renamed motion stylesheet still reveals all seven
animation-dependent elements.

## Startup loading pill and Continue Watching order on the TV (November 12, 2026)

Cold reloads from Home with the launch snapshot saved, recording when the
pill text, the Continue Watching cards and focus changed, plus the timing of
every non-image request. The Simkl check was skipped in every run (its
15-minute gate), so Continue Watching waited only on addon meta lookups.

- The spinner does not slow startup or keys. With it turned off through the
  inspector, Home was interactive at 6.2 and 7.0 s; with it on, at 4.9-6.1 s
  (four runs). Early-navigation key latency with the pill: median 50-89 ms,
  worst key 0.8-1.6 s.
- Continue Watching's late lookups are not slow requests. They took
  21-42 ms but started about a second apart, between 9.5 and 12.3 s, each
  step waiting while the main thread parsed the 55 catalog responses.
- Holding the lower catalogs until Continue Watching finished (at most 2.5 s)
  made the catalogs finish at 11.4-12.5 s instead of 8.5-9.0 s, and the last
  Continue Watching lookup did not end sooner. Reverted.
- Run-to-run variation is as large as the effects measured: the same merge
  build became interactive at 4.3, 4.6 and 8.5 s within an hour. Treat
  differences under about 2 s between two-run sets as unresolved.
- Upstream's IndexedDB catalog cache never wins its 500 ms race here: opening
  the database took 1.9 s and the read 1.2 s, so Home always paints from the
  network. Its writes still run (2.6 s for the put after the first rows).

## Catalog cache and catalog parsing on the TV (November 12, 2026)

Same cold-reload recording as the previous section. Each A/B pair ran on one
installed build, with the variant switched through the inspector before the
reload, and the pairs interleaved.

- **Catalog cache skipped on constrained TVs (kept).** Making the IndexedDB
  catalog cache unopenable before launch (3 pairs): catalogs finished at
  8.1-8.2 s instead of 10.1-12.2 s, long tasks totalled 3.2-3.9 s instead of
  4.4-5.7 s, and Home was interactive at 4.1-4.4 s instead of 4.3-6.7 s.
  Four reloads of the committed build: interactive 4.0-5.4 s, catalogs done
  6.9-9.8 s, long tasks 3.0-4.4 s (the first reload after the install, without
  a code cache, took 8.1 / 13.6 / 9.3 s). The direction held but by less than
  in the A/B.
- **Catalog parsing in a Web Worker (not kept).** Startup fetches 54 catalog
  pages, 15.5 MB of JSON, and parsing them on the main thread took 1.0-1.3 s.
  A worker that fetched, parsed and returned only the card fields removed that
  parsing but was not faster (3 pairs, worker vs main thread): long tasks
  4.5-5.0 s vs 3.1-4.8 s, catalogs done 8.4-9.0 s vs 7.6-10.3 s, interactive
  4.6-5.2 s vs 4.1-5.9 s. The worker had more long-task time in every pair.
  A likely cause is that a fifth busy thread competes with the main, raster
  and artwork threads for the four A55 cores; this was not traced. The
  change is kept outside the repository, under `.cache/tv-performance/`.

## Catalog cache start on constrained TVs (November 12, 2026)

Native Legacy, installed on the same TV, keeps compact per-profile catalog
files (`catalogo-*.bin`, 76-190 KB), sharded title metadata files and a
negative cache that does not repeat a failed HTTP request for 24 hours. Its
logs show it paints Home from the catalog cache and refreshes from the network.
The web app downloaded and parsed all 54 catalog pages (15.5 MB) on every
start.

A constrained TV now requests the first catalog batch as before and shows the
cached copies of the other catalogs instead of requesting them. The cache is
refreshed one catalog at a time once startup is over. Cold reloads, cache
blocked through the inspector versus allowed, interleaved on one build:

| Run       | Catalog pages parsed before 15 s | Home interactive | Catalogs done | Long tasks (first 20 s) |
| --------- | -------------------------------- | ---------------- | ------------- | ----------------------- |
| network 1 | 54 (1.07 s)                      | 6.0 s            | 10.0 s        | 4.6 s                   |
| cache 1   | 5 (0.07 s)                       | 4.3 s            | 4.3 s         | 3.4 s                   |
| network 2 | 54 (1.13 s)                      | 4.7 s            | 9.0 s         | 3.9 s                   |
| cache 2   | 5 (0.05 s)                       | 4.3 s            | 4.3 s         | 3.3 s                   |
| network 3 | 54 (1.18 s)                      | 4.7 s            | 10.2 s        | 4.3 s                   |

The third cache run of that build hit a slow phase of the TV (interactive
9.4 s): its cache read missed the then 3 s timeout and it fell back to
requesting every catalog. The read itself takes 15 ms to open and 33 ms to
read the 1.75 MB record when the TV is idle; during startup its callbacks wait
behind main-thread tasks. The timeout is now 8 s.

With the cache aged to an hour, the refresh started at 20 s and fetched the
49 cached catalogs in 6 s. After 15 s there were four long tasks, the longest
142 ms, and the record was saved again.

A first version that rendered every cached row in Home's first render was not
kept: that render took 0.9 s (0.4 s with the first batch only), and the long
tasks did not drop.

Not done yet, also from Native Legacy: persisting the metadata Next Up uses
(up to 32 series lookups per start; in-progress Continue Watching cards
already have a 14-day enrichment cache) and a negative cache for meta lookups
that failed.

## First catalog rows from the cache (November 12, 2026, not kept)

Native Legacy builds Home from its catalog file before any network request.
Two versions of that were tried on the constrained TV, two cold reloads each,
against the 4.3 s interactive of the build above (first five catalogs from the
network, later ones from the cache).

Reading the whole 1.75 MB cache before the first render: one reload found the
cache and parsed no catalog page before 15 s, but was interactive at 6.5 s
(long tasks before 15 s 4.6 s, longest 1.5 s). The other missed the cache and
started from the network (5.0 s); the cache had survived the reinstall, so the
miss was probably a slow read.

Storing the first five rows apart (138 KB) and reading the full cache after
the first render: interactive at 4.9 s and 3.9 s, all catalogs on screen at
7.8 s and 5.2 s, long tasks before 15 s 5.2 s and 3.6 s. With Home's perf log,
the small read took 0.39 s and the full read 1.05 s, after the first render.
Home's load started about 2.7 s after the reload and its first render
followed about 1 s later, so the catalog source can only change that last
second; most of the startup is spent before Home loads. Neither version was
kept. The second is kept outside the repository, under
`.cache/tv-performance/`.

The catalog refresh fix that came out of this work is kept: stale-catalog
refreshes pass their 15 min window as a maximum age to the in-memory catalog
cache, which otherwise returned the pages fetched earlier in the session, and
a constrained TV checks once a minute whether Home's catalogs need that
refresh. Neither has been timed on the TV.
