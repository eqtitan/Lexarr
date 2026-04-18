/**
 * Request service — business logic for media request creation.
 * Extracted from src/app/api/request/route.ts.
 */
import { prisma } from "@/lib/db";
import { routeToArr } from "@/lib/arr/router";
import { notify } from "@/lib/notifications";
import type { MediaType, MusicReleaseType, BookFormat } from "@/types";

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
  if (posterUrl && (typeof posterUrl !== "string" || posterUrl.length > 500)) {
    return { ok: false, error: "Invalid poster URL", status: 400 };
  }

  return null;
}

// ── Duplicate check ──────────────────────────────────────────────────

export async function checkDuplicate(
  externalId: string,
  mediaType: string,
  bookFormat?: BookFormat,
): Promise<DuplicateError | null> {
  // Books are unique on (externalId, mediaType, bookFormat) because the
  // same OpenLibrary work can be legitimately requested as both an ebook
  // and an audiobook — they're separate fulfillments in LazyLibrarian.
  // A null bookFormat in the DB (legacy pre-0.17 rows) is treated as
  // "ebook" for duplicate-detection purposes.
  const where =
    mediaType === "book"
      ? {
          externalId,
          mediaType,
          OR: [
            { bookFormat: bookFormat ?? "ebook" },
            ...(bookFormat === "ebook" || bookFormat === undefined
              ? [{ bookFormat: null }]
              : []),
          ],
        }
      : { externalId, mediaType };

  const existing = await prisma.request.findFirst({ where });
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
          data: { externalId2: String(result.arrId) },
        });
      }

      const alreadyAvailable = result.alreadyExists;
      const newStatus = alreadyAvailable ? "available" : "downloading";
      await prisma.request.update({
        where: { id: request.id },
        data: {
          arrId: result.arrId || null,
          status: newStatus,
          availableAt: alreadyAvailable ? new Date() : undefined,
        },
      });
      request.arrId = result.arrId;
      request.status = newStatus;

      await prisma.pipelineEvent.create({
        data: {
          requestId: request.id,
          event: "sent_to_arr",
          detail: JSON.stringify({
            arrId: result.arrId,
            alreadyExists: result.alreadyExists,
          }),
        },
      });

      if (alreadyAvailable) {
        await prisma.pipelineEvent.create({
          data: {
            requestId: request.id,
            event: "available",
            detail: JSON.stringify({ alreadyExists: true }),
          },
        });
        notify({
          event: "available",
          title: opts.title,
          mediaType: opts.mediaType,
          status: "available",
          user: opts.userName,
          posterUrl: opts.posterUrl,
          detail: "Already in library",
        });
      }
    }
  } catch (err: unknown) {
    arrError = err instanceof Error ? err.message : String(err);
    console.error(`Failed to add to *arr: ${arrError}`);

    await prisma.request.update({
      where: { id: request.id },
      data: { status: "failed", lastError: arrError },
    });

    await prisma.pipelineEvent.create({
      data: {
        requestId: request.id,
        event: "failed",
        detail: JSON.stringify({ error: arrError }),
      },
    });

    notify({
      event: "failed",
      title: opts.title,
      mediaType: opts.mediaType,
      status: "failed",
      user: opts.userName,
      detail: arrError,
    });
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

  // Duplicate check — books dedupe per-format (ebook vs audiobook)
  const dupError = await checkDuplicate(externalId, mediaType, bookFormat);
  if (dupError) return dupError;

  // Quota check
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

  // Create the request in our DB
  const request = await prisma.request.create({
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

  // Log pipeline events
  await prisma.pipelineEvent.create({
    data: { requestId: request.id, event: "submitted" },
  });

  // Fire notification
  notify({
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
