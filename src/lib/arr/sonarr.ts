import { arrFetch, ArrApiError, type ArrFetchOptions } from "./_fetch";
import { env } from "@/lib/env";
import { pickDefaultProfile, SONARR_DEFAULT_PATTERNS } from "./quality-profile";
import { getTvdbIdForTmdbTv } from "@/lib/search/tmdb";

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

type CachedSeries = { id: number; tmdbId: number; tvdbId?: number };

/** Get all series with 60s cache for batch lookups */
export async function getAllSeriesCached(): Promise<CachedSeries[]> {
  const cached = libraryCache.get("sonarr:series");
  if (cached) return cached as CachedSeries[];
  const series: CachedSeries[] = await api("/api/v3/series");
  libraryCache.set("sonarr:series", series);
  return series;
}

/** Check if a series already exists in Sonarr by TMDB ID */
export async function getSeriesByTmdbId(tmdbId: number) {
  const series = await getAllSeriesCached();
  return series.find((s) => s.tmdbId === tmdbId) || null;
}

/** Shown when TheTVDB doesn't list the show yet, so Sonarr can't add it. */
export const NOT_ON_TVDB_MESSAGE =
  "Not on TheTVDB yet, so Sonarr can't add it — re-request once TheTVDB lists it";

/**
 * Find the Sonarr lookup record for a TMDB TV id -- and ONLY that show.
 *
 * Sonarr is TVDB-based. Its `term=tmdb:<id>` lookup, when TVDB has no
 * mapping for that TMDB id, returns the show whose *TVDB* id equals the
 * number -- a different show. Lexarr used to take lookup[0] blindly, which
 * added the wrong series for 5 of 33 TV requests in production (e.g. "V:
 * The Final Battle" → "Intervention", "The Mandalorian and Grogu" →
 * "Outlander"). Now: resolve the real TVDB id through TMDB and look that up;
 * fall back to `tmdb:` only when TMDB is unreachable, and then accept only a
 * result whose tmdbId matches. No match → NOT_ON_TVDB_MESSAGE, never a guess.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findSeriesForTmdb(tmdbId: number): Promise<{ tvdbId: number | null; record: any | null }> {
  let tvdbId: number | null = null;
  let tmdbReachable = true;
  try {
    tvdbId = await getTvdbIdForTmdbTv(tmdbId);
  } catch {
    tmdbReachable = false;
  }

  if (tvdbId) {
    const results = await lookup(`tvdb:${tvdbId}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const record = (results as any[]).find((r) => r.tvdbId === tvdbId) ?? null;
    return { tvdbId, record };
  }
  if (tmdbReachable) return { tvdbId: null, record: null }; // TMDB says: not on TVDB

  const results = await lookup(`tmdb:${tmdbId}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const record = (results as any[]).find((r) => r.tmdbId === tmdbId) ?? null;
  return { tvdbId: record?.tvdbId ?? null, record };
}

export async function addSeries(tmdbId: number, _title: string, qualityProfileId?: number) {
  // Check if already exists
  const existing = await getSeriesByTmdbId(tmdbId);
  if (existing) {
    return { id: existing.id, alreadyExists: true };
  }

  const { tvdbId, record: seriesData } = await findSeriesForTmdb(tmdbId);
  if (tvdbId) {
    // Sonarr sometimes has the right show without a tmdbId on it -- match by TVDB.
    const byTvdb = (await getAllSeriesCached()).find((s) => s.tvdbId === tvdbId);
    if (byTvdb) return { id: byTvdb.id, alreadyExists: true };
  }
  if (!seriesData) throw new Error(NOT_ON_TVDB_MESSAGE);

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
    return {
      id: result.id,
      alreadyExists: false,
      qualityProfileId: profileId,
      rootFolderPath: mediaFolder?.path || "/tv",
    };
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
    const all = await getAllSeriesCached();
    const existing =
      all.find((s) => s.tmdbId === tmdbId) ?? (tvdbId ? all.find((s) => s.tvdbId === tvdbId) : undefined);
    if (!existing) {
      throw new Error(
        `Sonarr reports series tmdb:${tmdbId} already added but it can't be found via /api/v3/series`,
        { cause: err },
      );
    }
    return { id: existing.id, alreadyExists: true };
  }
}

/**
 * Unmonitor a series in Sonarr (used when an admin cancels a request).
 * Unmonitors rather than deletes -- see radarr.ts's setMovieMonitored for
 * the rationale (same pattern). Sonarr's PUT expects the full series
 * object back, so GET-modify-PUT like addSeries's own lookup step.
 */
export async function setSeriesMonitored(
  arrId: number,
  monitored: boolean,
): Promise<void> {
  const series = await api(`/api/v3/series/${arrId}`);
  await api(`/api/v3/series/${arrId}`, {
    method: "PUT",
    body: JSON.stringify({ ...series, monitored }),
  });
  libraryCache.delete("sonarr:series");
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
