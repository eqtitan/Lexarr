import { ARR_TIMEOUT_MS, ArrApiError } from "./_fetch";
import { getBreaker } from "./circuit-breaker";

const SERVICE = "qBittorrent";

interface QbTorrent {
  hash: string;
  name: string;
  save_path: string;
  state: string;
  progress: number;
  size: number;
}

const BASE = process.env.QBITTORRENT_URL!;
const USER = process.env.QBITTORRENT_USER!;
const PASS = process.env.QBITTORRENT_PASS!;

/** qBittorrent uses cookie-based sessions, so it doesn't fit arrFetch's
 *  pattern cleanly. We wrap each raw fetch in an AbortController with the
 *  shared timeout so a hung qBit can't stall the whole dashboard, and run
 *  it through the same circuit breaker every other *arr integration uses
 *  so a down qBittorrent fails fast instead of every caller (orphans scan,
 *  status checks) independently paying a full login + 15s timeout. */
async function qbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const breaker = getBreaker(SERVICE);
  breaker.beforeRequest(path); // throws ArrApiError if open

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ARR_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
    });
    // Mirrors arrFetch's breaker semantics: only network/5xx/408/429 count
    // as "service is failing" (see recordFailure). A 404 on a bad hash is
    // a legitimate response, not a qBittorrent outage.
    const counts = res.status >= 500 || res.status === 408 || res.status === 429;
    if (counts) {
      breaker.recordFailure(new ArrApiError(SERVICE, path, res.status, ""));
    } else {
      breaker.recordSuccess();
    }
    return res;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown network error";
    breaker.recordFailure(new ArrApiError(SERVICE, path, 0, detail));
    throw new ArrApiError(SERVICE, path, 0, detail);
  } finally {
    clearTimeout(timeout);
  }
}

async function login(): Promise<string> {
  const res = await qbFetch(`/api/v2/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: USER, password: PASS }),
  });
  const text = await res.text();
  if (text !== "Ok.") throw new Error(`qBittorrent login failed: ${text}`);
  const setCookie = res.headers.get("set-cookie") || "";
  const sid = setCookie.match(/SID=([^;]+)/)?.[1];
  if (!sid) throw new Error("qBittorrent: no SID in response");
  return sid;
}

async function qbGet(path: string, sid: string) {
  const res = await qbFetch(path, { headers: { Cookie: `SID=${sid}` } });
  if (!res.ok) throw new Error(`qBittorrent GET ${path}: ${res.status}`);
  return res.json();
}

/** Add a torrent from URL. Returns the info hash for tracking. */
export async function addTorrentFromUrl(
  torrentUrl: string,
  savePath: string = "/data/torrents",
  category: string = "default",
): Promise<string> {
  const sid = await login();

  // Add the torrent
  const body = new URLSearchParams({
    urls: torrentUrl,
    savepath: savePath,
    category,
  });
  const res = await qbFetch(`/api/v2/torrents/add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: `SID=${sid}`,
    },
    body,
  });
  const text = await res.text();
  if (text !== "Ok.") throw new Error(`qBittorrent add failed: ${text}`);

  // Give qBittorrent a moment to register the torrent
  await new Promise((r) => setTimeout(r, 1500));

  // Find the hash of the torrent we just added — it's the newest one in the category
  const torrents: QbTorrent[] = await qbGet(
    `/api/v2/torrents/info?category=${encodeURIComponent(category)}&sort=added_on&reverse=true&limit=5`,
    sid,
  ).catch(() => []);

  const newest = torrents[0];
  return newest?.hash ?? "";
}

/** Get a single torrent by its info hash */
export async function getTorrentByHash(hash: string): Promise<QbTorrent | null> {
  try {
    const sid = await login();
    const list: QbTorrent[] = await qbGet(
      `/api/v2/torrents/info?hashes=${hash}`,
      sid,
    );
    return list[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if a torrent is fully downloaded.
 * state values: "uploading" | "stalledUP" | "pausedUP" | "forcedUP" = complete
 * "downloading" | "stalledDL" | "pausedDL" = in progress
 */
export async function isTorrentComplete(hash: string): Promise<boolean> {
  const t = await getTorrentByHash(hash);
  if (!t) return false;
  const completeStates = [
    "uploading",
    "stalledUP",
    "pausedUP",
    "forcedUP",
    "checkingUP",
  ];
  return completeStates.includes(t.state) || t.progress === 1;
}

/** Get all torrents in a category */
export async function getTorrentsByCategory(category: string): Promise<QbTorrent[]> {
  try {
    const sid = await login();
    return qbGet(
      `/api/v2/torrents/info?category=${encodeURIComponent(category)}`,
      sid,
    );
  } catch {
    return [];
  }
}

/** Get the save path and completion status of a torrent by hash */
export async function getTorrentInfo(hash: string): Promise<{
  name: string;
  savePath: string;
  state: string;
  progress: number;
  size: number;
  hash: string;
} | null> {
  const t = await getTorrentByHash(hash);
  if (!t) return null;
  return {
    name: t.name,
    savePath: t.save_path,
    state: t.state,
    progress: t.progress,
    size: t.size,
    hash: t.hash,
  };
}

export async function health(): Promise<boolean> {
  try {
    const sid = await login();
    const res = await qbFetch(`/api/v2/app/version`, {
      headers: { Cookie: `SID=${sid}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Get every torrent regardless of category (used for orphan name matching) */
export async function getAllTorrents(): Promise<QbTorrent[]> {
  try {
    const sid = await login();
    return qbGet(`/api/v2/torrents/info`, sid);
  } catch {
    return [];
  }
}

/** Remove a torrent from qBittorrent. When deleteFiles=true the downloaded
 *  files are also removed from disk. Throws on non-2xx response. */
export async function deleteTorrent(
  hash: string,
  deleteFiles: boolean,
): Promise<void> {
  const sid = await login();
  const body = new URLSearchParams({
    hashes: hash,
    deleteFiles: String(deleteFiles),
  });
  const res = await qbFetch(`/api/v2/torrents/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: `SID=${sid}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`qBittorrent delete failed (${res.status}): ${text}`);
  }
}
