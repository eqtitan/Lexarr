import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";

// GET: List audit log entries
export async function GET(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);
  const action = req.nextUrl.searchParams.get("action");

  const where: Record<string, string> = {};
  if (action) where.action = action;

  const logs = await prisma.auditLog.findMany({
    where,
    include: { user: { select: { name: true, avatar: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });

  return NextResponse.json({ logs });
}
