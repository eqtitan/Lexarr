import { NextResponse } from "next/server";
import { getReadiness } from "@/lib/health";

/**
 * Readiness probe for Lexarr.
 *
 * Unlike `/api/livez` (Docker's HEALTHCHECK -- app + DB only), this
 * validates that the deploy can actually route requests:
 *   1. The SQLite DB is reachable and responds to a trivial query
 *   2. At least one *arr service (Radarr/Sonarr/Lidarr) accepts the
 *      configured API key and responds to its /health endpoint
 *
 * If (1) fails, Lexarr can't service requests → 503
 * If (2) fails for every configured arr, Lexarr is misconfigured and
 * can't route anything → 503
 *
 * deploy.ps1 gates on this after a deploy (and rolls back on non-200);
 * external monitors can use it too. Results are cached for 10s so this
 * public, unauthenticated route can't be used to hammer the *arr apps.
 * See src/lib/health.ts.
 */
export async function GET() {
  const body = await getReadiness();
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
