/**
 * Notification system for Lexarr.
 * Sends webhook notifications to Discord, Slack, and generic webhook endpoints
 * when request pipeline events occur.
 */
import { prisma } from "./db";
import type { MediaType, PipelineEventType } from "@/types";

interface NotificationPayload {
  event: PipelineEventType;
  title: string;
  mediaType: MediaType;
  status: string;
  user: string;
  detail?: string;
  posterUrl?: string;
}

const EVENT_LABELS: Record<string, string> = {
  submitted: "New Request",
  approved: "Request Approved",
  denied: "Request Denied",
  sent_to_arr: "Sent to Service",
  downloading: "Downloading",
  available: "Now Available",
  failed: "Request Failed",
  stalled: "Download Stalled",
  retried: "Request Retried",
  cancelled: "Request Cancelled",
};

const MEDIA_EMOJI: Record<string, string> = {
  movie: "🎬",
  tv: "📺",
  music: "🎵",
  book: "📚",
};

function buildDiscordEmbed(payload: NotificationPayload) {
  const colorMap: Record<string, number> = {
    submitted: 0x3498db, // blue
    approved: 0x2ecc71, // green
    denied: 0xe74c3c, // red
    sent_to_arr: 0x9b59b6, // purple
    downloading: 0xf39c12, // orange
    available: 0x27ae60, // dark green
    failed: 0xe74c3c, // red
    stalled: 0xe67e22, // dark orange
    retried: 0x3498db, // blue
    cancelled: 0x95a5a6, // gray
  };

  return {
    embeds: [
      {
        title: `${MEDIA_EMOJI[payload.mediaType] || ""} ${EVENT_LABELS[payload.event] || payload.event}`,
        description: `**${payload.title}**`,
        color: colorMap[payload.event] || 0x95a5a6,
        fields: [
          { name: "Type", value: payload.mediaType, inline: true },
          { name: "Status", value: payload.status, inline: true },
          { name: "User", value: payload.user, inline: true },
          ...(payload.detail
            ? [{ name: "Detail", value: payload.detail.slice(0, 200) }]
            : []),
        ],
        thumbnail: payload.posterUrl ? { url: payload.posterUrl } : undefined,
        timestamp: new Date().toISOString(),
        footer: { text: "Lexarr" },
      },
    ],
  };
}

function buildSlackPayload(payload: NotificationPayload) {
  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${MEDIA_EMOJI[payload.mediaType] || ""} ${EVENT_LABELS[payload.event] || payload.event}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Title:*\n${payload.title}` },
          { type: "mrkdwn", text: `*Type:*\n${payload.mediaType}` },
          { type: "mrkdwn", text: `*Status:*\n${payload.status}` },
          { type: "mrkdwn", text: `*User:*\n${payload.user}` },
        ],
      },
      ...(payload.detail
        ? [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Detail:* ${payload.detail.slice(0, 200)}`,
              },
            },
          ]
        : []),
    ],
  };
}

function buildGenericPayload(payload: NotificationPayload) {
  return {
    event: payload.event,
    title: payload.title,
    mediaType: payload.mediaType,
    status: payload.status,
    user: payload.user,
    detail: payload.detail,
    posterUrl: payload.posterUrl,
    timestamp: new Date().toISOString(),
    source: "lexarr",
  };
}

async function sendWebhook(
  url: string,
  type: string,
  payload: NotificationPayload,
): Promise<boolean> {
  try {
    let body: Record<string, unknown>;
    switch (type) {
      case "discord":
        body = buildDiscordEmbed(payload);
        break;
      case "slack":
        body = buildSlackPayload(payload);
        break;
      default:
        body = buildGenericPayload(payload);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return res.ok || res.status === 204;
  } catch (err) {
    console.error(`Notification webhook failed (${type}):`, err);
    return false;
  }
}

/**
 * Send notifications for a pipeline event.
 * Fires and forgets — never throws or blocks the request pipeline.
 */
export async function notify(payload: NotificationPayload): Promise<void> {
  try {
    const channels = await prisma.notificationChannel.findMany({
      where: { enabled: true },
    });

    if (channels.length === 0) return;

    const promises = channels
      .filter((ch) => {
        if (ch.events === "all") return true;
        return ch.events
          .split(",")
          .map((e) => e.trim())
          .includes(payload.event);
      })
      .map((ch) => sendWebhook(ch.webhookUrl, ch.type, payload));

    await Promise.allSettled(promises);
  } catch {
    // Notifications must never break the main pipeline
  }
}
