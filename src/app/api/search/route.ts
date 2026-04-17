import { NextRequest, NextResponse } from "next/server";
import { search as tmdbSearch } from "@/lib/search/tmdb";
import { search as musicSearch } from "@/lib/search/musicbrainz";
import { search as bookSearch } from "@/lib/search/openlib";
import { searchCache } from "@/lib/cache";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import type { SearchResult, MediaType } from "@/types";

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

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const cacheKey = `search:${filter || "all"}:${query.toLowerCase().trim()}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return NextResponse.json({ results: cached, cached: true });
  }

  const searches: Promise<SearchResult[]>[] = [];

  if (!filter || filter === "movie" || filter === "tv") {
    searches.push(tmdbSearch(query).catch(() => []));
  }
  if (!filter || filter === "music") {
    searches.push(musicSearch(query).catch(() => []));
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
