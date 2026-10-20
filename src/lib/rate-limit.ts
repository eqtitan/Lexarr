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
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
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

  const count = await incrementBucket(key, windowStart);
  if (count > config.limit) {
    return { allowed: false, remaining: 0, resetAt };
  }
  let remaining = config.limit - count;

  // Without a trusted proxy, the per-client key is only a hash of
  // client-chosen headers (see getClientIp), so a script that varies its
  // User-Agent per request gets a fresh per-client bucket every time. Cap
  // the total across all clients per route ("auth", "search", ...) so that
  // rotation can't exceed a fixed ceiling. Trade-off: a flood can exhaust
  // the shared ceiling for everyone until the window resets.
  if (trustedProxyHops() === 0) {
    const route = key.split(":", 1)[0];
    const ceiling = config.limit * ceilingMultiplier();
    const total = await incrementBucket(`${route}:__all__`, windowStart);
    if (total > ceiling) {
      return { allowed: false, remaining: 0, resetAt };
    }
    remaining = Math.min(remaining, ceiling - total);
  }

  return { allowed: true, remaining: Math.max(0, remaining), resetAt };
}

/** Atomically increment a bucket and return its new count. */
async function incrementBucket(key: string, windowStart: number): Promise<number> {
  // Atomic INSERT … ON CONFLICT DO UPDATE so two concurrent requests can't
  // both race past the read.
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO RateLimitBucket (key, windowStart, count)
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT(key, windowStart) DO UPDATE SET count = count + 1
    RETURNING count
  `;
  return rows[0]?.count ?? 1;
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
 * How many reverse-proxy hops to trust when reading X-Forwarded-For.
 *
 * Default 0: Lexarr is typically exposed directly (docker-compose maps
 * the port straight through) with no reverse proxy in front, in which
 * case X-Forwarded-For is attacker-controlled — a client can send a
 * different value on every request to get a fresh rate-limit bucket
 * each time, fully defeating the limiter. With 0 hops trusted, the
 * header is ignored entirely and the fallback below is used instead.
 *
 * If you run Lexarr behind your own reverse proxy that sets/appends
 * X-Forwarded-For with the real client IP, set this to the number of
 * proxies between the client and Lexarr (almost always 1) so the
 * trusted hop — appended by your proxy, not the client — is used.
 */
const trustedProxyHops = () => Number(env().TRUSTED_PROXY_HOPS) || 0;

/**
 * Per-route ceiling across ALL clients, as a multiple of the per-client
 * limit (default 4: e.g. auth 20/min, search 120/min in total). Only
 * applies when TRUSTED_PROXY_HOPS is 0 — see checkRateLimit.
 */
const ceilingMultiplier = () => Number(env().RATE_LIMIT_CEILING_MULTIPLIER) || 4;

/**
 * Extract a client key from request headers (works behind a *trusted*
 * proxy — see trustedProxyHops() / TRUSTED_PROXY_HOPS above).
 *
 * Fallback (no trusted proxy configured): bucket by a hash of
 * User-Agent + Accept-Language instead of a single shared "unknown"
 * key. Neither header is a strong identity signal on its own and both
 * are technically spoofable, but real browsers send a stable value for
 * both on every request, so this still gives each device/browser on a
 * LAN its own budget rather than one shared pool for the whole
 * household -- while an attacker still has to go out of their way to
 * vary them (unlike X-Forwarded-For, which is a single header most
 * HTTP clients let you set directly per request).
 */
export function getClientIp(headers: Headers): string {
  if (trustedProxyHops() > 0) {
    const xff = headers.get("x-forwarded-for");
    if (xff) {
      // The client-supplied end of this list is attacker-controlled;
      // only the rightmost N entries were appended by our own trusted
      // proxy/proxies, so read from that end.
      const ips = xff.split(",").map((s) => s.trim());
      const ip = ips[Math.max(0, ips.length - trustedProxyHops())];
      if (ip) return ip;
    }
    const realIp = headers.get("x-real-ip");
    if (realIp) return realIp;
  }

  const ua = headers.get("user-agent") || "";
  const lang = headers.get("accept-language") || "";
  if (!ua && !lang) return "unknown";
  return (
    "ua:" +
    createHash("sha256").update(`${ua}|${lang}`).digest("hex").slice(0, 16)
  );
}

// ── Background sweep ────────────────────────────────────────────────────
//
// Delete buckets older than 1 hour (any reasonable window is well under this).
// Skip under test so vitest doesn't hold the interval handle open.
if (process.env.NODE_ENV !== "test") {
  const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
  const STALE_CUTOFF_S = 60 * 60; // 1 hour

  const sweep = async () => {
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
  };
  setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
}
