import { arrFetch, ArrApiError, type ArrFetchOptions } from "./_fetch";
import { env } from "@/lib/env";
import { pickDefaultProfile, LIDARR_DEFAULT_PATTERNS } from "./quality-profile";

/**
 * Pick a metadata profile that allows Singles + EPs so Lexarr's
 * release-group requests populate properly. Preference order:
 *   1. Profile named "All Music" (TRaSH / community convention)
 *   2. Any profile whose name matches /all|everything/i
 *   3. Any non-"None" / non-"Standard" profile (Standard is
 *      Albums-only in Lidarr's default install — filters singles)
 *   4. First profile as last resort
 *
 * Using profiles[0] blindly — which was the old behaviour — picks
 * "Standard" on default Lidarr installs. That silently hides any
 * single/EP the user adds. See TRaSH Guides "Recommended metadata
 * profile: All Music" for rationale.
 */
interface LidarrMetadataProfile {
  id: number;
  name: string;
}
export function pickDefaultMetadataProfile(
  profiles: LidarrMetadataProfile[],
): LidarrMetadataProfile | undefined {
  if (profiles.length === 0) return undefined;
  const patterns = [/^all music$/i, /all|everything/i];
  for (const pat of patterns) {
    const match = profiles.find((p) => pat.test(p.name));
    if (match) return match;
  }
  // Last-resort filter: anything not "None" or "Standard"
  return (
    profiles.find((p) => !/^(none|standard)$/i.test(p.name)) ?? profiles[0]
  );
}

const base = () => `${env().ARR_HOST}:8686`;
const apiKey = () => env().LIDARR_API_KEY!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function api<T = any>(path: string, options: ArrFetchOptions = {}) {
  return arrFetch<T>("Lidarr", base(), path, {
    ...options,
    headers: { "X-Api-Key": apiKey(), ...options.headers },
  });
}

export async function health() {
  return api("/api/v1/health");
}

export async function lookupArtist(term: string) {
  return api(`/api/v1/artist/lookup?term=${encodeURIComponent(term)}`);
}

export async function lookupAlbum(term: string) {
  return api(`/api/v1/album/lookup?term=${encodeURIComponent(term)}`);
}

import { libraryCache } from "@/lib/cache";

const ARTIST_CACHE_KEY = "lidarr:artists";

/** Get all artists with 60s cache for batch lookups */
export async function getAllArtistsCached(): Promise<{ id: number; foreignArtistId: string }[]> {
  const cached = libraryCache.get(ARTIST_CACHE_KEY);
  if (cached) return cached as { id: number; foreignArtistId: string }[];
  const artists: { id: number; foreignArtistId: string }[] = await api("/api/v1/artist");
  libraryCache.set(ARTIST_CACHE_KEY, artists);
  return artists;
}

/**
 * Drop the cached artists list. Called whenever we add a new artist
 * so the next getArtistByForeignId() lookup sees the fresh state
 * rather than stale cache. Without this, back-to-back single-requests
 * for the same artist hit a 400 "This artist has already been added"
 * on the second request — the first added the artist but the cache
 * still reported them missing.
 */
export function invalidateArtistCache(): void {
  libraryCache.delete(ARTIST_CACHE_KEY);
}

/** Check if an artist already exists in Lidarr by MusicBrainz ID */
export async function getArtistByForeignId(foreignArtistId: string) {
  const artists = await getAllArtistsCached();
  return artists.find((a) => a.foreignArtistId === foreignArtistId) || null;
}

