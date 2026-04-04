import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db";
import { routeToArr } from "@/lib/arr/router";
import { notify } from "@/lib/notifications";
import type { MediaType } from "@/types";

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!session || !userId) {
    return NextResponse.json({ error: "Sign in to make requests" }, { status: 401 });
  }

  const body = await req.json();

  // Admin-only guard for adult content
  if (body.mediaType === "adult" && (session.user as any)?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    mediaType,
    externalId,
    title,
    year,
    posterUrl,
    artistId,
    downloadUrl,
    protocol,
  } = body as {
    mediaType: MediaType;
    externalId: string;
    title: string;
    year?: string;
    posterUrl?: string;
    artist?: string;
    artistId?: string;
    downloadUrl?: string;
    protocol?: string;
  };

  if (!mediaType || !externalId || !title) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Guard: reject adult requests with a missing/undefined externalId
  if (
    mediaType === "adult" &&
    (externalId === "site:undefined" || externalId === "movie:undefined" || externalId.endsWith(":undefined"))
  ) {
    return NextResponse.json(
      { error: "Invalid content ID — search result was missing an ID from TPDB. Try searching again." },
      { status: 400 }
    );
  }

  // Check for duplicate request
  const existing = await prisma.request.findFirst({
    where: { externalId, mediaType },
  });
  if (existing) {
    return NextResponse.json({ error: "Already requested", request: existing }, { status: 409 });
  }

  // Check request quota
  const dbUser =
    userId !== "system"
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;

  if (dbUser && dbUser.maxRequests > 0 && dbUser.role !== "admin") {
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);
    const monthlyCount = await prisma.request.count({
      where: { userId, createdAt: { gte: currentMonth } },
    });
    if (monthlyCount >= dbUser.maxRequests) {
      return NextResponse.json(
        { error: `Monthly request limit reached (${dbUser.maxRequests})` },
        { status: 429 }
      );
    }
  }

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
      source: "lexarr",
    },
  });

  // Log pipeline events
  await prisma.pipelineEvent.create({
    data: { requestId: request.id, event: "submitted" },
  });

  // Fire notification
  notify({
    event: "submitted",
    title,
    mediaType: mediaType as MediaType,
    status: autoApprove ? "approved" : "pending",
    user: dbUser?.name || "Unknown",
    posterUrl,
  });

  if (autoApprove) {
    await prisma.pipelineEvent.create({
      data: { requestId: request.id, event: "approved", detail: JSON.stringify({ auto: true }) },
    });
  }

  if (!autoApprove) {
    return NextResponse.json({ request });
  }

  // Route to the correct *arr app
  let arrError: string | undefined;

  try {
    const result = await routeToArr({
      mediaType: mediaType as MediaType,
      externalId,
      externalId2: artistId,
      title,
      downloadUrl,
      protocol,
    });

    if (result.needsReRequest) {
      arrError = "Re-request required";
    } else if (result.torrentHash !== undefined) {
      // Prowlarr direct grab
      await prisma.request.update({
        where: { id: request.id },
        data: { status: "downloading", torrentHash: result.torrentHash || null },
      });
      request.status = "downloading";

      await prisma.pipelineEvent.create({
        data: {
          requestId: request.id,
          event: "sent_to_arr",
          detail: JSON.stringify({ protocol, direct: true, torrentHash: result.torrentHash ?? null }),
        },
      });
    } else if (result.arrId !== undefined) {
      // *arr managed
      // For books, store the LazyLibrarian ID for polling
      if (mediaType === "book") {
        await prisma.request.update({
          where: { id: request.id },
          data: { externalId2: String(result.arrId) },
        });
      }

      const alreadyAvailable = result.alreadyExists && mediaType !== "adult";
      const newStatus = alreadyAvailable ? "available" : "downloading";
      await prisma.request.update({
        where: { id: request.id },
        data: {
          arrId: result.arrId || null,
          status: newStatus,
          availableAt: alreadyAvailable ? new Date() : undefined,
        },
      });
      request.arrId = result.arrId;
      request.status = newStatus;

      await prisma.pipelineEvent.create({
        data: {
          requestId: request.id,
          event: "sent_to_arr",
          detail: JSON.stringify({ arrId: result.arrId, alreadyExists: result.alreadyExists }),
        },
      });

      if (alreadyAvailable) {
        await prisma.pipelineEvent.create({
          data: { requestId: request.id, event: "available", detail: JSON.stringify({ alreadyExists: true }) },
        });
        notify({
          event: "available",
          title,
          mediaType: mediaType as MediaType,
          status: "available",
          user: dbUser?.name || "Unknown",
          posterUrl,
          detail: "Already in library",
        });
      }
    }
  } catch (err: any) {
    arrError = err.message;
    console.error(`Failed to add to *arr: ${err.message}`);

    await prisma.request.update({
      where: { id: request.id },
      data: { status: "failed", lastError: err.message },
    });

    await prisma.pipelineEvent.create({
      data: { requestId: request.id, event: "failed", detail: JSON.stringify({ error: err.message }) },
    });

    notify({
      event: "failed",
      title,
      mediaType: mediaType as MediaType,
      status: "failed",
      user: dbUser?.name || "Unknown",
      detail: err.message,
    });
  }

  return NextResponse.json({ request, arrError });
}
