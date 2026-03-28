import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";
import type { MediaType } from "@/types";

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id || "system";

  const body = await req.json();
  const { mediaType, externalId, title, year, posterUrl, artistId } = body as {
    mediaType: MediaType;
    externalId: string;
    title: string;
    year?: string;
    posterUrl?: string;
    artist?: string;
    artistId?: string; // MusicBrainz artist UUID for Lidarr
  };

  if (!mediaType || !externalId || !title) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Check for duplicate request
  const existing = await prisma.request.findFirst({
    where: { externalId, mediaType },
  });
  if (existing) {
    return NextResponse.json({ error: "Already requested", request: existing }, { status: 409 });
  }

  // Determine approval status based on user settings
  const dbUser = userId !== "system"
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  const autoApprove = dbUser?.autoApprove || dbUser?.role === "admin" || userId === "system";

  // Create the request in our DB
  const request = await prisma.request.create({
    data: {
      userId,
      mediaType,
      externalId,
      title,
      year,
      externalId2: artistId || undefined,
      posterPath: posterUrl,
      status: autoApprove ? "approved" : "pending",
      approvedAt: autoApprove ? new Date() : undefined,
    },
  });

  // Log "submitted" pipeline event
  await prisma.pipelineEvent.create({
    data: { requestId: request.id, event: "submitted" },
  });

  if (autoApprove) {
    await prisma.pipelineEvent.create({
      data: { requestId: request.id, event: "approved", detail: JSON.stringify({ auto: true }) },
    });
  }

  // Only send to *arr if auto-approved
  if (!autoApprove) {
    return NextResponse.json({ request });
  }

  // Route to the correct *arr app
  let arrResult: { id: number; alreadyExists?: boolean } | undefined;
  let arrError: string | undefined;

  try {
    switch (mediaType) {
      case "movie": {
        arrResult = await radarr.addMovie(Number(externalId), title);
        break;
      }
      case "tv": {
        arrResult = await sonarr.addSeries(Number(externalId), title);
        break;
      }
      case "music": {
        // Music: use artistId (MusicBrainz artist UUID) to add to Lidarr
        const lidarrId = artistId || externalId;
        arrResult = await lidarr.addArtist(lidarrId, title);
        break;
      }
      case "book": {
        // LazyLibrarian integration - TODO when port/key confirmed
        break;
      }
    }
  } catch (err: any) {
    arrError = err.message;
    console.error(`Failed to add to *arr: ${err.message}`);
  }

  // Update request with *arr tracking info
  if (arrResult) {
    const newStatus = arrResult.alreadyExists ? "available" : "downloading";
    await prisma.request.update({
      where: { id: request.id },
      data: {
        arrId: arrResult.id,
        status: newStatus,
        availableAt: arrResult.alreadyExists ? new Date() : undefined,
      },
    });
    request.arrId = arrResult.id;
    request.status = newStatus;

    await prisma.pipelineEvent.create({
      data: {
        requestId: request.id,
        event: "sent_to_arr",
        detail: JSON.stringify({ arrId: arrResult.id, alreadyExists: arrResult.alreadyExists }),
      },
    });

    if (arrResult.alreadyExists) {
      await prisma.pipelineEvent.create({
        data: { requestId: request.id, event: "available", detail: JSON.stringify({ alreadyExists: true }) },
      });
    }
  }

  return NextResponse.json({ request, arrError });
}
