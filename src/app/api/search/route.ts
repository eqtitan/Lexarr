import { NextRequest, NextResponse } from "next/server";
import { search as tmdbSearch } from "@/lib/search/tmdb";
import {
  search as musicSearch,
  type MusicSearchOptions,
} from "@/lib/search/musicbrainz";
import { search as bookSearch } from "@/lib/search/openlib";
import { searchCache } from "@/lib/cache";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { getAllowedRegions } from "@/lib/settings";
import type { SearchResult, MediaType } from "@/types";

type MusicSubFilter = "single" | "ep" | "album";
const VALID_SUB_FILTERS: MusicSubFilter[] = ["single", "ep", "album"];

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = checkRateLimit(`search:${ip}`, RATE_LIMITS.search);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)) } },
    );
  }

  const query = req.nextUrl.searchParams.get("q");
  const filter = req.nextUrl.searchParams.get("type") as MediaType | null;
  const subRaw = req.nextUrl.searchParams.get("sub");
  const sub =
    subRaw && VALID_SUB_FILTERS.includes(subRaw as MusicSubFilter)
      ? (subRaw as MusicSubFilter)
      : null;

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Cache key includes the music sub-filter + region setting so
  // different chips / region configs get their own cached slices.
  // Region setting rarely changes, so we read it once per request and
  // fold it into the cache key.
  const musicOptions: MusicSearchOptions =
    !filter || filter === "music"
      ? {
          releaseType: sub ?? undefined,
          allowedRegions: await getAllowedRegions(),
        }
      : {};
  const regionKey = (musicOptions.allowedRegions ?? []).join(",");
  const cacheKey = `search:${filter || "all"}:${sub ?? "any"}:${regionKey}:${query.toLowerCase().trim()}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return NextResponse.json({ results: cached, cached: true });
  }

  const searches: Promise<SearchResult[]>[] = [];

  if (!filter || filter === "movie" || filter === "tv") {
    searches.push(tmdbSearch(query).catch(() => []));
  }
  if (!filter || filter === "music") {
    searches.push(musicSearch(query, musicOptions).catch(() => []));
  }
  if (!filter || filter === "book") {
    searches.push(bookSearch(query).catch(() => []));
  }

  const resultArrays = await Promise.all(searches);
  let results = resultArrays.flat();

  // TMDB returns both movies and TV shows in the same response; filter
  // down to the requested type so the Movies/TV chips are honest.
  // Music and Books are already type-pure (separate source APIs).
  if (filter === "movie" || filter === "tv") {
    results = results.filter((r) => r.mediaType === filter);
  }

  // Music sub-filter: MB's `primarytype` query clause is best-effort —
  // sometimes it returns mixed types. Post-filter is the belt that
  // guarantees the chip promise.
  if (filter === "music" && sub) {
    results = results.filter((r) => r.releaseType === sub);
  }

  // Only cache non-empty results. An empty array almost always means an
  // upstream transient failure (MusicBrainz 503 rate-limit, TMDB outage,
  // OpenLibrary timeout). Caching [] for 5 min means one blip locks every
  // user out of finding that query until the TTL expires — a retry a
  // second later returns the same empty cached answer without ever
  // hitting the upstream again. Better to let transient failures cost
  // an extra fetch than poison the cache.
  if (results.length > 0) {
    searchCache.set(cacheKey, results);
  }
  return NextResponse.json({ results });
}
