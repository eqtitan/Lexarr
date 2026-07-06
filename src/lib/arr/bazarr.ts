import { arrFetch } from "./_fetch";

const BASE = process.env.BAZARR_URL || "http://your-server-ip:6767";
const KEY = process.env.BAZARR_API_KEY!;

// Unused helper kept for future Bazarr endpoints; underscore prefix keeps
// it from being exported accidentally and signals intent.
function _api<T = unknown>(path: string) {
  return arrFetch<T>("Bazarr", BASE, path, {
    headers: { "X-API-KEY": KEY },
  });
}
void _api; // silence unused-var lint

export async function health() {
  // /health is unauthenticated and always returns 200 when Bazarr is up.
  // Use arrFetch so we get the shared 15s timeout.
  return arrFetch<string>("Bazarr", BASE, "/health");
}
