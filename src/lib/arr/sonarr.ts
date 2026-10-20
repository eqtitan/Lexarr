import { arrFetch, ArrApiError, type ArrFetchOptions } from "./_fetch";
import { env } from "@/lib/env";
import { pickDefaultProfile, SONARR_DEFAULT_PATTERNS } from "./quality-profile";

const base = () => `${env().ARR_HOST}:8989`;
const apiKey = () => env().SONARR_API_KEY!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function api<T = any>(path: string, options: ArrFetchOptions = {}) {
  return arrFetch<T>("Sonarr", base(), path, {
    ...options,
    headers: { "X-Api-Key": apiKey(), ...options.headers },
  });
}

export async function health() {
  return api("/api/v3/health");
}

export async function lookup(term: string) {
  return api(`/api/v3/series/lookup?term=${encodeURIComponent(term)}`);
}

import { libraryCache } from "@/lib/cache";

/** Get all series with 60s cache for batch lookups */
export async function getAllSeriesCached(): Promise<{ id: number; tmdbId: number }[]> {
  const cached = libraryCache.get("sonarr:series");
  if (cached) return cached as { id: number; tmdbId: number }[];
  const series: { id: number; tmdbId: number }[] = await api("/api/v3/series");
  libraryCache.set("sonarr:series", series);
  return series;
}

/** Check if a series already exists in Sonarr by TMDB ID */
export async function getSeriesByTmdbId(tmdbId: number) {
  const series = await getAllSeriesCached();
  return series.find((s) => s.tmdbId === tmdbId) || null;
}

export async function addSeries(tmdbId: number, _title: string, qualityProfileId?: number) {
  // Check if already exists
  const existing = await getSeriesByTmdbId(tmdbId);
  if (existing) {
    return { id: existing.id, alreadyExists: true };
  }

  // Sonarr lookup supports tmdb: prefix to get full series data with tvdbId
  const lookupResults = await api(`/api/v3/series/lookup?term=tmdb:${tmdbId}`);
  const seriesData = lookupResults[0];
  if (!seriesData)
    throw new Error(`Series not found in Sonarr lookup: tmdb:${tmdbId}`);

  const [profiles, folders] = await Promise.all([
    api("/api/v3/qualityprofile"),
    api("/api/v3/rootfolder"),
  ]);

  const mediaFolder =
    folders.find((f: { path: string }) => f.path.includes("/media/")) || folders[0];

  // See comment in radarr.ts — avoids falling back to "Any" which
  // would bypass size caps.
  const profileId =
    qualityProfileId ??
    pickDefaultProfile(profiles, SONARR_DEFAULT_PATTERNS)?.id;

  try {
    const result = await api("/api/v3/series", {
      method: "POST",
      body: JSON.stringify({
        ...seriesData,
        qualityProfileId: profileId,
        rootFolderPath: mediaFolder?.path || "/tv",
        monitored: true,
        addOptions: { searchForMissingEpisodes: true },
      }),
    });
    // Drop the batch library cache so library-status reflects the new
    // series right away instead of up to 60s later.
    libraryCache.delete("sonarr:series");
    return { id: result.id, alreadyExists: false };
  } catch (err: unknown) {
    // TOCTOU recovery: getSeriesByTmdbId() above reads from a 60s cache,
    // making this race even more likely than Radarr's uncached check.
    // Sonarr rejects the second near-simultaneous POST with 400 "already
    // been added" -- treat that as success, same pattern as radarr.ts.
    const msg = err instanceof Error ? err.message : String(err);
    const isDuplicate =
      err instanceof ArrApiError &&
      err.status === 400 &&
      /already been added/i.test(msg);
    if (!isDuplicate) throw err;
    libraryCache.delete("sonarr:series");
    const existing = await getSeriesByTmdbId(tmdbId);
    if (!existing) {
      throw new Error(
        `Sonarr reports series tmdb:${tmdbId} already added but it can't be found via /api/v3/series`,
        { cause: err },
      );
    }
    return { id: existing.id, alreadyExists: true };
  }
}

export async function getQueue() {
  return api("/api/v3/queue?pageSize=50");
}

export async function getSeries(arrId: number) {
  return api(`/api/v3/series/${arrId}`);
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
  return api("/api/v3/series");
}

export interface SonarrParseResult {
  series?: { id: number; title: string } | null;
  episodes?: Array<{ hasFile: boolean }> | null;
}

/** Parse a raw filename/folder name and return the matched series + episode.
 *  Used by orphan cleanup to determine whether content is already imported. */
export async function parse(title: string): Promise<SonarrParseResult> {
  return api<SonarrParseResult>(
    `/api/v3/parse?title=${encodeURIComponent(title)}`,
  );
}
