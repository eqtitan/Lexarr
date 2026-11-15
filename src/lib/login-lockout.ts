/**
 * Per-account login lockout, on top of the per-client rate limit.
 *
 * The rate limit stops one client guessing fast; this stops guessing one
 * account from many clients. After MAX_FAILURES wrong passwords for the same
 * username within about WINDOW_SECONDS (this window plus the previous one),
 * further attempts for that username are refused until the failures age
 * out. A successful login clears the count.
 *
 * Kept generous (20) because anyone can trigger it for a known username:
 * it only slows a determined guesser down, without making it easy to lock
 * a real user out with a handful of tries.
 *
 * Stored in the RateLimitBucket table (survives restarts; the rate-limit
 * sweep removes buckets older than an hour).
 */
import { prisma } from "@/lib/db";

export const MAX_FAILURES = 20;
export const WINDOW_SECONDS = 15 * 60;

const keyFor = (username: string) => `login-fail:${username.trim().toLowerCase()}`;
const windowStart = (nowSec: number) => Math.floor(nowSec / WINDOW_SECONDS) * WINDOW_SECONDS;

/** Failures counted for this username in the current and previous window. */
async function recentFailures(username: string, now = Date.now()): Promise<number> {
  const current = windowStart(Math.floor(now / 1000));
  const rows = await prisma.rateLimitBucket.findMany({
    where: { key: keyFor(username), windowStart: { in: [current, current - WINDOW_SECONDS] } },
    select: { count: true },
  });
  return rows.reduce((sum, r) => sum + r.count, 0);
}

export async function isLockedOut(username: string, now = Date.now()): Promise<boolean> {
  return (await recentFailures(username, now)) >= MAX_FAILURES;
}

export async function recordFailure(username: string, now = Date.now()): Promise<void> {
  const key = keyFor(username);
  const start = windowStart(Math.floor(now / 1000));
  await prisma.$executeRaw`
    INSERT INTO RateLimitBucket (key, windowStart, count)
    VALUES (${key}, ${start}, 1)
    ON CONFLICT(key, windowStart) DO UPDATE SET count = count + 1
  `;
}

export async function clearFailures(username: string): Promise<void> {
  await prisma.rateLimitBucket.deleteMany({ where: { key: keyFor(username) } });
}
