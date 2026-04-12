import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { routeToArr } from "@/lib/arr/router";
import { notify } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import type { MediaType } from "@/types";

// GET: List pending requests
export async function GET() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const requests = await prisma.request.findMany({
    where: { status: "pending" },
    include: { user: { select: { name: true, avatar: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ requests });
}

// PATCH: Approve or deny a request
export async function PATCH(req: NextRequest) {
  const session = await auth();
  const role = session?.user?.role;
  const adminId = session?.user?.id;
  if (!session || role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { requestId, action, note } = await req.json();
  if (!requestId || !["approve", "deny"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (action === "deny") {
    const request = await prisma.request.update({
      where: { id: requestId },
      data: { status: "denied", adminNote: note || undefined },
    });
    await prisma.pipelineEvent.create({
      data: { requestId, event: "denied", detail: note ? JSON.stringify({ note }) : undefined },
    });

    logAudit(adminId, "deny_request", { type: "request", id: requestId }, { note });

    notify({
      event: "denied",
      title: request.title,
      mediaType: request.mediaType as MediaType,
      status: "denied",
      user: session.user?.name || "Admin",
      detail: note,
    });

    return NextResponse.json({ request });
  }

  // Approve: update status then send to *arr
  const request = await prisma.request.update({
    where: { id: requestId },
    data: { status: "approved", approvedAt: new Date(), adminNote: note || undefined },
  });
  await prisma.pipelineEvent.create({
    data: { requestId, event: "approved", detail: note ? JSON.stringify({ note }) : undefined },
  });

  logAudit(adminId, "approve_request", { type: "request", id: requestId }, { note });

  notify({
    event: "approved",
    title: request.title,
    mediaType: request.mediaType as MediaType,
    status: "approved",
    user: session.user?.name || "Admin",
  });

  try {
    const result = await routeToArr({
      mediaType: request.mediaType as MediaType,
      externalId: request.externalId,
      externalId2: request.externalId2,
      title: request.title,
    });

    if (result.arrId !== undefined) {
      // For books, store the LazyLibrarian ID
      if (request.mediaType === "book") {
        await prisma.request.update({
          where: { id: request.id },
          data: { externalId2: String(result.arrId) },
        });
      }

      const alreadyAvailable = result.alreadyExists;
      const newStatus = alreadyAvailable ? "available" : "downloading";
      await prisma.request.update({
        where: { id: request.id },
        data: {
          arrId: result.arrId || null,
          status: newStatus,
          availableAt: alreadyAvailable ? new Date() : undefined,
        },
      });

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
          title: request.title,
          mediaType: request.mediaType as MediaType,
          status: "available",
          user: session.user?.name || "Admin",
          detail: "Already in library",
        });
      }
    }
  } catch (err: any) {
    console.error(`Failed to add to *arr: ${err.message}`);
    await prisma.request.update({
      where: { id: request.id },
      data: { lastError: err.message },
    });
    await prisma.pipelineEvent.create({
      data: { requestId: request.id, event: "failed", detail: JSON.stringify({ error: err.message }) },
    });
    return NextResponse.json({ request, arrError: err.message });
  }

  return NextResponse.json({ request });
}
