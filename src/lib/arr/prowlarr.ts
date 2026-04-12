const BASE = process.env.ARR_HOST ? `${process.env.ARR_HOST}:9696` : "http://192.168.1.100:9696";
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
