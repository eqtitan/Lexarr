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
import type { MediaType } from "@/types";
import type { ArrQueueRecord } from "@/types/external-apis";

export interface StatusCheckResult {
  updated: number;
  stuckFlagged: number;
  autoRetried: number;
  autoFailed: number;
}

/** Automatic send attempts for an approved request that never reached an *arr. */
const MAX_AUTO_RETRIES = 3;

// Hours before a monitored, never-found item is considered "no sources found".
const NO_SOURCES_HOURS = 12;

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
      if (!identityMismatch && req.status === "downloading" && state.unreleased) {
        const { releaseDate } = state.unreleased;
        const moved = await updateRequestIfStatus(req.id, req.status, {
          status: "approved",
          lastError: releaseDate
            ? `Awaiting release: ${releaseDate}`
            : "Not yet released (no release date announced)",
          lastCheckedAt: now,
        });
        if (moved) {
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
        });
        if (moved) {
          await prisma.pipelineEvent.create({
            data: { requestId: req.id, event: "downloading" },
          });
          updated++;
        }
      } else {
        await updateRequestIfStatus(req.id, req.status, { lastCheckedAt: now });
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
          await updateRequestIfStatus(req.id, req.status, {
            lastCheckedAt: now,
            lastError: `Check failed: ${msg.slice(0, 240)}`,
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
  // ────────────────────────────────────────────────────────────────────
  const noSourcesCutoff = new Date(now.getTime() - NO_SOURCES_HOURS * 60 * 60 * 1000);
  // Age-based filter: any download older than 12h gets re-evaluated regardless of
  // when we last looked. Internal checks return early if the item is in queue /
  // has hasFile, so running this every cycle for old items is cheap.
  const neverFoundCandidates = await prisma.request.findMany({
    where: {
      status: "downloading",
      arrId: { not: null },
      createdAt: { lt: noSourcesCutoff },
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
        await updateRequestIfStatus(req.id, "downloading", { lastCheckedAt: now });
        continue;
      }

      const ageMs = now.getTime() - new Date(req.createdAt).getTime();
      const reason =
        percent > 0
          ? `No additional releases found after ${ageLabel(ageMs)} — partial at ${percent.toFixed(0)}%`
          : `No releases found after ${ageLabel(ageMs)} — indexers returned nothing`;

      const moved = await updateRequestIfStatus(req.id, "downloading", {
        status: "stalled",
        lastError: reason,
        lastCheckedAt: now,
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await updateRequestIfStatus(req.id, "downloading", {
          lastCheckedAt: now,
          lastError: `Stall check failed: ${msg.slice(0, 240)}`,
        });
      } catch (err) {
        log.error("status-checker: could not record a failed stall check", { err });
        // Skip
      }
    }
  }

  // Legacy stuck-event marker retained for PipelineEvent history (24h cutoff).
  const stuckCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const stuck = await prisma.request.findMany({
    where: {
      status: "downloading",
      OR: [
        { lastCheckedAt: { lt: stuckCutoff } },
        { lastCheckedAt: null, createdAt: { lt: stuckCutoff } },
      ],
    },
  });
  for (const req of stuck) {
    const alreadyFlagged = await prisma.pipelineEvent.findFirst({
      where: { requestId: req.id, event: "stalled" },
    });
    if (!alreadyFlagged) {
      await prisma.pipelineEvent.create({
        data: {
          requestId: req.id,
          event: "stalled",
          detail: JSON.stringify({
            reason: "No progress in 24 hours",
            stuckSince: req.updatedAt,
          }),
        },
      });
    }
  }

  // ── Auto-escalation Tier A: approved but never reached an *arr → retry ──
  // Up to MAX_AUTO_RETRIES attempts, at most one per hour (each recorded
  // attempt bumps updatedAt). The request stays "approved" between attempts
  // and is only marked failed -- and its owner notified -- after the last
  // one. (Before, the first failed attempt already marked it failed, so the
  // later retries never happened.)
  let autoRetried = 0;
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const orphanedApproved = await prisma.request.findMany({
    where: {
      status: "approved",
      arrId: null,
      retryCount: { lt: MAX_AUTO_RETRIES },
      updatedAt: { lt: oneHourAgo },
      OR: [
        { approvedAt: { lt: oneHourAgo } },
        { approvedAt: null, createdAt: { lt: oneHourAgo } },
      ],
    },
    include: { user: { select: { name: true } } },
  });

  for (const req of orphanedApproved) {
    const attempt = req.retryCount + 1;
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
        retryCount: attempt,
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
        retryCount: attempt,
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
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
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
    autoFailed++;
  }

  return { updated, stuckFlagged: stuck.length, autoRetried, autoFailed };
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
  try {
    isAvailable = (await getMediaState(request)).available;
  } catch (err) {
    log.warn("status-checker: webhook-triggered check failed", { err });
    return false;
  }

  const now = new Date();

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
