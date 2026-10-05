# Continue the webOS performance work

Read [RESULTS.md](RESULTS.md) for the measured outcomes and limitations. The original code baseline is `358d08c` (upstream release 1.2.2). The tested TV is LG 43UQ70003LB, webOS 7.6.0, Chromium 87; OS version alone does not identify browser support or rendering capacity.

## Maintain the fork

The intended Git layout is `origin` = `sircoderin/NuvioTVSmart`, `upstream` = `NuvioMedia/NuvioTVSmart`, and `webos-performance` = the custom build branch. Keep `main` aligned with upstream. Inspect `git status`, remotes, and the branch before starting; retain unrelated local edits.

To integrate an upstream update into a clean performance branch:

```sh
git fetch upstream
git switch webos-performance
git merge upstream/main
npm ci
npm run test:unit
npm run lint
npm run build
```

Resolve conflicts around the behavior below, then test on the TV before installing a newly merged build. A Git sync does not update the installed app. Avoid rebasing this published branch unless all users agree to rewrite its history. Prefer sending broadly useful fixes upstream to reduce the fork's long-term patch set. Fork setup/pushing was authorized in the originating session; future agents should use the current user's task to determine authorization for publishing and deployment.

## Preserve these behaviors during merges

- `js/platform/tvRuntimePerformance.js`: webOS 2022/2023 selects constrained rendering without selecting legacy API fallbacks. Tests distinguish those concepts.
- `css/components-61.css`: eliminate costly motion but explicitly reveal elements that relied on keyframes for opacity (parental warnings, loading identity/spokes, stream panel, library picker, PIN opening). Preserve menu closing/hidden states.
- Home: `expandedPosterMarkup.js`, helpers 02/15, methods 12. Allocate expanded art/layers on focus, preserve runtime-owned nodes through `homeDomUpdate.js`, and skip forced hero layout on constrained TVs. The existing constrained row limit is ten items. This is not full Home row virtualization.
- Player methods 28/68/71: retain control button identity through pause/resume; update only changed contents; keep focus and overlay synchronization. Do not reintroduce duplicate renders after `togglePause()`.
- Player episode panel (methods 65–67): key moves update focus classes in place (`syncEpisodePanelFocusDom`); only structural changes rebuild the panel. Stream cards render in batches of `PLAYER_STREAM_CARD_RENDER_BATCH`, appended as focus or scrolling nears the end. Streams show per source with the first-ranked source focused until the user moves. Entering an episode reuses the stream search cache; Reload forces a refresh. The player Sources panel (methods 62–64) uses the same card batching (`getStreamCardRenderLimit`), and its CSS shares the episode panel's 520 px sizing in `components-45/46.css`.
- `streamBadgeRules.js` and `streamBadgeSettingsStore.js`: prepare immutable snapshots, bounded result/rule caches, defensive badge copies, and correct invalidation. Only concatenated positive lookaheads starting with `.*`, without capturing/backreference behavior, use the anchored line optimization. Preserve original regex behavior for other patterns and line terminators.
- Stream methods 01/04/09/10: constrained lists virtualize above 20 streams with a smaller nearby window; prepare settings once per window; avoid bulk badge matching on source arrival; keep early results selectable while other sources load; preserve the selected stream's identity and filter focus during updates.
- Stream initial focus follows the top row until the user presses a direction key (`streamFocusUserMoved`), so a slower, higher-ranked source takes the first row and focus when it arrives. After the user moves, focus identity is preserved as above.
- Home route resume (`canSkipHomeResumeRefresh`, methods 04/20/30): a preserved Home skips its full background reload only when every route shown meanwhile is in `HOME_RESUME_PASSIVE_ROUTES`, the resume signature (sync-sensitive settings, installed-addon fingerprint, catalog preferences, stored profiles) is unchanged, and the last full load is under `HOME_RESUME_REFRESH_MAX_AGE_MS`. The router's bounded route-visit log supplies the visited routes; a truncated log means reload. Switching to a different profile always reloads Home; re-selecting the active profile resumes it.
- Profile selection paints locally stored profiles before the remote profile/lock pulls. Profile activation and the options dialog wait for those lock states, so PIN-locked profiles still require the PIN.
- `profileScopedStore` caches normalized envelopes by the exact stored text (`LocalStore.getRaw`). Returned profile values are clones and envelopes are shallow copies; keep normalizers pure.
- Startup backend requests (`httpClient.js`, `webosSupabaseProxy.js`): non-legacy webOS (Chromium 85+, 2022+) sends Supabase requests directly from the browser. Legacy webOS keeps the companion-service proxy, and one direct network failure moves the rest of the session to the proxy (safe reads replay through it; writes do not). The webOS service answers `supabaseProxy`/`safeHttpProxy` in-process without booting the media runtime, and `boot-guard.js` warms the service (`warmup`) only below Chromium 85. The stream badge image prerender in `app.js` waits for the startup sync, because its image-proxy `status` call boots the media runtime.
- Selection cancels picker work immediately using the load token, abort controller, and scheduled-render cleanup. The repository-owned search session can continue and reattach on return. Keep the resume lookup and stale-navigation token guard. Remote resume lookup can still delay the handoff; it does not mean the picker waits for all sources.

## Local checks and configuration

Use Node 22+ for the profiler (global WebSocket). `npm run test:unit` discovers the available `js/**/*.test.mjs` and `services/**/*.test.mjs` tests. The inherited `npm test` wrapper references two absent `tests/test-plugin-*.mjs` files; do not report that wrapper as passing. Run `node scripts/test-webos-plugin-forwarding.cjs` separately when plugin/service behavior changes; it opens a localhost server and checks the Node 8 service contract. TV JS services must remain compatible with the device runtime, independently of the development Node version.

