import { NextResponse } from "next/server";
import { checkDb } from "@/lib/health";

/**
 * Liveness probe: the app is up and its SQLite DB answers. No *arr calls.
 *
 * This is what Docker's HEALTHCHECK (Dockerfile, docker-compose.yml) and so
 * Unraid's container health probe every 30s. It must stay independent of
 * Radarr/Sonarr/Lidarr: when they're down Lexarr itself is healthy, and
 * probing them from here every 30s both marked the container unhealthy
 * and added load to them. For "can this deploy route requests?" use
 * /api/healthz (readiness).
 *
 * Unauthenticated on purpose — health checks must not require creds.
 */
export async function GET() {
  const db = await checkDb();
  return NextResponse.json(
    { ok: db.ok, checks: { db }, timestamp: new Date().toISOString() },
    { status: db.ok ? 200 : 503 },
  );
}
