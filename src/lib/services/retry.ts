/**
 * Admin "retry" of a failed, stalled or stuck-approved request: reset it to
 * approved and send it to its *arr again.
 *
 * Uses the same send path as a normal approval (sendToArrAndUpdateStatus),
 * so a retry carries the request's own releaseType / bookFormat -- the old
 * route-local copy dropped them, re-sending a single as a full album and an
 * audiobook as an ebook.
 *
 * No hard cap here (unlike the background auto-retry in status-checker.ts,
 * which caps at MAX_AUTO_RETRIES and uses its own `autoRetryCount`). A
 * manual retry is a deliberate, authenticated admin action -- rationing it
 * the same way an unattended loop needs to be rationed just meant an admin
 * who'd already fixed the underlying problem (rotated an API key,
 * restarted a dead *arr) had no way to try again short of cancelling and
 * asking the user to resubmit. The circuit breaker already stops a retry
 * from hammering a genuinely dead service.
 */
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { updateRequestIfStatus } from "@/lib/request-transition";
import { sendToArrAndUpdateStatus } from "@/lib/services/request";
import type { BookFormat, MediaType, MusicReleaseType } from "@/types";

const RETRYABLE = ["failed", "stalled", "approved", "downloading"];

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

  // failed / stalled, approved (covers "routing failed silently" and
  // "routed but never entered the download queue"), or downloading
  // (covers warnings.ts's "Orphaned download" -- marked downloading but
  // no longer found in any *arr queue; re-approving and resending gives
  // it a fresh dispatch instead of leaving the only offered action dead).
  if (!RETRYABLE.includes(request.status)) {
    throw new RetryError(400, `Cannot retry request with status: ${request.status}`);
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

/** Most requests one "Retry all failed" press will re-send. */
export const RETRY_ALL_LIMIT = 25;

export interface RetryAllResult {
  tried: number;
  sent: number;
  /** Requests that failed again, with the (raw, admin-only) reason. */
  stillFailing: { id: string; title: string; error: string }[];
  /** Failed requests left for another press because of RETRY_ALL_LIMIT. */
  remaining: number;
}

/**
 * Admin "Retry all failed": retryRequest for every failed request (oldest
 * update first), one at a time so the *arrs aren't hit with a burst.
 * Optional mediaType narrows it ("book" after fixing LazyLibrarian).
 */
export async function retryAllFailed(
  admin: { id: string; name: string },
  mediaType?: MediaType,
): Promise<RetryAllResult> {
  const where = { status: "failed", ...(mediaType ? { mediaType } : {}) };
  const failed = await prisma.request.findMany({
    where,
    orderBy: { updatedAt: "asc" },
    take: RETRY_ALL_LIMIT,
    select: { id: true, title: true },
  });
  const result: RetryAllResult = { tried: 0, sent: 0, stillFailing: [], remaining: 0 };
  for (const r of failed) {
    result.tried++;
    try {
      await retryRequest(r.id, admin);
      result.sent++;
    } catch (err: unknown) {
      result.stillFailing.push({ id: r.id, title: r.title, error: err instanceof Error ? err.message : String(err) });
    }
  }
  result.remaining = Math.max(0, (await prisma.request.count({ where })) - result.stillFailing.length);
  void logAudit(admin.id, "retry_all_failed", { type: "request", id: mediaType ?? "all" }, {
    tried: result.tried,
    sent: result.sent,
  });
  return result;
}
