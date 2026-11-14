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

const getLibrary = vi.fn();
vi.mock("@/lib/arr/lazylibrarian", () => ({ getLibrary: (...a: unknown[]) => getLibrary(...a) }));

const auth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: (...a: unknown[]) => auth(...a) }));

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

/** OpenLibrary author search stub: three works per author, one by someone
 *  else and one without a cover. */
function olAuthorSearch(url: URL): Response {
  const author = url.searchParams.get("author") ?? "";
  const slug = author.replace(/\W/g, "");
  return json({
    docs: [
      { key: `/works/${slug}1`, title: `${author} One`, author_name: [author], cover_i: 11, first_publish_year: 2011 },
      { key: `/works/${slug}X`, title: "Study Guide", author_name: ["Someone Else"], cover_i: 12 },
      { key: `/works/${slug}2`, title: `${author} Two`, author_name: [author] },
      { key: `/works/${slug}3`, title: `${author} Three`, author_name: [author], cover_i: 13 },
      { key: `/works/${slug}4`, title: `${author} Four`, author_name: [author], cover_i: 14 },
      { key: `/works/${slug}5`, title: `${author} Five`, author_name: [author], cover_i: 15 },
    ],
  });
}

let svc: typeof import("@/lib/services/discover");

beforeEach(async () => {
  vi.clearAllMocks();
  calls.length = 0;
  getLibraryStatuses.mockResolvedValue({});
  getCalendarRange.mockResolvedValue([]);
  getLibrary.mockResolvedValue([]);
  auth.mockResolvedValue(null);
  handler = (url) => {
    if (url.hostname === "rss.marketingtools.apple.com") return json(CHART);
    if (url.hostname === "musicbrainz.org") return musicbrainz(url);
    if (url.hostname === "openlibrary.org" && url.pathname === "/search.json") return olAuthorSearch(url);
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

  it("tries the Apple chart up to 3 times (some connections to it hang)", async () => {
    const base = handler;
    let appleCalls = 0;
    handler = (url) => {
      if (url.hostname === "rss.marketingtools.apple.com" && ++appleCalls < 3) return json({}, 500);
      return base(url);
    };
    expect((await svc.chartAlbums()).map((a) => a.id)).toEqual(["rg-fresh", "rg-big"]);
    expect(appleCalls).toBe(3);

    appleCalls = -10; // every attempt fails
    await expect(svc.fetchAppleChart()).rejects.toThrow("Apple chart HTTP 500");
    expect(appleCalls).toBe(-7);
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
      if (url.hostname === "rss.marketingtools.apple.com") {
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

describe("from your artists (Lidarr calendar)", () => {
  const cal = (title: string, id: string, type: string, date: string, monitored = false) => ({
    title,
    foreignAlbumId: id,
    albumType: type,
    releaseDate: date,
    monitored,
    artist: { artistName: "X", foreignArtistId: "ar-x" },
  });

  it("splits albums and EPs into recent (newest first) and upcoming (soonest first), skipping singles", async () => {
    getCalendarRange.mockResolvedValue([
      cal("Old", "a1", "Album", "2026-10-01T00:00:00Z"),
      cal("Single", "a2", "Single", "2026-11-01T00:00:00Z"),
      cal("New EP", "a3", "EP", "2026-11-10T00:00:00Z", true),
      cal("Today", "a4", "Album", "2026-11-13T00:00:00Z"),
      cal("Far Off", "a5", "Album", "2027-01-20T00:00:00Z", true),
      cal("Next Week", "a6", "EP", "2026-11-20T00:00:00Z", true),
    ]);
    const { recent, upcoming } = await svc.artistCalendar(new Date("2026-11-13T12:00:00Z"));
    expect(recent.map((a) => a.title)).toEqual(["Today", "New EP", "Old"]);
    expect(upcoming.map((a) => a.title)).toEqual(["Next Week", "Far Off"]);
    expect(recent[1]).toMatchObject({ id: "a3", artistId: "ar-x", releaseType: "ep", releaseDate: "2026-11-10" });
    const [start, end] = getCalendarRange.mock.calls[0] as [Date, Date];
    expect(start.toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(end.toISOString().slice(0, 10)).toBe("2027-02-11");
  });
});

describe("from authors you follow", () => {
  it("uses Active LazyLibrarian authors (and ones with books), most books first", async () => {
    getLibrary.mockResolvedValue([
      { AuthorName: "Paused Nobody", Status: "Paused", HaveBooks: "0", TotalBooks: "40" },
      { AuthorName: "Big Active", Status: "Active", HaveBooks: "0", TotalBooks: "200" },
      { AuthorName: "Has One", Status: "Paused", HaveBooks: "1", TotalBooks: "3" },
      { AuthorName: "Small Active", Status: "Active", HaveBooks: "0", TotalBooks: "9" },
    ]);
    expect(await svc.followedAuthors()).toEqual(["Has One", "Big Active", "Small Active"]);
  });

  it("takes each author's top works with covers, by that author, in turns", async () => {
    getLibrary.mockResolvedValue([
      { AuthorName: "Ann Author", Status: "Active", HaveBooks: "2", TotalBooks: "10" },
      { AuthorName: "Bob Writer", Status: "Active", HaveBooks: "1", TotalBooks: "10" },
    ]);
    const books = await svc.authorBooks();
    expect(books.map((b) => b.title)).toEqual([
      "Ann Author One",
      "Bob Writer One",
      "Ann Author Three",
      "Bob Writer Three",
      "Ann Author Four",
      "Bob Writer Four",
    ]);
    expect(books[0]).toMatchObject({
      id: "/works/AnnAuthor1",
      mediaType: "book",
      artist: "Ann Author",
      year: "2011",
      posterUrl: "https://covers.openlibrary.org/b/id/11-M.jpg",
    });
  });

  it("asks for English editions and keeps one work per book title", async () => {
    getLibrary.mockResolvedValue([{ AuthorName: "Marcus Aurelius", Status: "Active" }]);
    const base = handler;
    let lang: string | null = null;
    handler = (url) => {
      if (url.pathname !== "/search.json") return base(url);
      lang = url.searchParams.get("language");
      const w = (key: string, title: string) => ({ key: `/works/${key}`, title, author_name: ["Marcus Aurelius"], cover_i: 1 });
      return json({
        docs: [
          w("M1", "Meditations"),
          w("M2", "Meditations"),
          w("M3", "The Meditations"),
          w("M4", "The Meditations of Marcus Aurelius"),
          w("M5", "Letters"),
        ],
      });
    };
    expect((await svc.authorBooks()).map((b) => b.id)).toEqual(["/works/M1", "/works/M5"]);
    expect(lang).toBe("eng");
  });

  it("skips an author whose search fails and keeps the rest", async () => {
    getLibrary.mockResolvedValue([
      { AuthorName: "Ann Author", Status: "Active" },
      { AuthorName: "Bob Writer", Status: "Active" },
    ]);
    const base = handler;
    handler = (url) => (url.searchParams.get("author") === "Ann Author" ? json({}, 500) : base(url));
    expect((await svc.authorBooks()).map((b) => b.artist)).toEqual(["Bob Writer", "Bob Writer", "Bob Writer"]);
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
    expect(data.sections.map((s: { id: string }) => s.id)).toEqual(["chart", "your-artists", "coming-soon"]);
    expect(data.sections[0].items.map((i: { id: string }) => i.id)).toEqual(["rg-fresh"]);
    // Music items carry their artist id so the per-album Lidarr check works.
    expect(getLibraryStatuses.mock.calls[0][0]).toContainEqual(
      expect.objectContaining({ id: "rg-fresh", artistId: "ar-rg-fresh" }),
    );
  });

  it("keeps monitored albums in the coming-soon calendar, but hides them from the other lists", async () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    getCalendarRange.mockResolvedValue([
      { title: "Soon", foreignAlbumId: "soon", albumType: "Album", releaseDate: soon, monitored: true, artist: { artistName: "X", foreignArtistId: "ar-x" } },
      { title: "Got It", foreignAlbumId: "got", albumType: "Album", releaseDate: past, monitored: true, artist: { artistName: "X", foreignArtistId: "ar-x" } },
    ]);
    getLibraryStatuses.mockResolvedValue({ "music:soon": "monitored", "music:got": "monitored" });
    const { GET } = await import("@/app/api/discover/route");
    const data = await (await GET(req("music"))).json();
    const byId = Object.fromEntries(data.sections.map((s: { id: string; items: { id: string }[] }) => [s.id, s.items.map((i) => i.id)]));
    expect(byId["coming-soon"]).toEqual(["soon"]);
    expect(byId["your-artists"]).toEqual([]);
    expect(typeof data.builtAt).toBe("string");
  });

  it("returns the book sections, author books included", async () => {
    getLibrary.mockResolvedValue([{ AuthorName: "Ann Author", Status: "Active" }]);
    const { GET } = await import("@/app/api/discover/route");
    const data = await (await GET(req("book"))).json();
    expect(data.sections.map((s: { id: string }) => s.id)).toEqual(["trending", "your-authors"]);
    expect(data.sections[1].items.map((i: { id: string }) => i.id)).toEqual([
      "/works/AnnAuthor1",
      "/works/AnnAuthor3",
      "/works/AnnAuthor4",
    ]);
  });

  it("POST rebuilds the lists for an admin and is refused for everyone else", async () => {
    const { GET, POST } = await import("@/app/api/discover/route");
    expect((await POST()).status).toBe(403);
    auth.mockResolvedValue({ user: { role: "user" } });
    expect((await POST()).status).toBe(403);

    await GET(req("book"));
    handler = (url) =>
      url.hostname === "openlibrary.org" && url.pathname !== "/search.json"
        ? json({ works: [{ key: "/works/OL8W", title: "Fresh Pick" }] })
        : json({}, 500);
    auth.mockResolvedValue({ user: { role: "admin" } });
    const res = await POST();
    expect(res.status).toBe(200);
    // The filtered 60s cache is dropped too, so the new list shows at once.
    const again = await (await GET(req("book"))).json();
    expect(again.sections[0].items.map((i: { id: string }) => i.id)).toEqual(["/works/OL8W"]);
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

  it("background refresh reports whether the chart and trending lists came back (to retry sooner)", async () => {
    expect(await svc.refreshDiscoverPools()).toBe(true);
    const base = handler;
    handler = (url) => (url.hostname === "rss.marketingtools.apple.com" ? json({}, 500) : base(url));
    getCalendarRange.mockResolvedValue([
      { title: "Mine", foreignAlbumId: "a1", albumType: "Album", releaseDate: "2026-11-01", monitored: false, artist: { artistName: "X", foreignArtistId: "ar-x" } },
    ]);
    expect(await svc.refreshDiscoverPools()).toBe(false);
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
