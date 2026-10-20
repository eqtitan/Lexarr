/**
 * Admin "retry" of a failed, stalled or stuck-approved request: reset it to
 * approved and send it to its *arr again.
 *
 * Uses the same send path as a normal approval (sendToArrAndUpdateStatus),
 * so a retry carries the request's own releaseType / bookFormat -- the old
 * route-local copy dropped them, re-sending a single as a full album and an
 * audiobook as an ebook.
 */
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { updateRequestIfStatus } from "@/lib/request-transition";
import { sendToArrAndUpdateStatus } from "@/lib/services/request";
import type { BookFormat, MediaType, MusicReleaseType } from "@/types";

export const MAX_MANUAL_RETRIES = 3;
const RETRYABLE = ["failed", "stalled", "approved"];

export class RetryError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
    this.name = "RetryError";
  }
}

export async function retryRequest(
  requestId: string,
  admin: { id: string; name: string },
): Promise<void> {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: { user: { select: { name: true } } },
  });
  if (!request) throw new RetryError(404, "Request not found");

  // failed / stalled, or approved (covers "routing failed silently" and
  // "routed but never entered the download queue").
  if (!RETRYABLE.includes(request.status)) {
    throw new RetryError(400, `Cannot retry request with status: ${request.status}`);
  }
  if (request.retryCount >= MAX_MANUAL_RETRIES) {
    throw new RetryError(400, `Max retries (${MAX_MANUAL_RETRIES}) reached`);
  }

  // Guarded: a concurrent cancel or retry since we read it wins.
  const reset = await updateRequestIfStatus(requestId, request.status, {
    status: "approved",
    lastError: null,
    retryCount: { increment: 1 },
  });
  if (!reset) {
    throw new RetryError(409, "Request changed while retrying -- refresh and try again");
  }
  const attempt = request.retryCount + 1;

  await prisma.pipelineEvent.create({
    data: {
      requestId,
      event: "retried",
      detail: JSON.stringify({ retryCount: attempt, previousStatus: request.status }),
    },
  });
  void logAudit(admin.id, "retry_request", { type: "request", id: requestId }, { retryCount: attempt });

  const arrError = await sendToArrAndUpdateStatus(
    { ...request, status: "approved" },
    {
      mediaType: request.mediaType as MediaType,
      externalId: request.externalId,
      artistId: request.externalId2 || undefined,
      title: request.title,
      userName: request.user?.name || "Unknown",
      posterUrl: request.posterPath || undefined,
      releaseType: (request.releaseType as MusicReleaseType | null) || undefined,
      bookFormat: (request.bookFormat as BookFormat | null) || undefined,
    },
  );
  if (arrError) throw new RetryError(500, arrError);

  void notify({
    event: "retried",
    title: request.title,
    mediaType: request.mediaType as MediaType,
    status: "approved",
    user: admin.name,
    detail: `Retry #${attempt}`,
  });
}
