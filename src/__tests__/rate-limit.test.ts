/**
 * Rate-limit tests — DB-backed version (P-05).
 *
 * Exercises the real `checkRateLimit` against a throwaway SQLite DB (same
 * pattern as crypto.test.ts). Durability across process restart is also
 * verified by instantiating a fresh PrismaClient after the first few calls.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway DB setup
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lexarr-ratelimit-test-"));
const dbPath = path.join(tmpDir, "rl.db").replace(/\\/g, "/");
process.env.DATABASE_URL = `file:${dbPath}`;

let prisma: PrismaClient;

// Lazy-import the module under test so it picks up DATABASE_URL set above.
let checkRateLimit: typeof import("@/lib/rate-limit").checkRateLimit;
let getClientIp: typeof import("@/lib/rate-limit").getClientIp;
let RATE_LIMITS: typeof import("@/lib/rate-limit").RATE_LIMITS;
type RateLimitConfig = import("@/lib/rate-limit").RateLimitConfig;

beforeAll(async () => {
  execSync(`npx prisma db push --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    cwd: path.resolve(__dirname, "../.."),
    stdio: "pipe",
  });

  prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  await prisma.$connect();

  const mod = await import("@/lib/rate-limit");
  checkRateLimit = mod.checkRateLimit;
  getClientIp = mod.getClientIp;
  RATE_LIMITS = mod.RATE_LIMITS;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

beforeEach(async () => {
  // Clean slate per test
  await prisma.rateLimitBucket.deleteMany({});
});

describe("checkRateLimit (DB-backed)", () => {
  const config: RateLimitConfig = { limit: 3, windowSeconds: 60 };

  it("allows the first request in a window", async () => {
    const result = await checkRateLimit("test:1", config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("decrements remaining count on each request", async () => {
    const r1 = await checkRateLimit("test:2", config);
    const r2 = await checkRateLimit("test:2", config);
    expect(r1.remaining).toBe(2);
    expect(r2.remaining).toBe(1);
  });

  it("blocks requests after limit is exceeded", async () => {
    await checkRateLimit("test:3", config);
    await checkRateLimit("test:3", config);
    await checkRateLimit("test:3", config);
    const blocked = await checkRateLimit("test:3", config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("tracks different keys independently", async () => {
    await checkRateLimit("search:10.0.0.1", config);
    await checkRateLimit("search:10.0.0.1", config);
    await checkRateLimit("search:10.0.0.1", config);
    const blocked = await checkRateLimit("search:10.0.0.1", config);
    const fresh = await checkRateLimit("search:10.0.0.2", config);
    expect(blocked.allowed).toBe(false);
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(2);
  });

  it("survives a simulated process restart (P-05 durability)", async () => {
    // Burn 3 requests from the budget
    await checkRateLimit("restart:1", config);
    await checkRateLimit("restart:1", config);
    await checkRateLimit("restart:1", config);

    // Simulate restart: a fresh Prisma client (new connection) reading the
    // same DB should see the persisted count. The module's `prisma` import
    // is the singleton; we verify the DB has the row.
    const fresh = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
    try {
      const row = await fresh.rateLimitBucket.findFirst({ where: { key: "restart:1" } });
      expect(row).not.toBeNull();
      expect(row!.count).toBe(3);
    } finally {
      await fresh.$disconnect();
    }

    // Next call through the real function should see the persisted count
    // and block (4 > limit=3).
    const blocked = await checkRateLimit("restart:1", config);
    expect(blocked.allowed).toBe(false);
  });
});

describe("per-route ceiling (no trusted proxy)", () => {
  const config: RateLimitConfig = { limit: 2, windowSeconds: 60 };
  // Default multiplier 4 → ceiling of 8 across all clients per route.

  it("caps a client rotating its key (spoofed User-Agent) at the route ceiling", async () => {
    // Regression test: each distinct UA hash used to get a fresh bucket,
    // so rotation bypassed the limiter entirely.
    const results = [];
    for (let i = 0; i < 12; i++) {
      results.push(await checkRateLimit(`auth:ua:rotating${i}`, config));
    }
    expect(results.slice(0, 8).every((r) => r.allowed)).toBe(true);
    expect(results.slice(8).every((r) => !r.allowed)).toBe(true);
  });

  it("keeps separate ceilings per route", async () => {
    for (let i = 0; i < 8; i++) await checkRateLimit(`auth:ua:c${i}`, config);
    expect((await checkRateLimit("auth:ua:next", config)).allowed).toBe(false);
    expect((await checkRateLimit("search:ua:next", config)).allowed).toBe(true);
  });

  it("does not count a request the per-client limit already denied", async () => {
    for (let i = 0; i < 5; i++) await checkRateLimit("auth:ua:same", config);
    // 2 allowed + 3 denied per-client → only 2 counted against the
    // ceiling of 8, so 6 more distinct clients still fit.
    for (let i = 0; i < 6; i++) {
      expect((await checkRateLimit(`auth:ua:other${i}`, config)).allowed).toBe(true);
    }
    expect((await checkRateLimit("auth:ua:one-too-many", config)).allowed).toBe(false);
  });

  it("is skipped when a trusted proxy supplies real IPs", async () => {
    const original = process.env.TRUSTED_PROXY_HOPS;
    process.env.TRUSTED_PROXY_HOPS = "1";
    vi.resetModules();
    const scoped = (await import("@/lib/rate-limit")).checkRateLimit;
    try {
      for (let i = 0; i < 12; i++) {
        expect((await scoped(`auth:10.0.0.${i}`, config)).allowed).toBe(true);
      }
    } finally {
      process.env.TRUSTED_PROXY_HOPS = original;
    }
  });
});

describe("getClientIp", () => {
  // Default: TRUSTED_PROXY_HOPS=0 (no reverse proxy configured). Lexarr is
  // typically exposed directly, so X-Forwarded-For/X-Real-IP are
  // attacker-controlled and must be ignored entirely — otherwise a client
  // can send a different spoofed value per request to get a fresh
  // rate-limit bucket every time, fully defeating the limiter.
  it("ignores x-forwarded-for by default (untrusted, no proxy configured)", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.50, 70.41.3.18" });
    expect(getClientIp(headers)).toBe("unknown");
  });

  it("ignores x-real-ip by default (untrusted, no proxy configured)", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.23" });
    expect(getClientIp(headers)).toBe("unknown");
  });

  it('returns "unknown" when no IP headers are present', () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe("unknown");
  });

  it("two different spoofed X-Forwarded-For values collapse into the same bucket by default", async () => {
    // Regression test for the actual bypass this closed: previously each
    // distinct header value got its own fresh rate-limit bucket.
    const headersA = new Headers({ "x-forwarded-for": "1.1.1.1" });
    const headersB = new Headers({ "x-forwarded-for": "2.2.2.2" });
    expect(getClientIp(headersA)).toBe(getClientIp(headersB));
  });

  // Follow-up: a single shared "unknown" bucket for every direct client
  // made the search limit 30/min for an entire household combined.
  // getClientIp falls back to a hash of User-Agent + Accept-Language so
  // each device/browser gets its own budget instead.
  it("gives two different browsers (different User-Agent) separate buckets", () => {
    const chrome = new Headers({
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
      "accept-language": "en-US,en;q=0.9",
    });
    const safari = new Headers({
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
      "accept-language": "en-US,en;q=0.9",
    });
    const keyA = getClientIp(chrome);
    const keyB = getClientIp(safari);
    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe("unknown");
  });

  it("gives the same browser the same key across requests (stable, not spoofed per-request)", () => {
    const headers = () =>
      new Headers({
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
        "accept-language": "en-US,en;q=0.9",
      });
    expect(getClientIp(headers())).toBe(getClientIp(headers()));
  });

  it("still falls back to \"unknown\" when a client sends neither header at all", () => {
    const headers = new Headers({ "x-forwarded-for": "1.1.1.1" }); // ignored, untrusted
    expect(getClientIp(headers)).toBe("unknown");
  });

  describe("with TRUSTED_PROXY_HOPS configured", () => {
    const originalEnv = process.env.TRUSTED_PROXY_HOPS;
    let scopedGetClientIp: typeof getClientIp;

    beforeEach(async () => {
      process.env.TRUSTED_PROXY_HOPS = "1";
      vi.resetModules();
      const mod = await import("@/lib/rate-limit");
      scopedGetClientIp = mod.getClientIp;
    });

    afterAll(() => {
      process.env.TRUSTED_PROXY_HOPS = originalEnv;
    });

    it("trusts the hop appended by our own proxy (rightmost), not the client-supplied one", () => {
      // "1.1.1.1" is whatever the client claimed; "203.0.113.50" is what
      // our own reverse proxy actually appended.
      const headers = new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.50" });
      expect(scopedGetClientIp(headers)).toBe("203.0.113.50");
    });

    it("falls back to x-real-ip when x-forwarded-for is absent", () => {
      const headers = new Headers({ "x-real-ip": "198.51.100.23" });
      expect(scopedGetClientIp(headers)).toBe("198.51.100.23");
    });
  });
});

describe("RATE_LIMITS presets", () => {
  it("defines correct limits for each route type", () => {
    expect(RATE_LIMITS.search).toEqual({ limit: 30, windowSeconds: 60 });
    expect(RATE_LIMITS.request).toEqual({ limit: 10, windowSeconds: 60 });
    expect(RATE_LIMITS.auth).toEqual({ limit: 5, windowSeconds: 60 });
    expect(RATE_LIMITS.general).toEqual({ limit: 60, windowSeconds: 60 });
  });
});
