import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  getAllowedRegions,
  setAllowedRegions,
  SUPPORTED_REGIONS,
  DEFAULT_ALLOWED_REGIONS,
  type RegionCode,
} from "@/lib/settings";
import { logAudit } from "@/lib/audit";

/**
 * Admin-only read/write for music search settings.
 *
 * GET returns the current regions + the supported list so the UI can
 * render the checkbox grid without needing two calls.
 *
 * PUT accepts `{ regions: string[] }`. An empty array is valid and
 * disables region filtering entirely. Invalid codes are silently
 * dropped by the settings lib.
 */

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const regions = await getAllowedRegions();
  return NextResponse.json({
    regions,
    supported: SUPPORTED_REGIONS,
    default: DEFAULT_ALLOWED_REGIONS,
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  const adminId = session?.user?.id;
  if (session?.user?.role !== "admin" || !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.regions)) {
    return NextResponse.json(
      { error: "Expected { regions: string[] }" },
      { status: 400 },
    );
  }

  // Cast is safe here — setAllowedRegions re-validates internally.
  await setAllowedRegions(body.regions as RegionCode[]);
  const saved = await getAllowedRegions();

  void logAudit(
    adminId,
    "update_settings",
    { type: "settings", id: "music.allowedRegions" },
    { regions: saved },
  );

  return NextResponse.json({ regions: saved });
}
