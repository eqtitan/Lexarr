/**
 * Route-level tests for /api/library-status (M3 coverage push).
 *
 * The merge/lookup logic itself is exercised in
 * src/__tests__/library-status.test.ts and library-status-service.test.ts —
 * this file targets only the route's own auth + rate-limit + validation +
 * item-cap behavior, mocking the service layer at the boundary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn().mockReturnValue("10.0.0.1"),
  RATE_LIMITS: { search: { limit: 30, windowSeconds: 60 } },
}));

vi.mock("@/lib/services/library-status", () => ({
  getLibraryStatuses: vi.fn(),
}));

function makeReq(body: unknown): NextRequest {
  return {
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

const userSession = {
  user: { id: "user-1", name: "User", role: "user" },
  expires: "9999",
};

describe("POST /api/library-status", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 29,
      resetAt: Date.now(),
    });
  });

  it("returns 429 when rate-limited", async () => {
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now(),
    });

    const { POST } = await import("@/app/api/library-status/route");
    const res = await POST(makeReq({ items: [] }));
    expect(res.status).toBe(429);
  });

  it("returns 401 with no session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { POST } = await import("@/app/api/library-status/route");
    const res = await POST(makeReq({ items: [] }));
    expect(res.status).toBe(401);
  });

  it("returns an empty statuses map when items is not an array", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");

    const { POST } = await import("@/app/api/library-status/route");
    const res = await POST(makeReq({ items: "not-an-array" }));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.statuses).toEqual({});
    expect(vi.mocked(getLibraryStatuses)).not.toHaveBeenCalled();
  });

  it("returns an empty statuses map when items is empty", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");

    const { POST } = await import("@/app/api/library-status/route");
    const res = await POST(makeReq({ items: [] }));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.statuses).toEqual({});
    expect(vi.mocked(getLibraryStatuses)).not.toHaveBeenCalled();
  });

  it("caps items at 40 before calling the service", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    vi.mocked(getLibraryStatuses).mockResolvedValue({});

    const items = Array.from({ length: 50 }, (_, i) => ({
      mediaType: "movie",
      id: String(i),
    }));

    const { POST } = await import("@/app/api/library-status/route");
    await POST(makeReq({ items }));
    const calledWith = vi.mocked(getLibraryStatuses).mock.calls[0][0];
    expect(calledWith).toHaveLength(40);
  });

  it("returns the statuses map from the service", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    vi.mocked(getLibraryStatuses).mockResolvedValue({
      "movie:157336": "available",
    });

    const { POST } = await import("@/app/api/library-status/route");
    const res = await POST(
      makeReq({ items: [{ mediaType: "movie", id: "157336" }] }),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.statuses["movie:157336"]).toBe("available");
  });
});
