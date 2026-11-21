import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getSetupInfo } from "@/lib/setup";
import { setSetupStatus } from "@/lib/settings";
import { logAudit } from "@/lib/audit";

/**
 * Admin-only state of the first-run setup guide.
 *
 * GET returns what the guide needs (see SetupInfo; never a secret value).
 * PUT accepts `{ status: "completed" | "skipped" }`.
 */

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return NextResponse.json(await getSetupInfo());
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  const adminId = session?.user?.id;
  if (session?.user?.role !== "admin" || !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const status = body && typeof body === "object" ? (body as { status?: unknown }).status : undefined;
  if (status !== "completed" && status !== "skipped") {
    return NextResponse.json({ error: 'Expected { status: "completed" | "skipped" }' }, { status: 400 });
  }

  await setSetupStatus(status);
  void logAudit(adminId, "update_settings", { type: "settings", id: "setup.status" }, { status });

  return NextResponse.json(await getSetupInfo());
}
