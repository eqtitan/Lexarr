/**
 * Shared status-checking logic.
 * Polls *arr apps and updates request statuses in the database.
 * Used by: /api/status (admin), /api/admin/dashboard (piggyback),
 *          instrumentation.ts (background interval), and webhook handlers.
 *
 * 2026-04 — stuck-download detection hardening:
 *   - Errors inside the per-request loop now write lastError + lastCheckedAt
 *     instead of being silently swallowed (items previously became invisible
 *     to Tier B because lastCheckedAt stayed NULL).
 *   - Tier B now includes books (was movie/tv/music only).
 *   - Tier B's stale filter now also matches lastCheckedAt IS NULL.
 *   - New diagnostic rule: monitored + not-in-queue + percent<100 + age>12h
 *     is flagged as stalled with reason "No releases found after <N>h".
 *   - Unreleased detection broadened to movies with status==="announced"
 *     and no known release dates.
 *   - arrId identity guard: detects when the *arr's ID has been reused for
 *     a different title (deletion + re-add) and marks request failed with
 *     a clear reason instead of silently tracking the wrong item.
 */
import { prisma } from "./db";
import { log } from "./log";
import * as radarr from "./arr/radarr";
import * as sonarr from "./arr/sonarr";
import * as lidarr from "./arr/lidarr";
import { notify } from "./notifications";
import { sendToArrAndUpdateStatus } from "./services/request";
import { updateRequestIfStatus } from "./request-transition";
import { getMediaState } from "./arr/media-state";
import { PIPELINE_RULES, isUnreleased } from "./pipeline-rules";
import type { MediaType } from "@/types";
import type { ArrQueueRecord } from "@/types/external-apis";

export interface StatusCheckResult {
  updated: number;
  autoRetried: number;
  autoFailed: number;
}

/** Automatic send attempts for an approved request that never reached an *arr. */
const MAX_AUTO_RETRIES = 3;

/**
 * Format a duration (ms) as a short human string like "14h" or "3d".
 */
function ageLabel(ms: number): string {
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/**
 * Move a request to "available" and notify its owner -- once. Shared by
 * the poller and the webhook path, which can both see the same import at
 * the same moment; only the caller whose guarded write lands sends the
 * event and notification.
 */
async function markAvailable(
  req: { id: string; userId: string; title: string; mediaType: string; posterPath: string | null },
  fromStatus: string,
  now: Date,
): Promise<boolean> {
  const moved = await updateRequestIfStatus(req.id, fromStatus, {
    status: "available",
    availableAt: now,
    lastCheckedAt: now,
    lastError: null,
  });
  if (!moved) return false;

  await prisma.pipelineEvent.create({
    data: { requestId: req.id, event: "available" },
  });
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { name: true },
  });
  void notify({
    event: "available",
    title: req.title,
    mediaType: req.mediaType as MediaType,
    status: "available",
    user: user?.name || "Unknown",
    posterUrl: req.posterPath || undefined,
  });
  return true;
}

// The cycle currently running, if any. A cycle makes one *arr call per
// active request with a 15s timeout each, so with an *arr down it can
// outlast the 60s interval; overlapping cycles would double every
// transition's side effects.
let inFlight: Promise<StatusCheckResult> | null = null;

/**
 * Check all active requests and update their statuses.
 *
 * Only one cycle runs at a time: a call made while a cycle is running
 * (the background interval, the admin "check now" button, the dashboard
 * piggyback) joins that cycle and gets its result. Every write is
 * guarded on the status the cycle read (updateRequestIfStatus), so a
 * concurrent admin action or webhook always wins over a stale snapshot.
 */
