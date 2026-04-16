import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!session || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const role = session?.user?.role;
  const where = role === "admin" ? {} : { userId };

  const requests = await prisma.request.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ requests });
}
