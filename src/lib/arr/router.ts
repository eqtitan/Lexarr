/**
 * Shared *arr routing logic.
 * Routes media requests to the correct *arr application.
 * Used by both auto-approve (POST /api/request) and manual approve (PATCH /api/admin/requests).
 */
import * as radarr from "./radarr";
import * as sonarr from "./sonarr";
import * as lidarr from "./lidarr";
import * as lazylibrarian from "./lazylibrarian";
import { ArrApiError } from "./_fetch";
import { log } from "@/lib/log";
import type { MediaType, MusicReleaseType, BookFormat } from "@/types";

export interface RouteResult {
  arrId?: number;
  alreadyExists?: boolean;
  /** Movie/TV only, and only when the title was newly added -- the
   *  profile/folder *actually* used, which may differ from the caller's
   *  requested qualityProfileId if none was given (the *arr lib picks a
   *  default). Logged into the sent_to_arr pipeline event for diagnosing
   *  "wrong profile got used" without checking the *arr by hand. */
  qualityProfileId?: number;
  rootFolderPath?: string;
  /** Books only: LazyLibrarian's book id. Not a number since LazyLibrarian
   *  moved to OpenLibrary ("OL15992072W"), so it can't live in arrId. */
  bookId?: string;
}

interface RouteInput {
  mediaType: MediaType;
  externalId: string;
  externalId2?: string | null;
  title: string;
  qualityProfileId?: number;
  releaseType?: MusicReleaseType;
  /** Books only — "ebook" (default) or "audiobook". Maps to LL's `type` param. */
  bookFormat?: BookFormat;
}

/**
 * Route a request to the appropriate *arr service.
 * Returns tracking IDs for status polling.
 */
export async function routeToArr(input: RouteInput): Promise<RouteResult> {
  const { mediaType, externalId, externalId2, title, qualityProfileId } = input;

  switch (mediaType) {
    case "movie": {
      const result = await radarr.addMovie(Number(externalId), title, qualityProfileId);
      return {
        arrId: result.id,
        alreadyExists: result.alreadyExists,
        qualityProfileId: result.qualityProfileId,
        rootFolderPath: result.rootFolderPath,
      };
    }

    case "tv": {
      const result = await sonarr.addSeries(Number(externalId), title, qualityProfileId);
      return {
        arrId: result.id,
        alreadyExists: result.alreadyExists,
        qualityProfileId: result.qualityProfileId,
        rootFolderPath: result.rootFolderPath,
      };
    }

    case "music": {
      // All Lexarr music requests narrow-monitor at the release-group
      // level — clicking an album means "I want THIS album", not the
      // entire artist catalog. Same for singles and EPs. This applies
      // regardless of releaseType.
      //
      // If for some reason we don't have an artist MBID (externalId2),
      // fall through to whole-artist as a last resort so the request
      // doesn't 500 — but in practice every search result carries
      // artist-credit via MusicBrainz's inc=artist-credits.
      const artistForeignId = externalId2;
      if (artistForeignId) {
        const result = await lidarr.addSingleReleaseGroup(
          artistForeignId,
          externalId,
          qualityProfileId,
        );
        return { arrId: result.id, alreadyExists: result.alreadyExists };
      }
      // Fallback only (missing artist id on the search result)
      const result = await lidarr.addArtist(externalId, title, qualityProfileId);
      return { arrId: result.id, alreadyExists: result.alreadyExists };
    }

    case "book": {
      const [bookKey, authorHint] = externalId.split("|");
      // "/works/OL15992072W" -> "OL15992072W": the work the user picked.
      const workId = bookKey?.replace(/^\/works\//, "") || undefined;
      // externalId2 holds a stored LazyLibrarian id on re-sends. "0" was
      // written by 0.28.0 and earlier when an OpenLibrary id didn't parse
      // as a number; it means "none".
      const knownId =
        externalId2 && externalId2 !== "0" && externalId2 !== externalId ? externalId2 : undefined;
      let result: { id: string; alreadyExists: boolean } | undefined;

      // Books default to ebook when the caller didn't specify a format —
      // this preserves behaviour for existing callers (e.g. retry flow
      // replaying a pre-0.17 request that never had bookFormat stored).
      const llType = input.bookFormat === "audiobook" ? "AudioBook" : "eBook";

      // Add by id first: the OpenLibrary work the user picked, then a
      // stored id from an earlier send. Only then search by title --
      // LazyLibrarian's OpenLibrary title search on a generic title
      // ("Poems", "Meditations") can take minutes and time out. The work id
      // goes first so a stored GoodReads-era id (often a different edition)
      // isn't re-queued when the user's own pick works.
      const ids = [...new Set([workId, knownId].filter((x): x is string => !!x))];
      for (const id of ids) {
        try {
          result = await lazylibrarian.addBook(id, llType);
          break;
        } catch (err) {
          if (!isBookIdRejected(err)) throw err;
          log.warn("lazylibrarian: add by id failed, trying next", { id, err: String(err) });
        }
      }
      result ??= await lazylibrarian.addBookByTitle(title, authorHint, llType, workId);

      return {
        arrId: /^\d+$/.test(result.id) ? Number(result.id) : 0,
        bookId: result.id,
        alreadyExists: result.alreadyExists,
      };
    }

    default:
      throw new Error(`Unknown media type: ${mediaType}`);
  }
}

/**
 * LazyLibrarian refused or dropped this particular id (an HTTP error, or
 * it answered OK without adding the book), so another id or a title search
 * may still work. Network errors and timeouts (status 0) mean LazyLibrarian
 * itself is down; those stop the send.
 */
function isBookIdRejected(err: unknown): boolean {
  if (err instanceof lazylibrarian.BookNotAddedError) return true;
  return err instanceof ArrApiError && err.status !== 0;
}
