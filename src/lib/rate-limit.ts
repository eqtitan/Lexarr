/**
 * DB-backed sliding-window rate limiter (P-05).
 *
 * Previously an in-memory Map, which meant a container restart reset every
 * client's budget — letting a crash-loop attacker bypass the 5/min auth cap
 * by churning restarts. Now backed by the RateLimitBucket table so the
 * budget survives across process restarts and multi-worker deployments.
 *
 * Bucketing: windowStart is unix seconds quantized to config.windowSeconds.
 * A single atomic upsert-with-increment (SQLite's ON CONFLICT DO UPDATE)
 * avoids the read-then-write race that plagued the in-memory version.
 *
 * Sweep: old buckets are deleted on a 5-minute interval. Skipped under
 * NODE_ENV=test so vitest doesn't hold open handles.
 */
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";

export interface RateLimitConfig {
  /** Max requests per window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch ms at which this window ends (caller can expose via Retry-After) */
  resetAt: number;
}

/**
 * Check rate limit for a given key (usually IP address).
 * Atomic per-bucket increment; returns whether the request is allowed and
 * how much of the budget remains after this call.
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSec / config.windowSeconds) * config.windowSeconds;
  const resetAt = (windowStart + config.windowSeconds) * 1000;

  // Atomic INSERT … ON CONFLICT DO UPDATE so two concurrent requests can't
  // both race past the read.
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO RateLimitBucket (key, windowStart, count)
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT(key, windowStart) DO UPDATE SET count = count + 1
    RETURNING count
  `;

  const count = rows[0]?.count ?? 1;

  if (count > config.limit) {
    return { allowed: false, remaining: 0, resetAt };
  }
  return {
    allowed: true,
    remaining: Math.max(0, config.limit - count),
    resetAt,
  };
}

/**
 * Pre-configured rate limit configs for different route types.
 */
export const RATE_LIMITS = {
  /** Search routes — 30 requests per minute */
  search: { limit: 30, windowSeconds: 60 } as RateLimitConfig,
  /** Request creation — 10 requests per minute */
  request: { limit: 10, windowSeconds: 60 } as RateLimitConfig,
  /** Auth routes — 5 attempts per minute */
  auth: { limit: 5, windowSeconds: 60 } as RateLimitConfig,
  /** General API — 60 requests per minute */
  general: { limit: 60, windowSeconds: 60 } as RateLimitConfig,
} as const;

/**
 * Extract client IP from request headers (works behind proxies).
 */
export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

// ── Background sweep ────────────────────────────────────────────────────
//
// Delete buckets older than 1 hour (any reasonable window is well under this).
// Skip under test so vitest doesn't hold the interval handle open.
if (process.env.NODE_ENV !== "test") {
  const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
  const STALE_CUTOFF_S = 60 * 60; // 1 hour

  setInterval(async () => {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - STALE_CUTOFF_S;
      const { count } = await prisma.rateLimitBucket.deleteMany({
        where: { windowStart: { lt: cutoff } },
      });
      if (count > 0) {
        log.debug("rate-limit sweep removed stale buckets", { count });
      }
    } catch (err) {
      log.warn("rate-limit sweep failed", { err });
    }
  }, SWEEP_INTERVAL_MS);
}