export async function addArtist(
  foreignArtistId: string,
  _artistName: string,
  qualityProfileId?: number,
) {
  // Check if already exists
  const existing = await getArtistByForeignId(foreignArtistId);
  if (existing) {
    return { id: existing.id, alreadyExists: true };
  }

  // Lookup to get full artist data Lidarr needs
  const lookupResults = await api(
    `/api/v1/artist/lookup?term=lidarr:${foreignArtistId}`,
  );
  const artistData = lookupResults[0];
  if (!artistData)
    throw new Error(`Artist not found in Lidarr lookup: ${foreignArtistId}`);

  const [profiles, folders, metaProfiles] = await Promise.all([
    api("/api/v1/qualityprofile"),
    api("/api/v1/rootfolder"),
    api("/api/v1/metadataprofile"),
  ]);

  const mediaFolder =
    folders.find((f: { path: string }) => f.path.includes("/media/")) || folders[0];

  // See src/lib/arr/quality-profile.ts for why we don't use profiles[0]
  // as the fallback — avoids a pathological "Any" default.
  const qpId =
    qualityProfileId ??
    pickDefaultProfile(profiles, LIDARR_DEFAULT_PATTERNS)?.id ??
    profiles[0]?.id;
  const metaId =
    pickDefaultMetadataProfile(metaProfiles)?.id ?? metaProfiles[0]?.id;
  const result = await api("/api/v1/artist", {
    method: "POST",
    body: JSON.stringify({
      ...artistData,
      qualityProfileId: qpId,
      metadataProfileId: metaId,
      rootFolderPath: mediaFolder?.path || "/music",
      monitored: true,
      addOptions: { searchForMissingAlbums: true },
    }),
  });
  invalidateArtistCache();
  return { id: result.id, alreadyExists: false };
}

// ── Singles / release-group scoped flow ──────────────────────────────

interface LidarrAlbum {
  id: number;
  foreignAlbumId: string;
  title: string;
  monitored: boolean;
  artistId: number;
  albumType?: string;
}

/** Fetch all albums for an artist */
export async function getAlbumsForArtist(artistId: number): Promise<LidarrAlbum[]> {
  return api(`/api/v1/album?artistId=${artistId}`);
}

/** The library's copy of an album by MusicBrainz release-group id, or null
 *  if Lidarr doesn't have it. Fast (indexed), unlike the artist album list. */
export async function findLibraryAlbum(foreignAlbumId: string): Promise<LidarrAlbum | null> {
  const found: LidarrAlbum[] = await api(`/api/v1/album?foreignAlbumId=${encodeURIComponent(foreignAlbumId)}`);
  return found[0] ?? null;
}

/** Look up an album (release-group) by its MusicBrainz release-group ID */
export async function lookupAlbumByForeignId(
  releaseGroupId: string,
): Promise<LidarrAlbum | null> {
  const results = await api(
    `/api/v1/album/lookup?term=lidarr:${releaseGroupId}`,
  );
  return Array.isArray(results) && results.length > 0 ? results[0] : null;
}

/** Bulk-update album monitored flag */
export async function setAlbumMonitored(
  albumIds: number[],
  monitored: boolean,
): Promise<void> {
  await api("/api/v1/album/monitor", {
    method: "PUT",
    body: JSON.stringify({ albumIds, monitored }),
  });
}

/**
 * Unmonitor a whole artist in Lidarr (used when an admin cancels a
 * whole-artist request -- the addArtist fallback path, not a narrow
 * release-group request, which should unmonitor just its one album via
 * setAlbumMonitored above). Unmonitors rather than deletes -- see
 * radarr.ts's setMovieMonitored for the rationale (same pattern).
 */
export async function setArtistMonitored(
  arrId: number,
  monitored: boolean,
): Promise<void> {
  const artist = await api(`/api/v1/artist/${arrId}`);
  await api(`/api/v1/artist/${arrId}`, {
    method: "PUT",
    body: JSON.stringify({ ...artist, monitored }),
  });
  invalidateArtistCache();
}

/** Trigger a search for specific albums (by Lidarr internal ID) */
export async function triggerAlbumSearch(albumIds: number[]): Promise<void> {
  await api("/api/v1/command", {
    method: "POST",
    body: JSON.stringify({ name: "AlbumSearch", albumIds }),
  });
}

