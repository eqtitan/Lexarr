/**
 * /api/admin/users and /api/auth/register against a real SQLite DB.
 * Replaces the mocked-Prisma admin-users and auth (register) suites: these
 * exercise the real unique constraints, transactions, audit rows and
 * bcrypt hashes instead of a hand-written fake.
 */
import { useTestDb, testPrisma } from "../helpers/test-db";
import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";

useTestDb();

let session: unknown = null;
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(async () => session) }));
// Register is rate-limited 5/min per client; tests register many users.
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 4, resetAt: Date.now() })),
  getClientIp: vi.fn(() => "test"),
  RATE_LIMITS: { auth: { limit: 5, windowSeconds: 60 } },
}));

function req(body?: unknown): NextRequest {
  return {
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => (body === "BAD" ? Promise.reject(new Error("bad json")) : Promise.resolve(body ?? {})),
  } as unknown as NextRequest;
}

async function seedUser(name: string, role = "user", password?: string) {
  const prisma = await testPrisma();
  return prisma.user.create({
    data: { name, role, password: password ? await bcrypt.hash(password, 4) : null },
  });
}

let adminId: string;
beforeEach(async () => {
  adminId = (await seedUser("admin", "admin")).id;
  session = { user: { id: adminId, name: "admin", role: "admin" } };
});

const routes = () => import("@/app/api/admin/users/route");

describe("GET/POST /api/admin/users", () => {
  it("is admin-only", async () => {
    session = { user: { id: "x", role: "user" } };
    const { GET, POST } = await routes();
    expect((await GET()).status).toBe(403);
    expect((await POST(req({ name: "bob", password: "password1" }))).status).toBe(403);
  });

  it("lists users", async () => {
    await seedUser("alice");
    const { GET } = await routes();
    const { users } = await (await GET()).json();
    expect(users.map((u: { name: string }) => u.name).sort()).toEqual(["admin", "alice"]);
  });

  it.each([
    ["BAD", "Invalid JSON body"],
    [{ name: "a", password: "password1" }, "Name must be 2-50 characters"],
    [{ name: "bob", password: "short" }, "Password must be at least 8 characters"],
    [{ name: "bob", password: "password1", role: "superuser" }, "Role must be 'admin' or 'user'"],
  ])("rejects invalid input %#", async (body, error) => {
    const { POST } = await routes();
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
  });

  it("refuses a duplicate name (409)", async () => {
    await seedUser("bob");
    const { POST } = await routes();
    expect((await POST(req({ name: "bob", password: "password1" }))).status).toBe(409);
  });

  it("creates the user with a verifiable password hash and writes an audit row", async () => {
    const { POST } = await routes();
    const res = await POST(req({ name: "bob", password: "password1" }));
    expect(res.status).toBe(201);
    const prisma = await testPrisma();
    const bob = await prisma.user.findUniqueOrThrow({ where: { name: "bob" } });
    expect(bob.role).toBe("user");
    expect(await bcrypt.compare("password1", bob.password!)).toBe(true);
    await vi.waitFor(async () =>
      expect(await prisma.auditLog.count({ where: { action: "create_user", targetId: bob.id } })).toBe(1),
    );
  });
});

describe("PATCH /api/admin/users", () => {
  it("validates input", async () => {
    const { PATCH } = await routes();
    expect((await PATCH(req({ role: "admin" }))).status).toBe(400);
    expect((await PATCH(req({ userId: adminId, role: "root" }))).status).toBe(400);
    expect((await PATCH(req({ userId: adminId, password: "short" }))).status).toBe(400);
    expect((await PATCH(req({ userId: "nope", role: "admin" }))).status).toBe(404);
  });

  it("refuses to demote the last admin, allows it with another admin", async () => {
    const { PATCH } = await routes();
    expect((await PATCH(req({ userId: adminId, role: "user" }))).status).toBe(409);
    await seedUser("admin2", "admin");
    expect((await PATCH(req({ userId: adminId, role: "user" }))).status).toBe(200);
  });

  it("bumps sessionVersion on a password reset or role change, not on other edits", async () => {
    const alice = await seedUser("alice", "user", "oldpassword");
    const prisma = await testPrisma();
    const version = async () => (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).sessionVersion;
    const { PATCH } = await routes();

    await PATCH(req({ userId: alice.id, autoApprove: true }));
    expect(await version()).toBe(0);
    await PATCH(req({ userId: alice.id, password: "newpassword1" }));
    expect(await version()).toBe(1);
    await PATCH(req({ userId: alice.id, role: "admin" }));
    expect(await version()).toBe(2);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: alice.id } });
    expect(await bcrypt.compare("newpassword1", updated.password!)).toBe(true);
  });
});

