import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";

export async function GET() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { id: { not: "system" } },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      autoApprove: true,
      plexId: true,
      jellyfinId: true,
      avatar: true,
      createdAt: true,
      _count: { select: { requests: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ users });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { userId, role: newRole, autoApprove } = await req.json();
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const data: any = {};
  if (newRole !== undefined) data.role = newRole;
  if (autoApprove !== undefined) data.autoApprove = autoApprove;

  const user = await prisma.user.update({
    where: { id: userId },
    data,
  });

  return NextResponse.json({ user });
}
