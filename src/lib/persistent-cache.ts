/**
 * A small database-backed cache for lookups that are slow to rebuild.
 *
 * The in-memory caches in cache.ts empty on every restart. That's fine
 * for most things, but matching the Apple album chart to MusicBrainz runs
 * at one request a second (about 30 seconds for a cold chart), so every
 * deploy left the music Discover tab slow until it refilled. Entries here
 * survive restarts.
 *
 * Best effort: a database error is logged and treated as a miss, never
 * thrown, so a cache problem can't break the page that uses it. Expired
 * rows are ignored on read and swept now and then on write.
 *
 * Off under NODE_ENV=test unless a test turns it on, so tests that only
 * care about the in-memory behaviour don't share rows through the
 * database.
 */
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";

let enabled = process.env.NODE_ENV !== "test";
let writesSinceSweep = 0;
const SWEEP_EVERY = 50;

/** The cached value, or undefined on a miss, an expired row or an error. */
export async function getPersistent<T>(key: string, now = new Date()): Promise<T | undefined> {
  if (!enabled) return undefined;
  try {
    const row = await prisma.cacheEntry.findUnique({ where: { key } });
    if (!row || row.expiresAt <= now) return undefined;
    return JSON.parse(row.value) as T;
  } catch (err: unknown) {
    log.debug("persistent-cache: read failed", { key, err });
    return undefined;
  }
}

export async function setPersistent(key: string, value: unknown, ttlMs: number, now = new Date()): Promise<void> {
  if (!enabled) return;
  try {
    const expiresAt = new Date(now.getTime() + ttlMs);
    const json = JSON.stringify(value ?? null);
    await prisma.cacheEntry.upsert({
      where: { key },
      create: { key, value: json, expiresAt },
      update: { value: json, expiresAt },
    });
    if (++writesSinceSweep >= SWEEP_EVERY) {
      writesSinceSweep = 0;
      await prisma.cacheEntry.deleteMany({ where: { expiresAt: { lte: now } } });
    }
  } catch (err: unknown) {
    log.debug("persistent-cache: write failed", { key, err });
  }
}

/** Remove every entry whose key starts with `prefix`. */
export async function clearPersistent(prefix: string): Promise<void> {
  if (!enabled) return;
  try {
    await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: prefix } } });
  } catch (err: unknown) {
    log.debug("persistent-cache: clear failed", { prefix, err });
  }
}

export const __testing = {
  setEnabled(on: boolean) {
    enabled = on;
  },
};
