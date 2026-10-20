/**
 * Route-level tests for /api/search (M3 coverage push).
 *
 * Mocks the three search source modules + cache + rate-limit + settings
 * at the boundary. Exercises rate limiting, short-query short-circuit,
 * per-type filtering (TMDB returns mixed movie/tv), cache hit/miss, and
 * the graceful-degradation `.catch(() => [])` on each source.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/search/tmdb", () => ({
  search: vi.fn(),
}));
vi.mock("@/lib/search/musicbrainz", () => ({
  search: vi.fn(),
}));
vi.mock("@/lib/search/openlib", () => ({
  search: vi.fn(),
}));
vi.mock("@/lib/cache", () => ({
  searchCache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn().mockReturnValue("10.0.0.1"),
  RATE_LIMITS: { search: { limit: 30, windowSeconds: 60 } },
}));
vi.mock("@/lib/settings", () => ({
  getAllowedRegions: vi.fn().mockResolvedValue([]),
}));

function makeReq(url: string): NextRequest {
  const u = new URL(url);
  return {
    headers: new Headers(),
    nextUrl: u,
  } as unknown as NextRequest;
}

describe("GET /api/search", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 29,
      resetAt: Date.now(),
    });
    const { searchCache } = await import("@/lib/cache");
    vi.mocked(searchCache.get).mockReturnValue(undefined);
    const settings = await import("@/lib/settings");
    vi.mocked(settings.getAllowedRegions).mockResolvedValue([]);
  });

  it("returns 429 when rate-limited", async () => {
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 5000,
    });

    const { GET } = await import("@/app/api/search/route");
    const res = await GET(makeReq("http://localhost/api/search?q=matrix"));
    expect(res.status).toBe(429);
  });

  it("returns empty results for queries under 2 chars", async () => {
    const { GET } = await import("@/app/api/search/route");
    const res = await GET(makeReq("http://localhost/api/search?q=a"));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.results).toEqual([]);
  });

  it("returns empty results with no query", async () => {
    const { GET } = await import("@/app/api/search/route");
    const res = await GET(makeReq("http://localhost/api/search"));
    const json = await (res as Response).json();
    expect(json.results).toEqual([]);
  });

  it("returns a cached response without calling any source", async () => {
    const { searchCache } = await import("@/lib/cache");
    vi.mocked(searchCache.get).mockReturnValue([{ id: "1", mediaType: "movie" }]);
    const tmdb = await import("@/lib/search/tmdb");

    const { GET } = await import("@/app/api/search/route");
    const res = await GET(makeReq("http://localhost/api/search?q=matrix"));
    const json = await (res as Response).json();
    expect(json.cached).toBe(true);
    expect(json.results).toHaveLength(1);
    expect(vi.mocked(tmdb.search)).not.toHaveBeenCalled();
  });

  it("queries all three sources with no type filter", async () => {
    const tmdb = await import("@/lib/search/tmdb");
    const musicbrainz = await import("@/lib/search/musicbrainz");
    const openlib = await import("@/lib/search/openlib");
    vi.mocked(tmdb.search).mockResolvedValue([
      { id: "1", mediaType: "movie", title: "Matrix" } as never,
    ]);
    vi.mocked(musicbrainz.search).mockResolvedValue([]);
    vi.mocked(openlib.search).mockResolvedValue([]);

    const { GET } = await import("@/app/api/search/route");
    const res = await GET(makeReq("http://localhost/api/search?q=matrix"));
    expect(res.status).toBe(200);
    expect(vi.mocked(tmdb.search)).toHaveBeenCalled();
    expect(vi.mocked(musicbrainz.search)).toHaveBeenCalled();
    expect(vi.mocked(openlib.search)).toHaveBeenCalled();
  });

  it("filters TMDB's mixed movie/tv results down to the requested type", async () => {
    const tmdb = await import("@/lib/search/tmdb");
    vi.mocked(tmdb.search).mockResolvedValue([
      { id: "1", mediaType: "movie", title: "Matrix Movie" } as never,
      { id: "2", mediaType: "tv", title: "Matrix Show" } as never,
    ]);

    const { GET } = await import("@/app/api/search/route");
    const res = await GET(
      makeReq("http://localhost/api/search?q=matrix&type=movie"),
    );
    const json = await (res as Response).json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].mediaType).toBe("movie");
  });

  it("degrades gracefully when a source rejects", async () => {
    const tmdb = await import("@/lib/search/tmdb");
    vi.mocked(tmdb.search).mockRejectedValue(new Error("TMDB down"));

    const { GET } = await import("@/app/api/search/route");
    const res = await GET(
      makeReq("http://localhost/api/search?q=matrix&type=movie"),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.results).toEqual([]);
  });

  it("does not cache empty results", async () => {
    const tmdb = await import("@/lib/search/tmdb");
    vi.mocked(tmdb.search).mockResolvedValue([]);
    const { searchCache } = await import("@/lib/cache");

    const { GET } = await import("@/app/api/search/route");
    await GET(makeReq("http://localhost/api/search?q=matrix&type=movie"));
    expect(vi.mocked(searchCache.set)).not.toHaveBeenCalled();
  });

  it("applies the music sub-filter post-search", async () => {
    const musicbrainz = await import("@/lib/search/musicbrainz");
    vi.mocked(musicbrainz.search).mockResolvedValue([
      { id: "1", mediaType: "music", releaseType: "single" } as never,
      { id: "2", mediaType: "music", releaseType: "album" } as never,
    ]);

    const { GET } = await import("@/app/api/search/route");
    const res = await GET(
      makeReq("http://localhost/api/search?q=song&type=music&sub=single"),
    );
    const json = await (res as Response).json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].releaseType).toBe("single");
  });
});
