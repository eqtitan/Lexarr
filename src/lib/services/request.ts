/**
 * Request service — business logic for media request creation.
 * Extracted from src/app/api/request/route.ts.
 */
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { routeToArr } from "@/lib/arr/router";
import { notify } from "@/lib/notifications";
import { log } from "@/lib/log";
import { updateRequestIfStatus } from "@/lib/request-transition";
import { searchCache } from "@/lib/cache";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import type { MediaType, MusicReleaseType, BookFormat } from "@/types";
import { userFacingError } from "@/lib/user-facing-error";

// P-03: narrow client type so checkDuplicate can be called inside a
// $transaction without losing the Request model's type. The transaction
// client from prisma.$transaction(async (tx) => ...) structurally matches.
type RequestClient = Pick<typeof prisma, "request">;

// P-03: sentinel thrown inside the dedupe transaction to signal a duplicate
// and trigger rollback. Caught outside the transaction and converted back
// to a DuplicateError response.
class DuplicateRequestError extends Error {
  constructor(public readonly dupError: DuplicateError) {
    super("duplicate request");
    this.name = "DuplicateRequestError";
  }
}

// ── Types ────────────────────────────────────────────────────────────

interface CreateRequestInput {
  userId: string;
  mediaType: MediaType;
  externalId: string;
  title: string;
  year?: string;
  posterUrl?: string;
  artistId?: string;
  qualityProfileId?: number;
  releaseType?: MusicReleaseType;
  bookFormat?: BookFormat;
}

interface ValidationError {
  ok: false;
  error: string;
  status: 400;
}

interface DuplicateError {
  ok: false;
  error: string;
  status: 409;
  request: Awaited<ReturnType<typeof prisma.request.findFirst>>;
}

interface QuotaError {
  ok: false;
  error: string;
  status: 429;
}

interface CreateRequestSuccess {
  ok: true;
  request: Awaited<ReturnType<typeof prisma.request.create>>;
  arrError?: string;
}

export type CreateRequestResult =
  | ValidationError
  | DuplicateError
  | QuotaError
  | CreateRequestSuccess;

// ── Validation ───────────────────────────────────────────────────────

/**
 * Hosts the search modules take poster/cover art from (tmdb.ts,
 * musicbrainz.ts, openlib.ts incl. its Google Books fallback). The client
 * sends posterUrl back with a request and admins' browsers later load it,
 * so anything else -- a tracking pixel, an internal URL -- is refused.
 */
const POSTER_HOSTS = [
  "image.tmdb.org",
  "coverartarchive.org",
  "covers.openlibrary.org",
  "books.google.com",
  "books.googleusercontent.com",
];

export function isKnownPosterUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false; // not a URL at all
  }
  // Google Books still hands out http:// thumbnails.
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return POSTER_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

const VALID_MEDIA_TYPES: MediaType[] = ["movie", "tv", "music", "book"];

export function validateRequestInput(input: {
  mediaType?: string;
  externalId?: string;
  title?: string;
  year?: string;
  posterUrl?: string;
}): ValidationError | null {
  const { mediaType, externalId, title, year, posterUrl } = input;

  if (!mediaType || !externalId || !title) {
    return { ok: false, error: "Missing required fields", status: 400 };
  }
  if (!VALID_MEDIA_TYPES.includes(mediaType as MediaType)) {
    return { ok: false, error: "Invalid media type", status: 400 };
  }
  if (typeof title !== "string" || title.length < 1 || title.length > 500) {
    return { ok: false, error: "Title must be 1-500 characters", status: 400 };
  }
  if (
    typeof externalId !== "string" ||
    externalId.length < 1 ||
    externalId.length > 200
  ) {
    return { ok: false, error: "Invalid external ID", status: 400 };
  }
  if (year && (typeof year !== "string" || !/^\d{4}$/.test(year))) {
    return { ok: false, error: "Year must be 4 digits", status: 400 };
  }
  if (posterUrl && (typeof posterUrl !== "string" || posterUrl.length > 500 || !isKnownPosterUrl(posterUrl))) {
    return { ok: false, error: "Invalid poster URL", status: 400 };
  }

  return null;
}

// ── Quality profile check ────────────────────────────────────────────

// Same cache key/TTL as src/app/api/quality-profiles/route.ts, so a
// profile list the client already fetched for the dropdown is reused here
// instead of hitting the *arr again.
const QUALITY_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Checks qualityProfileId against the *arr's real profile list. Returns
 * false only when the list was fetched successfully and the ID isn't in
 * it -- if the *arr can't be reached, this fails open (returns true) so a
 * transient outage doesn't block every request; the existing post-hoc
 * arrError path still surfaces a real *arr failure to the user.
 */
