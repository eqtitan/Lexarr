/**
 * Admin service — business logic for admin request management.
 * Extracted from src/app/api/admin/requests/route.ts.
 */
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { sendToArrAndUpdateStatus } from "./request";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";
import type { MediaType, MusicReleaseType, BookFormat } from "@/types";
import { updateRequestIfStatus } from "@/lib/request-transition";
import { REQUEST_STATUSES, canTransition, type RequestStatus } from "@/lib/request-status";

/** Every status the lifecycle lets an admin cancel from. */
const CANCELLABLE = REQUEST_STATUSES.filter((s) => canTransition(s, "cancelled"));

/**
 * Thrown when approve/deny/cancel is attempted on a request that's no
 * longer in a state that action applies to -- e.g. a double-click, two
 * open admin tabs, or a genuine concurrent update. Callers (the API
 * route) should map this to a 409.
 */
export class RequestConflictError extends Error {
  constructor(
    public readonly requestId: string,
    public readonly currentStatus: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestConflictError";
  }
}

// ── Types ────────────────────────────────────────────────────────────

interface ListRequestsResult {
  requests: Awaited<ReturnType<typeof prisma.request.findMany>>;
}

interface DenyInput {
  requestId: string;
  note?: string;
  adminId: string | null | undefined;
  adminName: string;
}

interface ApproveInput {
  requestId: string;
  note?: string;
  adminId: string | null | undefined;
  adminName: string;
}

interface ApproveResult {
  request: Awaited<ReturnType<typeof prisma.request.update>>;
  arrError?: string;
}

interface DenyResult {
  request: Awaited<ReturnType<typeof prisma.request.update>>;
}

interface CancelInput {
  requestId: string;
  note?: string;
  adminId: string | null | undefined;
  adminName: string;
}

interface CancelResult {
  request: Awaited<ReturnType<typeof prisma.request.update>>;
}

// ── List pending requests ────────────────────────────────────────────

