import type { SearchResult } from "@/types";
import { log } from "@/lib/log";
import { env } from "@/lib/env";

interface TmdbMultiResult {
  id: number;
  media_type: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string;
  vote_average?: number;
}

interface TmdbDiscoverResult {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string;
  vote_average?: number;
}

// TMDB_API_BASE is only overridden by the end-to-end tests (e2e/), which
// point it at a local stub server.
const base = () => env().TMDB_API_BASE || "https://api.themoviedb.org/3";
const apiKey = () => env().TMDB_API_KEY || "";

export async function search(query: string): Promise<SearchResult[]> {
  if (!apiKey()) return [];
  const res = await fetch(
    `${base()}/search/multi?query=${encodeURIComponent(query)}&api_key=${apiKey()}&page=1&with_original_language=en`,
  );
  if (!res.ok) return [];
  const data = await res.json();

  return (data.results || [])
    .filter((r: TmdbMultiResult) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 10)
    .map(
      (r: TmdbMultiResult): SearchResult => ({
        id: String(r.id),
        mediaType: r.media_type === "movie" ? "movie" : "tv",
        title: r.title || r.name || "Unknown",
        year: (r.release_date || r.first_air_date || "").slice(0, 4),
        overview: r.overview?.slice(0, 200),
        posterUrl: r.poster_path
          ? `https://image.tmdb.org/t/p/w300${r.poster_path}`
          : undefined,
        rating: r.vote_average
          ? Math.round(r.vote_average * 10) / 10
          : undefined,
      }),
    );
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Rolling 6-month US release window, recomputed against "now" on every call
 *  so the feed naturally rolls forward without needing a scheduled reset. */
function sixMonthWindow(): { gte: string; lte: string } {
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  // Clamp to day 1 before subtracting months -- setMonth() on e.g. Oct 31
  // minus 6 lands on "April 31", which JS Date rolls over to May 1,
  // silently shrinking the window to ~5 months on the 29th-31st of any
  // month whose 6-months-back target has fewer days.
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return { gte: toIsoDate(sixMonthsAgo), lte: toIsoDate(now) };
}

function mapDiscoverMovie(r: TmdbDiscoverResult): SearchResult {
  return {
    id: String(r.id),
    mediaType: "movie",
    title: r.title || "Unknown",
    year: (r.release_date || "").slice(0, 4),
    releaseDate: r.release_date,
    overview: r.overview?.slice(0, 200),
    posterUrl: r.poster_path
      ? `https://image.tmdb.org/t/p/w300${r.poster_path}`
      : undefined,
    rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : undefined,
  };
}

function mapDiscoverTv(r: TmdbDiscoverResult): SearchResult {
  return {
    id: String(r.id),
    mediaType: "tv",
    title: r.name || "Unknown",
    year: (r.first_air_date || "").slice(0, 4),
    releaseDate: r.first_air_date,
    overview: r.overview?.slice(0, 200),
    posterUrl: r.poster_path
      ? `https://image.tmdb.org/t/p/w300${r.poster_path}`
      : undefined,
    rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : undefined,
  };
}

const DISCOVER_PAGES = 3; // 3 pages of 20 = enough pool to fill a 24-item feed after filtering

async function fetchDiscoverPages(
  endpoint: "movie" | "tv",
  baseParams: Record<string, string>,
): Promise<TmdbDiscoverResult[]> {
  const pages = await Promise.all(
    Array.from({ length: DISCOVER_PAGES }, (_, i) => {
      const params = new URLSearchParams({ ...baseParams, page: String(i + 1) });
      return fetch(`${base()}/discover/${endpoint}?${params}`)
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .catch((err: unknown) => {
          log.debug("tmdb: discover request failed", { err });
          return { results: [] };
        });
    }),
  );
  const all = pages.flatMap((p) => (p.results || []) as TmdbDiscoverResult[]);
  // Dedup by id — defensive against TMDB returning an overlapping item
  // across pages (e.g. if the popularity ranking shifts between requests).
  return [...new Map(all.map((r) => [r.id, r])).values()];
}

/**
 * New movies released in the past 6 months, most recent first.
 *
 * Sorts the TMDB query by `popularity.desc`, not by release date. Verified
 * against the live API: sorting by release date surfaces a flood of
 * zero-vote/zero-popularity noise (film-school shorts, direct-to-VOD
 * filler, festival entries) that got a recent date logged on TMDB —
 * mainstream titles like a wide theatrical release get buried under dozens
 * of releases nobody would recognize as a "US movie release." Popularity
 * sort surfaces the actual notable titles; the results are then re-sorted
 * by release date for display so the feed still reads newest-first.
 *
 * Uses `primary_release_date.gte/lte` rather than `release_date.gte/lte`
 * for the window itself: `release_date.gte/lte` matches against *any* of a
 * movie's release-date entries (any region/type), which let titles with a
 * displayed date far outside the requested window (even a year in the
 * future) leak into the feed. `primary_release_date.gte/lte` filters on
 * the same field the discover endpoint returns, so the filtered/displayed
 * date is always consistent. Deliberately omits the `region` param too —
 * combined with either date filter it substitutes a regional release date
 * into the response that can diverge further still. `with_original_language
 * =en` is used as the "US-relevant" proxy instead of a hard region filter.
 * The in-range filter below is a second safety net against any remaining
 * TMDB edge cases.
 */
/**
 * @param limit Max items to return. Callers that filter the result further
 * (e.g. /api/releases excluding items already in the library) should pass
 * a higher limit than they intend to display, so enough candidates survive
 * that filtering. Defaults to 24 — the feed's display count.
 */
export async function discoverRecentMovies(limit = 24): Promise<SearchResult[]> {
  if (!apiKey()) return [];
  const { gte, lte } = sixMonthWindow();
  const results = await fetchDiscoverPages("movie", {
    api_key: apiKey(),
    with_original_language: "en",
    sort_by: "popularity.desc",
    "primary_release_date.gte": gte,
    "primary_release_date.lte": lte,
    include_adult: "false",
  });
  return results
    .filter((r) => r.poster_path && r.release_date && r.release_date >= gte && r.release_date <= lte)
    .sort((a, b) => (b.release_date || "").localeCompare(a.release_date || ""))
    .map(mapDiscoverMovie)
    .slice(0, limit);
}

/** New TV series with a first-air date in the past 6 months, most recent
 *  first. Same popularity-sort-then-redate approach as discoverRecentMovies
 *  — see its doc comment for why. See discoverRecentMovies for `limit`. */
export async function discoverRecentTv(limit = 24): Promise<SearchResult[]> {
  if (!apiKey()) return [];
  const { gte, lte } = sixMonthWindow();
  const results = await fetchDiscoverPages("tv", {
    api_key: apiKey(),
    with_original_language: "en",
    sort_by: "popularity.desc",
    "first_air_date.gte": gte,
    "first_air_date.lte": lte,
    include_adult: "false",
  });
  return results
    .filter((r) => r.poster_path && r.first_air_date && r.first_air_date >= gte && r.first_air_date <= lte)
    .sort((a, b) => (b.first_air_date || "").localeCompare(a.first_air_date || ""))
    .map(mapDiscoverTv)
    .slice(0, limit);
}

/**
 * TheTVDB id for a TMDB TV show (Sonarr is TVDB-based), or null when TMDB
 * has no TVDB mapping yet. Throws when TMDB can't be reached, so callers
 * can tell "unknown" from "not on TVDB".
 */
export async function getTvdbIdForTmdbTv(tmdbId: number): Promise<number | null> {
  if (!apiKey()) throw new Error("TMDB_API_KEY is not set");
  const res = await fetch(`${base()}/tv/${tmdbId}/external_ids?api_key=${apiKey()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TMDB /tv/${tmdbId}/external_ids: ${res.status}`);
  const data = (await res.json()) as { tvdb_id?: number | null };
  return typeof data.tvdb_id === "number" && data.tvdb_id > 0 ? data.tvdb_id : null;
}
