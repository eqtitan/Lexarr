/**
 * Route-level tests for /api/admin/users (M3 coverage push).
 *
 * This route talks to Prisma directly (no service-layer extraction), so
 * we mock @/lib/db's `prisma` export with vi.fn() methods — the route's
 * own auth gating, validation, and audit-logging behavior is what's under
 * test, not Prisma's runtime.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    request: {
      deleteMany: vi.fn(),
    },
    auditLog: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed-password"),
  },
}));

function makeReq(body?: Record<string, unknown>): NextRequest {
  return {
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(body ?? {}),
  } as unknown as NextRequest;
}

const adminSession = {
  user: { id: "admin-1", name: "Admin", role: "admin" },
  expires: "9999",
};
const userSession = {
  user: { id: "user-1", name: "User", role: "user" },
  expires: "9999",
};

describe("GET /api/admin/users", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/admin/users/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the user list for admin", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", name: "Alice" },
    ] as never);

    const { GET } = await import("@/app/api/admin/users/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.users).toHaveLength(1);
  });
});

describe("POST /api/admin/users", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(makeReq({ name: "Bob", password: "password1" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid JSON body", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const req = {
      headers: new Headers(),
      json: () => Promise.reject(new Error("bad json")),
    } as unknown as NextRequest;

    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for a too-short name", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(makeReq({ name: "a", password: "password1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a too-short password", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(makeReq({ name: "Bob", password: "short" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid role", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(
      makeReq({ name: "Bob", password: "password1", role: "superuser" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 when the name already exists", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "existing" } as never);

    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(makeReq({ name: "Bob", password: "password1" }));
    expect(res.status).toBe(409);
  });

  it("creates a user and audit-logs on success", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "new-user",
      name: "Bob",
      role: "user",
    } as never);
    const { logAudit } = await import("@/lib/audit");

    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(makeReq({ name: "Bob", password: "password1" }));
    expect(res.status).toBe(201);
    const json = await (res as Response).json();
    expect(json.user.id).toBe("new-user");
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      "admin-1",
      "create_user",
      expect.objectContaining({ type: "user", id: "new-user" }),
      expect.anything(),
    );
  });
});

describe("PATCH /api/admin/users", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    // PATCH runs read-check-write inside an interactive transaction; run
    // the callback against the same mocked client.
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never,
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "user" } as never);
  });

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { PATCH } = await import("@/app/api/admin/users/route");
    const res = await PATCH(makeReq({ userId: "u1", role: "admin" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when userId is missing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { PATCH } = await import("@/app/api/admin/users/route");
    const res = await PATCH(makeReq({ role: "admin" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid role", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { PATCH } = await import("@/app/api/admin/users/route");
    const res = await PATCH(makeReq({ userId: "u1", role: "superuser" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a too-short password", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { PATCH } = await import("@/app/api/admin/users/route");
    const res = await PATCH(makeReq({ userId: "u1", password: "short" }));
    expect(res.status).toBe(400);
  });

  it("updates role and audit-logs the change set", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: "u1",
      role: "admin",
    } as never);
    const { logAudit } = await import("@/lib/audit");

    const { PATCH } = await import("@/app/api/admin/users/route");
    const res = await PATCH(makeReq({ userId: "u1", role: "admin" }));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.user.role).toBe("admin");
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      "admin-1",
      "update_user",
      expect.objectContaining({ id: "u1" }),
      expect.objectContaining({ changes: ["role"] }),
    );
  });

  it("hashes a new password when provided", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "u1" } as never);
    const bcrypt = (await import("bcryptjs")).default;

    const { PATCH } = await import("@/app/api/admin/users/route");
    const res = await PATCH(makeReq({ userId: "u1", password: "newpassword1" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(bcrypt.hash)).toHaveBeenCalledWith("newpassword1", 10);
  });

  it("returns 404 (not 500) for an unknown user", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const { PATCH } = await import("@/app/api/admin/users/route");
    const res = await PATCH(makeReq({ userId: "missing", role: "admin" }));
    expect(res.status).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses to demote the last admin (409)", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "admin" } as never);
    vi.mocked(prisma.user.count).mockResolvedValue(1);

    const { PATCH } = await import("@/app/api/admin/users/route");
    const res = await PATCH(makeReq({ userId: "admin-1", role: "user" }));
    expect(res.status).toBe(409);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("allows demoting an admin while another admin remains", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "admin" } as never);
    vi.mocked(prisma.user.count).mockResolvedValue(2);
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "u2", role: "user" } as never);

    const { PATCH } = await import("@/app/api/admin/users/route");
    const res = await PATCH(makeReq({ userId: "u2", role: "user" }));
    expect(res.status).toBe(200);
  });

  it.each([
    ["a password reset", { password: "newpassword1" }],
    ["a role change", { role: "admin" }],
  ])("signs the user out everywhere on %s (bumps sessionVersion)", async (_label, change) => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "u1" } as never);

    const { PATCH } = await import("@/app/api/admin/users/route");
    await PATCH(makeReq({ userId: "u1", ...change }));
    expect(vi.mocked(prisma.user.update).mock.calls[0][0].data).toMatchObject({
      sessionVersion: { increment: 1 },
    });
  });

  it("does not sign the user out for other edits (autoApprove, same role)", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "u1" } as never);

    const { PATCH } = await import("@/app/api/admin/users/route");
    await PATCH(makeReq({ userId: "u1", autoApprove: true, role: "user" }));
    expect(vi.mocked(prisma.user.update).mock.calls[0][0].data).not.toHaveProperty(
      "sessionVersion",
    );
  });
});

describe("DELETE /api/admin/users", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { DELETE } = await import("@/app/api/admin/users/route");
    const res = await DELETE(makeReq({ userId: "u1" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when userId is missing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { DELETE } = await import("@/app/api/admin/users/route");
    const res = await DELETE(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("refuses to let an admin delete themselves", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { DELETE } = await import("@/app/api/admin/users/route");
    const res = await DELETE(makeReq({ userId: "admin-1" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the target user doesn't exist", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const { DELETE } = await import("@/app/api/admin/users/route");
    const res = await DELETE(makeReq({ userId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("deletes a user transactionally and audit-logs", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: "Bob" } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
    const { logAudit } = await import("@/lib/audit");

    const { DELETE } = await import("@/app/api/admin/users/route");
    const res = await DELETE(makeReq({ userId: "u1" }));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.deleted).toBe(true);
    expect(json.id).toBe("u1");
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalled();
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      "admin-1",
      "delete_user",
      expect.objectContaining({ id: "u1" }),
      expect.objectContaining({ name: "Bob" }),
    );
  });
});
