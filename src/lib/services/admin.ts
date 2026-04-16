/**
 * Admin service — business logic for admin request management.
 * Extracted from src/app/api/admin/requests/route.ts.
 */
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { sendToArrAndUpdateStatus } from "./request";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";
import type { MediaType, MusicReleaseType } from "@/types";

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
  });
  return { requests };
}

// ── Deny a request ───────────────────────────────────────────────────

export async function denyRequest(input: DenyInput): Promise<DenyResult> {
  const { requestId, note, adminId, adminName } = input;

  const request = await prisma.request.update({
    where: { id: requestId },
    data: { status: "denied", adminNote: note || undefined },
  });

  await prisma.pipelineEvent.create({
    data: {
      requestId,
      event: "denied",
      detail: note ? JSON.stringify({ note }) : undefined,
    },
  });

  logAudit(adminId, "deny_request", { type: "request", id: requestId }, { note });

  notify({
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

  const request = await prisma.request.update({
    where: { id: requestId },
    data: {
      status: "approved",
      approvedAt: new Date(),
      adminNote: note || undefined,
    },
  });

  await prisma.pipelineEvent.create({
    data: {
      requestId,
      event: "approved",
      detail: note ? JSON.stringify({ note }) : undefined,
    },
  });

  logAudit(
    adminId,
    "approve_request",
    { type: "request", id: requestId },
    { note },
  );

  notify({
    event: "approved",
    title: request.title,
    mediaType: request.mediaType as MediaType,
    status: "approved",
    user: adminName,
  });

  // Send to *arr — carry releaseType through so singles/EPs stay narrow-monitored on admin approve
  const arrError = await sendToArrAndUpdateStatus(request, {
    mediaType: request.mediaType as MediaType,
    externalId: request.externalId,
    artistId: request.externalId2 || undefined,
    title: request.title,
    userName: adminName,
    releaseType: (request.releaseType as MusicReleaseType | null) || undefined,
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

  // Best-effort: remove from arr queue if actively downloading
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
      } else if (mediaType === "tv") {
        const queue = await sonarr.getQueue();
        const records = queue.records || [];
        const item = records.find(
          (r: { seriesId: number }) => r.seriesId === existing.arrId,
        );
        if (item) {
          await sonarr.deleteQueueItem(item.id, true);
        }
      } else if (mediaType === "music") {
        const queue = await lidarr.getQueue();
        const records = queue.records || [];
        const item = records.find(
          (r: { artistId: number }) => r.artistId === existing.arrId,
        );
        if (item) {
          await lidarr.deleteQueueItem(item.id, true);
        }
      }
    } catch (err: unknown) {
      // Best-effort — arr removal failure should not block cancellation
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[cancelRequest] Failed to remove from arr queue: ${msg}`);
    }
  }

  const request = await prisma.request.update({
    where: { id: requestId },
    data: { status: "cancelled", adminNote: note || undefined },
  });

  await prisma.pipelineEvent.create({
    data: {
      requestId,
      event: "cancelled",
      detail: note ? JSON.stringify({ note }) : undefined,
    },
  });

  logAudit(adminId, "cancel_request", { type: "request", id: requestId }, { note });

  notify({
    event: "cancelled",
    title: request.title,
    mediaType: request.mediaType as MediaType,
    status: "cancelled",
    user: adminName,
    detail: note,
  });

  return { request };
}
