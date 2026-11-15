import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { userFacingError } from "@/lib/user-facing-error";

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
  // Reasons saved before 0.28.0 can hold raw *arr or database errors;
  // non-admins get the plain-English version.
  return NextResponse.json({
    requests:
      role === "admin" ? requests : requests.map((r) => ({ ...r, lastError: userFacingError(r.lastError) })),
  });
}
