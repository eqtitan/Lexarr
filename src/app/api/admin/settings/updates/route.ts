import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { env } from "@/lib/env";
import { getUpdateCheckEnabled, setUpdateCheckEnabled } from "@/lib/settings";
import { getUpdateStatus } from "@/lib/update-check";
import { logAudit } from "@/lib/audit";

/**
 * Admin-only read/write for the update-notice opt-in.
 *
 * GET returns `{ enabled, lockedByEnv }`: the saved choice, and whether
 * LEXARR_UPDATE_CHECK=false overrides it.
 * PUT accepts `{ enabled: boolean }`.
 */

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return NextResponse.json({
    enabled: await getUpdateCheckEnabled(),
    lockedByEnv: env().LEXARR_UPDATE_CHECK === "false",
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  const adminId = session?.user?.id;
  if (session?.user?.role !== "admin" || !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Expected { enabled: boolean }" }, { status: 400 });
  }

  await setUpdateCheckEnabled(body.enabled);
  void logAudit(adminId, "update_settings", { type: "settings", id: "updates.check" }, { enabled: body.enabled });

  return NextResponse.json({
    enabled: body.enabled,
    lockedByEnv: env().LEXARR_UPDATE_CHECK === "false",
    // Warm the cache so the nav badge appears right after switching on.
    status: await getUpdateStatus(),
  });
}
