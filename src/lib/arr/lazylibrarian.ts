const PORT = process.env.LAZYLIBRARIAN_PORT || "5299";
const BASE = `${process.env.ARR_HOST}:${PORT}`;
const KEY = process.env.LAZYLIBRARIAN_API_KEY || "";

async function api(cmd: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ cmd, apikey: KEY, ...params });
  const res = await fetch(`${BASE}/api?${qs}`);
  if (!res.ok) throw new Error(`LazyLibrarian ${cmd}: ${res.status}`);
  return res.json();
}

export async function health() {
  return api("getVersion");
}

export async function searchBooks(query: string) {
  return api("searchBook", { name: query });
}

export async function addBook(bookId: string) {
  return api("addBook", { id: bookId });
}

export async function getWanted() {
  return api("getWanted");
}
