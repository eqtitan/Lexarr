const PORT = process.env.LAZYLIBRARIAN_PORT || "5299";
const BASE = `${process.env.ARR_HOST}:${PORT}`;
const KEY = process.env.LAZYLIBRARIAN_API_KEY || "";
const TIMEOUT_MS = 15000;

async function api(cmd: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ cmd, apikey: KEY, ...params });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api?${qs}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`LazyLibrarian ${cmd}: ${res.status}`);
    // LazyLibrarian returns plain text "OK" for write operations (addBook, searchBook)
    // but JSON for read operations (findBook, getVersion, getAllBooks, etc.)
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      // Not JSON — return the text wrapped so callers can check success
      return text;
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function health(): Promise<boolean> {
  try {
    const data = await api("getVersion");
    // getVersion returns { Success: true, install_type, current_version, ... }
    return !!data?.current_version || !!data?.Success;
  } catch {
    return false;
  }
}

interface LazyLibrarianBook {
  BookID?: string;
  bookid?: string;
  BookName?: string;
  bookname?: string;
  Status?: string;
  status?: string;
}

export async function searchBooks(query: string): Promise<LazyLibrarianBook[]> {
  // LL uses "findBook" to search by name, "searchBook" is for triggering download by ID
  const data = await api("findBook", { name: query });
  // LL may return a direct array, or an object like { data: [...] } depending on version
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  return [];
}

/** Get a single book by LazyLibrarian book ID */
export async function getBook(bookId: string): Promise<LazyLibrarianBook | null> {
  try {
    // getAllBooks returns all books; filter by bookid
    const data = await api("getAllBooks", {});
    if (!Array.isArray(data)) return null;
    return (
      data.find((b: LazyLibrarianBook) => String(b.BookID || b.bookid) === String(bookId)) ??
      null
    );
  } catch {
    return null;
  }
}

/** Get a book's download status: "Wanted" | "Have" | "Skipped" | "Ignored" */
export async function getBookStatus(bookId: string): Promise<string | null> {
  const book = await getBook(bookId);
  return book?.Status || book?.status || null;
}

/** Get all authors in the library */
export async function getLibrary(): Promise<unknown[]> {
  const data = await api("getIndex");
  if (!Array.isArray(data)) return [];
  return data;
}

/** Get all wanted books */
export async function getWanted(): Promise<LazyLibrarianBook[]> {
  const data = await api("getWanted");
  if (!Array.isArray(data)) return [];
  return data;
}

/**
 * Add a book by LazyLibrarian's internal book ID.
 * Returns { id, alreadyExists } to match the *arr integration pattern.
 */
export async function addBook(
  bookId: string,
): Promise<{ id: string; alreadyExists: boolean }> {
  // Check if book is already in the library
  const existing = await getBook(bookId);
  const existingStatus = existing?.Status || existing?.status;
  if (existing && (existingStatus === "Have" || existingStatus === "Wanted")) {
    return { id: bookId, alreadyExists: existingStatus === "Have" };
  }

  // addBook adds the book but LL defaults author to "Paused" and book to "Skipped"
  await api("addBook", { id: bookId });
  // queueBook sets the book status to "Wanted" so LL will actually search for it
  await api("queueBook", { id: bookId }).catch(() => null);
  // Now trigger the actual search
  await api("searchBook", { id: bookId }).catch(() => null);
  return { id: bookId, alreadyExists: false };
}

/**
 * Main integration entry point: search by title+author, find best match, add it.
 * Returns { id, alreadyExists } where id is LazyLibrarian's bookId (GoodReads ID).
 */
export async function addBookByTitle(
  title: string,
  author?: string,
): Promise<{ id: string; alreadyExists: boolean }> {
  const query = author ? `${title} ${author}` : title;
  const results = await searchBooks(query);

  if (results.length === 0) {
    throw new Error(`No results found in LazyLibrarian for: ${query}`);
  }

  // Pick best match: exact title match preferred, otherwise first result
  // LL returns lowercase keys from findBook (bookname, bookid) but uppercase from other endpoints
  const titleLower = title.toLowerCase();
  const getName = (r: LazyLibrarianBook) => r.BookName || r.bookname || "";
  const getId = (r: LazyLibrarianBook) => r.BookID || r.bookid;

  const best =
    results.find(
      (r) =>
        getName(r).toLowerCase() === titleLower ||
        getName(r).toLowerCase().includes(titleLower),
    ) ?? results[0];

  const bestId = getId(best);
  if (!bestId) {
    throw new Error(`LazyLibrarian result missing BookID for: ${query}`);
  }

  return addBook(String(bestId));
}

/** Force a search for a wanted book — triggers LL to re-scan indexers */
export async function searchForBook(bookId: string): Promise<void> {
  await api("searchForBook", { id: bookId }).catch(() => null);
}

export async function getQueue() {
  const data = await api("getWanted");
  return { records: Array.isArray(data) ? data : [] };
}
