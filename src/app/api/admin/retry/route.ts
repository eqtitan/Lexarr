import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { routeToArr } from "@/lib/arr/router";
import { notify } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import type { MediaType } from "@/types";

const MAX_RETRIES = 3;

// POST: Retry a failed or stalled request
export async function POST(req: NextRequest) {
  const session = await auth();
  const role = session?.user?.role;
  const adminId = session?.user?.id;
  if (!session || role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { requestId } = await req.json();
  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  const request = await prisma.request.findUnique({ where: { id: requestId } });
  if (!request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  // Allow retry for failed/stalled, or approved requests stuck without an arrId (routing failed silently)
  const canRetry = ["failed", "stalled"].includes(request.status) ||
    (request.status === "approved" && !request.arrId);
  if (!canRetry) {
    return NextResponse.json({ error: `Cannot retry request with status: ${request.status}` }, { status: 400 });
  }

  if (request.retryCount >= MAX_RETRIES) {
    return NextResponse.json({ error: `Max retries (${MAX_RETRIES}) reached` }, { status: 400 });
  }

  // Reset to approved and bump retry count
  await prisma.request.update({
    where: { id: requestId },
    data: { status: "approved", lastError: null, retryCount: { increment: 1 } },
  });

  await prisma.pipelineEvent.create({
    data: {
      requestId,
      event: "retried",
      detail: JSON.stringify({ retryCount: request.retryCount + 1, previousStatus: request.status }),
    },
  });

  logAudit(adminId, "retry_request", { type: "request", id: requestId }, { retryCount: request.retryCount + 1 });

  try {
    const result = await routeToArr({
      mediaType: request.mediaType as MediaType,
      externalId: request.externalId,
      externalId2: request.externalId2,
      title: request.title,
    });

    if (result.arrId !== undefined) {
      if (request.mediaType === "book") {
        await prisma.request.update({
          where: { id: requestId },
          data: { externalId2: String(result.arrId) },
        });
      }

      const alreadyAvailable = result.alreadyExists;
      const newStatus = alreadyAvailable ? "available" : "downloading";
      await prisma.request.update({
        where: { id: requestId },
        data: {
          arrId: result.arrId || null,
          status: newStatus,
          availableAt: alreadyAvailable ? new Date() : undefined,
        },
      });

      await prisma.pipelineEvent.create({
        data: {
          requestId,
          event: "sent_to_arr",
          detail: JSON.stringify({ arrId: result.arrId, alreadyExists: result.alreadyExists, retry: true }),
        },
      });

      if (alreadyAvailable) {
        await prisma.pipelineEvent.create({
          data: { requestId, event: "available", detail: JSON.stringify({ alreadyExists: true }) },
        });
      }
    }

    notify({
      event: "retried",
      title: request.title,
      mediaType: request.mediaType as MediaType,
      status: "approved",
      user: session.user?.name || "Admin",
      detail: `Retry #${request.retryCount + 1}`,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    await prisma.request.update({
      where: { id: requestId },
      data: { status: "failed", lastError: err.message },
    });
    await prisma.pipelineEvent.create({
      data: { requestId, event: "failed", detail: JSON.stringify({ error: err.message, retry: true }) },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
