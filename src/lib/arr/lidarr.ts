const BASE = `${process.env.ARR_HOST}:8686`;
const KEY = process.env.LIDARR_API_KEY!;

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "X-Api-Key": KEY, "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Lidarr ${path}: ${res.status} ${body}`);
  }
  return res.json();
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

/** Check if an artist already exists in Lidarr by MusicBrainz ID */
export async function getArtistByForeignId(foreignArtistId: string) {
  const artists: any[] = await api("/api/v1/artist");
  return artists.find((a) => a.foreignArtistId === foreignArtistId) || null;
}

export async function addArtist(foreignArtistId: string, artistName: string) {
  // Check if already exists
  const existing = await getArtistByForeignId(foreignArtistId);
  if (existing) {
    return { id: existing.id, alreadyExists: true };
  }

  // Lookup to get full artist data Lidarr needs
  const lookupResults = await api(`/api/v1/artist/lookup?term=lidarr:${foreignArtistId}`);
  const artistData = lookupResults[0];
  if (!artistData) throw new Error(`Artist not found in Lidarr lookup: ${foreignArtistId}`);

  const [profiles, folders, metaProfiles] = await Promise.all([
    api("/api/v1/qualityprofile"),
    api("/api/v1/rootfolder"),
    api("/api/v1/metadataprofile"),
  ]);

  const mediaFolder = folders.find((f: any) => f.path.includes("/media/")) || folders[0];

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

export async function getArtist(arrId: number) {
  return api(`/api/v1/artist/${arrId}`);
}

export async function getHistory(pageSize = 50) {
  return api(`/api/v1/history?pageSize=${pageSize}&sortKey=date&sortDirection=descending`);
}

export async function getIndexerStats() {
  return api("/api/v1/indexerstats");
}

export async function getQueue() {
  return api("/api/v1/queue?pageSize=50");
}

export async function getSystemStatus() { return api("/api/v1/system/status"); }
export async function getDiskSpace() { return api("/api/v1/diskspace"); }
export async function getWantedMissing(pageSize = 20) { return api(`/api/v1/wanted/missing?pageSize=${pageSize}`); }
export async function getWantedCutoff(pageSize = 20) { return api(`/api/v1/wanted/cutoff?pageSize=${pageSize}`); }
export async function getCalendar() { return api("/api/v1/calendar"); }
export async function getBlocklist(pageSize = 10) { return api(`/api/v1/blocklist?pageSize=${pageSize}`); }
export async function getTasks() { return api("/api/v1/system/task"); }
export async function getDownloadClients() { return api("/api/v1/downloadclient"); }
export async function getRootFolders() { return api("/api/v1/rootfolder"); }
export async function getQualityProfiles() { return api("/api/v1/qualityprofile"); }
export async function getLibrary() { return api("/api/v1/artist"); }
