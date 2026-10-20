/**
 * Route-level tests for /api/admin/retry (M3 coverage push).
 *
 * Mocks Prisma + the *arr router + notifications + audit at the boundary.
 * Exercises the admin gate, requestId validation, not-found, status-guard
 * (canRetry), max-retries guard, the success path (arrId returned), and
 * the failure path (routeToArr throws -> status flips to failed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  notify: vi.fn(),
}));

vi.mock("@/lib/arr/router", () => ({
  routeToArr: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    request: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pipelineEvent: {
      create: vi.fn(),
    },
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

const baseRequest = {
  id: "r1",
  status: "failed",
  retryCount: 0,
  mediaType: "movie",
  externalId: "157336",
  externalId2: null,
  title: "Interstellar",
};

describe("POST /api/admin/retry", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { POST } = await import("@/app/api/admin/retry/route");
    const res = await POST(makeReq({ requestId: "r1" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when requestId is missing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { POST } = await import("@/app/api/admin/retry/route");
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the request doesn't exist", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findUnique).mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/retry/route");
    const res = await POST(makeReq({ requestId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when the request status can't be retried", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findUnique).mockResolvedValue({
      ...baseRequest,
      status: "available",
    } as never);

    const { POST } = await import("@/app/api/admin/retry/route");
    const res = await POST(makeReq({ requestId: "r1" }));
    expect(res.status).toBe(400);
    const json = await (res as Response).json();
    expect(json.error).toMatch(/available/);
  });

  it("returns 400 when max retries have been reached", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findUnique).mockResolvedValue({
      ...baseRequest,
      retryCount: 3,
    } as never);

    const { POST } = await import("@/app/api/admin/retry/route");
    const res = await POST(makeReq({ requestId: "r1" }));
    expect(res.status).toBe(400);
    const json = await (res as Response).json();
    expect(json.error).toMatch(/Max retries/);
  });

  it("routes to arr and returns success on the happy path", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findUnique).mockResolvedValue(baseRequest as never);
    vi.mocked(prisma.request.update).mockResolvedValue({} as never);
    vi.mocked(prisma.pipelineEvent.create).mockResolvedValue({} as never);
    const { routeToArr } = await import("@/lib/arr/router");
    vi.mocked(routeToArr).mockResolvedValue({ arrId: 99, alreadyExists: false });
    const { notify } = await import("@/lib/notifications");

    const { POST } = await import("@/app/api/admin/retry/route");
    const res = await POST(makeReq({ requestId: "r1" }));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.success).toBe(true);
    expect(vi.mocked(prisma.request.update)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "downloading", arrId: 99 }),
      }),
    );
    expect(vi.mocked(notify)).toHaveBeenCalled();
  });

  it("marks the request failed when routeToArr throws", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findUnique).mockResolvedValue(baseRequest as never);
    vi.mocked(prisma.request.update).mockResolvedValue({} as never);
    vi.mocked(prisma.pipelineEvent.create).mockResolvedValue({} as never);
    const { routeToArr } = await import("@/lib/arr/router");
    vi.mocked(routeToArr).mockRejectedValue(new Error("Radarr unreachable"));

    const { POST } = await import("@/app/api/admin/retry/route");
    const res = await POST(makeReq({ requestId: "r1" }));
    expect(res.status).toBe(500);
    const json = await (res as Response).json();
    expect(json.error).toBe("Radarr unreachable");
    expect(vi.mocked(prisma.request.update)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", lastError: "Radarr unreachable" }),
      }),
    );
  });
});