export async function listPendingRequests(): Promise<ListRequestsResult> {
  const requests = await prisma.request.findMany({
    where: { status: "pending" },
    include: { user: { select: { name: true, avatar: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return { requests };
}

// ── Deny a request ───────────────────────────────────────────────────

export async function denyRequest(input: DenyInput): Promise<DenyResult> {
  const { requestId, note, adminId, adminName } = input;

  // Guarded write: only a still-pending request can be denied. Without
  // this, two concurrent deny calls (or a deny racing an approve) would
  // both run to completion -- duplicate pipeline events, audit entries,
  // and notifications.
  const denied = await updateRequestIfStatus(requestId, "pending", {
    status: "denied",
    adminNote: note || undefined,
  });
  if (!denied) {
    const current = await prisma.request.findUnique({ where: { id: requestId } });
    throw new RequestConflictError(
      requestId,
      current?.status ?? "unknown",
      `Request ${requestId} is no longer pending (current status: ${current?.status ?? "not found"})`,
    );
  }
  const request = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });

  await prisma.pipelineEvent.create({
    data: {
      requestId,
      event: "denied",
      detail: note ? JSON.stringify({ note }) : undefined,
    },
  });

  void logAudit(adminId, "deny_request", { type: "request", id: requestId }, { note });

  void notify({
    event: "denied",
    title: request.title,
    mediaType: request.mediaType as MediaType,
    status: "denied",
    user: adminName,
    detail: note,
  });

  return { request };
}

// ── Approve a request ────────────────────────────────────────────────

export async function approveRequest(
  input: ApproveInput,
): Promise<ApproveResult> {
  const { requestId, note, adminId, adminName } = input;

  // Guarded write: only a still-pending request can be approved -- same
  // reasoning as denyRequest above. Without it, a request already
  // denied/cancelled/available could be silently resurrected and
  // re-routed to the *arr, or approved twice (double *arr dispatch).
  const approved = await updateRequestIfStatus(requestId, "pending", {
    status: "approved",
    approvedAt: new Date(),
    adminNote: note || undefined,
  });
  if (!approved) {
    const current = await prisma.request.findUnique({ where: { id: requestId } });
    throw new RequestConflictError(
      requestId,
      current?.status ?? "unknown",
      `Request ${requestId} is no longer pending (current status: ${current?.status ?? "not found"})`,
    );
  }
  const request = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });

  await prisma.pipelineEvent.create({
    data: {
      requestId,
      event: "approved",
      detail: note ? JSON.stringify({ note }) : undefined,
    },
  });

  void logAudit(
    adminId,
    "approve_request",
    { type: "request", id: requestId },
    { note },
  );

  void notify({
    event: "approved",
    title: request.title,
    mediaType: request.mediaType as MediaType,
    status: "approved",
    user: adminName,
  });

  // Send to *arr — carry releaseType and bookFormat through so singles/EPs
  // stay narrow-monitored and audiobooks land in the audio pipeline on
  // admin approve (not just on user auto-approve).
  const arrError = await sendToArrAndUpdateStatus(request, {
    mediaType: request.mediaType as MediaType,
    externalId: request.externalId,
    artistId: request.externalId2 || undefined,
    title: request.title,
    userName: adminName,
    releaseType: (request.releaseType as MusicReleaseType | null) || undefined,
    bookFormat: (request.bookFormat as BookFormat | null) || undefined,
  });

  return { request, arrError };
}

// ── Cancel a request ────────────────────────────────────────────────

export async function cancelRequest(input: CancelInput): Promise<CancelResult> {
  const { requestId, note, adminId, adminName } = input;

  const existing = await prisma.request.findUnique({ where: { id: requestId } });
  if (!existing) {
    throw new Error(`Request not found: ${requestId}`);
  }
  // Bail before the arr-queue removal below if it's already terminal --
  // otherwise a second cancel (double-click, two admin tabs) re-runs the
  // queue-removal/notify logic for no reason.
  if (!CANCELLABLE.includes(existing.status as RequestStatus)) {
    throw new RequestConflictError(
      requestId,
      existing.status,
      `Request ${requestId} is already ${existing.status}`,
    );
  }

  // Best-effort: remove from arr queue if actively downloading, and
  // unmonitor the title in the *arr so it doesn't keep downloading in the
  // background after Lexarr considers the request cancelled. Unmonitor,
  // not delete -- keeps metadata/history so a future re-request adds
  // cleanly, and never touches files already on disk.
  if (existing.arrId) {
    try {
      const mediaType = existing.mediaType as MediaType;
      if (mediaType === "movie") {
        const queue = await radarr.getQueueDetails();
        const records = queue.records || [];
        const item = records.find(
          (r: { movieId: number }) => r.movieId === existing.arrId,
        );
        if (item) {
          await radarr.deleteQueueItem(item.id, true);
        }
        await radarr.setMovieMonitored(existing.arrId, false);
      } else if (mediaType === "tv") {
        const queue = await sonarr.getQueue();
        const records = queue.records || [];
        const item = records.find(
          (r: { seriesId: number }) => r.seriesId === existing.arrId,
        );
        if (item) {
          await sonarr.deleteQueueItem(item.id, true);
        }
        await sonarr.setSeriesMonitored(existing.arrId, false);
      } else if (mediaType === "music") {
        const queue = await lidarr.getQueue();
        const records = queue.records || [];
        const item = records.find(
          (r: { artistId: number }) => r.artistId === existing.arrId,
        );
        if (item) {
          await lidarr.deleteQueueItem(item.id, true);
        }
        // releaseType set → arrId is a narrow-monitored release-group's
        // album id (addSingleReleaseGroup); unset → arrId is the whole
        // artist (addArtist fallback). Same distinction media-state.ts
        // already makes when reading status.
        if (existing.releaseType) {
          await lidarr.setAlbumMonitored([existing.arrId], false);
        } else {
          await lidarr.setArtistMonitored(existing.arrId, false);
        }
      }
    } catch (err: unknown) {
      // Best-effort — arr removal failure should not block cancellation
      log.warn("admin.cancelRequest: arr queue removal failed", { err });
    }
  }

  // Atomic guard against a genuine concurrent update landing between the
  // early check above and this write (the early check alone only covers
  // the common sequential double-click case).
  const cancelled = await updateRequestIfStatus(requestId, CANCELLABLE, {
    status: "cancelled",
    adminNote: note || undefined,
  });
  if (!cancelled) {
    const current = await prisma.request.findUnique({ where: { id: requestId } });
    throw new RequestConflictError(
      requestId,
      current?.status ?? "unknown",
      `Request ${requestId} is no longer cancellable (current status: ${current?.status ?? "not found"})`,
    );
  }
  const request = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });

  await prisma.pipelineEvent.create({
    data: {
      requestId,
      event: "cancelled",
      detail: note ? JSON.stringify({ note }) : undefined,
    },
  });

  void logAudit(adminId, "cancel_request", { type: "request", id: requestId }, { note });

  void notify({
    event: "cancelled",
    title: request.title,
    mediaType: request.mediaType as MediaType,
    status: "cancelled",
    user: adminName,
    detail: note,
  });

  return { request };
}
