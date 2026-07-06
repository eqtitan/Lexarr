import { NextRequest, NextResponse } from "next/server";
import { discoverRecentMovies, discoverRecentTv } from "@/lib/search/tmdb";
import { getLibraryStatuses } from "@/lib/services/library-status";
import { releasesCache, releasesFilteredCache } from "@/lib/cache";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import type { SearchResult, LibraryStatusValue } from "@/types";

interface ReleasesResponse {
  movies: SearchResult[];
  tv: SearchResult[];
}

const CACHE_KEY = "releases:us:6mo";
const DISPLAY_LIMIT = 24;
// Fetch a larger raw pool than we display so there's enough left after
// excluding items already in the library/monitored/requested.
const RAW_POOL_LIMIT = 60;

async function getRawPool(): Promise<ReleasesResponse> {
  const cached = releasesCache.get(CACHE_KEY) as ReleasesResponse | undefined;
  if (cached) return cached;

  const [movies, tv] = await Promise.all([
    discoverRecentMovies(RAW_POOL_LIMIT).catch(() => []),
    discoverRecentTv(RAW_POOL_LIMIT).catch(() => []),
  ]);
  const payload: ReleasesResponse = { movies, tv };

  // Only cache when at least one list came back non-empty — same rationale
  // as /api/search: don't let a transient TMDB outage poison the cache for
  // a full day.
  if (movies.length > 0 || tv.length > 0) {
    releasesCache.set(CACHE_KEY, payload);
  }
  return payload;
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = await checkRateLimit(`releases:${ip}`, RATE_LIMITS.general);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)) } },
    );
  }

  const cachedFiltered = releasesFilteredCache.get(CACHE_KEY) as
    | ReleasesResponse
    | undefined;
  if (cachedFiltered) {
    return NextResponse.json({ ...cachedFiltered, cached: true });
  }

  const pool = await getRawPool();

  const statuses = await getLibraryStatuses([
    ...pool.movies.map((r) => ({ id: r.id, mediaType: r.mediaType })),
    ...pool.tv.map((r) => ({ id: r.id, mediaType: r.mediaType })),
  ]).catch(() => ({}) as Record<string, LibraryStatusValue>);

  // Only show releases the household doesn't already have — already
  // available, already monitored, or already requested by anyone.
  const notInLibrary = (r: SearchResult) => !statuses[`${r.mediaType}:${r.id}`];

  const payload: ReleasesResponse = {
    movies: pool.movies.filter(notInLibrary).slice(0, DISPLAY_LIMIT),
    tv: pool.tv.filter(notInLibrary).slice(0, DISPLAY_LIMIT),
  };

  releasesFilteredCache.set(CACHE_KEY, payload);

  return NextResponse.json(payload);
}
