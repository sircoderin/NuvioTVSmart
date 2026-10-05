# Development workflow

The main agent owns implementation, integration, failure diagnosis, and verification. Use subagents selectively for bounded, independent, primarily read-only investigations or reviews. Prefer explorers for repository investigation; delegate implementation only when the user explicitly requests it. Do not revert another contributor's changes.

For webOS performance work, TV profiling, or maintaining the performance fork, read [the continuation guide](docs/performance/CONTINUE.md) before changing runtime policy, Home, the stream picker, player controls, or the profiling script. Measured results and remaining limitations are in [RESULTS.md](docs/performance/RESULTS.md).

Keep runtime configuration in ignored `local.properties` or `.cache/`; commit source, tests, and documentation. Raw CPU profiles, screenshots, installed bundles, device keys, and packaged builds stay local.

Validate changes with the relevant unit tests and repository lint/build commands. TV performance claims require measurements on the actual device, with temporary probes and visual overrides cleaned up afterward.
