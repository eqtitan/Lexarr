/**
 * Real SQLite for tests -- import this FIRST in a test file:
 *
 *   import { useTestDb, testPrisma } from "./helpers/test-db";
 *   useTestDb();
 *
 * At import it copies the run's migrated template DB (see
 * db-template.global.ts) to a private file and points DATABASE_URL at it,
 * so the app's own prisma client (`@/lib/db`) talks to that file.
 * useTestDb() empties every table before each test and removes the file
 * afterwards.
 *
 * Prefer this over mocking `@/lib/db`: a hand-written Prisma fake only
 * proves the code matches the fake, while this exercises the real queries,
 * constraints (unique indexes, the partial dedupe index, foreign keys) and
 * transactions.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, inject } from "vitest";

const file = path
  .join(os.tmpdir(), `lexarr-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`)
  .replace(/\\/g, "/");
fs.copyFileSync(inject("dbTemplate"), file);
process.env.DATABASE_URL = `file:${file}`;

// Children before parents, so foreign keys never block the wipe.
const TABLES = [
  "PipelineEvent",
  "AuditLog",
  "Request",
  "RateLimitBucket",
  "NotificationChannel",
  "AppSetting",
  "User",
];

/** The app's own prisma client, connected to this file's test DB. */
export async function testPrisma() {
  return (await import("@/lib/db")).prisma;
}

export function useTestDb(): void {
  beforeEach(async () => {
    const prisma = await testPrisma();
    for (const table of TABLES) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
    }
  });

  afterAll(async () => {
    await (await testPrisma()).$disconnect();
    for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
      fs.rmSync(f, { force: true });
    }
  });
}
