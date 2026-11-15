/**
 * Music and Books discovery lists for the home page's Music / Books chips.
 *
 * Music:
 *   - "Popular new albums": Apple Music's public US most-played albums
 *     chart, each album matched to its MusicBrainz release group, so a card
 *     is exactly a music search result (same id, artist id and cover) and
 *     requests the same way. Albums MusicBrainz can't match are dropped,
 *     never guessed.
 *   - "New from your artists": albums by artists already in Lidarr that
 *     came out in the last 60 days and nobody has asked for yet.
 *   - "Coming soon from your artists": albums and EPs those artists have
 *     due in the next 90 days. Shown even when Lidarr already monitors
 *     them (with their status badge), so it works as a calendar.
 * Books:
 *   - "Trending books": OpenLibrary's weekly trending works. Same OL work
 *     keys book search uses.
 *   - "From authors you follow": the most-read OpenLibrary works by the
 *     authors marked Active (or with books) in LazyLibrarian.
 *
 * Every source is best-effort: a failure gives an empty section (the page
 * then shows its "search for it" hint) and is not cached, so the next load
 * tries again.
 */
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { discoverCache, mbMatchCache } from "@/lib/cache";
import { getPersistent, setPersistent } from "@/lib/persistent-cache";
import { findAlbumReleaseGroup } from "@/lib/search/musicbrainz";
import * as lidarr from "@/lib/arr/lidarr";
import * as lazylibrarian from "@/lib/arr/lazylibrarian";
import type { SearchResult } from "@/types";

export type DiscoverType = "music" | "book";

export interface DiscoverSection {
  id: "chart" | "your-artists" | "coming-soon" | "trending" | "your-authors";
  title: string;
  subtitle: string;
  items: SearchResult[];
  /** Show items even if they're already in the library or requested (the
   *  route normally hides those). */
  keepOwned?: boolean;
}

const DAY = 24 * 60 * 60 * 1000;
/** MusicBrainz allows anonymous clients one request a second. */
const MB_GAP_MS = 1100;
const MB_RETRY_MS = 3000;
/** Same lifetime as the in-memory mbMatchCache: a week. */
const MB_MATCH_TTL_MS = 7 * DAY;
const CHART_SIZE = 25;

const appleChartUrl = () => {
  const stub = env().DISCOVER_STUB_BASE;
  return stub
    ? `${stub}/apple/api/v2/us/music/most-played/${CHART_SIZE}/albums.json`
    : // rss.applemarketingtools.com 301s here; going direct saves a hop.
      `https://rss.marketingtools.apple.com/api/v2/us/music/most-played/${CHART_SIZE}/albums.json`;
};
/** Some connections to Apple's feed hang until the timeout (about 1 in 5
 *  from the dev server, curl and Node alike), so try a few times with a short wait. */
const APPLE_ATTEMPTS = 3;
const APPLE_TIMEOUT_MS = 8_000;
const openLibraryBase = () => {
  const stub = env().DISCOVER_STUB_BASE;
  return stub ? `${stub}/openlibrary` : "https://openlibrary.org";
};

let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Music: Apple chart → MusicBrainz ────────────────────────────────

interface AppleChartEntry {
  artistName?: string;
  name?: string;
}

