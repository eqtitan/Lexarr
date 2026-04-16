import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RateLimitConfig } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  const config: RateLimitConfig = { limit: 3, windowSeconds: 60 };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first request in a window", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const result = checkRateLimit("test:1", config);
    expect(result.allowed).toBe(true);
  });

  it("decrements remaining count on each request", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const r1 = checkRateLimit("test:2", config);
    const r2 = checkRateLimit("test:2", config);
    expect(r1.remaining).toBe(2);
    expect(r2.remaining).toBe(1);
  });

  it("blocks requests after limit is exceeded", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    checkRateLimit("test:3", config);
    checkRateLimit("test:3", config);
    checkRateLimit("test:3", config);
    const blocked = checkRateLimit("test:3", config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets after the window expires", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    checkRateLimit("test:4", config);
    checkRateLimit("test:4", config);
    checkRateLimit("test:4", config);

    // Advance past the 60-second window
    vi.advanceTimersByTime(61_000);

    const fresh = checkRateLimit("test:4", config);
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(2);
  });

  it("tracks different keys independently", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    checkRateLimit("search:10.0.0.1", config);
    checkRateLimit("search:10.0.0.1", config);
    checkRateLimit("search:10.0.0.1", config);

    const blockedKey = checkRateLimit("search:10.0.0.1", config);
    const freshKey = checkRateLimit("search:10.0.0.2", config);
    expect(blockedKey.allowed).toBe(false);
    expect(freshKey.allowed).toBe(true);
    expect(freshKey.remaining).toBe(2);
  });
});

describe("getClientIp", () => {
  it("extracts IP from x-forwarded-for header", async () => {
    const { getClientIp } = await import("@/lib/rate-limit");
    const headers = new Headers({ "x-forwarded-for": "203.0.113.50, 70.41.3.18" });
    expect(getClientIp(headers)).toBe("203.0.113.50");
  });

  it("extracts IP from x-real-ip header", async () => {
    const { getClientIp } = await import("@/lib/rate-limit");
    const headers = new Headers({ "x-real-ip": "198.51.100.23" });
    expect(getClientIp(headers)).toBe("198.51.100.23");
  });

  it('returns "unknown" when no IP headers are present', async () => {
    const { getClientIp } = await import("@/lib/rate-limit");
    const headers = new Headers();
    expect(getClientIp(headers)).toBe("unknown");
  });
});

describe("RATE_LIMITS presets", () => {
  it("defines correct limits for each route type", async () => {
    const { RATE_LIMITS } = await import("@/lib/rate-limit");
    expect(RATE_LIMITS.search).toEqual({ limit: 30, windowSeconds: 60 });
    expect(RATE_LIMITS.request).toEqual({ limit: 10, windowSeconds: 60 });
    expect(RATE_LIMITS.auth).toEqual({ limit: 5, windowSeconds: 60 });
    expect(RATE_LIMITS.general).toEqual({ limit: 60, windowSeconds: 60 });
  });
});