async function isValidQualityProfileId(
  mediaType: "movie" | "tv",
  profileId: number,
): Promise<boolean> {
  const cacheKey = `quality-profiles:${mediaType}`;
  let profiles = searchCache.get(cacheKey) as { id: number; name: string }[] | undefined;
  if (!profiles) {
    try {
      profiles =
        mediaType === "movie"
          ? await radarr.getQualityProfiles()
          : await sonarr.getQualityProfiles();
      searchCache.set(cacheKey, profiles, QUALITY_PROFILE_CACHE_TTL_MS);
    } catch (err: unknown) {
      log.error("quality-profile validation fetch failed", { mediaType, err });
      return true;
    }
  }
  return (profiles ?? []).some((p) => p.id === profileId);
}

// ── Duplicate check ──────────────────────────────────────────────────

/** Statuses that no longer block a new request for the same title. */
const INACTIVE_STATUSES = ["denied", "cancelled"] as const;

export async function checkDuplicate(
  externalId: string,
  mediaType: string,
  bookFormat?: BookFormat,
  client: RequestClient = prisma,
): Promise<DuplicateError | null> {
  // Books are unique on (externalId, mediaType, bookFormat) because the
  // same OpenLibrary work can be legitimately requested as both an ebook
  // and an audiobook — they're separate fulfillments in LazyLibrarian.
  // A null bookFormat in the DB (legacy pre-0.17 rows) is treated as
  // "ebook" for duplicate-detection purposes.
  //
  // P-03: `client` defaults to the global prisma singleton but accepts a
  // $transaction client so the check + subsequent create can happen
  // atomically. @@index([externalId, mediaType]) on Request makes this
  // cheap.
  //
  // Denied and cancelled requests don't count -- matching the
  // Request_active_dedupe_idx partial unique index (WHERE status NOT IN
  // ('denied','cancelled')). Without this filter a title that was ever
  // denied or cancelled could never be requested again by anyone.
  const where =
    mediaType === "book"
      ? {
          externalId,
          mediaType,
          status: { notIn: [...INACTIVE_STATUSES] },
          OR: [
            { bookFormat: bookFormat ?? "ebook" },
            ...(bookFormat === "ebook" || bookFormat === undefined
              ? [{ bookFormat: null }]
              : []),
          ],
        }
      : { externalId, mediaType, status: { notIn: [...INACTIVE_STATUSES] } };

  const existing = await client.request.findFirst({ where });
  if (existing) {
    return {
      ok: false,
      error: "Already requested",
      status: 409,
      request: existing,
    };
  }
  return null;
}

// ── Shared arr-routing + status update logic ─────────────────────────

export async function sendToArrAndUpdateStatus(
  request: Awaited<ReturnType<typeof prisma.request.create>>,
  opts: {
    mediaType: MediaType;
    externalId: string;
    artistId?: string;
    title: string;
    userName: string;
    posterUrl?: string;
    qualityProfileId?: number;
    releaseType?: MusicReleaseType;
    bookFormat?: BookFormat;
    /**
     * On a send error, mark the request failed (default). The background
     * auto-retry passes false: the request stays "approved" and the caller
     * decides when it has run out of attempts.
     */
    failOnError?: boolean;
  },
): Promise<string | undefined> {
  let arrError: string | undefined;

  try {
    const result = await routeToArr({
      mediaType: opts.mediaType,
      externalId: opts.externalId,
      externalId2: opts.artistId,
      title: opts.title,
      qualityProfileId: opts.qualityProfileId,
      releaseType: opts.releaseType,
      bookFormat: opts.bookFormat,
    });

    if (result.arrId !== undefined) {
      // For books, store the LazyLibrarian ID for polling
      if (opts.mediaType === "book") {
        await prisma.request.update({
          where: { id: request.id },
          data: { externalId2: result.bookId ?? String(result.arrId) },
        });
      }

      // Always start in "downloading" — the 60s status-checker verifies
      // actual file presence (Radarr hasFile, Sonarr percentOfEpisodes,
      // Lidarr percentOfTracks) before promoting to "available".
      // `alreadyExists` from the *arr router only means the title is in
      // the library, not that any files exist on disk — relying on it
      // here previously caused false-Available rows for series/movies/
      // albums that had been added but never downloaded.
      //
      // The arrId is stored unconditionally (a cancel that lands mid-send
      // needs it to pull the item back out of the *arr queue), but the
      // status only moves if the request is still "approved" -- see
      // updateRequestIfStatus.
      await prisma.request.update({
        where: { id: request.id },
        data: { arrId: result.arrId || null },
      });
      request.arrId = result.arrId;
      const moved = await updateRequestIfStatus(request.id, "approved", {
        status: "downloading",
      });
      if (moved) {
        request.status = "downloading";
        await prisma.pipelineEvent.create({
          data: {
            requestId: request.id,
            event: "sent_to_arr",
            detail: JSON.stringify({
              arrId: result.arrId,
              alreadyExists: result.alreadyExists,
              qualityProfileId: result.qualityProfileId,
              rootFolderPath: result.rootFolderPath,
            }),
          },
        });
      }
    }
  } catch (err: unknown) {
    arrError = err instanceof Error ? err.message : String(err);
    log.error("request.sendToArr failed", {
      requestId: request.id,
      mediaType: opts.mediaType,
      err,
    });
    if (opts.failOnError === false) return arrError;

    const moved = await updateRequestIfStatus(request.id, "approved", {
      status: "failed",
      lastError: userFacingError(arrError),
    });

    if (moved) {
      await prisma.pipelineEvent.create({
        data: {
          requestId: request.id,
          event: "failed",
          detail: JSON.stringify({ error: arrError }),
        },
      });

      void notify({
        event: "failed",
        title: opts.title,
        mediaType: opts.mediaType,
        status: "failed",
        user: opts.userName,
        detail: arrError,
      });
    }
  }

  return arrError;
}

