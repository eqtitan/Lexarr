/**
 * Rate-limit tests — DB-backed version (P-05).
 *
 * Exercises the real `checkRateLimit` against a throwaway SQLite DB (same
 * pattern as crypto.test.ts). Durability across process restart is also
 * verified by instantiating a fresh PrismaClient after the first few calls.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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

describe("getClientIp", () => {
  it("extracts IP from x-forwarded-for header", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.50, 70.41.3.18" });
    expect(getClientIp(headers)).toBe("203.0.113.50");
  });

  it("extracts IP from x-real-ip header", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.23" });
    expect(getClientIp(headers)).toBe("198.51.100.23");
  });

  it('returns "unknown" when no IP headers are present', () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe("unknown");
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
