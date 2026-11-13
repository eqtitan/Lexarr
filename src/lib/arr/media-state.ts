/**
 * "What does the *arr say about this request?" -- one answer per media type.
 *
 * The status checker used to spell this out three times (the main poll, the
 * stall check and the webhook path), each with its own subset of the rules.
 * Every per-request caller now asks here and uses the fields it needs.
 * (Batch library lookups for search results stay in
 * services/library-status.ts: they fetch a whole cached library at once.)
 */
import * as radarr from "./radarr";
import { log } from "@/lib/log";
import * as sonarr from "./sonarr";
import * as lidarr from "./lidarr";
import * as lazylibrarian from "./lazylibrarian";
import type { ArrQueueRecord } from "@/types/external-apis";

export interface MediaStateRequest {
  mediaType: string;
  arrId: number | null;
  externalId: string;
  externalId2: string | null;
  releaseType: string | null;
  bookFormat: string | null;
}

export interface MediaState {
  /** Fully on disk. */
  available: boolean;
  /** 0-100, how much of it is on disk. */
  percent: number;
  /**
   * In the *arr's download queue. Only looked up when `checkQueue` is set
   * and the item isn't available; for books it means "in LazyLibrarian's
   * Wanted list", which is still searching, not downloading.
   */
  inQueue: boolean;
  /** The *arr id now tracks a different title (deleted and re-added). */
  identityMismatch: string | null;
  /** Movies only: not released yet, so not expected to download.
   *  `inTheaters`: showing in cinemas, no digital/physical date known yet. */
  unreleased: { releaseDate: string | null; inTheaters?: boolean } | null;
}

export interface MediaStateOptions {
  checkQueue?: boolean;
  /** Compare the *arr's record against the request's external ids. */
  checkIdentity?: boolean;
  now?: Date;
}

const NOTHING: MediaState = {
  available: false,
  percent: 0,
  inQueue: false,
  identityMismatch: null,
  unreleased: null,
};

function queueHas(records: ArrQueueRecord[] | undefined, match: (r: ArrQueueRecord) => boolean) {
  return (records || []).some(match);
}

export async function getMediaState(
  req: MediaStateRequest,
  opts: MediaStateOptions = {},
): Promise<MediaState> {
  const { checkQueue = false, checkIdentity = false, now = new Date() } = opts;
  const arrId = req.arrId;

  if (req.mediaType === "movie" && arrId) {
    const movie = await radarr.getMovie(arrId);
    const identityMismatch =
      checkIdentity && movie.tmdbId && req.externalId && String(movie.tmdbId) !== String(req.externalId)
        ? `Radarr id ${arrId} now tracks tmdbId=${movie.tmdbId} but request expected tmdbId=${req.externalId}`
        : null;

    const digital = movie.digitalRelease ? new Date(movie.digitalRelease) : null;
    const physical = movie.physicalRelease ? new Date(movie.physicalRelease) : null;
    const earliest = digital && physical ? (digital < physical ? digital : physical) : digital || physical;
    let unreleased: MediaState["unreleased"] = null;
    if (earliest && earliest > now) {
      unreleased = { releaseDate: earliest.toISOString().split("T")[0] };
    } else if (movie.status === "inCinemas" && !earliest) {
      // In theaters with no home-release date yet: Radarr won't find a
      // release until it streams, so this is waiting, not stuck. Before
      // this, such titles stalled at 12h and auto-failed at ~60h.
      unreleased = { releaseDate: null, inTheaters: true };
    } else if (movie.status === "announced" && !earliest) {
      unreleased = { releaseDate: null };
    }

    const available = movie.hasFile === true;
    const inQueue =
      checkQueue && !available
        ? queueHas((await radarr.getQueue())?.records, (r) => r.movieId === arrId)
        : false;
    return { available, percent: available ? 100 : 0, inQueue, identityMismatch, unreleased };
  }

  if (req.mediaType === "tv" && arrId) {
    const series = await sonarr.getSeries(arrId);
    // Lexarr stores the tmdbId in externalId, same as for movies.
    const identityMismatch =
      checkIdentity &&
      series.tmdbId &&
      req.externalId &&
      /^\d+$/.test(String(req.externalId)) &&
      String(series.tmdbId) !== String(req.externalId)
        ? `Sonarr id ${arrId} now tracks tmdbId=${series.tmdbId} but request expected tmdbId=${req.externalId}`
        : null;
    const percent = series.statistics?.percentOfEpisodes ?? 0;
    const available = percent === 100;
    const inQueue =
      checkQueue && !available
        ? queueHas((await sonarr.getQueue())?.records, (r) => r.seriesId === arrId)
        : false;
    return { ...NOTHING, available, percent, inQueue, identityMismatch };
  }

  if (req.mediaType === "music" && arrId) {
    // Two flavors: release-group requests (0.16.1+, releaseType set) store
    // the Lidarr *album* id as arrId; full-artist requests store the artist
    // id. Calling getArtist with an album id 404s, which used to mark the
    // request "Deleted from *arr" by mistake.
    if (req.releaseType) {
      const album = await lidarr.getAlbum(arrId);
      // Release-group requests keep the MusicBrainz RG id in externalId.
      const identityMismatch =
        checkIdentity && album.foreignAlbumId && req.externalId && album.foreignAlbumId !== req.externalId
          ? `Lidarr album ${arrId} now tracks RG=${album.foreignAlbumId} but request expected ${req.externalId}`
          : null;
      const percent = album.statistics?.percentOfTracks ?? 0;
      const available = percent === 100 && (album.statistics?.trackFileCount ?? 0) > 0;
      const inQueue =
        checkQueue && !available
          ? queueHas((await lidarr.getQueue())?.records, (r) => r.albumId === arrId)
          : false;
      return { ...NOTHING, available, percent, inQueue, identityMismatch };
    }
    const artist = await lidarr.getArtist(arrId);
    const identityMismatch =
      checkIdentity && artist.foreignArtistId && req.externalId2 && artist.foreignArtistId !== req.externalId2
        ? `Lidarr id ${arrId} now tracks MBID=${artist.foreignArtistId} but request expected ${req.externalId2}`
        : null;
    const percent = artist.statistics?.percentOfTracks ?? 0;
    const available = artist.statistics?.albumCount > 0 && percent === 100;
    const inQueue =
      checkQueue && !available
        ? queueHas((await lidarr.getQueue())?.records, (r) => r.artistId === arrId)
        : false;
    return { ...NOTHING, available, percent, inQueue, identityMismatch };
  }

  if (req.mediaType === "book") {
    const bookId = req.externalId2 || (arrId ? String(arrId) : "");
    if (!bookId) return NOTHING;
    // Audiobooks: LazyLibrarian often leaves them at "Open" (file on disk,
    // post-processing unfinished); Jellyfin can already play them, so
    // isAudiobookOnDisk counts that as available. Legacy rows with a null
    // bookFormat are ebooks.
    const available =
      req.bookFormat === "audiobook"
        ? await lazylibrarian.isAudiobookOnDisk(bookId)
        : (await lazylibrarian.getBookStatus(bookId, "eBook")) === "Have";
    let inQueue = false;
    if (checkQueue && !available) {
      const wanted = await lazylibrarian.getQueue().catch((err: unknown) => {
        log.debug("media-state: LazyLibrarian wanted list unavailable", { err });
        return { records: [] };
      });
      inQueue = (wanted.records as { BookID?: string; id?: string }[]).some(
        (r) => String(r.BookID) === bookId || String(r.id) === bookId,
      );
    }
    return { ...NOTHING, available, percent: available ? 100 : 0, inQueue };
  }

  return NOTHING;
}
