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

/**
 * POST — Create a notification channel.
 *
 * Idempotency: idempotent on `webhookUrl`. A second POST with the same
 * webhookUrl as an existing channel returns the existing channel with
 * status 200 instead of creating a duplicate. Without this, a rapid
 * double-click or retried request would produce two channels firing the
 * same webhook — every notification would send twice.
 *
 * `webhookUrl` is the natural key here: name/type are cosmetic, the URL
 * is what actually receives traffic.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const adminId = session?.user?.id;
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { name, type, webhookUrl, events } = await req.json();
  if (!name || !type || !webhookUrl) {
    return NextResponse.json(
      { error: "Missing required fields (name, type, webhookUrl)" },
      { status: 400 },
    );
  }

  if (!["discord", "slack", "webhook"].includes(type)) {
    return NextResponse.json(
      { error: "Invalid type. Must be: discord, slack, or webhook" },
      { status: 400 },
    );
  }

  // Idempotent upsert by webhookUrl — return existing channel on re-POST
  const existing = await prisma.notificationChannel.findFirst({
    where: { webhookUrl },
  });
  if (existing) {
    return NextResponse.json({ channel: existing, alreadyExists: true });
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

  void logAudit(
    adminId,
    "add_notification",
    { type: "notification", id: channel.id },
    { name, type },
  );

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

  const data: Record<string, unknown> = {};
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
  void logAudit(adminId, "remove_notification", { type: "notification", id });

  return NextResponse.json({ deleted: true });
}
