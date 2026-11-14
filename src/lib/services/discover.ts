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
 *     came out in the last 60 days or are due in the next 30.
 * Books:
 *   - "Trending books": OpenLibrary's weekly trending works. Same OL work
 *     keys book search uses.
 *
 * Every source is best-effort: a failure gives an empty section (the page
 * then shows its "search for it" hint) and is not cached, so the next load
 * tries again.
 */
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { discoverCache, mbMatchCache } from "@/lib/cache";
import { findAlbumReleaseGroup } from "@/lib/search/musicbrainz";
import * as lidarr from "@/lib/arr/lidarr";
import type { SearchResult } from "@/types";

export type DiscoverType = "music" | "book";

export interface DiscoverSection {
  id: "chart" | "your-artists" | "trending";
  title: string;
  subtitle: string;
  items: SearchResult[];
}

const DAY = 24 * 60 * 60 * 1000;
/** MusicBrainz allows anonymous clients one request a second. */
const MB_GAP_MS = 1100;
const MB_RETRY_MS = 3000;
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
      match = await lookup(artist, title);
      // "The Life of a Showgirl: The Encore" is an edition of "The Life of
      // a Showgirl": fall back to the title before the colon.
      const base = title.split(": ")[0];
      if (match === null && base !== title) match = await lookup(artist, base);
      // undefined = MusicBrainz unreachable: skip, but don't remember it.
      if (match !== undefined) mbMatchCache.set(key, match);
    }
    if (match && !seen.has(match.id)) {
      seen.add(match.id);
      out.push(match);
    }
  }
  return out;
}

// ── Music: new from artists already in Lidarr ───────────────────────

export async function yourArtistsAlbums(now = new Date()): Promise<SearchResult[]> {
  const albums = await lidarr.getCalendarRange(new Date(now.getTime() - 60 * DAY), new Date(now.getTime() + 30 * DAY));
  return albums
    .filter((a) => a.foreignAlbumId && a.artist?.foreignArtistId && /^(album|ep)$/i.test(a.albumType ?? ""))
    .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""))
    .map((a) => ({
      id: a.foreignAlbumId,
      mediaType: "music" as const,
      title: a.title,
      year: a.releaseDate?.slice(0, 4),
      releaseDate: a.releaseDate?.slice(0, 10),
      overview: `${/^ep$/i.test(a.albumType ?? "") ? "EP" : "Album"} by ${a.artist!.artistName}`,
      posterUrl: `https://coverartarchive.org/release-group/${a.foreignAlbumId}/front-250`,
      artist: a.artist!.artistName,
      artistId: a.artist!.foreignArtistId,
      releaseType: /^ep$/i.test(a.albumType ?? "") ? ("ep" as const) : ("album" as const),
    }));
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
    return [
      {
        id: "trending",
        title: "Trending books",
        subtitle: "Most read on OpenLibrary this week",
        items: await settle("OpenLibrary trending", trendingBooks()),
      },
    ];
  }
  const [chart, mine] = await Promise.all([
    settle("Apple chart", chartAlbums()),
    settle("Lidarr calendar", yourArtistsAlbums()),
  ]);
  return [
    { id: "chart", title: "Popular new albums", subtitle: "Most played in the US on Apple Music", items: chart },
    { id: "your-artists", title: "New from your artists", subtitle: "From artists already in your library", items: mine },
  ];
}

/** The unfiltered sections, cached for a day once any of them has items. */
export function getDiscoverPool(type: DiscoverType): Promise<DiscoverSection[]> {
  const cached = discoverCache.get(`discover:${type}`) as DiscoverSection[] | undefined;
  if (cached) return Promise.resolve(cached);
  return fill(type);
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
      if (sections.some((s) => s.items.length > 0)) discoverCache.set(`discover:${type}`, sections);
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
