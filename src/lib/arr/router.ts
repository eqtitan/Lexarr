/**
 * Shared *arr routing logic.
 * Routes media requests to the correct *arr application.
 * Used by both auto-approve (POST /api/request) and manual approve (PATCH /api/admin/requests).
 */
import * as radarr from "./radarr";
import * as sonarr from "./sonarr";
import * as lidarr from "./lidarr";
import * as whisparr from "./whisparr";
import * as lazylibrarian from "./lazylibrarian";
import type { MediaType } from "@/types";

export interface RouteResult {
  arrId?: number;
  torrentHash?: string;
  alreadyExists?: boolean;
  /** Set when a prowlarr direct-grab is approved from admin without downloadUrl */
  needsReRequest?: boolean;
}

interface RouteInput {
  mediaType: MediaType;
  externalId: string;
  externalId2?: string | null;
  title: string;
  downloadUrl?: string;
  protocol?: string;
}

/**
 * Route a request to the appropriate *arr service.
 * Returns tracking IDs for status polling.
 */
export async function routeToArr(input: RouteInput): Promise<RouteResult> {
  const { mediaType, externalId, externalId2, title, downloadUrl, protocol } = input;

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
        // Caller should store result.id as externalId2 for polling
      };
    }

    case "adult": {
      if (externalId.startsWith("prowlarr:")) {
        if (!downloadUrl) {
          return { needsReRequest: true };
        }

        if (protocol === "usenet") {
          const { addNzbFromUrl } = await import("./nzbget");
          await addNzbFromUrl(downloadUrl, "adult-movies");
          return { torrentHash: undefined };
        } else {
          const { addTorrentFromUrl } = await import("./qbittorrent");
          const hash = await addTorrentFromUrl(
            downloadUrl,
            "/data/torrents/movies-adult",
            "adult-movies"
          );
          return { torrentHash: hash };
        }
      }

      const isSite = externalId.startsWith("site:");
      const foreignId = externalId.replace(/^(site|movie):/, "");
      if (isSite) {
        const result = await whisparr.addSite(foreignId, title);
        return { arrId: result.id, alreadyExists: result.alreadyExists };
      } else {
        const result = await whisparr.addMovie(foreignId, title);
        return { arrId: result.id, alreadyExists: result.alreadyExists };
      }
    }

    default:
      throw new Error(`Unknown media type: ${mediaType}`);
  }
}
