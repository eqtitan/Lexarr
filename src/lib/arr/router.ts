/**
 * Shared *arr routing logic.
 * Routes media requests to the correct *arr application.
 * Used by both auto-approve (POST /api/request) and manual approve (PATCH /api/admin/requests).
 */
import * as radarr from "./radarr";
import * as sonarr from "./sonarr";
import * as lidarr from "./lidarr";
import * as lazylibrarian from "./lazylibrarian";
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
      const [_bookKey, authorHint] = externalId.split("|");
      let result: { id: string; alreadyExists: boolean };

      // Books default to ebook when the caller didn't specify a format —
      // this preserves behaviour for existing callers (e.g. retry flow
      // replaying a pre-0.17 request that never had bookFormat stored).
      const llType = input.bookFormat === "audiobook" ? "AudioBook" : "eBook";

      if (externalId2 && externalId2 !== externalId) {
        result = await lazylibrarian.addBook(externalId2, llType);
      } else {
        result = await lazylibrarian.addBookByTitle(title, authorHint, llType);
      }

      return {
        arrId: parseInt(result.id, 10) || 0,
        alreadyExists: result.alreadyExists,
      };
    }

    default:
      throw new Error(`Unknown media type: ${mediaType}`);
  }
}