export async function fetchAppleChart(): Promise<{ artist: string; title: string }[]> {
  let json: { feed?: { results?: AppleChartEntry[] } };
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(appleChartUrl(), { signal: AbortSignal.timeout(APPLE_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Apple chart HTTP ${res.status}`);
      json = await res.json();
      break;
    } catch (err: unknown) {
      if (attempt >= APPLE_ATTEMPTS) throw err;
      log.debug("discover: Apple chart attempt failed, retrying", { attempt, err });
    }
  }
  return (json.feed?.results ?? [])
    .filter((e) => e.artistName && e.name)
    .map((e) => ({ artist: e.artistName!, title: e.name! }));
}

/** Chart albums matched to MusicBrainz, in chart order. Cached matches cost
 *  nothing; uncached ones are looked up one a second. */
export async function chartAlbums(): Promise<SearchResult[]> {
  const chart = await fetchAppleChart();
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  let lookedUp = 0;
  const lookup = async (artist: string, title: string) => {
    if (lookedUp > 0) await sleep(MB_GAP_MS);
    lookedUp++;
    const m = await findAlbumReleaseGroup(artist, title);
    if (m !== undefined) return m;
    // MusicBrainz sheds load with a 503 now and then: one retry, after a
    // longer pause.
    await sleep(MB_RETRY_MS);
    return findAlbumReleaseGroup(artist, title);
  };
  for (const { artist, title } of chart) {
    const key = `mb:album:${artist.toLowerCase()}|${title.toLowerCase()}`;
    let match = mbMatchCache.get(key) as SearchResult | null | undefined;
    if (match === undefined) {
      // Saved by an earlier run of Lexarr (survives restarts).
      match = await getPersistent<SearchResult | null>(key);
      if (match !== undefined) mbMatchCache.set(key, match);
    }
    if (match === undefined) {
      match = await lookup(artist, title);
      // "The Life of a Showgirl: The Encore" is an edition of "The Life of
      // a Showgirl": fall back to the title before the colon.
      const base = title.split(": ")[0];
      if (match === null && base !== title) match = await lookup(artist, base);
      // undefined = MusicBrainz unreachable: skip, but don't remember it.
      if (match !== undefined) {
        mbMatchCache.set(key, match);
        await setPersistent(key, match, MB_MATCH_TTL_MS);
      }
    }
    if (match && !seen.has(match.id)) {
      seen.add(match.id);
      out.push(match);
    }
  }
  return out;
}

// ── Music: from artists already in Lidarr ───────────────────────────

const RECENT_DAYS = 60;
const UPCOMING_DAYS = 90;

function calendarResult(a: lidarr.LidarrCalendarAlbum): SearchResult {
  const ep = /^ep$/i.test(a.albumType ?? "");
  return {
    id: a.foreignAlbumId,
    mediaType: "music",
    title: a.title,
    year: a.releaseDate?.slice(0, 4),
    releaseDate: a.releaseDate?.slice(0, 10),
    overview: `${ep ? "EP" : "Album"} by ${a.artist!.artistName}`,
    posterUrl: `https://coverartarchive.org/release-group/${a.foreignAlbumId}/front-250`,
    artist: a.artist!.artistName,
    artistId: a.artist!.foreignArtistId,
    releaseType: ep ? "ep" : "album",
  };
}

/** Albums and EPs by Lidarr artists from the last 60 days (newest first)
 *  and the next 90 (soonest first), from one Lidarr calendar call. */
export async function artistCalendar(now = new Date()): Promise<{ recent: SearchResult[]; upcoming: SearchResult[] }> {
  const albums = await lidarr.getCalendarRange(
    new Date(now.getTime() - RECENT_DAYS * DAY),
    new Date(now.getTime() + UPCOMING_DAYS * DAY),
  );
  const usable = albums.filter(
    (a) => a.foreignAlbumId && a.releaseDate && a.artist?.foreignArtistId && /^(album|ep)$/i.test(a.albumType ?? ""),
  );
  const today = now.toISOString().slice(0, 10);
  const isPast = (a: lidarr.LidarrCalendarAlbum) => a.releaseDate!.slice(0, 10) <= today;
  return {
    recent: usable
      .filter(isPast)
      .sort((x, y) => y.releaseDate!.localeCompare(x.releaseDate!))
      .map(calendarResult),
    upcoming: usable
      .filter((a) => !isPast(a))
      .sort((x, y) => x.releaseDate!.localeCompare(y.releaseDate!))
      .map(calendarResult),
  };
}

// ── Books: OpenLibrary trending ─────────────────────────────────────

interface OlTrendingWork {
  key?: string;
  title?: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
}

export async function trendingBooks(): Promise<SearchResult[]> {
  const res = await fetch(`${openLibraryBase()}/trending/weekly.json?limit=40`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OpenLibrary trending HTTP ${res.status}`);
  const json = (await res.json()) as { works?: OlTrendingWork[] };
  const seen = new Set<string>();
  return (json.works ?? [])
    .filter((w) => w.key?.startsWith("/works/") && w.title && !seen.has(w.key) && seen.add(w.key))
    .map((w) => ({
      id: w.key!,
      mediaType: "book" as const,
      title: w.title!,
      year: w.first_publish_year ? String(w.first_publish_year) : undefined,
      posterUrl: w.cover_i ? `https://covers.openlibrary.org/b/id/${w.cover_i}-M.jpg` : undefined,
      artist: w.author_name?.join(", "),
    }));
}

