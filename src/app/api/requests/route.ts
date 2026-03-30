import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!session || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const role = (session?.user as any)?.role;
  const where = role === "admin" ? {} : { userId };

  const requests = await prisma.request.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ requests });
}
