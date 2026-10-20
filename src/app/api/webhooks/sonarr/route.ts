import { NextRequest, NextResponse } from "next/server";
import { checkSingleRequest } from "@/lib/status-checker";
import { log } from "@/lib/log";
import { env } from "@/lib/env";
import { verifyWebhookToken } from "@/lib/webhook-auth";

/**
 * Sonarr webhook receiver.
 * Configure in Sonarr: Settings → Connect → Webhook
 * URL: http://your-server-ip:5056/api/webhooks/sonarr?token=YOUR_SECRET
 * Events: On Import, On Upgrade
 *
 * Idempotency: idempotent — delegates to `checkSingleRequest()`, a
 * state-reconciling update. Duplicate POSTs from Sonarr retries
 * converge on the same row state.
 */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!verifyWebhookToken(env.LEXARR_WEBHOOK_SECRET, token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const eventType = body.eventType;

    if (!["Download", "EpisodeFileImported", "Upgrade"].includes(eventType)) {
      return NextResponse.json({ ok: true, skipped: eventType });
    }

    const seriesId = body.series?.id;
    if (!seriesId) {
      return NextResponse.json({ ok: true, skipped: "no series id" });
    }

    const updated = await checkSingleRequest("tv", seriesId);
    return NextResponse.json({ ok: true, updated });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("webhook.sonarr failed", { err });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
