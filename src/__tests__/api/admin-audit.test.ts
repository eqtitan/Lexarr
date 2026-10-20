/**
 * Route-level tests for /api/admin/audit (M3 coverage push).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(),
    },
  },
}));

function makeReq(url: string): NextRequest {
  const u = new URL(url);
  return {
    nextUrl: u,
    headers: new Headers(),
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

describe("GET /api/admin/audit", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/admin/audit/route");
    const res = await GET(makeReq("http://localhost/api/admin/audit"));
    expect(res.status).toBe(403);
  });

  it("uses the default limit of 50 when unspecified", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);

    const { GET } = await import("@/app/api/admin/audit/route");
    await GET(makeReq("http://localhost/api/admin/audit"));
    expect(vi.mocked(prisma.auditLog.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, where: {} }),
    );
  });

  it("caps the limit at 200 even if a larger value is requested", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);

    const { GET } = await import("@/app/api/admin/audit/route");
    await GET(makeReq("http://localhost/api/admin/audit?limit=9999"));
    expect(vi.mocked(prisma.auditLog.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });

  it("filters by action when provided", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);

    const { GET } = await import("@/app/api/admin/audit/route");
    await GET(makeReq("http://localhost/api/admin/audit?action=approve_request"));
    expect(vi.mocked(prisma.auditLog.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: "approve_request" } }),
    );
  });

  it("returns the logs from prisma", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { id: "log1", action: "approve_request" },
    ] as never);

    const { GET } = await import("@/app/api/admin/audit/route");
    const res = await GET(makeReq("http://localhost/api/admin/audit"));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.logs).toHaveLength(1);
  });
});
