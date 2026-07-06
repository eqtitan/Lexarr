import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { NextRequest } from "next/server";

// Mock dependencies before importing route
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: "1", name: "Test", role: "admin" }),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
  RATE_LIMITS: { auth: { windowMs: 60000, max: 5 } },
}));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-pw") },
}));

function makeReq(body: Record<string, unknown>): NextRequest {
  return {
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

describe("Auth Registration", () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.REGISTRATION_OPEN;
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.count).mockResolvedValue(0);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "1", name: "Test", role: "admin", email: null, password: "x",
      autoApprove: true, createdAt: new Date(),
    } as never);
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() });
  });

  afterAll(() => { process.env = originalEnv; });

  it("rejects missing name", async () => {
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(makeReq({ password: "longpassword" }));
    expect(res.status).toBe(400);
  });

  it("rejects missing password", async () => {
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(makeReq({ name: "Alice" }));
    expect(res.status).toBe(400);
  });

  it("rejects short name (< 2 chars)", async () => {
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(makeReq({ name: "A", password: "longpassword" }));
    expect(res.status).toBe(400);
  });

  it("rejects short password (< 8 chars)", async () => {
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(makeReq({ name: "Alice", password: "short" }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid email format", async () => {
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(makeReq({ name: "Alice", password: "longpassword", email: "bademail" }));
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() });
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(makeReq({ name: "Alice", password: "longpassword" }));
    expect(res.status).toBe(429);
  });

  it("blocks registration when admin exists and REGISTRATION_OPEN unset", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "admin", role: "admin" } as never);
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(makeReq({ name: "Alice", password: "longpassword" }));
    expect(res.status).toBe(403);
  });

  it("allows registration when REGISTRATION_OPEN=true", async () => {
    process.env.REGISTRATION_OPEN = "true";
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "admin", role: "admin" } as never);
    vi.mocked(prisma.user.count).mockResolvedValue(1);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "2", name: "Bob", role: "user", email: null, password: "x",
      autoApprove: false, createdAt: new Date(),
    } as never);
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(makeReq({ name: "Bob", password: "longpassword" }));
    expect(res.status).toBe(200);
  });

  it("first user gets admin role", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.count).mockResolvedValue(0);
    const { POST } = await import("@/app/api/auth/register/route");
    await POST(makeReq({ name: "First", password: "longpassword" }));
    expect(vi.mocked(prisma.user.create)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "admin" }) }),
    );
  });

  it("returns 409 when username already exists (P-01)", async () => {
    process.env.REGISTRATION_OPEN = "true";
    const { prisma } = await import("@/lib/db");
    // First findUnique (by name) → returns existing user
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1", name: "Alice", role: "user",
    } as never);
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(makeReq({ name: "Alice", password: "longpassword" }));
    expect(res.status).toBe(409);
    const body = await (res as Response).json();
    expect(body.error).toMatch(/username/i);
  });

  it("returns 409 when create() throws P2002 (race past findUnique)", async () => {
    process.env.REGISTRATION_OPEN = "true";
    const { prisma } = await import("@/lib/db");
    const { Prisma } = await import("@prisma/client");
    // findUnique says no collision, but create races and hits the unique index
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed on the fields: (`name`)",
        { code: "P2002", clientVersion: "x", meta: { target: ["name"] } },
      ),
    );
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(makeReq({ name: "Alice", password: "longpassword" }));
    expect(res.status).toBe(409);
  });

  it("subsequent users get user role", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.user.count).mockResolvedValue(1);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "2", name: "Second", role: "user", email: null, password: "x",
      autoApprove: false, createdAt: new Date(),
    } as never);
    process.env.REGISTRATION_OPEN = "true";
    const { POST } = await import("@/app/api/auth/register/route");
    await POST(makeReq({ name: "Second", password: "longpassword" }));
    expect(vi.mocked(prisma.user.create)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "user" }) }),
    );
  });
});
