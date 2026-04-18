import { arrFetch, type ArrFetchOptions } from "./_fetch";
import { pickDefaultProfile, RADARR_DEFAULT_PATTERNS } from "./quality-profile";

const BASE = `${process.env.ARR_HOST}:7878`;
const KEY = process.env.RADARR_API_KEY!;

// Default T to `any` to match the historical signature. Individual call sites
// can narrow with `api<Movie>(...)` when stricter typing is useful.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function api<T = any>(path: string, options: ArrFetchOptions = {}) {
  return arrFetch<T>("Radarr", BASE, path, {
    ...options,
    headers: { "X-Api-Key": KEY, ...options.headers },
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
  return { id: result.id, alreadyExists: false, hasFile: false };
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