// ── Books: popular works by authors you follow ──────────────────────

const MAX_AUTHORS = 10;
const BOOKS_PER_AUTHOR = 3;
const OL_GAP_MS = 300;

interface LlAuthor {
  AuthorName?: string;
  Status?: string;
  HaveBooks?: string | number;
  TotalBooks?: string | number;
}

/** The authors LazyLibrarian follows (Active) or has books by, most books
 *  first. */
export async function followedAuthors(): Promise<string[]> {
  const index = (await lazylibrarian.getLibrary()) as LlAuthor[];
  return index
    .filter((a) => a.AuthorName && (a.Status === "Active" || Number(a.HaveBooks) > 0))
    .sort((x, y) => Number(y.HaveBooks) - Number(x.HaveBooks) || Number(y.TotalBooks) - Number(x.TotalBooks))
    .slice(0, MAX_AUTHORS)
    .map((a) => a.AuthorName!);
}

/** Each followed author's most-read OpenLibrary works (with covers), taken
 *  in turns so one prolific author doesn't fill the row. */
export async function authorBooks(): Promise<SearchResult[]> {
  const authors = await followedAuthors();
  const perAuthor: SearchResult[][] = [];
  for (const [i, name] of authors.entries()) {
    if (i > 0) await sleep(OL_GAP_MS);
    try {
      const qs = new URLSearchParams({
        author: name,
        language: "eng",
        sort: "readinglog",
        limit: "8",
        fields: "key,title,author_name,cover_i,first_publish_year",
      });
      const res = await fetch(`${openLibraryBase()}/search.json?${qs}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`OpenLibrary search HTTP ${res.status}`);
      const docs = ((await res.json()) as { docs?: OlTrendingWork[] }).docs ?? [];
      const lower = name.toLowerCase();
      // OpenLibrary has many works for one book ("Meditations" several
      // times, "The Meditations of Marcus Aurelius"): keep the first of
      // each title, treating a longer title that starts with a kept one as
      // the same book.
      const kept: string[] = [];
      const isNewTitle = (title: string) => {
        const t = title.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
        if (!t || kept.some((k) => t.startsWith(k))) return false;
        kept.push(t);
        return true;
      };
      perAuthor.push(
        docs
          .filter(
            (w) =>
              w.key?.startsWith("/works/") &&
              w.title &&
              w.cover_i &&
              (w.author_name ?? []).some((n) => n.toLowerCase() === lower) &&
              isNewTitle(w.title),
          )
          .slice(0, BOOKS_PER_AUTHOR)
          .map((w) => ({
            id: w.key!,
            mediaType: "book" as const,
            title: w.title!,
            year: w.first_publish_year ? String(w.first_publish_year) : undefined,
            posterUrl: `https://covers.openlibrary.org/b/id/${w.cover_i}-M.jpg`,
            artist: name,
          })),
      );
    } catch (err: unknown) {
      log.debug("discover: OpenLibrary author search failed", { author: name, err });
    }
  }
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (let round = 0; round < BOOKS_PER_AUTHOR; round++) {
    for (const list of perAuthor) {
      const w = list[round];
      if (w && !seen.has(w.id)) {
        seen.add(w.id);
        out.push(w);
      }
    }
  }
  return out;
}

// ── Raw pools (24h cache, one fill at a time) ───────────────────────

