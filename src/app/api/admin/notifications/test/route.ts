import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";

// POST: Send a test notification to a specific channel
export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { channelId } = await req.json();
  if (!channelId) {
    return NextResponse.json({ error: "Missing channelId" }, { status: 400 });
  }

  const channel = await prisma.notificationChannel.findUnique({ where: { id: channelId } });
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Build test payload based on channel type
  let body: any;
  if (channel.type === "discord") {
    body = {
      embeds: [{
        title: "Lexarr Test Notification",
        description: "If you see this, your webhook is working correctly.",
        color: 0x6366f1,
        timestamp: new Date().toISOString(),
        footer: { text: "Lexarr" },
      }],
    };
  } else if (channel.type === "slack") {
    body = {
      blocks: [
        { type: "header", text: { type: "plain_text", text: "Lexarr Test Notification" } },
        { type: "section", text: { type: "mrkdwn", text: "If you see this, your webhook is working correctly." } },
      ],
    };
  } else {
    body = {
      event: "test",
      message: "If you receive this, your webhook is working correctly.",
      timestamp: new Date().toISOString(),
      source: "lexarr",
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(channel.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok && res.status !== 204) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `Webhook returned ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