// ── Main create-request flow ─────────────────────────────────────────

export async function createRequest(
  input: CreateRequestInput,
): Promise<CreateRequestResult> {
  const {
    userId,
    mediaType,
    externalId,
    title,
    year,
    posterUrl,
    artistId,
    qualityProfileId,
    releaseType,
    bookFormat,
  } = input;

  // Validation
  const validationError = validateRequestInput({
    mediaType,
    externalId,
    title,
    year,
    posterUrl,
  });
  if (validationError) return validationError;

  if (
    qualityProfileId !== undefined &&
    (mediaType === "movie" || mediaType === "tv") &&
    !(await isValidQualityProfileId(mediaType, qualityProfileId))
  ) {
    return { ok: false, error: "Invalid quality profile", status: 400 };
  }

  // Quota check (before the dedupe tx — a concurrent burst can still
  // slip one over the cap, but quota is a soft guard, not security).
  const dbUser =
    userId !== "system"
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;

  if (dbUser && dbUser.maxRequests > 0 && dbUser.role !== "admin") {
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);
    const monthlyCount = await prisma.request.count({
      where: { userId, createdAt: { gte: currentMonth } },
    });
    if (monthlyCount >= dbUser.maxRequests) {
      return {
        ok: false,
        error: `Monthly request limit reached (${dbUser.maxRequests})`,
        status: 429,
      };
    }
  }

  const autoApprove =
    dbUser?.autoApprove || dbUser?.role === "admin" || userId === "system";

  // P-03 + partial-unique: dedupe + create atomically. The transaction is
  // belt; the partial unique index `Request_active_dedupe_idx` (added in
  // 20260421203000) is suspenders — even if two concurrent transactions
  // both pass the in-tx checkDuplicate read, only one INSERT can succeed
  // because the unique index covers active rows. The other gets P2002,
  // which we map back to the same 409 dup-error shape.
  //
  // SQLite's default isolation in WAL mode is effectively Serializable for
  // writes, and Prisma doesn't accept isolationLevel on SQLite. When/if we
  // move to Postgres (post-1.0.0), add:
  //   { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  // as the second arg to $transaction to preserve this guarantee.
  let request: Awaited<ReturnType<typeof prisma.request.create>>;
  try {
    request = await prisma.$transaction(async (tx) => {
      // Re-check inside the tx using the tx client so the read sees the
      // serialized snapshot, not a stale read from before.
      const dupError = await checkDuplicate(
        externalId,
        mediaType,
        bookFormat,
        tx,
      );
      if (dupError) throw new DuplicateRequestError(dupError);

      return tx.request.create({
        data: {
          userId,
          mediaType,
          externalId,
          title,
          year,
          externalId2: artistId || undefined,
          posterPath: posterUrl,
          status: autoApprove ? "approved" : "pending",
          approvedAt: autoApprove ? new Date() : undefined,
          source: "lexarr",
          releaseType: releaseType || undefined,
          bookFormat: bookFormat || undefined,
        },
      });
    });
  } catch (err) {
    if (err instanceof DuplicateRequestError) return err.dupError;
    // Partial-unique index race: two concurrent txs both passed the read,
    // only one INSERT won. Re-fetch the winning row so we can return the
    // same { 409, request } shape as the in-tx checkDuplicate path.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await checkDuplicate(externalId, mediaType, bookFormat);
      if (existing) return existing;
      // Defensive: if checkDuplicate now returns null (race window closed
      // between P2002 and our re-read), surface a generic 409.
      return {
        ok: false as const,
        error: "Already requested",
        status: 409 as const,
        request: null,
      };
    }
    throw err;
  }

  // Log pipeline events
  await prisma.pipelineEvent.create({
    data: { requestId: request.id, event: "submitted" },
  });

  // Fire notification
  void notify({
    event: "submitted",
    title,
    mediaType,
    status: autoApprove ? "approved" : "pending",
    user: dbUser?.name || "Unknown",
    posterUrl,
  });

  if (autoApprove) {
    await prisma.pipelineEvent.create({
      data: {
        requestId: request.id,
        event: "approved",
        detail: JSON.stringify({ auto: true }),
      },
    });
  }

  if (!autoApprove) {
    return { ok: true, request };
  }

  // Route to the correct *arr app
  const arrError = await sendToArrAndUpdateStatus(request, {
    mediaType,
    externalId,
    artistId,
    title,
    userName: dbUser?.name || "Unknown",
    posterUrl,
    qualityProfileId,
    releaseType,
    bookFormat,
  });

  return { ok: true, request, arrError };
}
