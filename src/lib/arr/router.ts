/**
 * Shared *arr routing logic.
 * Routes media requests to the correct *arr application.
 * Used by both auto-approve (POST /api/request) and manual approve (PATCH /api/admin/requests).
 */
import * as radarr from "./radarr";
import * as sonarr from "./sonarr";
import * as lidarr from "./lidarr";
import * as lazylibrarian from "./lazylibrarian";
import type { MediaType } from "@/types";

export interface RouteResult {
  arrId?: number;
  alreadyExists?: boolean;
}

interface RouteInput {
  mediaType: MediaType;
  externalId: string;
  externalId2?: string | null;
  title: string;
}

/**
 * Route a request to the appropriate *arr service.
 * Returns tracking IDs for status polling.
 */
export async function routeToArr(input: RouteInput): Promise<RouteResult> {
  const { mediaType, externalId, externalId2, title } = input;

  switch (mediaType) {
    case "movie": {
      const result = await radarr.addMovie(Number(externalId), title);
      return { arrId: result.id, alreadyExists: result.alreadyExists };
    }

    case "tv": {
      const result = await sonarr.addSeries(Number(externalId), title);
      return { arrId: result.id, alreadyExists: result.alreadyExists };
    }

    case "music": {
      const lidarrId = externalId2 || externalId;
      const result = await lidarr.addArtist(lidarrId, title);
      return { arrId: result.id, alreadyExists: result.alreadyExists };
    }

    case "book": {
      const [bookKey, authorHint] = externalId.split("|");
      let result: { id: string; alreadyExists: boolean };

      if (externalId2 && externalId2 !== externalId) {
        result = await lazylibrarian.addBook(externalId2);
      } else {
        result = await lazylibrarian.addBookByTitle(title, authorHint);
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