Runtime service settings are private and absent from a fresh checkout. A default build may fall back to example/empty configuration. For a deployable package, use your ignored `local.properties`, or capture the installed app's static configuration with the profiler as described below. Captured configuration stays under `.cache/tv-performance/`, with owner-only file permissions. Never commit it, SSH device keys, raw profiles, screenshots, or installed bundles; they can contain private or signed URLs.

```sh
NUVIO_LOCAL_PROPERTIES=.cache/tv-performance/tv-build.properties NUVIO_REQUIRE_LOCAL_PROPERTIES=1 npm run package:webos
```

The package is `space.nuvio.webos_1.2.2_all.ipk` for this baseline; check the current app version for future builds. Package files are ignored. Installing replaces the running app and needs authorization from the current task.

## Connect to the TV

Developer Mode and its SSH device configuration must already be available locally. Device aliases are machine-specific. Discover the current one rather than committing device credentials.

```sh
node node_modules/@webos-tools/cli/bin/ares-device.js --list
node node_modules/@webos-tools/cli/bin/ares-inspect.js -d 'DEVICE_ALIAS' space.nuvio.webos
```

Keep `ares-inspect` running. It prints a URL containing `?ws=localhost:PORT/devtools/page/TARGET`. The target/port changes after reinstall/relaunch. Set the matching WebSocket URL:

```sh
export NUVIO_CDP_URL='ws://127.0.0.1:PORT/devtools/page/TARGET'
npm run perf:tv -- --help
npm run perf:tv -- --ui-summary --player-state --cleanup-check
```

`--endpoint=ws://...` overrides the environment variable. Artifacts default to ignored `.cache/tv-performance/`; `--output-dir=PATH` overrides that directory. The profiler neither installs packages nor discovers SSH credentials. Use the locally installed CLI directly if the inherited npm inspect/install wrappers cannot find a global `ares-*` executable.

## Repeat the measured flows

Confirm the visible screen before acting. The UI summary reports active screens and visible focus; Home may remain mounted but hidden during playback. Allocated hidden DOM is not evidence that it continuously lays out. A dispatched click does not prove navigation or successful playback. Keep screenshots out of timed loops.

1. **Home navigation:** after Home has settled, focus Continue Watching and run `npm run perf:tv -- --measure`. This sends the same 16 right/left keys as the baseline, captures RAF intervals/long tasks/CPU samples, and exits 2 if p95 key-to-next-frame exceeds 100 ms or samples are incomplete. Handler timing is measured by capture listeners; the `--probe` window listener is better for keys stopped by the app.
2. **Search:** use visible sidebar keys or its selector to open Search. Run `npm run perf:tv -- --probe --type=abbott`. `--type` uses CDP text insertion, not the LG system keyboard; do not claim it measures the keyboard itself. Route opening must be included in a probe to measure it.
3. **Early streams:** from visible Home, run the command below. It selects the first available 720/1080-labelled card while skipping donation rows; check `pendingSources > 0`, then check `video.readyState=4` and nonzero dimensions. This is source-specific; a quality label cannot guarantee a playable codec/URL. Reset the app/search cache when a warm session would hide late-source behavior. Confirm Home is ready after reload before clicking.
4. **Pause/subtitles:** while real video is playing, run `npm run perf:tv -- --probe --press=MediaPlayPause,s,ArrowDown`. It pauses, opens subtitles, and moves focus without selecting a subtitle. Close the dialog afterward with `--press=Escape` and verify `--player-state` still shows paused video.
5. **Badge CPU:** `npm run perf:tv -- --badge-stats --badge-benchmark --baseline-ref=358d08c` compares the baseline/current pure matcher on the TV with its active rules and 24 synthetic descriptions. Confirm identical results. This isolates badge matching; it is not total stream-load time.
6. **Visibility:** `npm run perf:tv -- --css-smoke` checks computed visibility of animation-dependent components on the constrained build. Expect opacity 1 and animation none for the tested open/visible elements.

```sh
npm run perf:tv -- --probe --click='.home-continue-card[data-item-title="Abbott Elementary"]' --early-play --wait=10000 --player-state
npm run perf:tv -- --capture-build-config
```

Historical benchmarks and snapshots vary with warm caches, loaded source counts, and startup timing. Compare the same route, focus, stream, settled state, and rule settings. Report the number of keys/sources/cards alongside timing rather than promising a universal speedup.

## Diagnostic experiments and completion

`--no-motion`, `--no-effects`, `--constrained`, and `--prune-rows` change the current TV session before actions/probes. `--prune-rows` temporarily detaches rows after the first six; it is a causal experiment, not the implemented Home architecture. Overrides persist between runs until explicitly restored. Run one profiler at a time. On normal completion or an action error, the script stops its timing observers/RAF loops; a disconnected inspector can prevent remote cleanup.

After any experiment:

```sh
npm run perf:tv -- --restore --cleanup-check --player-state
```

Completion means: relevant unit/lint/build checks pass; the original TV flow improves without breaking focus, resume, subtitles, or early selection; diagnostic cleanup reports no temporary styles, detached rows, active probes, or saved class override; playback is left paused when the task is done. Update RESULTS.md with the device, app/build, sample counts, and remaining limitations. Do not claim Stremio parity from these samples. The inspected reference was the public `Stremio/stremio-web` repository, not the LG application source.
