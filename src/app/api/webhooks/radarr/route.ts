import { NextRequest, NextResponse } from "next/server";
import { checkSingleRequest } from "@/lib/status-checker";

const SECRET = process.env.LEXARR_WEBHOOK_SECRET;

/**
 * Radarr webhook receiver.
 * Configure in Radarr: Settings → Connect → Webhook
 * URL: http://192.168.1.100:5056/api/webhooks/radarr?token=YOUR_SECRET
 * Events: On Import, On Upgrade
 */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!SECRET || token !== SECRET) {
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
    console.error("Radarr webhook error:", errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
