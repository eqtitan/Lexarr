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

export async function addTorrentFromUrl(
  torrentUrl: string,
  savePath: string = "/data/media/movies-adult",
  category: string = "adult-movies"
): Promise<void> {
  const sid = await login();
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
