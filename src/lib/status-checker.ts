/**
 * Shared status-checking logic.
 * Polls *arr apps and updates request statuses in the database.
 * Used by: /api/status (admin), /api/admin/dashboard (piggyback),
 *          instrumentation.ts (background interval), and webhook handlers.
 */
import { prisma } from "./db";
import * as radarr from "./arr/radarr";
import * as sonarr from "./arr/sonarr";
import * as lidarr from "./arr/lidarr";
import * as lazylibrarian from "./arr/lazylibrarian";
import { notify } from "./notifications";
import { sendToArrAndUpdateStatus } from "./services/request";
import type { MediaType } from "@/types";
import type { ArrQueueRecord } from "@/types/external-apis";

interface LazyLibrarianRecord {
  BookID?: string;
  id?: string;
}

export interface StatusCheckResult {
  updated: number;
  stuckFlagged: number;
  autoRetried: number;
  autoFailed: number;
}

/**
 * Check all active requests and update their statuses.
 * Safe to call concurrently — each request is updated independently.
 */
export async function checkAndUpdateStatuses(): Promise<StatusCheckResult> {
  const activeRequests = await prisma.request.findMany({
    where: {
      status: { in: ["approved", "downloading"] },
      arrId: { not: null },
    },
  });

  if (activeRequests.length === 0) {
    return { updated: 0, stuckFlagged: 0, autoRetried: 0, autoFailed: 0 };
  }

  let updated = 0;
  const now = new Date();

  for (const req of activeRequests) {
    try {
      let isAvailable = false;
      let inQueue = false;

      if (req.mediaType === "book") {
        const llBookId = req.externalId2 || String(req.arrId);
        if (!llBookId) continue;
        const status = await lazylibrarian
          .getBookStatus(llBookId)
          .catch(() => null);
        isAvailable = status === "Have";
        if (!isAvailable && req.status === "approved") {
          const wanted = await lazylibrarian
            .getQueue()
            .catch(() => ({ records: [] }));
          inQueue = (wanted.records as LazyLibrarianRecord[]).some(
            (r) =>
              String(r.BookID) === llBookId || String(r.id) === llBookId,
          );
        }
      } else if (req.mediaType === "movie" && req.arrId) {
        const movie = await radarr.getMovie(req.arrId);

        // Fix 4: Unreleased content detection
        if (req.status === "downloading") {
          const digitalRelease = movie.digitalRelease
            ? new Date(movie.digitalRelease)
            : null;
          const physicalRelease = movie.physicalRelease
            ? new Date(movie.physicalRelease)
            : null;
          const earliestRelease = digitalRelease && physicalRelease
            ? (digitalRelease < physicalRelease ? digitalRelease : physicalRelease)
            : digitalRelease || physicalRelease;

          if (earliestRelease && earliestRelease > now) {
            const releaseDate = earliestRelease.toISOString().split("T")[0];
            await prisma.request.update({
              where: { id: req.id },
              data: {
                status: "approved",
                lastError: `Awaiting release: ${releaseDate}`,
                lastCheckedAt: now,
              },
            });
            await prisma.pipelineEvent.create({
              data: {
                requestId: req.id,
                event: "approved",
                detail: JSON.stringify({
                  reason: "unreleased",
                  releaseDate,
                }),
              },
            });
            updated++;
            continue;
          }
        }

        isAvailable = movie.hasFile === true;
        if (!isAvailable && req.status === "approved") {
          const queues = await radarr.getQueue();
          inQueue = (queues?.records || []).some(
            (r: ArrQueueRecord) => r.movieId === req.arrId,
          );
        }
      } else if (req.mediaType === "tv" && req.arrId) {
        const series = await sonarr.getSeries(req.arrId);
        isAvailable = series.statistics?.percentOfEpisodes === 100;
        if (!isAvailable && req.status === "approved") {
          const queues = await sonarr.getQueue();
          inQueue = (queues?.records || []).some(
            (r: ArrQueueRecord) => r.seriesId === req.arrId,
          );
        }
      } else if (req.mediaType === "music" && req.arrId) {
        const artist = await lidarr.getArtist(req.arrId);
        isAvailable =
          artist.statistics?.albumCount > 0 &&
          artist.statistics?.percentOfTracks === 100;
        if (!isAvailable && req.status === "approved") {
          const queues = await lidarr.getQueue();
          inQueue = (queues?.records || []).some(
            (r: ArrQueueRecord) => r.artistId === req.arrId,
          );
        }
      }

      if (isAvailable && req.status !== "available") {
        await prisma.request.update({
          where: { id: req.id },
          data: { status: "available", availableAt: now, lastCheckedAt: now },
        });
        await prisma.pipelineEvent.create({
          data: { requestId: req.id, event: "available" },
        });

        // Notify user that content is now available
        const user = await prisma.user.findUnique({
          where: { id: req.userId },
          select: { name: true },
        });
        notify({
          event: "available",
          title: req.title,
          mediaType: req.mediaType as MediaType,
          status: "available",
          user: user?.name || "Unknown",
          posterUrl: req.posterPath || undefined,
        });

        updated++;
      } else if (!isAvailable && req.status === "approved" && inQueue) {
        await prisma.request.update({
          where: { id: req.id },
          data: { status: "downloading", lastCheckedAt: now },
        });
        await prisma.pipelineEvent.create({
          data: { requestId: req.id, event: "downloading" },
        });
        updated++;
      } else {
        await prisma.request.update({
          where: { id: req.id },
          data: { lastCheckedAt: now },
        });
      }
    } catch (err: unknown) {
      // Per-request check failed (e.g. *arr returned 404 for a deleted arrId,
      // or the *arr service is unreachable). Log for operator visibility but
      // keep iterating — one bad row shouldn't break the whole sweep.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[status-checker] skip ${req.mediaType} request ${req.id} (${req.title}): ${msg}`,
      );
    }
  }

  // Stuck detection: anything in "downloading" for > 24 h with no status check progress
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

  // ── Auto-escalation Tier A: Approved + no arrId + >1 hour → auto-retry ──
  let autoRetried = 0;
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const orphanedApproved = await prisma.request.findMany({
    where: {
      status: "approved",
      arrId: null,
      retryCount: { lt: 3 },
      OR: [
        { approvedAt: { lt: oneHourAgo } },
        { approvedAt: null, createdAt: { lt: oneHourAgo } },
      ],
    },
    include: { user: { select: { name: true } } },
  });

  for (const req of orphanedApproved) {
    try {
      const arrError = await sendToArrAndUpdateStatus(req, {
        mediaType: req.mediaType as MediaType,
        externalId: req.externalId,
        artistId: req.externalId2 || undefined,
        title: req.title,
        userName: req.user?.name || "Unknown",
        posterUrl: req.posterPath || undefined,
      });

      if (!arrError) {
        autoRetried++;
        await prisma.pipelineEvent.create({
          data: {
            requestId: req.id,
            event: "sent_to_arr",
            detail: JSON.stringify({ autoRetry: true, attempt: req.retryCount + 1 }),
          },
        });
      } else {
        const newRetryCount = req.retryCount + 1;
        if (newRetryCount >= 3) {
          await prisma.request.update({
            where: { id: req.id },
            data: { status: "failed", retryCount: newRetryCount, lastError: arrError },
          });
          await prisma.pipelineEvent.create({
            data: {
              requestId: req.id,
              event: "failed",
              detail: JSON.stringify({ reason: "max_retries", error: arrError }),
            },
          });
        } else {
          await prisma.request.update({
            where: { id: req.id },
            data: { retryCount: newRetryCount, lastError: arrError },
          });
          await prisma.pipelineEvent.create({
            data: {
              requestId: req.id,
              event: "retry_failed",
              detail: JSON.stringify({ attempt: newRetryCount, error: arrError }),
            },
          });
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const newRetryCount = req.retryCount + 1;
      if (newRetryCount >= 3) {
        await prisma.request.update({
          where: { id: req.id },
          data: { status: "failed", retryCount: newRetryCount, lastError: errMsg },
        });
        await prisma.pipelineEvent.create({
          data: {
            requestId: req.id,
            event: "failed",
            detail: JSON.stringify({ reason: "max_retries", error: errMsg }),
          },
        });
      } else {
        await prisma.request.update({
          where: { id: req.id },
          data: { retryCount: newRetryCount, lastError: errMsg },
        });
      }
    }
  }

  // ── Auto-escalation Tier B: Downloading + not in arr queue + >6 hours → stalled ──
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const staleDownloading = await prisma.request.findMany({
    where: {
      status: "downloading",
      arrId: { not: null },
      lastCheckedAt: { lt: sixHoursAgo },
    },
  });

  for (const req of staleDownloading) {
    try {
      let inArrQueue = false;
      let hasFile = false;

      if (req.mediaType === "movie" && req.arrId) {
        const movie = await radarr.getMovie(req.arrId);
        hasFile = movie.hasFile === true;
        if (!hasFile) {
          const queues = await radarr.getQueue();
          inArrQueue = (queues?.records || []).some(
            (r: ArrQueueRecord) => r.movieId === req.arrId,
          );
        }
      } else if (req.mediaType === "tv" && req.arrId) {
        const series = await sonarr.getSeries(req.arrId);
        hasFile = series.statistics?.percentOfEpisodes === 100;
        if (!hasFile) {
          const queues = await sonarr.getQueue();
          inArrQueue = (queues?.records || []).some(
            (r: ArrQueueRecord) => r.seriesId === req.arrId,
          );
        }
      } else if (req.mediaType === "music" && req.arrId) {
        const artist = await lidarr.getArtist(req.arrId);
        hasFile =
          artist.statistics?.albumCount > 0 &&
          artist.statistics?.percentOfTracks === 100;
        if (!hasFile) {
          const queues = await lidarr.getQueue();
          inArrQueue = (queues?.records || []).some(
            (r: ArrQueueRecord) => r.artistId === req.arrId,
          );
        }
      }

      if (!inArrQueue && !hasFile) {
        await prisma.request.update({
          where: { id: req.id },
          data: { status: "stalled", lastCheckedAt: now },
        });
        await prisma.pipelineEvent.create({
          data: {
            requestId: req.id,
            event: "stalled",
            detail: JSON.stringify({
              reason: "Not in arr queue after 6 hours",
              escalatedAt: now.toISOString(),
            }),
          },
        });
      }
    } catch {
      // Skip failed checks
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
    await prisma.request.update({
      where: { id: req.id },
      data: {
        status: "failed",
        lastError: "Auto-failed: no progress after 48 hours",
      },
    });
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

  let isAvailable = false;

  try {
    if (mediaType === "movie") {
      const movie = await radarr.getMovie(arrId);
      isAvailable = movie.hasFile === true;
    } else if (mediaType === "tv") {
      const series = await sonarr.getSeries(arrId);
      isAvailable = series.statistics?.percentOfEpisodes === 100;
    } else if (mediaType === "music") {
      const artist = await lidarr.getArtist(arrId);
      isAvailable =
        artist.statistics?.albumCount > 0 &&
        artist.statistics?.percentOfTracks === 100;
    }
  } catch {
    return false;
  }

  const now = new Date();

  if (isAvailable && request.status !== "available") {
    await prisma.request.update({
      where: { id: request.id },
      data: { status: "available", availableAt: now, lastCheckedAt: now },
    });
    await prisma.pipelineEvent.create({
      data: { requestId: request.id, event: "available" },
    });

    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: { name: true },
    });
    notify({
      event: "available",
      title: request.title,
      mediaType: request.mediaType as MediaType,
      status: "available",
      user: user?.name || "Unknown",
      posterUrl: request.posterPath || undefined,
    });

    return true;
  } else if (!isAvailable && request.status === "approved") {
    await prisma.request.update({
      where: { id: request.id },
      data: { status: "downloading", lastCheckedAt: now },
    });
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
    radarr.getQueue().catch(() => ({ records: [] as ArrQueueRecord[] })),
    sonarr.getQueue().catch(() => ({ records: [] as ArrQueueRecord[] })),
    lidarr.getQueue().catch(() => ({ records: [] as ArrQueueRecord[] })),
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
        } catch {
          // Skip items that fail to delete
        }
      }
    }
  }

  return cleaned;
}
