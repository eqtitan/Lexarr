const BASE = `${process.env.ARR_HOST}:8989`;
const KEY = process.env.SONARR_API_KEY!;

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "X-Api-Key": KEY, "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sonarr ${path}: ${res.status} ${body}`);
  }
  return res.json();
}

export async function health() {
  return api("/api/v3/health");
}

export async function lookup(term: string) {
  return api(`/api/v3/series/lookup?term=${encodeURIComponent(term)}`);
}

/** Check if a series already exists in Sonarr by TMDB ID */
export async function getSeriesByTmdbId(tmdbId: number) {
  const series: any[] = await api("/api/v3/series");
  return series.find((s) => s.tmdbId === tmdbId) || null;
}

export async function addSeries(tmdbId: number, title: string) {
  // Check if already exists
  const existing = await getSeriesByTmdbId(tmdbId);
  if (existing) {
    return { id: existing.id, alreadyExists: true };
  }

  // Sonarr lookup supports tmdb: prefix to get full series data with tvdbId
  const lookupResults = await api(`/api/v3/series/lookup?term=tmdb:${tmdbId}`);
  const seriesData = lookupResults[0];
  if (!seriesData) throw new Error(`Series not found in Sonarr lookup: tmdb:${tmdbId}`);

  const [profiles, folders] = await Promise.all([
    api("/api/v3/qualityprofile"),
    api("/api/v3/rootfolder"),
  ]);

  const mediaFolder = folders.find((f: any) => f.path.includes("/media/")) || folders[0];

  const result = await api("/api/v3/series", {
    method: "POST",
    body: JSON.stringify({
      ...seriesData,
      qualityProfileId: profiles[0]?.id,
      rootFolderPath: mediaFolder?.path || "/tv",
      monitored: true,
      addOptions: { searchForMissingEpisodes: true },
    }),
  });
  return { id: result.id, alreadyExists: false };
}

export async function getQueue() {
  return api("/api/v3/queue?pageSize=50");
}

export async function getSeries(arrId: number) {
  return api(`/api/v3/series/${arrId}`);
}

export async function getHistory(pageSize = 50) {
  return api(`/api/v3/history?pageSize=${pageSize}&sortKey=date&sortDirection=descending`);
}

export async function getIndexerStats() {
  return api("/api/v3/indexerstats");
}

export async function getSystemStatus() { return api("/api/v3/system/status"); }
export async function getDiskSpace() { return api("/api/v3/diskspace"); }
export async function getWantedMissing(pageSize = 20) { return api(`/api/v3/wanted/missing?pageSize=${pageSize}`); }
export async function getWantedCutoff(pageSize = 20) { return api(`/api/v3/wanted/cutoff?pageSize=${pageSize}`); }
export async function getCalendar() { return api("/api/v3/calendar"); }
export async function getBlocklist(pageSize = 10) { return api(`/api/v3/blocklist?pageSize=${pageSize}`); }
export async function getTasks() { return api("/api/v3/system/task"); }
export async function getDownloadClients() { return api("/api/v3/downloadclient"); }
export async function getRootFolders() { return api("/api/v3/rootfolder"); }
export async function getQualityProfiles() { return api("/api/v3/qualityprofile"); }
export async function getLibrary() { return api("/api/v3/series"); }
