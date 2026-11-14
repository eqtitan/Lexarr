/**
 * Music / Books discovery: Apple chart → MusicBrainz matching, the Lidarr
 * "new from your artists" list, OpenLibrary trending, the 24h pool cache,
 * and GET /api/discover's in-library filtering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() }),
  getClientIp: vi.fn().mockReturnValue("10.0.0.1"),
  RATE_LIMITS: { general: { limit: 60, windowSeconds: 60 } },
}));

const getCalendarRange = vi.fn();
vi.mock("@/lib/arr/lidarr", () => ({ getCalendarRange: (...a: unknown[]) => getCalendarRange(...a) }));

const getLibraryStatuses = vi.fn();
vi.mock("@/lib/services/library-status", () => ({
  getLibraryStatuses: (...a: unknown[]) => getLibraryStatuses(...a),
}));

const realFetch = globalThis.fetch;
type Handler = (url: URL) => Response | Promise<Response>;
let handler: Handler;
const calls: string[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const CHART = {
  feed: {
    results: [
      { artistName: "Lil Baby", name: "FRESH" },
      { artistName: "Some Artist & Friend", name: "Big Record (Deluxe Edition)" },
      { artistName: "Nobody Known", name: "Not On MusicBrainz" },
    ],
  },
};

function rg(id: string, title: string, artist: string) {
  return {
    id,
    title,
    "primary-type": "Album",
    "first-release-date": "2026-11-01",
    "artist-credit": [{ name: artist, artist: { id: `ar-${id}` } }],
  };
}

/** MusicBrainz stub: answers by the releasegroup title in the query. */
function musicbrainz(url: URL): Response {
  const q = url.searchParams.get("query") ?? "";
  if (q.includes('"FRESH"')) {
    // A same-title album by someone else comes first; the matcher must skip it.
    return json({ "release-groups": [rg("wrong", "Fresh", "Other Band"), rg("rg-fresh", "Fresh", "Lil Baby")] });
  }
  if (q.includes('"Big Record"')) return json({ "release-groups": [rg("rg-big", "Big Record", "Some Artist")] });
  return json({ "release-groups": [] });
}

let svc: typeof import("@/lib/services/discover");

beforeEach(async () => {
  vi.clearAllMocks();
  calls.length = 0;
  getLibraryStatuses.mockResolvedValue({});
  getCalendarRange.mockResolvedValue([]);
  handler = (url) => {
    if (url.hostname === "rss.applemarketingtools.com") return json(CHART);
    if (url.hostname === "musicbrainz.org") return musicbrainz(url);
    if (url.hostname === "openlibrary.org") {
      return json({
        works: [
          { key: "/works/OL1W", title: "Atomic Habits", author_name: ["James Clear"], cover_i: 1, first_publish_year: 2018 },
          { key: "/works/OL1W", title: "Atomic Habits (dup)" },
          { key: "/authors/OL9A", title: "Not a work" },
          { key: "/works/OL2W", title: "No Cover" },
        ],
      });
    }
    return json({}, 404);
  };
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.hostname);
    return handler(url);
  }) as typeof fetch;
  svc = await import("@/lib/services/discover");
  svc.__testing.reset();
  svc.__testing.setSleep(async () => {});
  const { discoverFilteredCache } = await import("@/lib/cache");
  discoverFilteredCache.clear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("chart albums", () => {
  it("matches chart albums to MusicBrainz by artist and title, in chart order, dropping misses", async () => {
    const albums = await svc.chartAlbums();
    expect(albums.map((a) => a.id)).toEqual(["rg-fresh", "rg-big"]);
    expect(albums[0]).toMatchObject({
      mediaType: "music",
      title: "Fresh",
      artist: "Lil Baby",
      artistId: "ar-rg-fresh",
      releaseType: "album",
      posterUrl: "https://coverartarchive.org/release-group/rg-fresh/front-250",
    });
  });

  it("remembers matches and misses, so the next refresh skips MusicBrainz", async () => {
    await svc.chartAlbums();
    const first = calls.filter((h) => h === "musicbrainz.org").length;
    expect(first).toBe(3);
    await svc.chartAlbums();
    expect(calls.filter((h) => h === "musicbrainz.org").length).toBe(first);
  });

  it("does not remember a miss caused by MusicBrainz being down", async () => {
    const base = handler;
    handler = (url) => (url.hostname === "musicbrainz.org" ? json({}, 503) : base(url));
    expect(await svc.chartAlbums()).toEqual([]);
    handler = base;
    expect((await svc.chartAlbums()).map((a) => a.id)).toEqual(["rg-fresh", "rg-big"]);
  });

  it("retries a lookup once when MusicBrainz sheds load", async () => {
    const base = handler;
    let failed = 0;
    handler = (url) => {
      if (url.hostname === "musicbrainz.org" && (url.searchParams.get("query") ?? "").includes('"FRESH"') && failed++ === 0) {
        return json({}, 503);
      }
      return base(url);
    };
    expect((await svc.chartAlbums()).map((a) => a.id)).toEqual(["rg-fresh", "rg-big"]);
  });

  it("falls back to the title before a colon for editions", async () => {
    const base = handler;
    handler = (url) => {
      if (url.hostname === "rss.applemarketingtools.com") {
        return json({ feed: { results: [{ artistName: "Lil Baby", name: "FRESH: The Encore" }] } });
      }
      return base(url);
    };
    expect((await svc.chartAlbums()).map((a) => a.id)).toEqual(["rg-fresh"]);
  });

  it("waits between uncached MusicBrainz lookups (1 request a second)", async () => {
    const waits: number[] = [];
    svc.__testing.setSleep(async (ms) => {
      waits.push(ms);
    });
    await svc.chartAlbums();
    expect(waits).toHaveLength(2);
    expect(waits.every((ms) => ms >= 1000)).toBe(true);
  });
});

