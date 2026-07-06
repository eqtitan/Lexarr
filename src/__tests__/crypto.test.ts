/**
 * P-06: crypto + ServiceConnection round-trip.
 *
 * Covers:
 *   1. encrypt("secret") → persist → read back → decrypt → original plaintext
 *   2. tampered ciphertext → decrypt throws (GCM auth tag)
 *   3. raw sqlite dump does NOT contain the plaintext secret
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

// Set the data key BEFORE importing @/lib/crypto. `resolveKey()` reads
// process.env at call time, but it's cheap insurance against any future
// module-load-time caching.
process.env.LEXARR_DATA_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Spin up a throwaway sqlite database for the whole suite. We do NOT want
// to touch the dev lexarr.db — this test should be idempotent and
// parallel-safe with the rest of the suite.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lexarr-crypto-test-"));
const dbPath = path.join(tmpDir, "test.db");
process.env.DATABASE_URL = `file:${dbPath}`;

let prisma: PrismaClient;
// Import crypto lazily so it picks up the env vars set above.
let encrypt: (plaintext: string) => string;
let decrypt: (packed: string) => string;

// `beforeAll` runs `prisma db push` which can exceed vitest's default 10s
// hook timeout on a cold Prisma CLI start (especially on Windows). Bump
// to 60s — the actual push is ~2-5s when warm, but the first-run cost
// after a Prisma generate can be higher.
beforeAll(async () => {
  // Apply the current Prisma schema to the throwaway DB. `db push` is the
  // right tool here — we don't need migration history in a test scratch DB,
  // and it avoids needing the full migrations/ folder to be replayable.
  execSync(`npx prisma db push --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    cwd: path.resolve(__dirname, "../.."),
    stdio: "pipe",
  });

  prisma = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
  });
  await prisma.$connect();

  const mod = await import("@/lib/crypto");
  encrypt = mod.encrypt;
  decrypt = mod.decrypt;
}, 60_000); // `prisma db push` cold start can exceed the 10s default on Windows

afterAll(async () => {
  await prisma?.$disconnect();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* swallow — temp dir cleanup is best-effort */
  }
});

beforeEach(async () => {
  // Clean slate per test so (category, kind, name) unique constraint doesn't bite.
  await prisma.serviceConnection.deleteMany({});
});

describe("crypto + ServiceConnection round-trip (P-06)", () => {
  it("encrypts, persists, reads back, and decrypts to the original plaintext", async () => {
    const secret = "super-secret-radarr-api-key-42";

    const row = await prisma.serviceConnection.create({
      data: {
        category: "arr",
        kind: "radarr",
        name: "primary",
        baseUrl: "http://localhost:7878",
        encryptedSecret: encrypt(secret),
        config: JSON.stringify({ qualityProfileId: 4 }),
        enabled: true,
      },
    });

    const found = await prisma.serviceConnection.findUniqueOrThrow({
      where: { id: row.id },
    });

    expect(found.encryptedSecret).not.toBe(secret);
    expect(decrypt(found.encryptedSecret)).toBe(secret);
  });

  it("throws when ciphertext is tampered with (GCM auth tag)", async () => {
    const packed = encrypt("don't-tamper-with-me");
    const buf = Buffer.from(packed, "base64");
    // Flip one byte inside the ciphertext segment (past iv(12) + tag(16)).
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString("base64");

    expect(() => decrypt(tampered)).toThrow();
  });

  it("does not leak plaintext into the sqlite file", async () => {
    const secret = "plaintext-canary-9e5f1b7c";

    await prisma.serviceConnection.create({
      data: {
        category: "download",
        kind: "qbittorrent",
        name: "primary",
        baseUrl: "http://localhost:8080",
        encryptedSecret: encrypt(secret),
        config: JSON.stringify({}),
        enabled: true,
      },
    });

    // Force a checkpoint so the secret (if leaked) would be in the main DB
    // file rather than still sitting in the WAL. PRAGMA returns rows, so use
    // $queryRawUnsafe — $executeRawUnsafe rejects result-producing SQL on sqlite.
    await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(FULL);");

    // Scan every byte of the on-disk database for the canary string.
    const dbBytes = fs.readFileSync(dbPath);
    expect(dbBytes.includes(Buffer.from(secret, "utf8"))).toBe(false);

    // And a second check via a raw query — whatever Prisma reads back must
    // be the ciphertext, not the plaintext.
    const rawRows = await prisma.$queryRawUnsafe<
      Array<{ encryptedSecret: string }>
    >(`SELECT "encryptedSecret" FROM "ServiceConnection";`);
    for (const r of rawRows) {
      expect(r.encryptedSecret).not.toContain(secret);
    }
  });
});
