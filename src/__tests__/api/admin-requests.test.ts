/**
 * Route-level tests for /api/admin/requests (M3 coverage push).
 *
 * Mocks the service layer (@/lib/services/admin) at the boundary so this
 * stays a pure route-level test — the same pattern as api-request.test.ts.
 * Exercises: admin gate on GET/PATCH/DELETE, action validation on PATCH,
 * requestId validation, and the arrError pass-through on approve.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

class MockRequestConflictError extends Error {
  constructor(
    public readonly requestId: string,
    public readonly currentStatus: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestConflictError";
  }
}

vi.mock("@/lib/services/admin", () => ({
  listPendingRequests: vi.fn(),
  approveRequest: vi.fn(),
  denyRequest: vi.fn(),
  cancelRequest: vi.fn(),
  RequestConflictError: MockRequestConflictError,
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

describe("GET /api/admin/requests", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/admin/requests/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns 403 with no session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { GET } = await import("@/app/api/admin/requests/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns pending requests for admin", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { listPendingRequests } = await import("@/lib/services/admin");
    vi.mocked(listPendingRequests).mockResolvedValue({
      requests: [{ id: "r1" }] as never,
    });

    const { GET } = await import("@/app/api/admin/requests/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.requests).toHaveLength(1);
  });
});

describe("PATCH /api/admin/requests", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { PATCH } = await import("@/app/api/admin/requests/route");
    const res = await PATCH(makeReq({ requestId: "r1", action: "approve" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid action", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { PATCH } = await import("@/app/api/admin/requests/route");
    const res = await PATCH(makeReq({ requestId: "r1", action: "explode" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when requestId is missing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { PATCH } = await import("@/app/api/admin/requests/route");
    const res = await PATCH(makeReq({ action: "approve" }));
    expect(res.status).toBe(400);
  });

  it("denies a request", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { denyRequest } = await import("@/lib/services/admin");
    vi.mocked(denyRequest).mockResolvedValue({
      request: { id: "r1", status: "denied" } as never,
    });

    const { PATCH } = await import("@/app/api/admin/requests/route");
    const res = await PATCH(
      makeReq({ requestId: "r1", action: "deny", note: "not needed" }),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.request.status).toBe("denied");
    expect(vi.mocked(denyRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "r1", adminId: "admin-1" }),
    );
  });

  it("approves a request with no arr error", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { approveRequest } = await import("@/lib/services/admin");
    vi.mocked(approveRequest).mockResolvedValue({
      request: { id: "r1", status: "approved" } as never,
    });

    const { PATCH } = await import("@/app/api/admin/requests/route");
    const res = await PATCH(makeReq({ requestId: "r1", action: "approve" }));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.request.status).toBe("approved");
    expect(json.arrError).toBeUndefined();
  });

  it("returns 409 when approving a request that's no longer pending", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { approveRequest } = await import("@/lib/services/admin");
    vi.mocked(approveRequest).mockRejectedValue(
      new MockRequestConflictError("r1", "denied", "Request r1 is no longer pending (current status: denied)"),
    );

    const { PATCH } = await import("@/app/api/admin/requests/route");
    const res = await PATCH(makeReq({ requestId: "r1", action: "approve" }));
    expect(res.status).toBe(409);
    const json = await (res as Response).json();
    expect(json.error).toMatch(/no longer pending/);
  });

  it("returns 409 when denying a request that's no longer pending", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { denyRequest } = await import("@/lib/services/admin");
    vi.mocked(denyRequest).mockRejectedValue(
      new MockRequestConflictError("r1", "approved", "Request r1 is no longer pending (current status: approved)"),
    );

    const { PATCH } = await import("@/app/api/admin/requests/route");
    const res = await PATCH(makeReq({ requestId: "r1", action: "deny" }));
    expect(res.status).toBe(409);
  });

  it("re-throws a non-conflict error as an unhandled failure (not swallowed as a 409)", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { approveRequest } = await import("@/lib/services/admin");
    vi.mocked(approveRequest).mockRejectedValue(new Error("db connection lost"));

    const { PATCH } = await import("@/app/api/admin/requests/route");
    await expect(
      PATCH(makeReq({ requestId: "r1", action: "approve" })),
    ).rejects.toThrow("db connection lost");
  });

  it("surfaces arrError when *arr routing fails on approve", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { approveRequest } = await import("@/lib/services/admin");
    vi.mocked(approveRequest).mockResolvedValue({
      request: { id: "r1", status: "approved" } as never,
      arrError: "Radarr unreachable",
    });

    const { PATCH } = await import("@/app/api/admin/requests/route");
    const res = await PATCH(makeReq({ requestId: "r1", action: "approve" }));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.arrError).toBe("Radarr unreachable");
  });
});

describe("DELETE /api/admin/requests", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { DELETE } = await import("@/app/api/admin/requests/route");
    const res = await DELETE(makeReq({ requestId: "r1" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when requestId is missing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { DELETE } = await import("@/app/api/admin/requests/route");
    const res = await DELETE(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("cancels a request", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { cancelRequest } = await import("@/lib/services/admin");
    vi.mocked(cancelRequest).mockResolvedValue({
      request: { id: "r1", status: "cancelled" } as never,
    });

    const { DELETE } = await import("@/app/api/admin/requests/route");
    const res = await DELETE(makeReq({ requestId: "r1", note: "dup" }));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.request.status).toBe("cancelled");
  });

  it("returns 409 when cancelling an already-terminal request", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { cancelRequest } = await import("@/lib/services/admin");
    vi.mocked(cancelRequest).mockRejectedValue(
      new MockRequestConflictError("r1", "cancelled", "Request r1 is already cancelled"),
    );

    const { DELETE } = await import("@/app/api/admin/requests/route");
    const res = await DELETE(makeReq({ requestId: "r1" }));
    expect(res.status).toBe(409);
    const json = await (res as Response).json();
    expect(json.error).toMatch(/already cancelled/);
  });
});
