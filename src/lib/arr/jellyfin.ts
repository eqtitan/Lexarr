const BASE = process.env.JELLYFIN_URL || "http://192.168.1.100:8096";

export async function health() {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error(`Jellyfin /health: ${res.status}`);
  return res.text();
}
