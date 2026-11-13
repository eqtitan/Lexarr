import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";

/**
 * Admin activity feed: the request events a notification channel would
 * announce (new request, available, failed, stalled, denied, cancelled),
 * for every user, newest first. Read from PipelineEvent, so it works with
 * no webhook channel configured -- this is the admin dashboard's
 * notification inbox.
 */
const ACTIVITY_EVENTS = ["submitted", "available", "failed", "stalled", "denied", "cancelled"] as const;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;
const MAX_ITEMS = 200;

function summarize(event: string, detail: string | null, lastError: string | null): string | null {
  let d: Record<string, unknown> = {};
  try {
    d = detail ? (JSON.parse(detail) as Record<string, unknown>) : {};
  } catch {
    // free-text detail
  }
  if (event === "available") {
    if (d.reason === "late_arrival") return "Arrived after Lexarr had given up";
    return null;
  }
  if (event === "submitted") return d.auto ? "Auto-approved" : null;
  if (event === "failed" || event === "stalled") {
    const why = typeof d.error === "string" ? d.error : lastError;
    return why ? why.replace(/\s+/g, " ").trim().slice(0, 160) : null;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const daysParam = parseInt(req.nextUrl.searchParams.get("days") || String(DEFAULT_DAYS), 10);
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), MAX_DAYS) : DEFAULT_DAYS;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.pipelineEvent.findMany({
    where: { event: { in: [...ACTIVITY_EVENTS] }, createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    take: MAX_ITEMS,
    include: {
      request: {
        select: { id: true, title: true, mediaType: true, status: true, lastError: true, user: { select: { name: true } } },
      },
    },
  });

  // A few legacy rows store createdAt as TEXT, which SQLite sorts above every
  // integer timestamp -- re-check the cutoff here so they can't pose as new.
  const activity = rows
    .filter((r) => r.createdAt instanceof Date && !Number.isNaN(r.createdAt.getTime()) && r.createdAt >= cutoff)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => ({
      id: r.id,
      event: r.event,
      at: r.createdAt.toISOString(),
      requestId: r.request.id,
      title: r.request.title,
      mediaType: r.request.mediaType,
      currentStatus: r.request.status,
      user: r.request.user?.name ?? "Unknown",
      summary: summarize(r.event, r.detail, r.request.lastError),
    }));

  return NextResponse.json({ activity, days });
}
