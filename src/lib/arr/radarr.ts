import { arrFetch, ArrApiError, type ArrFetchOptions } from "./_fetch";
import { env } from "@/lib/env";
import { pickDefaultProfile, RADARR_DEFAULT_PATTERNS } from "./quality-profile";
import { libraryCache } from "@/lib/cache";

const base = () => `${env().ARR_HOST}:7878`;
const apiKey = () => env().RADARR_API_KEY!;

// Default T to `any` to match the historical signature. Individual call sites
// can narrow with `api<Movie>(...)` when stricter typing is useful.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function api<T = any>(path: string, options: ArrFetchOptions = {}) {
  return arrFetch<T>("Radarr", base(), path, {
    ...options,
    headers: { "X-Api-Key": apiKey(), ...options.headers },
  });
}

export async function health() {
  return api("/api/v3/health");
}

export async function lookup(term: string) {
  return api(`/api/v3/movie/lookup?term=${encodeURIComponent(term)}`);
}

/** Check if a movie already exists in Radarr by TMDB ID */
export async function getMovieByTmdbId(tmdbId: number) {
  const movies: { id: number; hasFile: boolean }[] = await api(`/api/v3/movie?tmdbId=${tmdbId}`);
  return movies[0] || null;
}

/** Get all movies with 60s cache for batch lookups -- same pattern as
 *  sonarr.ts's getAllSeriesCached(), used by library-status.ts's
 *  checkMovies() to avoid one Radarr request per search result. */
export async function getAllMoviesCached(): Promise<
  { id: number; tmdbId: number; hasFile: boolean }[]
> {
  const cached = libraryCache.get("radarr:movies");
  if (cached) return cached as { id: number; tmdbId: number; hasFile: boolean }[];
  const movies: { id: number; tmdbId: number; hasFile: boolean }[] = await api(
    "/api/v3/movie",
  );
  libraryCache.set("radarr:movies", movies);
  return movies;
}

export async function addMovie(tmdbId: number, _title: string, qualityProfileId?: number) {
  // Check if already exists
  const existing = await getMovieByTmdbId(tmdbId);
  if (existing) {
    return { id: existing.id, alreadyExists: true, hasFile: existing.hasFile };
  }

  // Lookup to get full movie data Radarr needs
  const lookupResults = await api(`/api/v3/movie/lookup?term=tmdb:${tmdbId}`);
  const movieData = lookupResults[0];
  if (!movieData)
    throw new Error(`Movie not found in Radarr lookup: tmdb:${tmdbId}`);

  const [profiles, folders] = await Promise.all([
    api("/api/v3/qualityprofile"),
    api("/api/v3/rootfolder"),
  ]);

  // Use the media root folder (prefer /data/media/movies over download folders)
  const mediaFolder =
    folders.find((f: { path: string }) => f.path.includes("/media/")) || folders[0];

  // Pick a capped WEB/HD profile by name, falling back to any non-"Any"
  // profile. The old fallback `profiles[0]?.id` returned "Any" which
  // allows CAM, workprint, Remux-2160p — blowing any size caps.
  const profileId =
    qualityProfileId ??
    pickDefaultProfile(profiles, RADARR_DEFAULT_PATTERNS)?.id;

  try {
    const result = await api("/api/v3/movie", {
      method: "POST",
      body: JSON.stringify({
        ...movieData,
        qualityProfileId: profileId,
        rootFolderPath: mediaFolder?.path || "/movies",
        monitored: true,
        addOptions: { searchForMovie: true },
      }),
    });
    // Drop the batch library cache so library-status reflects the new
    // movie right away instead of up to 60s later.
    libraryCache.delete("radarr:movies");
    return {
      id: result.id,
      alreadyExists: false,
      hasFile: false,
      qualityProfileId: profileId,
      rootFolderPath: mediaFolder?.path || "/movies",
    };
  } catch (err: unknown) {
    // TOCTOU recovery: two near-simultaneous requests for the same movie
    // can both pass the getMovieByTmdbId() check above before either POST
    // lands. Radarr rejects the second with 400 "already been added" --
    // treat that as success and re-fetch, same pattern lidarr.ts already
    // uses for addSingleReleaseGroup.
    const msg = err instanceof Error ? err.message : String(err);
    const isDuplicate =
      err instanceof ArrApiError &&
      err.status === 400 &&
      /already been added/i.test(msg);
    if (!isDuplicate) throw err;
    const existing = await getMovieByTmdbId(tmdbId);
    if (!existing) {
      throw new Error(
        `Radarr reports movie tmdb:${tmdbId} already added but it can't be found via /api/v3/movie`,
        { cause: err },
      );
    }
    return { id: existing.id, alreadyExists: true, hasFile: existing.hasFile };
  }
}

