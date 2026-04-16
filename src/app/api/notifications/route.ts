import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db";

/**
 * User notifications — derived from request status changes.
 * Returns requests that became "available" since the user last checked.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!session || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find requests by this user that are now available
  // and became available in the last 7 days
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const available = await prisma.request.findMany({
    where: {
      userId,
      status: "available",
      availableAt: { gte: cutoff },
    },
    orderBy: { availableAt: "desc" },
    select: {
      id: true,
      title: true,
      mediaType: true,
      posterPath: true,
      availableAt: true,
    },
    take: 20,
  });

  return NextResponse.json({ notifications: available });
}
