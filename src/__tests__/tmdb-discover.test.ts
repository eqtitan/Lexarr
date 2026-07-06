/**
 * Tests for the New Releases feed's TMDB discover helpers
 * (src/lib/search/tmdb.ts: discoverRecentMovies / discoverRecentTv).
 *
 * KEY is read from process.env at module import time, so tests that need
 * a real key must reset modules and re-import — same pattern as env.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const realFetch = globalThis.fetch;
const originalEnv = process.env;

function mockFetch(body: unknown, ok = true) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: ok ? 200 : 500,
      }),
  ) as typeof fetch;
}

/** A date guaranteed to fall inside the rolling 6-month window at test
 *  run time, regardless of when the suite is run. */
function recentIsoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv, TMDB_API_KEY: "test-tmdb-key" };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe("discoverRecentMovies", () => {
  it("maps TMDB discover results into SearchResult shape", async () => {
    const releaseDate = recentIsoDate(30);
    mockFetch({
      results: [
        {
          id: 603,
          title: "The Matrix Resurrections 2",
          release_date: releaseDate,
          overview: "A".repeat(300),
          poster_path: "/poster.jpg",
          vote_average: 7.456,
        },
      ],
    });
    const { discoverRecentMovies } = await import("@/lib/search/tmdb");
    const results = await discoverRecentMovies();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "603",
      mediaType: "movie",
      title: "The Matrix Resurrections 2",
      year: releaseDate.slice(0, 4),
      releaseDate,
      posterUrl: "https://image.tmdb.org/t/p/w300/poster.jpg",
      rating: 7.5,
    });
    // overview is truncated to 200 chars
    expect(results[0].overview).toHaveLength(200);
  });

  it("filters out results with no poster (low-confidence/placeholder entries)", async () => {
    mockFetch({
      results: [
        { id: 1, title: "No Poster", release_date: recentIsoDate(10) },
        { id: 2, title: "Has Poster", release_date: recentIsoDate(11), poster_path: "/p.jpg" },
      ],
    });
    const { discoverRecentMovies } = await import("@/lib/search/tmdb");
    const results = await discoverRecentMovies();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("2");
  });

  it("filters out results whose release date falls outside the 6-month window", async () => {
    mockFetch({
      results: [
        { id: 1, title: "Too Old", release_date: recentIsoDate(400), poster_path: "/p.jpg" },
        { id: 2, title: "Future", release_date: recentIsoDate(-30), poster_path: "/p.jpg" },
        { id: 3, title: "In Range", release_date: recentIsoDate(10), poster_path: "/p.jpg" },
      ],
    });
    const { discoverRecentMovies } = await import("@/lib/search/tmdb");
    const results = await discoverRecentMovies();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("3");
  });

  it("requests a ~6-month primary_release_date window sorted by popularity, without a region param, across multiple pages", async () => {
    const capturedUrls: string[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrls.push(String(url));
      return new Response(JSON.stringify({ results: [] }));
    }) as typeof fetch;

    const { discoverRecentMovies } = await import("@/lib/search/tmdb");
    await discoverRecentMovies();

    expect(capturedUrls).toHaveLength(3);
    const pageNumbers = capturedUrls
      .map((u) => new URL(u).searchParams.get("page"))
      .sort();
    expect(pageNumbers).toEqual(["1", "2", "3"]);

    const params = new URL(capturedUrls[0]).searchParams;
    // No `region` param — see the doc comment on discoverRecentMovies for why.
    expect(params.get("region")).toBeNull();
    // Sorted by popularity, not release date — see doc comment for why.
    expect(params.get("sort_by")).toBe("popularity.desc");

    expect(params.get("release_date.gte")).toBeNull();
    const gte = new Date(params.get("primary_release_date.gte")!);
    const lte = new Date(params.get("primary_release_date.lte")!);
    const monthsSpan =
      (lte.getFullYear() - gte.getFullYear()) * 12 +
      (lte.getMonth() - gte.getMonth());
    expect(monthsSpan).toBe(6);
  });

  it("re-sorts the popularity-ordered pool by release date, newest first", async () => {
    mockFetch({
      results: [
        { id: 1, title: "Older", release_date: recentIsoDate(60), poster_path: "/p1.jpg" },
        { id: 2, title: "Newest", release_date: recentIsoDate(5), poster_path: "/p2.jpg" },
        { id: 3, title: "Middle", release_date: recentIsoDate(30), poster_path: "/p3.jpg" },
      ],
    });
    const { discoverRecentMovies } = await import("@/lib/search/tmdb");
    const results = await discoverRecentMovies();
    expect(results.map((r) => r.title)).toEqual(["Newest", "Middle", "Older"]);
  });

  it("dedupes results that appear on more than one page", async () => {
    mockFetch({
      results: [{ id: 1, title: "Dup", release_date: recentIsoDate(5), poster_path: "/p.jpg" }],
    });
    const { discoverRecentMovies } = await import("@/lib/search/tmdb");
    const results = await discoverRecentMovies();
    expect(results).toHaveLength(1);
  });

  it("returns an empty array when TMDB_API_KEY is unset", async () => {
    process.env = { ...originalEnv, TMDB_API_KEY: "" };
    vi.resetModules();
    const { discoverRecentMovies } = await import("@/lib/search/tmdb");
    const results = await discoverRecentMovies();
    expect(results).toEqual([]);
  });

  it("returns an empty array on a non-ok TMDB response", async () => {
    mockFetch({}, false);
    const { discoverRecentMovies } = await import("@/lib/search/tmdb");
    const results = await discoverRecentMovies();
    expect(results).toEqual([]);
  });
});

describe("discoverRecentTv", () => {
  it("maps TMDB discover/tv results using first_air_date", async () => {
    const airDate = recentIsoDate(15);
    mockFetch({
      results: [
        {
          id: 9999,
          name: "Some New Show",
          first_air_date: airDate,
          poster_path: "/tv.jpg",
          vote_average: 8.2,
        },
      ],
    });
    const { discoverRecentTv } = await import("@/lib/search/tmdb");
    const results = await discoverRecentTv();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "9999",
      mediaType: "tv",
      title: "Some New Show",
      year: airDate.slice(0, 4),
      releaseDate: airDate,
      posterUrl: "https://image.tmdb.org/t/p/w300/tv.jpg",
    });
  });

  it("is sorted by popularity server-side, then re-sorted by first_air_date for display", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (!capturedUrl) capturedUrl = String(url);
      return new Response(JSON.stringify({ results: [] }));
    }) as typeof fetch;

    const { discoverRecentTv } = await import("@/lib/search/tmdb");
    await discoverRecentTv();

    const params = new URL(capturedUrl).searchParams;
    expect(params.get("sort_by")).toBe("popularity.desc");
  });

  it("re-sorts the popularity-ordered pool by first_air_date, newest first", async () => {
    mockFetch({
      results: [
        { id: 1, name: "Older Show", first_air_date: recentIsoDate(60), poster_path: "/p1.jpg" },
        { id: 2, name: "Newest Show", first_air_date: recentIsoDate(5), poster_path: "/p2.jpg" },
      ],
    });
    const { discoverRecentTv } = await import("@/lib/search/tmdb");
    const results = await discoverRecentTv();
    expect(results.map((r) => r.title)).toEqual(["Newest Show", "Older Show"]);
  });
});
