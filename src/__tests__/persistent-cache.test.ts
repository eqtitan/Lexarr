/**
 * Database-backed cache against a throwaway SQLite DB (same pattern as
 * login-lockout.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lexarr-pcache-test-"));
const dbPath = path.join(tmpDir, "pcache.db").replace(/\\/g, "/");
process.env.DATABASE_URL = `file:${dbPath}`;

let prisma: PrismaClient;
let cache: typeof import("@/lib/persistent-cache");

beforeAll(async () => {
  execSync(`npx prisma db push --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    cwd: path.resolve(__dirname, "../.."),
    stdio: "pipe",
  });
  prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  await prisma.$connect();
  cache = await import("@/lib/persistent-cache");
  cache.__testing.setEnabled(true);
});

afterAll(async () => {
  cache.__testing.setEnabled(false);
  await prisma.$disconnect();
  await (await import("@/lib/db")).prisma.$disconnect();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows can hold the SQLite file briefly after disconnect; it's a temp dir.
  }
});

beforeEach(async () => {
  await prisma.cacheEntry.deleteMany();
});

const HOUR = 60 * 60 * 1000;

describe("persistent cache", () => {
  it("round-trips objects and remembers a null (no match) as a hit", async () => {
    await cache.setPersistent("mb:album:a|b", { id: "rg-1", title: "B" }, HOUR);
    await cache.setPersistent("mb:album:c|d", null, HOUR);
    expect(await cache.getPersistent("mb:album:a|b")).toEqual({ id: "rg-1", title: "B" });
    expect(await cache.getPersistent("mb:album:c|d")).toBeNull();
    expect(await cache.getPersistent("mb:album:missing")).toBeUndefined();
  });

  it("ignores expired rows", async () => {
    const then = new Date("2026-11-01T00:00:00Z");
    await cache.setPersistent("k", "v", HOUR, then);
    expect(await cache.getPersistent("k", new Date(then.getTime() + HOUR / 2))).toBe("v");
    expect(await cache.getPersistent("k", new Date(then.getTime() + 2 * HOUR))).toBeUndefined();
  });

  it("overwrites an existing key", async () => {
    await cache.setPersistent("k", 1, HOUR);
    await cache.setPersistent("k", 2, HOUR);
    expect(await cache.getPersistent("k")).toBe(2);
    expect(await prisma.cacheEntry.count()).toBe(1);
  });

  it("clears by prefix only", async () => {
    await cache.setPersistent("mb:album:x", 1, HOUR);
    await cache.setPersistent("other:y", 2, HOUR);
    await cache.clearPersistent("mb:");
    expect(await cache.getPersistent("mb:album:x")).toBeUndefined();
    expect(await cache.getPersistent("other:y")).toBe(2);
  });

  it("does nothing when disabled", async () => {
    cache.__testing.setEnabled(false);
    await cache.setPersistent("k", 1, HOUR);
    cache.__testing.setEnabled(true);
    expect(await cache.getPersistent("k")).toBeUndefined();
  });
});
