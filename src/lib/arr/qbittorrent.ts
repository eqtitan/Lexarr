const BASE = process.env.QBITTORRENT_URL!;
const USER = process.env.QBITTORRENT_USER!;
const PASS = process.env.QBITTORRENT_PASS!;

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/v2/auth/login`, {
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
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: `SID=${sid}` },
  });
  if (!res.ok) throw new Error(`qBittorrent GET ${path}: ${res.status}`);
  return res.json();
}

/** Add a torrent from URL. Returns the info hash for tracking. */
export async function addTorrentFromUrl(
  torrentUrl: string,
  savePath: string = "/data/torrents",
  category: string = "default"
): Promise<string> {
  const sid = await login();

  // Add the torrent
  const body = new URLSearchParams({
    urls: torrentUrl,
    savepath: savePath,
    category,
  });
  const res = await fetch(`${BASE}/api/v2/torrents/add`, {
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
  const torrents: any[] = await qbGet(
    `/api/v2/torrents/info?category=${encodeURIComponent(category)}&sort=added_on&reverse=true&limit=5`,
    sid
  ).catch(() => []);

  const newest = torrents[0];
  return newest?.hash ?? "";
}

/** Get a single torrent by its info hash */
export async function getTorrentByHash(hash: string): Promise<any | null> {
  try {
    const sid = await login();
    const list: any[] = await qbGet(
      `/api/v2/torrents/info?hashes=${hash}`,
      sid
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
  const completeStates = ["uploading", "stalledUP", "pausedUP", "forcedUP", "checkingUP"];
  return completeStates.includes(t.state) || t.progress === 1;
}

/** Get all torrents in a category */
export async function getTorrentsByCategory(category: string): Promise<any[]> {
  try {
    const sid = await login();
    return qbGet(
      `/api/v2/torrents/info?category=${encodeURIComponent(category)}`,
      sid
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
    const res = await fetch(`${BASE}/api/v2/app/version`, {
      headers: { Cookie: `SID=${sid}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