describe("DELETE /api/admin/users", () => {
  it("validates and refuses self-delete", async () => {
    const { DELETE } = await routes();
    expect((await DELETE(req({}))).status).toBe(400);
    expect((await DELETE(req({ userId: adminId }))).status).toBe(400);
    expect((await DELETE(req({ userId: "nope" }))).status).toBe(404);
  });

  it("deletes the user and their requests, keeping their audit entries anonymized", async () => {
    const prisma = await testPrisma();
    const alice = await seedUser("alice");
    await prisma.request.create({
      data: { userId: alice.id, mediaType: "movie", externalId: "1", title: "X", status: "pending" },
    });
    await prisma.auditLog.create({ data: { userId: alice.id, action: "login" } });

    const { DELETE } = await routes();
    expect((await DELETE(req({ userId: alice.id }))).status).toBe(200);
    expect(await prisma.user.count({ where: { id: alice.id } })).toBe(0);
    expect(await prisma.request.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "login", userId: null } })).toBe(1);
  });
});

describe("POST /api/auth/register", () => {
  const register = async (body: unknown) => (await import("@/app/api/auth/register/route")).POST(req(body));

  beforeEach(async () => {
    // Registration tests start from an empty DB (no admin yet).
    await (await testPrisma()).user.deleteMany({});
    delete process.env.REGISTRATION_OPEN;
  });

  it.each([
    [{ password: "password1" }, 400],
    [{ name: "bob" }, 400],
    [{ name: "b", password: "password1" }, 400],
    [{ name: "bob", password: "short" }, 400],
    [{ name: "bob", password: "password1", email: "not-an-email" }, 400],
    ["BAD", 400],
  ])("rejects invalid input %#", async (body, status) => {
    expect((await register(body)).status).toBe(status);
  });

  it("returns 429 when rate limited", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() });
    expect((await register({ name: "bob", password: "password1" })).status).toBe(429);
  });

  it("makes the first user an auto-approving admin, later users regular users", async () => {
    const first = await (await register({ name: "first", password: "password1" })).json();
    expect(first.user.role).toBe("admin");
    process.env.REGISTRATION_OPEN = "true";
    const second = await (await register({ name: "second", password: "password1" })).json();
    expect(second.user.role).toBe("user");
    const prisma = await testPrisma();
    expect((await prisma.user.findUniqueOrThrow({ where: { name: "first" } })).autoApprove).toBe(true);
  });

  it("is closed once an admin exists unless REGISTRATION_OPEN=true", async () => {
    await register({ name: "first", password: "password1" });
    expect((await register({ name: "second", password: "password1" })).status).toBe(403);
    process.env.REGISTRATION_OPEN = "true";
    expect((await register({ name: "second", password: "password1" })).status).toBe(200);
  });

  it("refuses a taken username or email (409)", async () => {
    process.env.REGISTRATION_OPEN = "true";
    await register({ name: "bob", password: "password1", email: "bob@example.com" });
    expect((await register({ name: "bob", password: "password1" })).status).toBe(409);
    expect((await register({ name: "rob", password: "password1", email: "bob@example.com" })).status).toBe(409);
  });

  it("two simultaneous registrations of one name: one succeeds, the other gets 409 (not 500)", async () => {
    // Both can pass the friendly pre-check; the unique constraint (P2002)
    // decides, and it must surface as a 409.
    process.env.REGISTRATION_OPEN = "true";
    const statuses = (
      await Promise.all([
        register({ name: "same", password: "password1" }),
        register({ name: "same", password: "password1" }),
      ])
    ).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 409]);
  });

  it("two simultaneous first registrations create exactly one admin", async () => {
    process.env.REGISTRATION_OPEN = "true";
    await Promise.all([
      register({ name: "racer1", password: "password1" }),
      register({ name: "racer2", password: "password1" }),
    ]);
    expect(await (await testPrisma()).user.count({ where: { role: "admin" } })).toBe(1);
  });
});