/**
 * Add a single release-group (Single / EP) with narrow monitoring.
 *
 * Unlike {@link addArtist} which monitors an artist's whole catalog, this:
 *   1. Adds the artist with `monitored: false` and no auto-search
 *   2. Enables monitoring on only the requested release-group
 *   3. Triggers a targeted AlbumSearch for it
 *
 * If the artist already exists in Lidarr, we do not touch the artist's
 * global monitored flag — we only toggle the specific album.
 */
export async function addSingleReleaseGroup(
  foreignArtistId: string,
  releaseGroupId: string,
  qualityProfileId?: number,
): Promise<{ id: number; alreadyExists: boolean }> {
  const existingArtist = await getArtistByForeignId(foreignArtistId);

  let artistId: number;
  let artistAlreadyExisted: boolean;

  if (existingArtist) {
    artistId = existingArtist.id;
    artistAlreadyExisted = true;
  } else {
    const lookupResults = await api(
      `/api/v1/artist/lookup?term=lidarr:${foreignArtistId}`,
    );
    const artistData = lookupResults[0];
    if (!artistData)
      throw new Error(`Artist not found in Lidarr lookup: ${foreignArtistId}`);

    const [profiles, folders, metaProfiles] = await Promise.all([
      api("/api/v1/qualityprofile"),
      api("/api/v1/rootfolder"),
      api("/api/v1/metadataprofile"),
    ]);

    const mediaFolder =
      folders.find((f: { path: string }) => f.path.includes("/media/")) ||
      folders[0];

    const qpId =
      qualityProfileId ??
      pickDefaultProfile(profiles, LIDARR_DEFAULT_PATTERNS)?.id ??
      profiles[0]?.id;
    const metaId =
      pickDefaultMetadataProfile(metaProfiles)?.id ?? metaProfiles[0]?.id;
    try {
      const created = await api("/api/v1/artist", {
        method: "POST",
        body: JSON.stringify({
          ...artistData,
          qualityProfileId: qpId,
          metadataProfileId: metaId,
          rootFolderPath: mediaFolder?.path || "/music",
          monitored: false,
          addOptions: {
            searchForMissingAlbums: false,
            monitor: "none",
          },
        }),
      });
      artistId = created.id;
      artistAlreadyExisted = false;
    } catch (err: unknown) {
      // Recovery path for stale cache: getArtistByForeignId said the
      // artist wasn't in Lidarr, but Lidarr itself rejects the POST
      // with 400 "This artist has already been added." In that case
      // our local cache is stale — invalidate and re-fetch, then use
      // whatever Lidarr actually has. Anything else re-throws.
      const msg = err instanceof Error ? err.message : String(err);
      const isDuplicate =
        err instanceof ArrApiError &&
        err.status === 400 &&
        /artist has already been added/i.test(msg);
      if (!isDuplicate) throw err;
      invalidateArtistCache();
      const refreshed = await getArtistByForeignId(foreignArtistId);
      if (!refreshed) {
        // Cache miss after invalidation — Lidarr and our lookup
        // disagree. Bail with a clear message, preserving cause.
        throw new Error(
          `Lidarr reports artist ${foreignArtistId} already added but we can't find it in /api/v1/artist — manual Lidarr cleanup may be needed`,
          { cause: err },
        );
      }
      artistId = refreshed.id;
      artistAlreadyExisted = true;
    }
  }

  // If we reach this point having just created a new artist, also bust
  // the cache so a subsequent addSingleReleaseGroup for the same artist
  // in the next ~60s doesn't re-POST and trip the 400 again.
  if (!artistAlreadyExisted) invalidateArtistCache();

  // Find the album (release-group) in Lidarr's catalog for this artist.
  // For a newly-added artist, Lidarr may need a moment to populate albums;
  // retry briefly to give the metadata refresh a chance. If Lidarr itself
  // is unreachable (network error), break immediately — more retries
  // won't help and we'd just waste 3s of wall time per request.
  let matchedAlbum: LidarrAlbum | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const albums = await getAlbumsForArtist(artistId);
      matchedAlbum =
        albums.find((a) => a.foreignAlbumId === releaseGroupId) || null;
      if (matchedAlbum) break;
    } catch (err: unknown) {
      if (err instanceof ArrApiError && err.isNetworkError) {
        throw err; // Lidarr is down; bail immediately
      }
      // Transient 4xx/5xx — fall through to retry
    }
    await new Promise((r) => setTimeout(r, 750));
  }

  if (!matchedAlbum) {
    throw new Error(
      `Release-group ${releaseGroupId} not found under artist after add — ` +
        `the artist's metadata profile may exclude Singles/EPs`,
    );
  }

  // If already monitored and exists on disk, treat as already-available
  if (matchedAlbum.monitored && artistAlreadyExisted) {
    return { id: matchedAlbum.id, alreadyExists: true };
  }

  await setAlbumMonitored([matchedAlbum.id], true);
  await triggerAlbumSearch([matchedAlbum.id]);

  return { id: matchedAlbum.id, alreadyExists: false };
}

