/**
 * Shared library-status lookup: checks whether search/discover results
 * already exist in the *arr services or the Lexarr request DB.
 *
 * Extracted from the /api/library-status route so /api/releases can
 * reuse the exact same logic to pre-filter the New Releases feed down to
 * items the household doesn't already have, without duplicating the
 * Radarr/Sonarr/Lidarr/DB-fallback merge logic.
 */
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";
import type { LibraryStatusValue, MediaType } from "@/types";

export interface StatusItem {
  id: string;
  mediaType: MediaType;
  artistId?: string;
  /** Music only: "single" / "ep" trigger a release-group level check */
  releaseType?: string;
}

/** Checks `items` against Radarr/Sonarr/Lidarr and the Lexarr request DB,
 *  returning a map of "mediaType:id" → LibraryStatusValue. Arr status takes
 *  priority; DB request status is the fallback for items *arr doesn't know
 *  about yet (e.g. a pending request not yet sent to the *arr service). */
export async function getLibraryStatuses(
  items: StatusItem[],
): Promise<Record<string, LibraryStatusValue>> {
  const statuses: Record<string, LibraryStatusValue> = {};
  if (items.length === 0) return statuses;

  const movies = items.filter((i) => i.mediaType === "movie");
  const tvShows = items.filter((i) => i.mediaType === "tv");
  const music = items.filter((i) => i.mediaType === "music");
  // Books: checked via Lexarr DB only (OpenLibrary→LazyLibrarian ID mismatch)

  const externalIds = items.map((i) => i.id);
  const existingRequests = await prisma.request.findMany({
    where: { externalId: { in: externalIds } },
    select: { externalId: true, mediaType: true, status: true },
  });
  const requestMap = new Map(
    existingRequests.map((r) => [`${r.mediaType}:${r.externalId}`, r.status]),
  );

  const [movieResults, tvResults, musicResults] = await Promise.all([
    checkMovies(movies),
    checkTv(tvShows),
    checkMusic(music),
  ]);

  for (const item of items) {
    const key = `${item.mediaType}:${item.id}`;
    const arrStatus =
      movieResults[key] ?? tvResults[key] ?? musicResults[key] ?? null;

    if (arrStatus) {
      statuses[key] = arrStatus;
    } else {
      const dbStatus = requestMap.get(key);
      if (dbStatus === "available") statuses[key] = "available";
      else if (dbStatus === "downloading" || dbStatus === "approved")
        statuses[key] = "requested";
      else if (dbStatus === "pending") statuses[key] = "requested";
      else statuses[key] = null;
    }
  }

  return statuses;
}

async function checkMovies(
  items: StatusItem[],
): Promise<Record<string, LibraryStatusValue>> {
  const results: Record<string, LibraryStatusValue> = {};
  if (items.length === 0) return results;

  // One cached library fetch + in-memory filter, matching checkTv/checkMusic
  // below — this used to call getMovieByTmdbId() once per item, firing one
  // Radarr request per search result instead of one for the whole batch.
  try {
    const allMovies = await radarr.getAllMoviesCached();
    for (const item of items) {
      const match = allMovies.find((m) => m.tmdbId === Number(item.id));
      if (match) {
        results[`movie:${item.id}`] = match.hasFile ? "available" : "monitored";
      }
    }
  } catch (err) {
    log.debug("library-status: Radarr unavailable", { err });
    // Radarr unavailable — skip
  }
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
  } catch (err) {
    log.debug("library-status: Sonarr unavailable", { err });
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

    const artistIdByItem = new Map<string, number>();
    const itemsNeedingReleaseGroupCheck: StatusItem[] = [];

    for (const item of items) {
      const lookupId = item.artistId || item.id;
      const match = allArtists.find((a) => a.foreignArtistId === lookupId);
      if (!match) continue;

      // An artist id passed as the item id (an artist-level result) means
      // the whole artist is what's monitored.
      if (!item.artistId) {
        results[`music:${item.id}`] = "monitored";
        continue;
      }
      // Requests monitor one release group, not the artist's catalog, so
      // an album by an artist already in Lidarr only counts as monitored
      // if that album is. (It used to be marked monitored for any album by
      // a known artist, which hid albums nobody had asked for.)
      artistIdByItem.set(item.id, match.id);
      itemsNeedingReleaseGroupCheck.push(item);
    }

    const uniqueArtistIds = [...new Set(artistIdByItem.values())];
    const albumLists = await Promise.all(
      uniqueArtistIds.map((id) =>
        lidarr.getAlbumsForArtist(id).catch((err: unknown) => {
          log.debug("library-status: Lidarr album lookup failed", { err });
          return [];
        }),
      ),
    );
    const albumsByArtist = new Map<
      number,
      Awaited<ReturnType<typeof lidarr.getAlbumsForArtist>>
    >();
    uniqueArtistIds.forEach((id, i) => albumsByArtist.set(id, albumLists[i]));

    for (const item of itemsNeedingReleaseGroupCheck) {
      const artistId = artistIdByItem.get(item.id);
      if (artistId == null) continue;
      const albums = albumsByArtist.get(artistId) || [];
      const album = albums.find((a) => a.foreignAlbumId === item.id);
      if (album) {
        results[`music:${item.id}`] = album.monitored ? "monitored" : null;
      }
    }
  } catch (err) {
    log.debug("library-status: Lidarr unavailable", { err });
    // Lidarr unavailable — skip
  }
  return results;
}
