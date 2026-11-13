import pkg from "../../package.json";

/**
 * The current app version, sourced from package.json at build time.
 * Bumped in a release PR (see .changelog-rules.md).
 */
export const APP_VERSION: string = pkg.version;

export type ReleaseChannel = "alpha" | "beta" | "rc" | "stable";

/**
 * Derive the release channel from a SemVer string.
 *
 *   0.x.y           → "beta"   (pre-1.0)
 *   x.y.z-alpha.N   → "alpha"
 *   x.y.z-rc.N      → "rc"
 *   x.y.z           → "stable" (1.0.0 and up with no pre-release tag)
 *
 * Derivation happens at runtime from {@link APP_VERSION} so bumping
 * package.json flips the channel automatically — no second field to
 * keep in sync.
 */
export function getChannel(v: string = APP_VERSION): ReleaseChannel {
  if (/-alpha(\b|\.)/.test(v)) return "alpha";
  if (/-rc(\b|\.)/.test(v)) return "rc";
  if (/^0\./.test(v)) return "beta";
  return "stable";
}
