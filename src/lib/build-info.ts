import { APP_VERSION } from "@/lib/version";
import { env } from "@/lib/env";

/**
 * Build-time metadata for the running Lexarr process.
 *
 * `version` always comes from package.json (via {@link APP_VERSION}) so it
 * can never drift from the file that actually defines it — there is no
 * second version string to keep in sync.
 *
 * `gitSha` and `buildTime` come from environment variables that the
 * Dockerfile sets from `--build-arg GIT_SHA=...` / `--build-arg
 * BUILD_TIME=...` at image build time (see the `builder`/`runner` stages).
 * Nobody has to remember to bump these by hand — whatever built the image
 * stamped them in, and if they weren't passed we fall back to "unknown"
 * rather than throwing. That fallback also means `npm run dev` and plain
 * `npm run build` (outside Docker) work fine without setting anything.
 */
export interface BuildInfo {
  version: string;
  gitSha: string;
  buildTime: string;
}

export function getBuildInfo(): BuildInfo {
  return {
    version: APP_VERSION,
    gitSha: env().GIT_SHA ?? "unknown",
    buildTime: env().BUILD_TIME ?? "unknown",
  };
}
