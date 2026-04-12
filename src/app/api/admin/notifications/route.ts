import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { logAudit } from "@/lib/audit";

// GET: List all notification channels
export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const channels = await prisma.notificationChannel.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ channels });
}

// POST: Create a new notification channel
export async function POST(req: NextRequest) {
  const session = await auth();
  const adminId = session?.user?.id;
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { name, type, webhookUrl, events } = await req.json();
  if (!name || !type || !webhookUrl) {
    return NextResponse.json({ error: "Missing required fields (name, type, webhookUrl)" }, { status: 400 });
  }

  if (!["discord", "slack", "webhook"].includes(type)) {
    return NextResponse.json({ error: "Invalid type. Must be: discord, slack, or webhook" }, { status: 400 });
  }

  const channel = await prisma.notificationChannel.create({
    data: {
      name,
      type,
      webhookUrl,
      events: events || "all",
      enabled: true,
    },
  });

  logAudit(adminId, "add_notification", { type: "notification", id: channel.id }, { name, type });

  return NextResponse.json({ channel }, { status: 201 });
}

// PATCH: Update a notification channel (toggle enabled, change events, etc.)
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id, ...updates } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const data: any = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.webhookUrl !== undefined) data.webhookUrl = updates.webhookUrl;
  if (updates.events !== undefined) data.events = updates.events;
  if (updates.enabled !== undefined) data.enabled = updates.enabled;

  const channel = await prisma.notificationChannel.update({
    where: { id },
    data,
  });

  return NextResponse.json({ channel });
}

// DELETE: Remove a notification channel
export async function DELETE(req: NextRequest) {
  const session = await auth();
  const adminId = session?.user?.id;
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  await prisma.notificationChannel.delete({ where: { id } });
  logAudit(adminId, "remove_notification", { type: "notification", id });

  return NextResponse.json({ deleted: true });
}
