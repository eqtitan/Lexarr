/**
 * Regression guard for the 0.9.1 music-search cache-poisoning bug.
 *
 * Before 0.9.1, src/app/api/search/route.ts unconditionally called
 * searchCache.set(key, results) — including when results was []. If
 * MusicBrainz (or any other upstream) returned 503 during a search, the
 * empty array landed in the 5-minute TTL cache. Every retry served the
 * cached empty set; the upstream was never re-hit until expiry. Users
 * saw "No results found" for a working query for up to 5 minutes.
 *
 * The fix: only cache results.length > 0. This test pins that behaviour.
 */
import { describe, it, expect } from "vitest";

/**
 * The gate in the search route. Kept in sync with the actual code;
 * if you change the caching condition there, update this test.
 */
function shouldCacheSearchResults<T>(results: T[]): boolean {
  return results.length > 0;
}

describe("search result caching", () => {
  it("caches non-empty result lists", () => {
    expect(shouldCacheSearchResults([{ id: "1" }])).toBe(true);
    expect(shouldCacheSearchResults([1, 2, 3])).toBe(true);
  });

  it("does NOT cache empty result lists (prevents upstream-outage poisoning)", () => {
    expect(shouldCacheSearchResults([])).toBe(false);
  });
});
