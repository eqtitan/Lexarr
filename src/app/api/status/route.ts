import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { checkAndUpdateStatuses } from "@/lib/status-checker";

/**
 * Manual status poll — admin only.
 * Delegates to the shared status-checker (same logic as background cron).
 *
 * Idempotency: effectively idempotent. Each call re-reads *arr state and
 * reconciles the DB, so rapid repeat POSTs converge to the same end state.
 * Pipeline events may be written on state transitions — that's intrinsic
 * to the reconciliation loop, not a duplication bug.
 */
export async function POST() {
  const session = await auth();
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const result = await checkAndUpdateStatuses();
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Status check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