export async function getArtist(arrId: number) {
  return api(`/api/v1/artist/${arrId}`);
}

/**
 * Fetch a single album by its Lidarr album ID.
 *
 * Used by the status-checker when a music request was created via
 * addSingleReleaseGroup — in that flow the arrId stored on the
 * Request is the ALBUM id, not the artist id. Calling getArtist with
 * an album id returns 404, which historically made the poller mark
 * the request as "Deleted from *arr" even when the album was
 * downloading fine.
 */
export async function getAlbum(arrId: number) {
  return api(`/api/v1/album/${arrId}`);
}

export async function getHistory(pageSize = 50) {
  return api(
    `/api/v1/history?pageSize=${pageSize}&sortKey=date&sortDirection=descending`,
  );
}

export async function getIndexerStats() {
  return api("/api/v1/indexerstats");
}

export async function getQueue() {
  return api("/api/v1/queue?pageSize=50");
}

export async function getSystemStatus() {
  return api("/api/v1/system/status");
}
export async function getDiskSpace() {
  return api("/api/v1/diskspace");
}
export async function getWantedMissing(pageSize = 20) {
  return api(`/api/v1/wanted/missing?pageSize=${pageSize}`);
}
export async function getWantedCutoff(pageSize = 20) {
  return api(`/api/v1/wanted/cutoff?pageSize=${pageSize}`);
}
export async function getCalendar() {
  return api("/api/v1/calendar");
}

export interface LidarrCalendarAlbum {
  title: string;
  foreignAlbumId: string;
  albumType?: string;
  releaseDate?: string;
  monitored: boolean;
  artist?: { artistName: string; foreignArtistId: string };
}

/** Albums by artists in Lidarr releasing between `start` and `end`,
 *  monitored or not. */
export async function getCalendarRange(start: Date, end: Date): Promise<LidarrCalendarAlbum[]> {
  const q = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
    unmonitored: "true",
    includeArtist: "true",
  });
  return api(`/api/v1/calendar?${q}`);
}
export async function getBlocklist(pageSize = 10) {
  return api(`/api/v1/blocklist?pageSize=${pageSize}`);
}
export async function getTasks() {
  return api("/api/v1/system/task");
}
export async function getDownloadClients() {
  return api("/api/v1/downloadclient");
}
export async function getRootFolders() {
  return api("/api/v1/rootfolder");
}
export async function getQualityProfiles() {
  return api("/api/v1/qualityprofile");
}
export async function deleteQueueItem(queueId: number, blocklist = true) {
  return api(
    `/api/v1/queue/${queueId}?removeFromClient=true&blocklist=${blocklist}`,
    { method: "DELETE" },
  );
}

export async function getLibrary() {
  return api("/api/v1/artist");
}
