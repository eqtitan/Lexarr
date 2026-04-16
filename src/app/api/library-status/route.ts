import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import type { LibraryStatusValue, MediaType } from "@/types";

interface StatusItem {
  id: string;
  mediaType: MediaType;
  artistId?: string;
  /** Music only: "single" / "ep" trigger a release-group level check */
  releaseType?: string;
}

/**
 * POST /api/library-status
 * Checks whether search results already exist in the *arr services or Lexarr DB.
 * Returns a map of "mediaType:id" → LibraryStatusValue.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = checkRateLimit(`search:${ip}`, RATE_LIMITS.search);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const items: StatusItem[] = body.items;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ statuses: {} });
  }
  // Cap at 40 items (search returns up to 10 per source × 4 sources)
  const cappedItems = items.slice(0, 40);

  const statuses: Record<string, LibraryStatusValue> = {};

  // Group items by media type
  const movies = cappedItems.filter((i) => i.mediaType === "movie");
  const tvShows = cappedItems.filter((i) => i.mediaType === "tv");
  const music = cappedItems.filter((i) => i.mediaType === "music");
  // Books: checked via Lexarr DB only (OpenLibrary→LazyLibrarian ID mismatch)

  // Check Lexarr DB for existing requests (all types at once)
  const externalIds = cappedItems.map((i) => i.id);
  const existingRequests = await prisma.request.findMany({
    where: { externalId: { in: externalIds } },
    select: { externalId: true, mediaType: true, status: true },
  });
  const requestMap = new Map(
    existingRequests.map((r) => [`${r.mediaType}:${r.externalId}`, r.status]),
  );

  // Check all services in parallel
  const [movieResults, tvResults, musicResults] = await Promise.all([
    checkMovies(movies),
    checkTv(tvShows),
    checkMusic(music),
  ]);

  // Merge results: arr status takes priority over Lexarr DB status
  for (const item of cappedItems) {
    const key = `${item.mediaType}:${item.id}`;
    const arrStatus =
      movieResults[key] ?? tvResults[key] ?? musicResults[key] ?? null;

    if (arrStatus) {
      statuses[key] = arrStatus;
    } else {
      // Fall back to Lexarr DB request status
      const dbStatus = requestMap.get(key);
      if (dbStatus === "available") statuses[key] = "available";
      else if (dbStatus === "downloading" || dbStatus === "approved")
        statuses[key] = "requested";
      else if (dbStatus === "pending") statuses[key] = "requested";
      else statuses[key] = null;
    }
  }

  return NextResponse.json({ statuses });
}

async function checkMovies(
  items: StatusItem[],
): Promise<Record<string, LibraryStatusValue>> {
  const results: Record<string, LibraryStatusValue> = {};
  if (items.length === 0) return results;

  const checks = items.map(async (item) => {
    try {
      const movie = await radarr.getMovieByTmdbId(Number(item.id));
      if (movie) {
        results[`movie:${item.id}`] = movie.hasFile
          ? "available"
          : "monitored";
      }
    } catch {
      // Radarr unavailable — skip
    }
  });
  await Promise.all(checks);
  return results;
}

async function checkTv(
  items: StatusItem[],
): Promise<Record<string, LibraryStatusValue>> {
  const results: Record<string, LibraryStatusValue> = {};
  if (items.length === 0) return results;

  try {
    const allSeries = await sonarr.getAllSeriesCached();
    for (const item of items) {
      const match = allSeries.find((s) => s.tmdbId === Number(item.id));
      if (match) {
        results[`tv:${item.id}`] = "monitored";
      }
    }
  } catch {
    // Sonarr unavailable — skip
  }
  return results;
}

async function checkMusic(
  items: StatusItem[],
): Promise<Record<string, LibraryStatusValue>> {
  const results: Record<string, LibraryStatusValue> = {};
  if (items.length === 0) return results;

  try {
    const allArtists = await lidarr.getAllArtistsCached();

    // Group items by artist match so we only fetch albums per artist once
    const artistIdByItem = new Map<string, number>();
    const itemsNeedingReleaseGroupCheck: StatusItem[] = [];

    for (const item of items) {
      const lookupId = item.artistId || item.id;
      const match = allArtists.find((a) => a.foreignArtistId === lookupId);
      if (!match) continue;

      if (item.releaseType === "single" || item.releaseType === "ep") {
        // Singles/EPs: defer to release-group level check
        artistIdByItem.set(item.id, match.id);
        itemsNeedingReleaseGroupCheck.push(item);
      } else {
        // Album / default: artist-level "monitored" is sufficient
        results[`music:${item.id}`] = "monitored";
      }
    }

    // Release-group level check: fetch albums per unique artist, match on foreignAlbumId
    const uniqueArtistIds = [...new Set(artistIdByItem.values())];
    const albumLists = await Promise.all(
      uniqueArtistIds.map((id) =>
        lidarr.getAlbumsForArtist(id).catch(() => []),
      ),
    );
    const albumsByArtist = new Map<number, Awaited<ReturnType<typeof lidarr.getAlbumsForArtist>>>();
    uniqueArtistIds.forEach((id, i) => albumsByArtist.set(id, albumLists[i]));

    for (const item of itemsNeedingReleaseGroupCheck) {
      const artistId = artistIdByItem.get(item.id);
      if (artistId == null) continue;
      const albums = albumsByArtist.get(artistId) || [];
      const album = albums.find((a) => a.foreignAlbumId === item.id);
      if (album) {
        results[`music:${item.id}`] = album.monitored ? "monitored" : null;
      }
      // If release-group not in Lidarr's catalog → leave as null (not in library)
    }
  } catch {
    // Lidarr unavailable — skip
  }
  return results;
}
