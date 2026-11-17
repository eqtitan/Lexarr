import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getReadinessReport } from "@/lib/readiness";

// GET: readiness report (security, backups, services, pipeline, books).
// Admin only; results are cached for 60s in src/lib/readiness.ts.
export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return NextResponse.json(await getReadinessReport());
}
