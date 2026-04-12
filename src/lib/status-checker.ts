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
import type { MediaType } from "@/types";

export interface StatusCheckResult {
  updated: number;
  stuckFlagged: number;
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
    return { updated: 0, stuckFlagged: 0 };
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
        const status = await lazylibrarian.getBookStatus(llBookId).catch(() => null);
        isAvailable = status === "Have";
        if (!isAvailable && req.status === "approved") {
          const wanted = await lazylibrarian.getQueue().catch(() => ({ records: [] }));
          inQueue = (wanted.records as any[]).some(
            (r: any) => String(r.BookID) === llBookId || String(r.id) === llBookId
          );
        }
      } else if (req.mediaType === "movie" && req.arrId) {
        const movie = await radarr.getMovie(req.arrId);
        isAvailable = movie.hasFile === true;
        if (!isAvailable && req.status === "approved") {
          const queues = await radarr.getQueue();
          inQueue = (queues?.records || []).some((r: any) => r.movieId === req.arrId);
        }
      } else if (req.mediaType === "tv" && req.arrId) {
        const series = await sonarr.getSeries(req.arrId);
        isAvailable = series.statistics?.percentOfEpisodes === 100;
        if (!isAvailable && req.status === "approved") {
          const queues = await sonarr.getQueue();
          inQueue = (queues?.records || []).some((r: any) => r.seriesId === req.arrId);
        }
      } else if (req.mediaType === "music" && req.arrId) {
        const artist = await lidarr.getArtist(req.arrId);
        isAvailable =
          artist.statistics?.albumCount > 0 &&
          artist.statistics?.percentOfTracks === 100;
        if (!isAvailable && req.status === "approved") {
          const queues = await lidarr.getQueue();
          inQueue = (queues?.records || []).some((r: any) => r.artistId === req.arrId);
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
        const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { name: true } });
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
    } catch {
      // Skip failed checks silently
    }
  }

  // Stuck detection: anything in "downloading" for > 24 h
  const stuckCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const stuck = await prisma.request.findMany({
    where: {
      status: "downloading",
      updatedAt: { lt: stuckCutoff },
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
          detail: JSON.stringify({ reason: "No progress in 24 hours", stuckSince: req.updatedAt }),
        },
      });
    }
  }

  return { updated, stuckFlagged: stuck.length };
}

/**
 * Update a single request by its arrId and media type.
 * Used by webhook handlers for instant status updates.
 */
export async function checkSingleRequest(mediaType: string, arrId: number): Promise<boolean> {
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

    const user = await prisma.user.findUnique({ where: { id: request.userId }, select: { name: true } });
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
