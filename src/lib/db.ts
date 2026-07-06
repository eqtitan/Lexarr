import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// P-09: log Prisma's own errors + warnings so DB-level issues (constraint
// violations, connection problems, migration drift) land in stderr instead
// of going silently to the void. Queries/info are left off — they're noisy
// and the app-level structured logger in src/lib/log.ts covers what's
// actionable. In dev/test, enable `query` if you're debugging.
const prismaLog =
  process.env.NODE_ENV === "production" ? ["error", "warn"] : ["error", "warn"];

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: prismaLog as ("error" | "warn" | "info" | "query")[],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
