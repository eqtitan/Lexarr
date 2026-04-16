const BASE = `${process.env.ARR_HOST}:7878`;
const KEY = process.env.RADARR_API_KEY!;
const TIMEOUT_MS = 15000;

async function api(path: string, options?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "X-Api-Key": KEY,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Radarr ${path}: ${res.status} ${body}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
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

  const profileId = qualityProfileId ?? profiles[0]?.id;

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
