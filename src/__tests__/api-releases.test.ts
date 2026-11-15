/**
 * Route-level test for GET /api/releases (New Releases feed).
 *
 * Mocks TMDB discover, library-status, and rate-limit so the test exercises
 * the route's own two-tier caching (24h raw pool / 60s post-filter) and
 * in-library exclusion, not the TMDB or *arr integrations themselves
 * (covered separately in tmdb-discover.test.ts and library-status.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// These routes need a signed-in user (0.28.0); signed in unless a test says otherwise.
const authMock = vi.hoisted(() => vi.fn(async (): Promise<{ user: { id: string; role: string } } | null> => ({ user: { id: "u1", role: "user" } })));
vi.mock("@/lib/auth/config", () => ({ auth: authMock }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() }),
  getClientIp: vi.fn().mockReturnValue("10.0.0.1"),
  RATE_LIMITS: {
    general: { limit: 60, windowSeconds: 60 },
  },
}));

const discoverRecentMovies = vi.fn();
const discoverRecentTv = vi.fn();
vi.mock("@/lib/search/tmdb", () => ({
  discoverRecentMovies: (...args: unknown[]) => discoverRecentMovies(...args),
  discoverRecentTv: (...args: unknown[]) => discoverRecentTv(...args),
}));

const getLibraryStatuses = vi.fn();
vi.mock("@/lib/services/library-status", () => ({
  getLibraryStatuses: (...args: unknown[]) => getLibraryStatuses(...args),
}));

function makeReq(): NextRequest {
  return { headers: new Headers() } as unknown as NextRequest;
}

describe("GET /api/releases", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    getLibraryStatuses.mockResolvedValue({});
    const { releasesCache, releasesFilteredCache } = await import("@/lib/cache");
    releasesCache.clear();
    releasesFilteredCache.clear();
  });

  it("returns movies and tv from TMDB discover when nothing is already in the library", async () => {
    discoverRecentMovies.mockResolvedValue([{ id: "1", mediaType: "movie", title: "M" }]);
    discoverRecentTv.mockResolvedValue([{ id: "2", mediaType: "tv", title: "T" }]);

    const { GET } = await import("@/app/api/releases/route");
    const res = await GET(makeReq());
    const data = await res.json();

    expect(data.movies).toHaveLength(1);
    expect(data.tv).toHaveLength(1);
  });

  it("excludes releases already available, monitored, or requested", async () => {
    discoverRecentMovies.mockResolvedValue([
      { id: "1", mediaType: "movie", title: "Already Monitored" },
      { id: "2", mediaType: "movie", title: "Not In Library" },
    ]);
    discoverRecentTv.mockResolvedValue([
      { id: "3", mediaType: "tv", title: "Already Requested" },
    ]);
    getLibraryStatuses.mockResolvedValue({
      "movie:1": "monitored",
      "tv:3": "requested",
    });

    const { GET } = await import("@/app/api/releases/route");
    const res = await GET(makeReq());
    const data = await res.json();

    expect(data.movies).toHaveLength(1);
    expect(data.movies[0].id).toBe("2");
    expect(data.tv).toHaveLength(0);
  });

  it("passes the combined movie+tv pool to getLibraryStatuses", async () => {
    discoverRecentMovies.mockResolvedValue([{ id: "1", mediaType: "movie", title: "M" }]);
    discoverRecentTv.mockResolvedValue([{ id: "2", mediaType: "tv", title: "T" }]);

    const { GET } = await import("@/app/api/releases/route");
    await GET(makeReq());

    expect(getLibraryStatuses).toHaveBeenCalledWith([
      { id: "1", mediaType: "movie" },
      { id: "2", mediaType: "tv" },
    ]);
  });

  it("serves the fully-cached (post-filter) response on an immediate second call without re-checking anything", async () => {
    discoverRecentMovies.mockResolvedValue([{ id: "1", mediaType: "movie", title: "M" }]);
    discoverRecentTv.mockResolvedValue([{ id: "2", mediaType: "tv", title: "T" }]);

    const { GET } = await import("@/app/api/releases/route");
    await GET(makeReq());
    const res2 = await GET(makeReq());
    const data2 = await res2.json();

    expect(data2.cached).toBe(true);
    expect(discoverRecentMovies).toHaveBeenCalledTimes(1);
    expect(getLibraryStatuses).toHaveBeenCalledTimes(1);
  });

  it("re-checks library status without re-hitting TMDB once only the 60s filter-cache has expired", async () => {
    discoverRecentMovies.mockResolvedValue([{ id: "1", mediaType: "movie", title: "M" }]);
    discoverRecentTv.mockResolvedValue([{ id: "2", mediaType: "tv", title: "T" }]);

    const { GET } = await import("@/app/api/releases/route");
    await GET(makeReq());

    // Simulate the 60s filter-cache expiring while the 24h raw-pool cache
    // (from TMDB) is still fresh.
    const { releasesFilteredCache } = await import("@/lib/cache");
    releasesFilteredCache.clear();

    const res2 = await GET(makeReq());
    const data2 = await res2.json();

    expect(data2.cached).toBeUndefined();
    expect(discoverRecentMovies).toHaveBeenCalledTimes(1); // raw pool still cached
    expect(getLibraryStatuses).toHaveBeenCalledTimes(2); // but re-checked
  });

  it("does NOT cache the raw pool when both TMDB calls come back empty (avoids poisoning cache during an outage)", async () => {
    discoverRecentMovies.mockResolvedValue([]);
    discoverRecentTv.mockResolvedValue([]);

    const { GET } = await import("@/app/api/releases/route");
    await GET(makeReq());

    const { releasesFilteredCache } = await import("@/lib/cache");
    releasesFilteredCache.clear();

    await GET(makeReq());
    expect(discoverRecentMovies).toHaveBeenCalledTimes(2);
  });

  it("returns 429 when rate-limited", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    (checkRateLimit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 5000,
    });

    const { GET } = await import("@/app/api/releases/route");
    const res = await GET(makeReq());
    expect(res.status).toBe(429);
  });
});
