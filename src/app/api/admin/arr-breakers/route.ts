import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { snapshotAllBreakers } from "@/lib/arr/circuit-breaker";

/**
 * Admin-only snapshot of every *arr circuit-breaker's current state.
 * Used by the Diagnose action on down-service pills. Read-only — no
 * way to manually trip or reset a breaker from the API.
 */
export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return NextResponse.json({ breakers: snapshotAllBreakers() });
}
