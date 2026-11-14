/**
 * Simple in-memory cache with TTL for search results and API responses.
 * Reduces load on TMDB, MusicBrainz, OpenLibrary, etc.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class TTLCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(defaultTtlMs: number = 5 * 60 * 1000, maxEntries: number = 500) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: T, ttlMs?: number): void {
    // Evict the oldest entry if we're at the limit -- but only when this
    // is a genuinely new key. Refreshing an existing entry at capacity
    // shouldn't evict an unrelated one just because Map.size hasn't
    // changed yet.
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// Search results cache: 5 minute TTL
export const searchCache = new TTLCache(5 * 60 * 1000, 200);

// Detail/metadata cache: 15 minute TTL (movie details change rarely)
export const detailCache = new TTLCache(15 * 60 * 1000, 100);

// Service health cache: 30 second TTL (health checks are frequent)
export const healthCache = new TTLCache(30 * 1000, 20);

// Library status cache: 60 second TTL (arr libraries change infrequently)
export const libraryCache = new TTLCache(60 * 1000, 50);

// New-releases feed cache: 24h TTL (rolling 6-month window only needs to
// shift once a day; avoids hammering TMDB discover on every page load).
export const releasesCache = new TTLCache(24 * 60 * 60 * 1000, 5);

// New-releases feed, post library-status filtering: 60s TTL. Deliberately
// much shorter than releasesCache — a request made mid-day should stop
// appearing in the feed within a minute, not up to a day later.
export const releasesFilteredCache = new TTLCache(60 * 1000, 5);

// Next.js bundles instrumentation.ts and the API routes separately, so a
// plain module-level cache exists once per bundle. Caches that the
// background refresh (instrumentation) fills for the routes to read must
// live on globalThis to be shared.
const shared = globalThis as typeof globalThis & {
  __lexarrDiscoverCache?: TTLCache;
  __lexarrMbMatchCache?: TTLCache<unknown>;
};

// Music/Books discovery lists (Apple chart, Lidarr calendar, OpenLibrary
// trending): 24h raw (shared, see above), 60s after library filtering
// (route only), the same split as releases.
export const discoverCache = (shared.__lexarrDiscoverCache ??= new TTLCache(24 * 60 * 60 * 1000, 10));
export const discoverFilteredCache = new TTLCache(60 * 1000, 10);

// Chart album → MusicBrainz match (null = MusicBrainz had no match). 7 days:
// the chart turns over slowly, so the daily refresh is mostly cache hits.
export const mbMatchCache = (shared.__lexarrMbMatchCache ??= new TTLCache<unknown>(7 * 24 * 60 * 60 * 1000, 500));

// Artist listener count cache: 24h TTL (Last.fm popularity moves slowly
// enough that day-old data is fine; we cache nulls as well to avoid
// re-fetching for artists Last.fm doesn't know about).
export const lastfmCache = new TTLCache<number | null>(
  24 * 60 * 60 * 1000,
  1000,
);

// Plex pin-auth session cache: maps an opaque, server-generated session
// token (set as an httpOnly cookie) to the real Plex pin id. The pin id
// itself is never trusted from the client — see src/app/api/auth/plex/route.ts.
// 10 minute TTL matches Plex's own pin expiry.
export const plexPinSessionCache = new TTLCache<number>(10 * 60 * 1000, 500);