// On globalThis so the background refresh (instrumentation bundle) and the
// route share one in-flight fill instead of matching the chart twice at
// once (see the note in lib/cache.ts).
const g = globalThis as typeof globalThis & {
  __lexarrDiscoverInFlight?: Map<DiscoverType, Promise<DiscoverSection[]>>;
};
const inFlight = (g.__lexarrDiscoverInFlight ??= new Map());

async function settle(label: string, p: Promise<SearchResult[]>): Promise<SearchResult[]> {
  try {
    return await p;
  } catch (err: unknown) {
    log.warn(`discover: ${label} failed`, { err });
    return [];
  }
}

async function build(type: DiscoverType): Promise<DiscoverSection[]> {
  if (type === "book") {
    const [trending, authors] = await Promise.all([
      settle("OpenLibrary trending", trendingBooks()),
      settle("author books", authorBooks()),
    ]);
    return [
      { id: "trending", title: "Trending books", subtitle: "Most read on OpenLibrary this week", items: trending },
      { id: "your-authors", title: "From authors you follow", subtitle: "Popular books by authors in LazyLibrarian", items: authors },
    ];
  }
  const [chart, calendar] = await Promise.all([
    settle("Apple chart", chartAlbums()),
    artistCalendar().catch((err: unknown) => {
      log.warn("discover: Lidarr calendar failed", { err });
      return { recent: [] as SearchResult[], upcoming: [] as SearchResult[] };
    }),
  ]);
  return [
    { id: "chart", title: "Popular new albums", subtitle: "Most played in the US on Apple Music", items: chart },
    { id: "your-artists", title: "New from your artists", subtitle: "Out in the last 60 days, not requested yet", items: calendar.recent },
    {
      id: "coming-soon",
      title: "Coming soon from your artists",
      subtitle: "Due in the next 90 days",
      items: calendar.upcoming,
      keepOwned: true,
    },
  ];
}

/** The unfiltered sections, cached for a day once any of them has items. */
export function getDiscoverPool(type: DiscoverType): Promise<DiscoverSection[]> {
  const cached = discoverCache.get(`discover:${type}`) as DiscoverSection[] | undefined;
  if (cached) return Promise.resolve(cached);
  return fill(type);
}

/** When the cached lists were built (ISO), or null if they aren't cached. */
export function discoverBuiltAt(type: DiscoverType): string | null {
  return (discoverCache.get(`discover:${type}:at`) as string | undefined) ?? null;
}

/** Rebuild both pools in the background (instrumentation.ts, at startup and
 *  every 12h) so nobody waits ~30s for the chart to be matched. The old
 *  lists keep serving until the new ones are ready, and a failed rebuild
 *  leaves them in place. */
export async function refreshDiscoverPools(): Promise<boolean> {
  let complete = true;
  for (const type of ["book", "music"] as const) {
    const sections = await fill(type).catch((err: unknown) => {
      log.warn("discover: background refresh failed", { type, err });
      return [] as DiscoverSection[];
    });
    // The chart and trending lists are never legitimately empty ("new from
    // your artists" can be), so an empty one means its source failed.
    const main = sections.find((s) => s.id === (type === "music" ? "chart" : "trending"));
    if (!main || main.items.length === 0) complete = false;
  }
  return complete;
}

function fill(type: DiscoverType): Promise<DiscoverSection[]> {
  const running = inFlight.get(type);
  if (running) return running;
  const p = build(type)
    .then((sections) => {
      if (sections.some((s) => s.items.length > 0)) {
        discoverCache.set(`discover:${type}`, sections);
        discoverCache.set(`discover:${type}:at`, new Date().toISOString());
      }
      return sections;
    })
    .finally(() => inFlight.delete(type));
  inFlight.set(type, p);
  return p;
}

// ── Test hooks ──────────────────────────────────────────────────────

export const __testing = {
  setSleep(fn: (ms: number) => Promise<void>) {
    sleep = fn;
  },
  reset() {
    inFlight.clear();
    discoverCache.clear();
    mbMatchCache.clear();
  },
};
