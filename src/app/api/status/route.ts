import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";

// Poll *arr queues and update request statuses
export async function POST() {
  const activeRequests = await prisma.request.findMany({
    where: { status: { in: ["approved", "downloading"] }, arrId: { not: null } },
  });

  if (activeRequests.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  let updated = 0;

  for (const req of activeRequests) {
    try {
      let isAvailable = false;

      switch (req.mediaType) {
        case "movie": {
          const movie = await radarr.getMovie(req.arrId!);
          isAvailable = movie.hasFile === true;
          break;
        }
        case "tv": {
          const series = await sonarr.getSeries(req.arrId!);
          isAvailable = series.statistics?.percentOfEpisodes === 100;
          break;
        }
        case "music": {
          const artist = await lidarr.getArtist(req.arrId!);
          isAvailable = artist.statistics?.albumCount > 0 && artist.statistics?.percentOfTracks === 100;
          break;
        }
      }

      if (isAvailable && req.status !== "available") {
        await prisma.request.update({
          where: { id: req.id },
          data: { status: "available", availableAt: new Date() },
        });
        await prisma.pipelineEvent.create({
          data: { requestId: req.id, event: "available" },
        });
        updated++;
      } else if (!isAvailable && req.status === "approved") {
        // Check if it's in the download queue
        let queues: any;
        switch (req.mediaType) {
          case "movie":
            queues = await radarr.getQueue();
            break;
          case "tv":
            queues = await sonarr.getQueue();
            break;
          case "music":
            queues = await lidarr.getQueue();
            break;
        }
        const inQueue = (queues?.records || []).some(
          (r: any) => r.movieId === req.arrId || r.seriesId === req.arrId || r.artistId === req.arrId
        );
        if (inQueue) {
          await prisma.request.update({
            where: { id: req.id },
            data: { status: "downloading" },
          });
          await prisma.pipelineEvent.create({
            data: { requestId: req.id, event: "downloading" },
          });
          updated++;
        }
      }
    } catch {
      // Skip failed checks
    }
  }

  return NextResponse.json({ updated });
}
