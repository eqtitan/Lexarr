import { PrismaClient } from "@prisma/client";
import { env } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// P-09: log Prisma's own errors + warnings so DB-level issues (constraint
// violations, connection problems, migration drift) land in stderr instead
// of going silently to the void. Queries/info are left off — they're noisy
// and the app-level structured logger in src/lib/log.ts covers what's
// actionable. In dev/test, enable `query` if you're debugging.
const prismaLog =
  process.env.NODE_ENV === "production" ? ["error", "warn"] : ["error", "warn"];

/** Seconds a write waits for SQLite's lock before failing. */
export const SQLITE_LOCK_WAIT_SECONDS = 15;

/**
 * Give SQLite writes room to wait for the lock. Prisma 5's default is about
 * 5s: when the poller, a webhook and an admin retry write at the same moment,
 * the loser failed with "Operations timed out after `N/A`" (four requests
 * failed this way in production, 2026-04 to 2026-07). Reproduced locally:
 * a write blocked for 7s fails at ~5.6s by default and succeeds with
 * `socket_timeout=15`. A URL that already sets socket_timeout, and any
 * non-file URL, is left alone.
 */
export function withSqliteLockWait(url: string | undefined): string | undefined {
  if (!url || !url.startsWith("file:") || /[?&]socket_timeout=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}socket_timeout=${SQLITE_LOCK_WAIT_SECONDS}`;
}

const databaseUrl = withSqliteLockWait(env().DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: prismaLog as ("error" | "warn" | "info" | "query")[],
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
