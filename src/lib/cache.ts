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
    // Evict oldest entries if we hit the limit
    if (this.store.size >= this.maxEntries) {
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
