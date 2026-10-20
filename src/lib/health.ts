/**
 * Health checks behind /api/livez (liveness) and /api/healthz (readiness).
 *
 * Liveness: the app is up and its SQLite DB answers. This is what Docker's
 * HEALTHCHECK probes every 30s, so it must not depend on anything outside
 * the container -- Lexarr is fine when Radarr/Sonarr/Lidarr are down.
 *
 * Readiness: liveness plus at least one *arr accepting our API key, i.e.
 * "this deploy can actually route requests". deploy.ps1 gates on it after a
 * deploy. Both routes are unauthenticated on purpose (health checks must
 * not need creds); bodies reveal what's failing but not secrets.
 */
import { prisma } from "@/lib/db";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";

const ARR_HEALTHZ_TIMEOUT_MS = 3_000;

/**
 * How long a readiness result is reused. The route is public, and each
 * uncached call fans out to three *arr apps -- the cache bounds that to
 * one round per window no matter how often it's hit.
 */
const READINESS_CACHE_MS = 10_000;

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
  durationMs: number;
}

export interface Readiness {
  ok: boolean;
  checks: { db: CheckResult; arrs: CheckResult[] };
  reason: "db-unreachable" | "no-arr-reachable" | null;
  timestamp: string;
}

export async function checkDb(): Promise<CheckResult> {
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
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    // Cap the arr health call so we don't inherit the 15s arrFetch default —
    // the circuit breaker's fail-fast path handles repeated outages anyway.
    const timer = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`${name} healthz timeout`)),
        ARR_HEALTHZ_TIMEOUT_MS,
      );
    });
    await Promise.race([healthFn(), timer]);
    return { name, ok: true, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return {
      name,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

let cached: { at: number; result: Promise<Readiness> } | null = null;

/** Test-only: forget the cached readiness result. */
export function _resetReadinessCache(): void {
  cached = null;
}

/**
 * DB + every *arr in parallel, each capped at 3s, so an uncached call
 * never blocks for longer than ~3.5s even when everything is down.
 * Concurrent callers inside the cache window share one in-flight check.
 */
export function getReadiness(): Promise<Readiness> {
  const now = Date.now();
  if (cached && now - cached.at < READINESS_CACHE_MS) return cached.result;

  const result = (async (): Promise<Readiness> => {
    const [db, ...arrs] = await Promise.all([
      checkDb(),
      checkArr("radarr", radarr.health),
      checkArr("sonarr", sonarr.health),
      checkArr("lidarr", lidarr.health),
    ]);
    const ok = db.ok && arrs.some((r) => r.ok);
    return {
      ok,
      checks: { db, arrs },
      // Explicit human-readable reason when unhealthy, makes log-greps easy
      reason: ok ? null : !db.ok ? "db-unreachable" : "no-arr-reachable",
      timestamp: new Date().toISOString(),
    };
  })();
  cached = { at: now, result };
  return result;
}
