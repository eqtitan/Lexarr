/**
 * Bootstrap admin: creates an admin only when none exists, and resets an
 * existing admin's password only on explicit request (BOOTSTRAP_ADMIN_RESET).
 * Real migrated SQLite DB (helpers/test-db.ts).
 */
import { useTestDb, testPrisma } from "./helpers/test-db";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

useTestDb();

const envVals: Record<string, string | undefined> = {};
vi.mock("@/lib/env", () => ({ env: () => envVals }));
const warn = vi.fn();
vi.mock("@/lib/log", () => ({ log: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn() } }));

let prisma: PrismaClient;
let ensureBootstrapAdmin: typeof import("@/lib/bootstrap-admin").ensureBootstrapAdmin;

beforeAll(async () => {
  prisma = await testPrisma();
  ({ ensureBootstrapAdmin } = await import("@/lib/bootstrap-admin"));
});

beforeEach(async () => {
  vi.clearAllMocks();
  for (const k of Object.keys(envVals)) delete envVals[k];
  await prisma.user.deleteMany({ where: { name: { startsWith: "boot-" } } });
});

const adminWith = (name: string, pw: string) =>
  bcrypt.hash(pw, 4).then((password) => prisma.user.create({ data: { name, role: "admin", password } }));

describe("ensureBootstrapAdmin", () => {
  it("keeps a password the admin changed, even with the bootstrap password still set", async () => {
    const admin = await adminWith("boot-a", "changed-in-ui");
    Object.assign(envVals, { BOOTSTRAP_ADMIN_USERNAME: "boot-a", BOOTSTRAP_ADMIN_PASSWORD: "old-env-pass" });
    await ensureBootstrapAdmin(prisma);
    const row = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(await bcrypt.compare("changed-in-ui", row!.password!)).toBe(true);
    expect(await bcrypt.compare("old-env-pass", row!.password!)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/still set .* remove it/));
  });

  it("resets the password only with BOOTSTRAP_ADMIN_RESET=true", async () => {
    const admin = await adminWith("boot-b", "forgotten");
    Object.assign(envVals, {
      BOOTSTRAP_ADMIN_USERNAME: "boot-b",
      BOOTSTRAP_ADMIN_PASSWORD: "rescue-pass",
      BOOTSTRAP_ADMIN_RESET: "true",
    });
    await ensureBootstrapAdmin(prisma);
    const row = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(await bcrypt.compare("rescue-pass", row!.password!)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/remove BOOTSTRAP_ADMIN_RESET/), { username: "boot-b" });
  });

  it("is silent when an admin exists and no bootstrap password is set", async () => {
    await adminWith("boot-c", "x");
    await ensureBootstrapAdmin(prisma);
    expect(warn).not.toHaveBeenCalled();
  });

  it("still creates the admin when none exists", async () => {
    await prisma.user.updateMany({ where: { role: "admin" }, data: { role: "user" } });
    Object.assign(envVals, { BOOTSTRAP_ADMIN_USERNAME: "boot-d", BOOTSTRAP_ADMIN_PASSWORD: "first-pass" });
    await ensureBootstrapAdmin(prisma);
    const row = await prisma.user.findFirst({ where: { name: "boot-d", role: "admin" } });
    expect(row && (await bcrypt.compare("first-pass", row.password!))).toBe(true);
  });
});
