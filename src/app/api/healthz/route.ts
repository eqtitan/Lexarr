import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";

/**
 * Liveness + readiness probe for Lexarr.
 *
 * Unlike `/api/config` or `/` (which only prove the Next.js process
 * hasn't crashed), this endpoint validates:
 *   1. The SQLite DB is reachable and responds to a trivial query
 *   2. At least one *arr service (Radarr/Sonarr/Lidarr) accepts the
 *      configured API key and responds to its /health endpoint
 *
 * If (1) fails, Lexarr can't service requests → 503
 * If (2) fails for every configured arr, Lexarr is misconfigured and
 * can't route anything → 503
 *
 * Unauthenticated on purpose — health checks must not require creds.
 * The response body reveals the shape of what's failing but not
 * secrets.
 *
 * Container orchestrators (Unraid's native container health, docker
 * HEALTHCHECK, k8s readinessProbe) can consume this directly.
 *
 * Fast path: every arr check runs in parallel with a 3s cap so this
 * route never blocks for longer than ~3.5s even when everything is
 * down.
 */

const ARR_HEALTHZ_TIMEOUT_MS = 3_000;

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
  durationMs: number;
}

async function checkDb(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Cheapest possible validation — just confirm Prisma can talk to SQLite.
    await prisma.$queryRaw`SELECT 1`;
    return { name: "db", ok: true, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return {
      name: "db",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function checkArr(
  name: string,
  healthFn: () => Promise<unknown>,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Cap the arr health call so we don't inherit the 15s arrFetch default —
    // the circuit breaker's fail-fast path handles repeated outages anyway.
    const timer = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${name} healthz timeout`)),
        ARR_HEALTHZ_TIMEOUT_MS,
      ),
    );
    await Promise.race([healthFn(), timer]);
    return { name, ok: true, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return {
      name,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

export async function GET() {
  const [db, ...arrs] = await Promise.all([
    checkDb(),
    checkArr("radarr", radarr.health),
    checkArr("sonarr", sonarr.health),
    checkArr("lidarr", lidarr.health),
  ]);

  const anyArrOk = arrs.some((r) => r.ok);
  const ok = db.ok && anyArrOk;

  const body = {
    ok,
    checks: {
      db,
      arrs,
    },
    // Explicit human-readable reason when unhealthy, makes log-greps easy
    reason: ok
      ? null
      : !db.ok
        ? "db-unreachable"
        : "no-arr-reachable",
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
