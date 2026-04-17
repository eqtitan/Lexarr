import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import type { PipelineEventDTO } from "@/types/dashboard";

/**
 * Return the PipelineEvent history for a single request.
 *
 * Authorization: the request owner, or any admin. Regular users cannot read
 * other users' lifecycle history. Returns 404 (not 403) when an unauthorized
 * user asks, so we don't leak whether a given id exists.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!session || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const role = session.user?.role;

  const request = await prisma.request.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });

  if (!request || (role !== "admin" && request.userId !== userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const events = await prisma.pipelineEvent.findMany({
    where: { requestId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      event: true,
      detail: true,
      createdAt: true,
    },
  });

  const dto: PipelineEventDTO[] = events.map((e) => ({
    id: e.id,
    event: e.event,
    detail: e.detail,
    createdAt: e.createdAt.toISOString(),
  }));

  return NextResponse.json({ events: dto });
}
