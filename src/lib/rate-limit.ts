/**
 * Simple in-memory rate limiter for API routes.
 * Uses a sliding window counter per IP address.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitConfig {
  /** Max requests per window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check rate limit for a given key (usually IP address).
 * Returns whether the request is allowed and remaining quota.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // New window
    store.set(key, {
      count: 1,
      resetAt: now + config.windowSeconds * 1000,
    });
    return {
      allowed: true,
      remaining: config.limit - 1,
      resetAt: now + config.windowSeconds * 1000,
    };
  }

  entry.count++;

  if (entry.count > config.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  return {
    allowed: true,
    remaining: config.limit - entry.count,
    resetAt: entry.resetAt,
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
export function getClientIp(
  headers: Headers,
): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
