import { arrFetch, ArrApiError, type ArrFetchOptions } from "./_fetch";

const BASE = `${process.env.ARR_HOST}:8686`;
const KEY = process.env.LIDARR_API_KEY!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function api<T = any>(path: string, options: ArrFetchOptions = {}) {
  return arrFetch<T>("Lidarr", BASE, path, {
    ...options,
    headers: { "X-Api-Key": KEY, ...options.headers },
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

/** Get all artists with 60s cache for batch lookups */
export async function getAllArtistsCached(): Promise<{ id: number; foreignArtistId: string }[]> {
  const cached = libraryCache.get("lidarr:artists");
  if (cached) return cached as { id: number; foreignArtistId: string }[];
  const artists: { id: number; foreignArtistId: string }[] = await api("/api/v1/artist");
  libraryCache.set("lidarr:artists", artists);
  return artists;
}

/** Check if an artist already exists in Lidarr by MusicBrainz ID */
export async function getArtistByForeignId(foreignArtistId: string) {
  const artists = await getAllArtistsCached();
  return artists.find((a) => a.foreignArtistId === foreignArtistId) || null;
}

export async function addArtist(foreignArtistId: string, _artistName: string) {
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

  const result = await api("/api/v1/artist", {
    method: "POST",
    body: JSON.stringify({
      ...artistData,
      qualityProfileId: profiles[0]?.id,
      metadataProfileId: metaProfiles[0]?.id,
      rootFolderPath: mediaFolder?.path || "/music",
      monitored: true,
      addOptions: { searchForMissingAlbums: true },
    }),
  });
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

    const created = await api("/api/v1/artist", {
      method: "POST",
      body: JSON.stringify({
        ...artistData,
        qualityProfileId: profiles[0]?.id,
        metadataProfileId: metaProfiles[0]?.id,
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
  }

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
