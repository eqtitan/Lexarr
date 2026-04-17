import { arrFetch, ARR_TIMEOUT_MS } from "./_fetch";

const PORT = process.env.LAZYLIBRARIAN_PORT || "5299";
const BASE = `${process.env.ARR_HOST}:${PORT}`;
const KEY = process.env.LAZYLIBRARIAN_API_KEY || "";

// LazyLibrarian's /api endpoint is querystring-based, not REST path-based,
// and its writes return plain-text "OK" rather than JSON. The shared
// arrFetch handles the Content-Type heuristic; we still need to parse
// text responses that happen to be JSON (read endpoints return JSON text
// with Content-Type: text/html sometimes).
async function api(cmd: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ cmd, apikey: KEY, ...params });
  const raw = await arrFetch<string | unknown>(
    "LazyLibrarian",
    BASE,
    `/api?${qs}`,
    { timeoutMs: ARR_TIMEOUT_MS },
  );
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
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
  // queueBook sets the book status to "Wanted" so LL will actually search for it.
  // If this fails the request would sit in "approved" forever with no indication,
  // so let the error bubble — the router marks the Request as "failed" with a
  // useful lastError, and the admin's retry button recovers.
  await api("queueBook", { id: bookId });
  // searchBook failures are less critical — the book is already Wanted; LL will
  // pick it up on the next RSS sweep even if this immediate search call fails.
  // We do log the failure so operators see chronic issues.
  try {
    await api("searchBook", { id: bookId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[lazylibrarian] searchBook(${bookId}) failed: ${msg} — book is Wanted, LL will retry on RSS sweep`);
  }
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

/** Force a search for a wanted book — triggers LL to re-scan indexers.
 *  Logged on failure; book stays in Wanted state so LL will retry via RSS. */
export async function searchForBook(bookId: string): Promise<void> {
  try {
    await api("searchForBook", { id: bookId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[lazylibrarian] searchForBook(${bookId}) failed: ${msg}`);
  }
}

export async function getQueue() {
  const data = await api("getWanted");
  return { records: Array.isArray(data) ? data : [] };
}
