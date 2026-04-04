const BASE = `${process.env.ARR_HOST}:6969`;
const KEY = process.env.WHISPARR_API_KEY!;
const TIMEOUT_MS = 15000;

async function api(path: string, options?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "X-Api-Key": KEY, "Content-Type": "application/json", ...options?.headers },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Whisparr ${path}: ${res.status} ${body}`);
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
  return api(`/api/v3/series/lookup?term=${encodeURIComponent(term)}`);
}

/** Look up a movie in Whisparr/TPDB */
export async function lookupMovie(term: string) {
  return api(`/api/v3/movie/lookup?term=${encodeURIComponent(term)}`);
}

/** Check if a site already exists in Whisparr by foreign/TPDB ID */
export async function getSiteByForeignId(foreignId: string) {
  const sites: any[] = await api("/api/v3/series");
  return (
    sites.find(
      (s) =>
        String(s.foreignId) === String(foreignId) ||
        String(s.tpdbId) === String(foreignId)
    ) || null
  );
}

/** Check if a movie already exists in Whisparr by foreign/TPDB ID */
export async function getMovieByForeignId(foreignId: string) {
  const movies: any[] = await api("/api/v3/movie");
  return (
    movies.find(
      (m) =>
        String(m.foreignId) === String(foreignId) ||
        String(m.tpdbId) === String(foreignId)
    ) || null
  );
}

export async function addSite(foreignId: string, title: string, monitored = true) {
  const existing = await getSiteByForeignId(foreignId);
  if (existing) {
    // If unmonitored and caller wants it monitored, update it
    if (monitored && !existing.monitored) {
      await api(`/api/v3/series/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...existing, monitored: true, addOptions: { searchForMissingEpisodes: true } }),
      });
    }
    return { id: existing.id, alreadyExists: true };
  }

  const lookupResults: any[] = await lookup(title);
  const siteData =
    lookupResults.find(
      (s) =>
        String(s.foreignId) === String(foreignId) ||
        String(s.tpdbId) === String(foreignId)
    ) || lookupResults[0];

  if (!siteData) throw new Error(`Site not found in Whisparr lookup: ${title}`);

  const [profiles, folders] = await Promise.all([
    api("/api/v3/qualityprofile"),
    api("/api/v3/rootfolder"),
  ]);

  const mediaFolder =
    folders.find((f: any) => f.path.includes("/media/")) || folders[0];

  const result = await api("/api/v3/series", {
    method: "POST",
    body: JSON.stringify({
      ...siteData,
      qualityProfileId: profiles[0]?.id,
      rootFolderPath: mediaFolder?.path || "/data/media/movies-adult",
      monitored,
      addOptions: { searchForMissingEpisodes: monitored },
    }),
  });

  return { id: result.id, alreadyExists: false };
}

/** Add a movie to Whisparr. monitored param controls whether it triggers search. */
export async function addMovie(foreignId: string, title: string, monitored = true) {
  const existing = await getMovieByForeignId(foreignId);
  if (existing) {
    // If it exists but is unmonitored and we want it monitored, update it
    if (monitored && !existing.monitored) {
      await api(`/api/v3/movie/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...existing, monitored: true, addOptions: { searchForMissingMovies: true } }),
      });
    }
    return { id: existing.id, alreadyExists: true };
  }

  const lookupResults: any[] = await lookupMovie(title);
  const movieData =
    lookupResults.find(
      (m) =>
        String(m.foreignId) === String(foreignId) ||
        String(m.tpdbId) === String(foreignId)
    ) || lookupResults[0];

  if (!movieData) throw new Error(`Movie not found in Whisparr lookup: ${title}`);

  const [profiles, folders] = await Promise.all([
    api("/api/v3/qualityprofile"),
    api("/api/v3/rootfolder"),
  ]);

  const mediaFolder =
    folders.find((f: any) => f.path.includes("/media/")) || folders[0];

  const result = await api("/api/v3/movie", {
    method: "POST",
    body: JSON.stringify({
      ...movieData,
      qualityProfileId: profiles[0]?.id,
      rootFolderPath: mediaFolder?.path || "/data/media/movies-adult",
      monitored,
      addOptions: { searchForMissingMovies: monitored },
    }),
  });

  return { id: result.id, alreadyExists: false };
}

/** Get episodes/scenes for a series already in Whisparr */
export async function getEpisodes(seriesId: number) {
  return api(`/api/v3/episode?seriesId=${seriesId}`);
}

export async function getQueue() {
  return api("/api/v3/queue?pageSize=50");
}

export async function getSite(arrId: number) {
  return api(`/api/v3/series/${arrId}`);
}

export async function getQualityProfiles() {
  return api("/api/v3/qualityprofile");
}

export async function getRootFolders() {
  return api("/api/v3/rootfolder");
}
