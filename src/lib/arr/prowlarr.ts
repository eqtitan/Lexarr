import { arrFetch } from "./_fetch";

const BASE = `${process.env.ARR_HOST}:9696`;
const KEY = process.env.PROWLARR_API_KEY!;

function api<T = unknown>(path: string) {
  return arrFetch<T>("Prowlarr", BASE, path, {
    headers: { "X-Api-Key": KEY },
  });
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
