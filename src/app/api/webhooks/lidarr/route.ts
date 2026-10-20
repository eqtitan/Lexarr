import { NextRequest, NextResponse } from "next/server";
import { checkSingleRequest } from "@/lib/status-checker";
import { log } from "@/lib/log";
import { env } from "@/lib/env";
import { verifyWebhookToken, webhookTokenFrom } from "@/lib/webhook-auth";

/**
 * Lidarr webhook receiver.
 * Configure in Lidarr: Settings → Connect → Webhook
 * URL: http://your-server-ip:5056/api/webhooks/lidarr -- put LEXARR_WEBHOOK_SECRET in
 * the connection's Password field (HTTP Basic auth; Username is ignored).
 * The older ?token=YOUR_SECRET form still works but leaks into URLs/logs.
 * Events: On Import, On Upgrade
 *
 * Idempotency: idempotent — delegates to `checkSingleRequest()`, a
 * state-reconciling update. Duplicate POSTs from Lidarr retries
 * converge on the same row state.
 */
export async function POST(req: NextRequest) {
  const token = webhookTokenFrom(req);
  if (!verifyWebhookToken(env().LEXARR_WEBHOOK_SECRET, token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const eventType = body.eventType;

    if (!["Download", "TrackFileImported", "Upgrade"].includes(eventType)) {
      return NextResponse.json({ ok: true, skipped: eventType });
    }

    const artistId = body.artist?.id;
    if (!artistId) {
      return NextResponse.json({ ok: true, skipped: "no artist id" });
    }

    const updated = await checkSingleRequest("music", artistId);
    return NextResponse.json({ ok: true, updated });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("webhook.lidarr failed", { err });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
