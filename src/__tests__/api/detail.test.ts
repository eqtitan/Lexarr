/**
 * Route-level tests for /api/detail (M3 coverage push).
 *
 * This route calls global fetch() directly (TMDB, MusicBrainz,
 * OpenLibrary) rather than going through src/lib/search/*, so we stub
 * globalThis.fetch instead of mocking a module. Exercises id-format
 * validation per media type, cache hit, and the movie/tv/music/book
 * mapping branches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/cache", () => ({
  detailCache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
  RATE_LIMITS: { search: { limit: 30, windowSeconds: 60 } },
}));

function makeReq(url: string): NextRequest {
  const u = new URL(url);
  return {
    nextUrl: u,
    headers: new Headers(),
  } as unknown as NextRequest;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("GET /api/detail", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.resetAllMocks();
    const { detailCache } = await import("@/lib/cache");
    vi.mocked(detailCache.get).mockReturnValue(undefined);
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 429 when rate limited, without hitting any upstream API", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as never;

    const { GET } = await import("@/app/api/detail/route");
    const res = await GET(
      makeReq("http://localhost/api/detail?type=movie&id=157336"),
    );
    expect(res.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 400 when type or id is missing", async () => {
    const { GET } = await import("@/app/api/detail/route");
    const res = await GET(makeReq("http://localhost/api/detail?type=movie"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid type", async () => {
    const { GET } = await import("@/app/api/detail/route");
    const res = await GET(
      makeReq("http://localhost/api/detail?type=podcast&id=1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-numeric movie id", async () => {
    const { GET } = await import("@/app/api/detail/route");
    const res = await GET(
      makeReq("http://localhost/api/detail?type=movie&id=abc"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed music (MBID) id", async () => {
    const { GET } = await import("@/app/api/detail/route");
    const res = await GET(
      makeReq("http://localhost/api/detail?type=music&id=not-a-uuid"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed book id", async () => {
    const { GET } = await import("@/app/api/detail/route");
    const res = await GET(
      makeReq("http://localhost/api/detail?type=book&id=12345"),
    );
    expect(res.status).toBe(400);
  });

  it("returns a cached response without hitting fetch", async () => {
    const { detailCache } = await import("@/lib/cache");
    vi.mocked(detailCache.get).mockReturnValue({ title: "Cached Movie" });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as never;

    const { GET } = await import("@/app/api/detail/route");
    const res = await GET(
      makeReq("http://localhost/api/detail?type=movie&id=157336"),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.title).toBe("Cached Movie");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a movie detail response and caches it", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        title: "Interstellar",
        release_date: "2014-11-05",
        overview: "A team travels...",
        poster_path: "/poster.jpg",
        backdrop_path: "/backdrop.jpg",
        runtime: 169,
        genres: [{ id: 1, name: "Sci-Fi" }],
        credits: { cast: [{ name: "Matthew McConaughey", character: "Cooper", profile_path: null }] },
        vote_average: 8.6,
      }),
    ) as never;
    const { detailCache } = await import("@/lib/cache");

    const { GET } = await import("@/app/api/detail/route");
    const res = await GET(
      makeReq("http://localhost/api/detail?type=movie&id=157336"),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.title).toBe("Interstellar");
    expect(json.year).toBe("2014");
    expect(json.genres).toEqual(["Sci-Fi"]);
    expect(vi.mocked(detailCache.set)).toHaveBeenCalled();
  });

  it("returns 500 when the upstream TMDB call fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}, false, 500)) as never;

    const { GET } = await import("@/app/api/detail/route");
    const res = await GET(
      makeReq("http://localhost/api/detail?type=movie&id=157336"),
    );
    expect(res.status).toBe(500);
  });

  it("maps a music release-group detail response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "b84ac3c9-9c17-4370-b7e2-df91769c0e18",
        title: "OK Computer",
        "first-release-date": "1997-05-21",
        "artist-credit": [{ name: "Radiohead" }],
        "primary-type": "Album",
        "secondary-types": [],
      }),
    ) as never;

    const { GET } = await import("@/app/api/detail/route");
    const res = await GET(
      makeReq(
        "http://localhost/api/detail?type=music&id=b84ac3c9-9c17-4370-b7e2-df91769c0e18",
      ),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.title).toBe("OK Computer");
    expect(json.artist).toBe("Radiohead");
  });

  it("maps a book detail response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        title: "Dune",
        description: "A sci-fi epic.",
        covers: [12345],
      }),
    ) as never;

    const { GET } = await import("@/app/api/detail/route");
    const res = await GET(
      makeReq("http://localhost/api/detail?type=book&id=OL27448W"),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.title).toBe("Dune");
    expect(json.posterUrl).toContain("12345");
  });
});
