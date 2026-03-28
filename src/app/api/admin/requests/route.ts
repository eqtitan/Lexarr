import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";

// GET: List pending requests
export async function GET() {
  const requests = await prisma.request.findMany({
    where: { status: "pending" },
    include: { user: { select: { name: true, avatar: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ requests });
}

// PATCH: Approve or deny a request
export async function PATCH(req: NextRequest) {
  const { requestId, action } = await req.json();
  if (!requestId || !["approve", "deny"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (action === "deny") {
    const request = await prisma.request.update({
      where: { id: requestId },
      data: { status: "denied" },
    });
    await prisma.pipelineEvent.create({
      data: { requestId, event: "denied" },
    });
    return NextResponse.json({ request });
  }

  // Approve: send to *arr
  const request = await prisma.request.update({
    where: { id: requestId },
    data: { status: "approved", approvedAt: new Date() },
  });
  await prisma.pipelineEvent.create({
    data: { requestId, event: "approved" },
  });

  let arrResult: { id: number; alreadyExists?: boolean } | undefined;
  try {
    switch (request.mediaType) {
      case "movie": {
        arrResult = await radarr.addMovie(Number(request.externalId), request.title);
        break;
      }
      case "tv": {
        arrResult = await sonarr.addSeries(Number(request.externalId), request.title);
        break;
      }
      case "music": {
        // Use externalId2 (artist UUID) if available, fall back to externalId
        const lidarrId = request.externalId2 || request.externalId;
        arrResult = await lidarr.addArtist(lidarrId, request.title);
        break;
      }
    }
  } catch (err: any) {
    console.error(`Failed to add to *arr: ${err.message}`);
  }

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
    await prisma.pipelineEvent.create({
      data: {
        requestId: request.id,
        event: "sent_to_arr",
        detail: JSON.stringify({ arrId: arrResult.id, alreadyExists: arrResult.alreadyExists }),
      },
    });
  }

  return NextResponse.json({ request });
}
