import { arrFetch, ARR_TIMEOUT_MS } from "./_fetch";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

const port = () => env().LAZYLIBRARIAN_PORT || "5299";
const base = () => `${env().ARR_HOST}:${port()}`;
const apiKey = () => env().LAZYLIBRARIAN_API_KEY || "";

// LazyLibrarian's /api endpoint is querystring-based, not REST path-based,
// and its writes return plain-text "OK" rather than JSON. The shared
// arrFetch handles the Content-Type heuristic; we still need to parse
// text responses that happen to be JSON (read endpoints return JSON text
// with Content-Type: text/html sometimes).
async function api(cmd: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ cmd, apikey: apiKey(), ...params });
  const raw = await arrFetch<string | unknown>(
    "LazyLibrarian",
    base(),
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
  } catch (err) {
    log.debug("lazylibrarian: health check failed", { err });
    return false;
  }
}

export type LazyLibrarianBookType = "eBook" | "AudioBook";

interface LazyLibrarianBook {
  BookID?: string;
  bookid?: string;
  BookName?: string;
  bookname?: string;
  AuthorID?: string;
  authorid?: string;
  AuthorName?: string;
  authorname?: string;
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
  } catch (err) {
    log.debug("lazylibrarian: book lookup failed", { err });
    return null;
  }
}

/**
 * Get a book's download status: "Wanted" | "Have" | "Skipped" | "Ignored" | "Open".
 *
 * When `bookType === "AudioBook"`, returns the audiobook `AudioStatus`
 * field LL exposes when `audio_tab=1` is set in its config. Callers that
 * don't pass a type get the ebook status for backward compatibility.
 *
 * Audiobook-specific nuance: LL flags an audiobook as "Open" once the
 * file is detected in the library folder but its post-processor hasn't
 * finished renaming/metadata-tagging yet. For our purposes (file
 * playable in Jellyfin) "Open" + an `AudioFile` set on the row means
 * the file is already on disk — callers that care about availability
 * (status-checker) should treat that as available. This function
 * returns the raw status string; interpretation lives at the caller.
 */
export async function getBookStatus(
  bookId: string,
  bookType: LazyLibrarianBookType = "eBook",
): Promise<string | null> {
  const book = await getBook(bookId);
  if (!book) return null;
  return statusForType(book, bookType);
}

/**
 * Check whether an audiobook's physical file is present on disk — which
 * is all that matters for Jellyfin playback. Returns true for both
 * "Have" (LL fully post-processed) and "Open" (file exists, post-proc
 * not yet finalized). Using getBookStatus alone misses the "Open" case
 * and would leave Lexarr stuck showing "downloading" indefinitely.
 */
export async function isAudiobookOnDisk(bookId: string): Promise<boolean> {
  const book = await getBook(bookId);
  if (!book) return false;
  const status = statusForType(book, "AudioBook");
  return status === "Have" || status === "Open";
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

  // CRITICAL: only call addBook if LL doesn't already know the book. LL's
  // addBook endpoint spawns a background thread that re-fetches metadata
  // via GoodReads/OpenLibrary and REWRITES the Status + AudioStatus rows
  // back to their NEWAUTHOR_STATUS / NEWAUDIO_STATUS defaults (typically
  // "Skipped"). If we then call queueBook, a race occurs — sometimes our
  // Wanted flip sticks, sometimes the refresher thread overwrites it.
  // Symptom: queueBook returns "OK" but AudioStatus stays "Skipped" and
  // LL never searches. Fix is to skip the re-add entirely when LL
  // already has the book, regardless of its per-format status.
  if (!existing) {
    // `wait` param forces addBook to run synchronously; otherwise LL
    // returns immediately and we'd race with the background thread when
    // queueBook runs a moment later.
    await api("addBook", { id: bookId, wait: "1" });
  }

  // queueBook sets the book's per-format status to "Wanted" so LL will
  // search for it. The `type` parameter is what tells LL to queue the
  // audiobook side (AudioStatus) instead of the ebook side (Status).
  // If this fails the request would sit in "approved" forever with no
  // indication, so let the error bubble — the router marks the Request
  // as "failed" with a useful lastError, and the admin's retry recovers.
  await api("queueBook", { id: bookId, type: bookType });

  // Resume the author — LL defaults new authors to "Paused" and paused
  // authors are SKIPPED by the cron search sweep. Without this a Wanted
  // book sits forever because no search ever runs for it. Best-effort:
  // re-fetch the book post-queue so we have the AuthorID reliably (it
  // may not have been on the initial lookup response in some LL builds).
  const refreshed = await getBook(bookId).catch((err: unknown) => {
    log.debug("lazylibrarian: re-fetching book after queue failed", { err });
    return null;
  });
  const authorId = refreshed?.AuthorID || refreshed?.authorid;
  if (authorId) {
    await resumeAuthor(String(authorId));
  }

  // searchBook failures are less critical — the book is already Wanted; LL will
  // pick it up on the next RSS sweep even if this immediate search call fails.
  // We do log the failure so operators see chronic issues.
  try {
    await api("searchBook", { id: bookId, type: bookType });
  } catch (err: unknown) {
    log.warn("lazylibrarian.searchBook failed; book is Wanted, LL will retry on RSS sweep", { bookId, bookType, err });
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

/**
 * Resume an author in LazyLibrarian, best-effort.
 *
 * LL defaults newly-added authors to Status="Paused", and its cron
 * searches do NOT run for paused authors — even if the book underneath
 * is marked Wanted, the search never fires. Whenever we queue a book
 * we resume its author to unblock the scheduled search sweep. Silent on
 * failure: if LL is restarting or the author doesn't exist yet, leave
 * a warning and let the cron sort it out.
 */
export async function resumeAuthor(authorId: string): Promise<void> {
  try {
    await api("resumeAuthor", { id: authorId });
  } catch (err: unknown) {
    log.warn("lazylibrarian.resumeAuthor failed", { authorId, err });
  }
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
    log.warn("lazylibrarian.searchForBook failed", { bookId, bookType, err });
  }
}

export async function getQueue() {
  const data = await api("getWanted");
  return { records: Array.isArray(data) ? data : [] };
}
