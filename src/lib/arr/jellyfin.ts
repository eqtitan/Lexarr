import { arrFetch, ARR_TIMEOUT_MS } from "./_fetch";
import { serviceUrls } from "./urls";

const base = () => serviceUrls.jellyfin();

// Previously a bare fetch with no timeout -- the one integration that
// never got migrated onto the shared arrFetch helper (see its header
// comment: Prowlarr/Bazarr had the same bug and would hang indefinitely
// on a slow/hung Jellyfin, e.g. mid-library-scan). This also gives
// Jellyfin circuit-breaker protection for free.
export async function health() {
  return arrFetch<string>("Jellyfin", base(), "/health", {
    timeoutMs: ARR_TIMEOUT_MS,
  });
}
