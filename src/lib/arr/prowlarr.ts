const BASE = process.env.ARR_HOST
  ? `${process.env.ARR_HOST}:9696`
  : "http://192.168.1.100:9696";
const KEY = process.env.PROWLARR_API_KEY!;

async function api(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-Api-Key": KEY },
  });
  if (!res.ok) throw new Error(`Prowlarr ${path}: ${res.status}`);
  return res.json();
}

export interface ProwlarrResult {
  guid: string;
  title: string;
  size: number;
  indexerId: number;
  indexer: string;
  publishDate: string;
  downloadUrl: string;
  seeders?: number;
  leechers?: number;
  protocol: "torrent" | "usenet";
  fileName?: string;
}

export async function health() {
  return api("/api/v1/health");
}

export interface ProwlarrIndexerStat {
  indexerId: number;
  indexerName: string;
  averageResponseTime?: number;
  numberOfQueries?: number;
  numberOfGrabs?: number;
  numberOfRssQueries?: number;
  numberOfFailedQueries?: number;
  numberOfFailedRssQueries?: number;
  numberOfFailedGrabs?: number;
}

/** Aggregated indexer statistics across all apps (Prowlarr is the central indexer). */
export async function getIndexerStats(): Promise<{ indexers: ProwlarrIndexerStat[] }> {
  return api("/api/v1/indexerstats");
}
