import { compatibilityPolicy } from "./compatibilityPolicy.mjs";

// Builds target the oldest supported browser unless NUVIO_BUILD_CHROMIUM names
// a newer one. A raised target must also raise the package's runtime gate, so
// older TVs report "unsupported" instead of failing on missing features.
export function resolveBuildChromiumVersion(env = process.env) {
  const requested = Number.parseInt(env.NUVIO_BUILD_CHROMIUM || "", 10);
  return Number.isFinite(requested) && requested > compatibilityPolicy.chromiumVersion
    ? requested
    : compatibilityPolicy.chromiumVersion;
}
