import { NextRequest, NextResponse } from "next/server";
import { checkSingleRequest } from "@/lib/status-checker";

const SECRET = process.env.LEXARR_WEBHOOK_SECRET;

/**
 * Lidarr webhook receiver.
 * Configure in Lidarr: Settings → Connect → Webhook
 * URL: http://192.168.1.100:5056/api/webhooks/lidarr?token=YOUR_SECRET
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
    console.error("Lidarr webhook error:", errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