/**
 * Unmonitor a movie in Radarr (used when an admin cancels a request).
 * Deliberately unmonitors rather than deletes: Radarr keeps the metadata,
 * so a future re-request for the same title adds cleanly instead of
 * losing history, and nothing on disk is touched. Radarr's PUT expects
 * the full movie object back, so GET-modify-PUT like addMovie's own
 * lookup step. Best-effort by design -- caller (cancelRequest) already
 * treats *arr cleanup as best-effort and won't block cancellation on it.
 */
export async function setMovieMonitored(
  arrId: number,
  monitored: boolean,
): Promise<void> {
  const movie = await api(`/api/v3/movie/${arrId}`);
  await api(`/api/v3/movie/${arrId}`, {
    method: "PUT",
    body: JSON.stringify({ ...movie, monitored }),
  });
  libraryCache.delete("radarr:movies");
}

export async function getQueue() {
  return api("/api/v3/queue?pageSize=50");
}

export async function getMovie(arrId: number) {
  return api(`/api/v3/movie/${arrId}`);
}

export async function getQueueDetails() {
  return api("/api/v3/queue?pageSize=100&includeUnknownMovieItems=false");
}

export async function getHistory(pageSize = 50) {
  return api(
    `/api/v3/history?pageSize=${pageSize}&sortKey=date&sortDirection=descending`,
  );
}

export async function getIndexerStats() {
  return api("/api/v3/indexerstats");
}

export async function getSystemStatus() {
  return api("/api/v3/system/status");
}
export async function getDiskSpace() {
  return api("/api/v3/diskspace");
}
export async function getWantedMissing(pageSize = 20) {
  return api(`/api/v3/wanted/missing?pageSize=${pageSize}`);
}
export async function getWantedCutoff(pageSize = 20) {
  return api(`/api/v3/wanted/cutoff?pageSize=${pageSize}`);
}
export async function getCalendar() {
  return api("/api/v3/calendar");
}
export async function getBlocklist(pageSize = 10) {
  return api(`/api/v3/blocklist?pageSize=${pageSize}`);
}
export async function getTasks() {
  return api("/api/v3/system/task");
}
export async function getDownloadClients() {
  return api("/api/v3/downloadclient");
}
export async function getRootFolders() {
  return api("/api/v3/rootfolder");
}
export async function getQualityProfiles() {
  return api("/api/v3/qualityprofile");
}
export async function deleteQueueItem(queueId: number, blocklist = true) {
  return api(
    `/api/v3/queue/${queueId}?removeFromClient=true&blocklist=${blocklist}`,
    { method: "DELETE" },
  );
}

export async function getLibrary() {
  return api("/api/v3/movie");
}

export interface RadarrParseResult {
  movie?: { id: number; title: string; hasFile: boolean } | null;
}

/** Parse a raw filename/folder name and return the matched movie.
 *  Used by orphan cleanup to determine whether content is already imported. */
export async function parse(title: string): Promise<RadarrParseResult> {
  return api<RadarrParseResult>(
    `/api/v3/parse?title=${encodeURIComponent(title)}`,
  );
}