export function checkAndUpdateStatuses(): Promise<StatusCheckResult> {
  if (!inFlight) {
    inFlight = runStatusCheck().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function runStatusCheck(): Promise<StatusCheckResult> {
  const activeRequests = await prisma.request.findMany({
    where: {
      status: { in: ["approved", "downloading"] },
      arrId: { not: null },
    },
  });

  let updated = 0;
  const now = new Date();

  for (const req of activeRequests) {
    try {
      const state = await getMediaState(req, {
        checkQueue: req.status === "approved",
        checkIdentity: true,
        now,
      });
      const { available: isAvailable, inQueue, identityMismatch } = state;

      // Unreleased movie (release date still in the future, or announced
      // with no date yet): not expected to download, so park it back at
      // "approved" with the reason instead of leaving it "downloading".
      // Also re-enters here for an already-approved row still carrying one
      // of these messages, so a date that gets announced (or changes)
      // after the initial park isn't frozen on the original wording --
      // this is a message refresh only, not a status change, in that case.
      if (!identityMismatch && state.unreleased && (req.status === "downloading" || isUnreleased(req.lastError))) {
        const { releaseDate } = state.unreleased;
        const newError = releaseDate
          ? `Awaiting release: ${releaseDate}`
          : "Not yet released (no release date announced)";
        if (req.status === "approved" && req.lastError === newError) {
          // Nothing changed -- just prove the check ran.
          await updateRequestIfStatus(req.id, req.status, { lastCheckedAt: now });
          continue;
        }
        const moved = await updateRequestIfStatus(req.id, req.status, {
          status: "approved",
          lastError: newError,
          lastCheckedAt: now,
        });
        if (moved && req.status === "downloading") {
          await prisma.pipelineEvent.create({
            data: {
              requestId: req.id,
              event: "approved",
              detail: JSON.stringify(
                releaseDate
                  ? { reason: "unreleased", releaseDate }
                  : { reason: "announced_no_date" },
              ),
            },
          });
          updated++;
        }
        continue;
      }

      if (identityMismatch) {
        const moved = await updateRequestIfStatus(req.id, req.status, {
          status: "failed",
          lastError: `Tracker drift — please re-request. ${identityMismatch}`,
          lastCheckedAt: now,
        });
        if (moved) {
          await prisma.pipelineEvent.create({
            data: {
              requestId: req.id,
              event: "failed",
              detail: JSON.stringify({ reason: "arrid_drift", note: identityMismatch }),
            },
          });
          updated++;
        }
        continue;
      }

      if (isAvailable) {
        if (await markAvailable(req, req.status, now)) updated++;
      } else if (req.status === "approved" && inQueue) {
        const moved = await updateRequestIfStatus(req.id, "approved", {
          status: "downloading",
          lastCheckedAt: now,
          lastError: null,
          checkFailingSince: null,
        });
        if (moved) {
          await prisma.pipelineEvent.create({
            data: { requestId: req.id, event: "downloading" },
          });
          updated++;
        }
      } else {
        // A successful check (even one that changes nothing) proves the
        // *arr is reachable and this request's record is fine -- clear
        // any in-progress "check-failing" streak from a prior blip. Also
        // clear a stale "unreleased" message: state.unreleased is falsy
        // here (the block above already handles the still-unreleased
        // case), so if lastError is still one of those markers the title
        // has since released but nothing's grabbed it yet -- clearing it
        // lets the normal "Not in queue" warning / Tier B apply instead of
        // leaving it silently suppressed forever.
        await updateRequestIfStatus(req.id, req.status, {
          lastCheckedAt: now,
          checkFailingSince: req.checkFailingSince ? null : undefined,
          lastError: isUnreleased(req.lastError) ? null : undefined,
        });
      }
    } catch (err: unknown) {
      // Do NOT swallow. Surface the error so admins can see why an item is stuck,
      // and always bump lastCheckedAt so Tier B stale-detection can see this row.
      const msg = err instanceof Error ? err.message : String(err);
      const isDeleted = /\b404\b/.test(msg);
      try {
        if (isDeleted) {
          // Item was deleted from the *arr — no point retrying. Flip to failed now.
          const moved = await updateRequestIfStatus(req.id, req.status, {
            status: "failed",
            lastCheckedAt: now,
            lastError: `Deleted from *arr — please re-request`,
            checkFailingSince: null,
          });
          if (moved) {
            await prisma.pipelineEvent.create({
              data: {
                requestId: req.id,
                event: "failed",
                detail: JSON.stringify({ reason: "arr_404", raw: msg.slice(0, 200) }),
              },
            });
          }
        } else {
          // Stamp checkFailingSince on the FIRST failure only -- lastError
          // gets overwritten every cycle, which previously made it
          // impossible to tell a 5-minute blip from a 2-month-old one (see
          // the new escalation tier below, which reads this field).
          await updateRequestIfStatus(req.id, req.status, {
            lastCheckedAt: now,
            lastError: `Check failed: ${msg.slice(0, 240)}`,
            checkFailingSince: req.checkFailingSince ?? now,
          });
        }
      } catch (err) {
        log.error("status-checker: could not record a failed check", { err });
        // If even the DB write fails there's nothing meaningful we can do here.
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Tier B — "No releases found" stall detection (NEW)
  // Covers monitored items that have never downloaded anything and are
  // not in the *arr queue. Books are now included. Uses a 12h floor so
  // we don't race the *arr's initial search cycle.
  //
  // Measured from approvedAt (when the request actually reached the
  // *arr), not createdAt (when the user first submitted it) -- a request
  // that sat "pending" for a day before approval would otherwise be
  // eligible for this tier within seconds of being sent, flagged
  // "stalled" with a misleading "No releases found after 1d" before the
  // *arr had even started searching. Same approvedAt-with-createdAt-
  // fallback pattern Tier A already uses below.
  // ────────────────────────────────────────────────────────────────────
  const noSourcesCutoff = new Date(
    now.getTime() - PIPELINE_RULES["no-sources-found"].escalateThresholdMs,
  );
  // Age-based filter: any download older than 12h gets re-evaluated regardless of
  // when we last looked. Internal checks return early if the item is in queue /
  // has hasFile, so running this every cycle for old items is cheap.
  const neverFoundCandidates = await prisma.request.findMany({
    where: {
      status: "downloading",
      arrId: { not: null },
      OR: [
        { approvedAt: { lt: noSourcesCutoff } },
        { approvedAt: null, createdAt: { lt: noSourcesCutoff } },
      ],
    },
  });

  for (const req of neverFoundCandidates) {
    try {
      // LazyLibrarian's Wanted list means "still searching", not an active
      // download, so books never count as in-queue here: the age-based
      // stall applies to them.
      const state = await getMediaState(req, { checkQueue: req.mediaType !== "book" });
      const hasFile = state.available;
      const inArrQueue = state.inQueue;
      const percent = state.percent;

      if (hasFile) {
        // Becomes available naturally on the next poll cycle.
        continue;
      }
      if (inArrQueue) {
        // Genuinely downloading — stamp lastCheckedAt so we don't loop on it.
        await updateRequestIfStatus(req.id, "downloading", {
          lastCheckedAt: now,
          checkFailingSince: req.checkFailingSince ? null : undefined,
        });
        continue;
      }

      const ageMs = now.getTime() - new Date(req.approvedAt ?? req.createdAt).getTime();
      const reason =
        percent > 0
          ? `No additional releases found after ${ageLabel(ageMs)} — partial at ${percent.toFixed(0)}%`
          : `No releases found after ${ageLabel(ageMs)} — indexers returned nothing`;

      const moved = await updateRequestIfStatus(req.id, "downloading", {
        status: "stalled",
        lastError: reason,
        lastCheckedAt: now,
        checkFailingSince: null,
      });
      if (!moved) continue;
      await prisma.pipelineEvent.create({
        data: {
          requestId: req.id,
          event: "stalled",
          detail: JSON.stringify({
            reason: "no_sources_found",
            ageHours: Math.floor(ageMs / 3_600_000),
            percent,
          }),
        },
      });
      // Previously silent on every channel -- this was pipeline-event-only,
      // so neither the admin nor the requester learned a title stalled
      // until someone happened to open the dashboard.
      const stalledUser = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { name: true },
      });
      void notify({
        event: "stalled",
        title: req.title,
        mediaType: req.mediaType as MediaType,
        status: "stalled",
        user: stalledUser?.name || "Unknown",
        detail: reason,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await updateRequestIfStatus(req.id, "downloading", {
          lastCheckedAt: now,
          lastError: `Stall check failed: ${msg.slice(0, 240)}`,
          checkFailingSince: req.checkFailingSince ?? now,
        });
      } catch (err) {
        log.error("status-checker: could not record a failed stall check", { err });
        // Skip
      }
    }
  }

  // (Removed: a legacy 24h lastCheckedAt-staleness "stuck" marker used to
  // live here. It could only fire when polling itself had been failing
  // for 24h straight -- a case lastError from the per-request catch block
  // above already surfaces -- so it only ever added a confusing duplicate
  // "stalled" PipelineEvent with no status change. Tier B above is the
  // real stall detector now.)

  // ── Auto-escalation Tier A: approved but never reached an *arr → retry ──
  // Up to MAX_AUTO_RETRIES attempts, at most one per hour (each recorded
  // attempt bumps updatedAt). The request stays "approved" between attempts
  // and is only marked failed -- and its owner notified -- after the last
  // one. (Before, the first failed attempt already marked it failed, so the
  // later retries never happened.)
  //
  // Tracked via autoRetryCount, NOT retryCount: retryCount is the admin's
  // manual-retry counter (services/retry.ts), which has no cap. Sharing one
  // counter meant this silent, unattended loop could burn through most of
  // an admin's manual retry budget before they ever saw the request --
  // worse, retry.ts's old hard cap meant the Retry button could disappear
  // from the dashboard with no explanation. Keeping the counters separate
  // means an admin always gets a full, uncapped set of manual attempts
  // regardless of how many background attempts already ran.
  let autoRetried = 0;
  const oneHourAgo = new Date(
    now.getTime() - PIPELINE_RULES["never-dispatched"].escalateThresholdMs,
  );
  const orphanedApproved = await prisma.request.findMany({
    where: {
      status: "approved",
      arrId: null,
      autoRetryCount: { lt: MAX_AUTO_RETRIES },
      updatedAt: { lt: oneHourAgo },
      OR: [
        { approvedAt: { lt: oneHourAgo } },
        { approvedAt: null, createdAt: { lt: oneHourAgo } },
      ],
    },
    include: { user: { select: { name: true } } },
  });

  for (const req of orphanedApproved) {
    const attempt = req.autoRetryCount + 1;
    let arrError: string | undefined;
    try {
      arrError = await sendToArrAndUpdateStatus(req, {
        mediaType: req.mediaType as MediaType,
        externalId: req.externalId,
        artistId: req.externalId2 || undefined,
        title: req.title,
        userName: req.user?.name || "Unknown",
        posterUrl: req.posterPath || undefined,
        releaseType:
          (req.releaseType as import("@/types").MusicReleaseType | null) ||
          undefined,
        bookFormat:
          (req.bookFormat as import("@/types").BookFormat | null) || undefined,
        failOnError: false,
      });
    } catch (err: unknown) {
      arrError = err instanceof Error ? err.message : String(err);
    }

    if (!arrError) {
      autoRetried++;
      await prisma.pipelineEvent.create({
        data: {
          requestId: req.id,
          event: "sent_to_arr",
          detail: JSON.stringify({ autoRetry: true, attempt }),
        },
      });
      continue;
    }

    if (attempt >= MAX_AUTO_RETRIES) {
      const moved = await updateRequestIfStatus(req.id, "approved", {
        status: "failed",
        autoRetryCount: attempt,
        lastError: arrError,
      });
      if (moved) {
        await prisma.pipelineEvent.create({
          data: {
            requestId: req.id,
            event: "failed",
            detail: JSON.stringify({ reason: "max_retries", error: arrError }),
          },
        });
        void notify({
          event: "failed",
          title: req.title,
          mediaType: req.mediaType as MediaType,
          status: "failed",
          user: req.user?.name || "Unknown",
          detail: arrError,
        });
      }
    } else {
      const recorded = await updateRequestIfStatus(req.id, "approved", {
        autoRetryCount: attempt,
        lastError: arrError,
      });
      if (recorded) {
        await prisma.pipelineEvent.create({
          data: {
            requestId: req.id,
            event: "retry_failed",
            detail: JSON.stringify({ attempt, error: arrError }),
          },
        });
      }
    }
  }

  // ── Auto-escalation Tier C: Stalled + >48 hours → failed ──
  let autoFailed = 0;
  const fortyEightHoursAgo = new Date(
    now.getTime() - PIPELINE_RULES["stalled-too-long"].escalateThresholdMs,
  );
  const stalledTooLong = await prisma.request.findMany({
    where: {
      status: "stalled",
      updatedAt: { lt: fortyEightHoursAgo },
    },
  });

  for (const req of stalledTooLong) {
    const moved = await updateRequestIfStatus(req.id, "stalled", {
      status: "failed",
      lastError: req.lastError || "Auto-failed: no progress after 48 hours",
    });
    if (!moved) continue;
    await prisma.pipelineEvent.create({
      data: {
        requestId: req.id,
        event: "failed",
        detail: JSON.stringify({
          reason: "auto_failed_stalled",
          stalledSince: req.updatedAt?.toISOString(),
        }),
      },
    });
    // Previously silent -- a request could auto-fail after 48h stalled
    // with nobody, admin or requester, ever told.
    const failedUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { name: true },
    });
    void notify({
      event: "failed",
      title: req.title,
      mediaType: req.mediaType as MediaType,
      status: "failed",
      user: failedUser?.name || "Unknown",
      detail: req.lastError || "No progress after 48 hours",
    });
    autoFailed++;
  }

  // ── Auto-escalation Tier D: can't even check it, for >2 hours → failed ──
  // Covers a request that already has an arrId (so Tier A's "never
  // dispatched" rule doesn't see it) and isn't "downloading" (so Tier B's
  // "no sources found" rule doesn't see it either) -- its *arr record is
  // throwing on every poll (network blip, the *arr choking on this one
  // title, etc.). Previously nothing ever escalated this: lastError gets
  // overwritten with the same string every cycle, so the request would
  // just sit at its current status re-accumulating that error forever,
  // with only a passive dashboard badge (if any) to notice it.
  const twoHoursAgo = new Date(
    now.getTime() - PIPELINE_RULES["check-failing"].escalateThresholdMs,
  );
  const checkFailingTooLong = await prisma.request.findMany({
    where: {
      status: { in: ["approved", "downloading"] },
      arrId: { not: null },
      checkFailingSince: { lt: twoHoursAgo },
    },
    include: { user: { select: { name: true } } },
  });

  for (const req of checkFailingTooLong) {
    const moved = await updateRequestIfStatus(req.id, req.status, {
      status: "failed",
      lastError: req.lastError || "Auto-failed: couldn't verify status for 2+ hours",
    });
    if (!moved) continue;
    await prisma.pipelineEvent.create({
      data: {
        requestId: req.id,
        event: "failed",
        detail: JSON.stringify({
          reason: "check_failing_too_long",
          checkFailingSince: req.checkFailingSince?.toISOString(),
        }),
      },
    });
    void notify({
      event: "failed",
      title: req.title,
      mediaType: req.mediaType as MediaType,
      status: "failed",
      user: req.user?.name || "Unknown",
      detail: req.lastError || "Couldn't verify status for 2+ hours",
    });
    autoFailed++;
  }

  return { updated, autoRetried, autoFailed };
}

/**
 * Update a single request by its arrId and media type.
 * Used by webhook handlers for instant status updates.
 */
export async function checkSingleRequest(
  mediaType: string,
  arrId: number,
): Promise<boolean> {
  const request = await prisma.request.findFirst({
    where: {
      mediaType,
      arrId,
      status: { in: ["approved", "downloading"] },
    },
  });

  if (!request) return false;

  let isAvailable: boolean;
  let identityMismatch: string | null;
  try {
    // checkIdentity: true -- matches the poller (runStatusCheck), which
    // was the only path actually catching an *arr ID being reused for a
    // different title (deleted + re-added). Without it, a webhook firing
    // right after that happens could promote this request to "available"
    // based on an unrelated title's hasFile.
    const state = await getMediaState(request, { checkIdentity: true });
    isAvailable = state.available;
    identityMismatch = state.identityMismatch;
  } catch (err) {
    log.warn("status-checker: webhook-triggered check failed", { err });
    return false;
  }

  const now = new Date();

  if (identityMismatch) {
    const moved = await updateRequestIfStatus(request.id, request.status, {
      status: "failed",
      lastError: `Tracker drift — please re-request. ${identityMismatch}`,
      lastCheckedAt: now,
    });
    if (moved) {
      await prisma.pipelineEvent.create({
        data: {
          requestId: request.id,
          event: "failed",
          detail: JSON.stringify({ reason: "arrid_drift", note: identityMismatch }),
        },
      });
    }
    return moved;
  }

  if (isAvailable) {
    return markAvailable(request, request.status, now);
  }
  if (request.status === "approved") {
    const moved = await updateRequestIfStatus(request.id, "approved", {
      status: "downloading",
      lastCheckedAt: now,
      lastError: null,
    });
    if (!moved) return false;
    await prisma.pipelineEvent.create({
      data: { requestId: request.id, event: "downloading" },
    });
    return true;
  }

  return false;
}

/**
 * Clean dead downloads from *arr queues.
 * Removes items stuck in "warning" state for > 2 hours and blocklists them.
 */
export async function cleanDeadDownloads(): Promise<number> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  let cleaned = 0;

  const queues = await Promise.all([
    radarr.getQueue().catch((err: unknown) => {
      log.warn("cleanDeadDownloads: Radarr queue fetch failed", { err });
      return { records: [] as ArrQueueRecord[] };
    }),
    sonarr.getQueue().catch((err: unknown) => {
      log.warn("cleanDeadDownloads: Sonarr queue fetch failed", { err });
      return { records: [] as ArrQueueRecord[] };
    }),
    lidarr.getQueue().catch((err: unknown) => {
      log.warn("cleanDeadDownloads: Lidarr queue fetch failed", { err });
      return { records: [] as ArrQueueRecord[] };
    }),
  ]);

  const services = [
    { records: queues[0].records || [], del: radarr.deleteQueueItem },
    { records: queues[1].records || [], del: sonarr.deleteQueueItem },
    { records: queues[2].records || [], del: lidarr.deleteQueueItem },
  ];

  for (const svc of services) {
    for (const item of svc.records) {
      if (
        item.trackedDownloadStatus === "warning" &&
        item.added &&
        new Date(item.added) < twoHoursAgo
      ) {
        try {
          await svc.del(item.id, true);
          cleaned++;
        } catch (err) {
          log.warn("cleanDeadDownloads: removing a dead download failed", { err });
          // Skip items that fail to delete
        }
      }
    }
  }

  return cleaned;
}
