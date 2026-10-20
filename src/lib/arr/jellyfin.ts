import { arrFetch, ARR_TIMEOUT_MS } from "./_fetch";
import { env } from "@/lib/env";

const base = () => env().JELLYFIN_URL || "http://your-server-ip:8096";

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
