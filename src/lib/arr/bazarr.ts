const BASE = process.env.BAZARR_URL || "http://192.168.1.100:6767";
const KEY = process.env.BAZARR_API_KEY!;

async function _api(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-API-KEY": KEY },
  });
  if (!res.ok) throw new Error(`Bazarr ${path}: ${res.status}`);
  return res.json();
}

export async function health() {
  // /health is unauthenticated and always returns 200 when Bazarr is up
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error(`Bazarr /health: ${res.status}`);
  return res.text();
}