describe("new from your artists", () => {
  it("lists albums and EPs by Lidarr artists, newest first, skipping singles", async () => {
    getCalendarRange.mockResolvedValue([
      { title: "Old", foreignAlbumId: "a1", albumType: "Album", releaseDate: "2026-10-01T00:00:00Z", monitored: false, artist: { artistName: "X", foreignArtistId: "ar-x" } },
      { title: "Single", foreignAlbumId: "a2", albumType: "Single", releaseDate: "2026-11-01T00:00:00Z", monitored: false, artist: { artistName: "X", foreignArtistId: "ar-x" } },
      { title: "New EP", foreignAlbumId: "a3", albumType: "EP", releaseDate: "2026-11-10T00:00:00Z", monitored: true, artist: { artistName: "Y", foreignArtistId: "ar-y" } },
    ]);
    const list = await svc.yourArtistsAlbums(new Date("2026-11-13T00:00:00Z"));
    expect(list.map((a) => a.title)).toEqual(["New EP", "Old"]);
    expect(list[0]).toMatchObject({ id: "a3", artistId: "ar-y", releaseType: "ep", releaseDate: "2026-11-10" });
    const [start, end] = getCalendarRange.mock.calls[0] as [Date, Date];
    expect(start.toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(end.toISOString().slice(0, 10)).toBe("2026-12-13");
  });
});

describe("trending books", () => {
  it("returns OpenLibrary works with the same ids book search uses, de-duplicated", async () => {
    const books = await svc.trendingBooks();
    expect(books.map((b) => b.id)).toEqual(["/works/OL1W", "/works/OL2W"]);
    expect(books[0]).toMatchObject({
      mediaType: "book",
      title: "Atomic Habits",
      artist: "James Clear",
      year: "2018",
      posterUrl: "https://covers.openlibrary.org/b/id/1-M.jpg",
    });
    expect(books[1].posterUrl).toBeUndefined();
  });
});

describe("GET /api/discover", () => {
  const req = (type?: string) =>
    ({
      headers: new Headers(),
      nextUrl: new URL(`http://x/api/discover${type ? `?type=${type}` : ""}`),
    }) as unknown as NextRequest;

  it("rejects an unknown type", async () => {
    const { GET } = await import("@/app/api/discover/route");
    expect((await GET(req("movie"))).status).toBe(400);
    expect((await GET(req())).status).toBe(400);
  });

  it("returns the music sections without albums already in the library", async () => {
    getLibraryStatuses.mockResolvedValue({ "music:rg-big": "monitored" });
    const { GET } = await import("@/app/api/discover/route");
    const data = await (await GET(req("music"))).json();
    expect(data.sections.map((s: { id: string }) => s.id)).toEqual(["chart", "your-artists"]);
    expect(data.sections[0].items.map((i: { id: string }) => i.id)).toEqual(["rg-fresh"]);
    // Music items carry their artist id so the per-album Lidarr check works.
    expect(getLibraryStatuses.mock.calls[0][0]).toContainEqual(
      expect.objectContaining({ id: "rg-fresh", artistId: "ar-rg-fresh" }),
    );
  });

  it("returns empty sections (not an error) when every source is down, and doesn't cache them", async () => {
    handler = () => json({}, 500);
    getCalendarRange.mockRejectedValue(new Error("Lidarr down"));
    const { GET } = await import("@/app/api/discover/route");
    const res = await GET(req("book"));
    expect(res.status).toBe(200);
    expect((await res.json()).sections[0].items).toEqual([]);

    handler = (url) =>
      url.hostname === "openlibrary.org" ? json({ works: [{ key: "/works/OL5W", title: "Back" }] }) : json({}, 500);
    const again = await (await GET(req("book"))).json();
    expect(again.sections[0].items.map((i: { id: string }) => i.id)).toEqual(["/works/OL5W"]);
  });

  it("background refresh rebuilds a cached pool, and a failed rebuild keeps the old one", async () => {
    expect((await svc.getDiscoverPool("book"))[0].items.map((i) => i.id)).toEqual(["/works/OL1W", "/works/OL2W"]);

    handler = (url) =>
      url.hostname === "openlibrary.org" ? json({ works: [{ key: "/works/OL7W", title: "New This Week" }] }) : json({}, 500);
    await svc.refreshDiscoverPools();
    expect((await svc.getDiscoverPool("book"))[0].items.map((i) => i.id)).toEqual(["/works/OL7W"]);

    handler = () => json({}, 500);
    await svc.refreshDiscoverPools();
    expect((await svc.getDiscoverPool("book"))[0].items.map((i) => i.id)).toEqual(["/works/OL7W"]);
  });

  it("keeps the raw lists for a day: a second load doesn't refetch the sources", async () => {
    const { GET } = await import("@/app/api/discover/route");
    await GET(req("book"));
    const { discoverFilteredCache } = await import("@/lib/cache");
    discoverFilteredCache.clear();
    const before = calls.length;
    await GET(req("book"));
    expect(calls.length).toBe(before);
  });
});
