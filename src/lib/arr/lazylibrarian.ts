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

export type LazyLibrarianBookType = "eBook" | "AudioBook";

interface LazyLibrarianBook {
  BookID?: string;
  bookid?: string;
  BookName?: string;
  bookname?: string;
  /** Ebook download status: "Wanted" | "Have" | "Skipped" | "Ignored" | "Open" */
  Status?: string;
  status?: string;
  /** Audiobook download status, present when LL's audio_tab setting is enabled */
  AudioStatus?: string;
  audiostatus?: string;
}

/** Extract the relevant status field for the requested format. */
function statusForType(
  book: LazyLibrarianBook,
  bookType: LazyLibrarianBookType = "eBook",
): string | null {
  if (bookType === "AudioBook") {
    return book.AudioStatus || book.audiostatus || null;
  }
  return book.Status || book.status || null;
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

/**
 * Get a book's download status: "Wanted" | "Have" | "Skipped" | "Ignored".
 *
 * When `bookType === "AudioBook"`, returns the audiobook `AudioStatus`
 * field LL exposes when `audio_tab=1` is set in its config. Callers that
 * don't pass a type get the ebook status for backward compatibility.
 */
export async function getBookStatus(
  bookId: string,
  bookType: LazyLibrarianBookType = "eBook",
): Promise<string | null> {
  const book = await getBook(bookId);
  if (!book) return null;
  return statusForType(book, bookType);
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
 *
 * `bookType` defaults to "eBook" for backward compatibility; pass
 * "AudioBook" to route the request to LL's audiobook pipeline. LL's
 * `type` querystring parameter tells `queueBook`/`searchBook` which
 * status field (`Status` vs `AudioStatus`) to mark Wanted and which
 * destination folder + search categories to use. Requires LL's
 * `audio_tab=1` config setting for AudioBook calls to succeed.
 *
 * Returns { id, alreadyExists } to match the *arr integration pattern.
 */
export async function addBook(
  bookId: string,
  bookType: LazyLibrarianBookType = "eBook",
): Promise<{ id: string; alreadyExists: boolean }> {
  // Check if the book already has the requested format in the library.
  // A book may be "Have" on ebook and still need audiobook fetch, or vice
  // versa — statusForType dispatches on the per-format field.
  const existing = await getBook(bookId);
  const existingStatus = existing ? statusForType(existing, bookType) : null;
  if (existing && (existingStatus === "Have" || existingStatus === "Wanted")) {
    return { id: bookId, alreadyExists: existingStatus === "Have" };
  }

  // addBook adds the book but LL defaults author to "Paused" and book to "Skipped"
  await api("addBook", { id: bookId });
  // queueBook sets the book status to "Wanted" so LL will actually search for it.
  // The `type` parameter is what tells LL to queue the audiobook side instead
  // of the ebook side (or both, if caller wants eBook after an AudioBook add).
  // If this fails the request would sit in "approved" forever with no indication,
  // so let the error bubble — the router marks the Request as "failed" with a
  // useful lastError, and the admin's retry button recovers.
  await api("queueBook", { id: bookId, type: bookType });
  // searchBook failures are less critical — the book is already Wanted; LL will
  // pick it up on the next RSS sweep even if this immediate search call fails.
  // We do log the failure so operators see chronic issues.
  try {
    await api("searchBook", { id: bookId, type: bookType });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[lazylibrarian] searchBook(${bookId}, ${bookType}) failed: ${msg} — book is Wanted, LL will retry on RSS sweep`);
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
  bookType: LazyLibrarianBookType = "eBook",
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

  return addBook(String(bestId), bookType);
}

/** Force a search for a wanted book — triggers LL to re-scan indexers.
 *  Logged on failure; book stays in Wanted state so LL will retry via RSS. */
export async function searchForBook(
  bookId: string,
  bookType: LazyLibrarianBookType = "eBook",
): Promise<void> {
  try {
    await api("searchForBook", { id: bookId, type: bookType });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[lazylibrarian] searchForBook(${bookId}, ${bookType}) failed: ${msg}`);
  }
}

export async function getQueue() {
  const data = await api("getWanted");
  return { records: Array.isArray(data) ? data : [] };
}
