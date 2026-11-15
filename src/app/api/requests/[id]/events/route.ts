import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import type { PipelineEventDTO } from "@/types/dashboard";
import { userFacingError } from "@/lib/user-facing-error";

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
    detail: role === "admin" ? e.detail : safeDetail(e.detail),
    createdAt: e.createdAt.toISOString(),
  }));

  return NextResponse.json({ events: dto });
}

/** Event details can hold raw *arr or database errors ("error", "raw").
 *  The request's owner sees a plain-English version; admins see it all. */
function safeDetail(detail: string | null): string | null {
  if (!detail) return detail;
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    for (const key of ["error", "raw"]) {
      if (typeof parsed[key] === "string") parsed[key] = userFacingError(parsed[key] as string);
    }
    return JSON.stringify(parsed);
  } catch {
    return userFacingError(detail);
  }
}
