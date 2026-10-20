import { NextRequest, NextResponse } from "next/server";
import { checkSingleRequest } from "@/lib/status-checker";
import { log } from "@/lib/log";
import { env } from "@/lib/env";
import { verifyWebhookToken } from "@/lib/webhook-auth";

/**
 * Radarr webhook receiver.
 * Configure in Radarr: Settings → Connect → Webhook
 * URL: http://your-server-ip:5056/api/webhooks/radarr?token=YOUR_SECRET
 * Events: On Import, On Upgrade
 *
 * Idempotency: idempotent. Delegates to `checkSingleRequest()`, which
 * does a state-reconciling update (status → available / downloading)
 * and a state-transition pipeline event. Radarr occasionally retries a
 * webhook on its own — duplicate POSTs converge on the same row state.
 */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!verifyWebhookToken(env.LEXARR_WEBHOOK_SECRET, token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const eventType = body.eventType;

    // Radarr sends "Download" on import (confusing name), "MovieFileImported" in newer versions
    if (!["Download", "MovieFileImported", "Upgrade"].includes(eventType)) {
      return NextResponse.json({ ok: true, skipped: eventType });
    }

    const movieId = body.movie?.id;
    if (!movieId) {
      return NextResponse.json({ ok: true, skipped: "no movie id" });
    }

    const updated = await checkSingleRequest("movie", movieId);
    return NextResponse.json({ ok: true, updated });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("webhook.radarr failed", { err });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
