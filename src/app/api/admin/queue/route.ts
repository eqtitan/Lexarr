import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { logAudit } from "@/lib/audit";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";

/**
 * Admin-only queue management.
 *
 * DELETE with `{ source, id, blocklist }` removes a queue item from
 * the named *arr's download client (Radarr/Sonarr/Lidarr), optionally
 * adding the release to the blocklist so the indexer doesn't grab
 * the same release again on the next RSS cycle.
 *
 * This is the plumbing for the Warnings panel's "Blocklist" button
 * on Failed download / Stalled download warnings (0.16.0). Before
 * this endpoint existed, queue-item warnings were display-only.
 */

interface DeleteBody {
  source?: "radarr" | "sonarr" | "lidarr";
  id?: number;
  /** Default true — admins reaching this endpoint are resolving a
   *  problem release, so blocklisting is the right default. */
  blocklist?: boolean;
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  const adminId = session?.user?.id;
  if (session?.user?.role !== "admin" || !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as DeleteBody | null;
  if (!body || !body.source || typeof body.id !== "number") {
    return NextResponse.json(
      { error: "Expected { source, id, blocklist? }" },
      { status: 400 },
    );
  }

  const blocklist = body.blocklist !== false; // default true

  try {
    switch (body.source) {
      case "radarr":
        await radarr.deleteQueueItem(body.id, blocklist);
        break;
      case "sonarr":
        await sonarr.deleteQueueItem(body.id, blocklist);
        break;
      case "lidarr":
        await lidarr.deleteQueueItem(body.id, blocklist);
        break;
      default:
        return NextResponse.json(
          { error: `Unknown source: ${body.source}` },
          { status: 400 },
        );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `${body.source} rejected the delete: ${msg}` },
      { status: 502 },
    );
  }

  void logAudit(
    adminId,
    "blocklist_queue",
    { type: "queue", id: String(body.id) },
    { source: body.source, blocklist },
  );

  return NextResponse.json({ deleted: true, source: body.source, id: body.id });
}
