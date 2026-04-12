import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";
import * as lazylibrarian from "@/lib/arr/lazylibrarian";

// Poll *arr apps and update request statuses (admin only)
export async function POST() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const activeRequests = await prisma.request.findMany({
    where: {
      status: { in: ["approved", "downloading"] },
      arrId: { not: null },
    },
  });

  if (activeRequests.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  let updated = 0;
  const now = new Date();

  for (const req of activeRequests) {
    try {
      let isAvailable = false;
      let inQueue = false;

      // ── Books: poll LazyLibrarian by bookId stored in externalId2 ──────────
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

      // ── Movies (Radarr) ───────────────────────────────────────────────────
      } else if (req.mediaType === "movie" && req.arrId) {
        const movie = await radarr.getMovie(req.arrId);
        isAvailable = movie.hasFile === true;
        if (!isAvailable && req.status === "approved") {
          const queues = await radarr.getQueue();
          inQueue = (queues?.records || []).some((r: any) => r.movieId === req.arrId);
        }

      // ── TV (Sonarr) ───────────────────────────────────────────────────────
      } else if (req.mediaType === "tv" && req.arrId) {
        const series = await sonarr.getSeries(req.arrId);
        isAvailable = series.statistics?.percentOfEpisodes === 100;
        if (!isAvailable && req.status === "approved") {
          const queues = await sonarr.getQueue();
          inQueue = (queues?.records || []).some((r: any) => r.seriesId === req.arrId);
        }

      // ── Music (Lidarr) ────────────────────────────────────────────────────
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

      // ── Transitions ──────────────────────────────────────────────────────
      if (isAvailable && req.status !== "available") {
        await prisma.request.update({
          where: { id: req.id },
          data: { status: "available", availableAt: now, lastCheckedAt: now },
        });
        await prisma.pipelineEvent.create({
          data: { requestId: req.id, event: "available" },
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
      // Skip failed checks silently — logged by cron
    }
  }

  // Stuck detection: anything in "downloading" for > 24 h with no recent check
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

  return NextResponse.json({ updated, stuckFlagged: stuck.length });
}
