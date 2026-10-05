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

## Checks and remaining limits

- 27 available unit/regression tests pass, including first-source playback while a slow source remains pending, late-source focus preservation, and bounded card rendering.
- Repository lint, production build, webOS packaging, and plugin forwarding/Node 8 contract check pass.
- The npm test wrapper references two absent `tests/test-plugin-*.mjs` files; the available tests and forwarding check were invoked directly.
- Some startup, resume, and player transitions still take hundreds of milliseconds or longer. Remote resume lookup and provider/network resolution remain asynchronous dependencies; this change does not skip resume state to conceal their latency.
- Stremio's public stremio-web repository was inspected for architectural guidance. It is not the official LG app, and no LG-specific implementation equivalence is claimed.
