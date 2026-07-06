/**
 * POST /api/admin/services/:name/diagnose-opened (M2-03)
 *
 * Admin-only telemetry endpoint. Records a `service_diagnose_opened` audit
 * event when an operator opens the Diagnose modal for a down service.
 *
 * Body: `{ errorClass: string }` — one of the values from
 * `src/lib/dashboard/error-class.ts` ErrorClass union. The route accepts
 * any string (defense: never crash on a stale client) but only forwards
 * the known set into AuditLog.detail; unknown values land as
 * `errorClass: "unknown"` so the post-beta query stays clean.
 *
 * Why a fire-and-forget POST rather than logging in the GET /logs handler:
 * the GET fires every modal-open including refresh-now clicks, and the
 * telemetry should count opens, not log fetches. Keeping it on a separate
 * POST also lets us extend the body shape later (dwell time, action taken)
 * without breaking the read API.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { SERVICE_REGISTRY } from "@/lib/dashboard/services";
import { logAudit } from "@/lib/audit";
import { log } from "@/lib/log";

const KNOWN_ERROR_CLASSES = new Set([
  "breaker_open",
  "timeout",
  "network",
  "http_5xx",
  "http_4xx",
  "unknown",
]);

const VALID_NAMES = new Set(SERVICE_REGISTRY.map((s) => s.name));

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { name } = await ctx.params;
  if (!VALID_NAMES.has(name)) {
    return NextResponse.json({ error: "Unknown service" }, { status: 404 });
  }

  let errorClass = "unknown";
  try {
    const body = (await req.json()) as { errorClass?: unknown };
    if (
      typeof body.errorClass === "string" &&
      KNOWN_ERROR_CLASSES.has(body.errorClass)
    ) {
      errorClass = body.errorClass;
    }
  } catch (err) {
    // Malformed JSON — keep going with errorClass = "unknown" so we still
    // capture the open. Telemetry should never fail a UI interaction.
    log.warn("diagnose-opened: malformed body", { err });
  }

  await logAudit(
    session.user?.id,
    "service_diagnose_opened",
    { type: "service", id: name },
    { errorClass },
  );

  return NextResponse.json({ ok: true });
}
