/**
 * Per-account login lockout against a throwaway SQLite DB (same pattern as
 * rate-limit.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lexarr-lockout-test-"));
const dbPath = path.join(tmpDir, "lockout.db").replace(/\\/g, "/");
process.env.DATABASE_URL = `file:${dbPath}`;

let prisma: PrismaClient;
let lockout: typeof import("@/lib/login-lockout");

beforeAll(async () => {
  execSync(`npx prisma db push --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    cwd: path.resolve(__dirname, "../.."),
    stdio: "pipe",
  });
  prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  await prisma.$connect();
  lockout = await import("@/lib/login-lockout");
});

afterAll(async () => {
  await prisma.$disconnect();
  await (await import("@/lib/db")).prisma.$disconnect();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows can hold the SQLite file briefly after disconnect; it's a temp dir.
  }
});

beforeEach(async () => {
  await prisma.rateLimitBucket.deleteMany();
});

const fail = async (name: string, times: number, now?: number) => {
  for (let i = 0; i < times; i++) await lockout.recordFailure(name, now);
};

describe("login lockout", () => {
  it("locks an account after MAX_FAILURES wrong passwords, whoever sends them", async () => {
    await fail("alice", lockout.MAX_FAILURES - 1);
    expect(await lockout.isLockedOut("alice")).toBe(false);
    await fail("alice", 1);
    expect(await lockout.isLockedOut("alice")).toBe(true);
  });

  it("treats usernames case-insensitively and keeps accounts separate", async () => {
    await fail("Alice", lockout.MAX_FAILURES);
    expect(await lockout.isLockedOut(" alice ")).toBe(true);
    expect(await lockout.isLockedOut("bob")).toBe(false);
  });

  it("counts failures across a window boundary, then lets them age out", async () => {
    const w = lockout.WINDOW_SECONDS * 1000;
    const t0 = Math.floor(Date.now() / w) * w + w - 1000; // just before a boundary
    await fail("carol", lockout.MAX_FAILURES / 2, t0);
    await fail("carol", lockout.MAX_FAILURES / 2, t0 + 2000); // next window
    expect(await lockout.isLockedOut("carol", t0 + 2000)).toBe(true);
    expect(await lockout.isLockedOut("carol", t0 + 2 * w + 2000)).toBe(false);
  });

  it("clears the count after a successful login", async () => {
    await fail("dave", lockout.MAX_FAILURES);
    await lockout.clearFailures("dave");
    expect(await lockout.isLockedOut("dave")).toBe(false);
  });
});
