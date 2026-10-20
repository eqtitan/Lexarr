/**
 * Route-level tests for /api/status (M3 coverage push).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/status-checker", () => ({
  checkAndUpdateStatuses: vi.fn(),
}));

const adminSession = {
  user: { id: "admin-1", name: "Admin", role: "admin" },
  expires: "9999",
};
const userSession = {
  user: { id: "user-1", name: "User", role: "user" },
  expires: "9999",
};

describe("POST /api/status", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { POST } = await import("@/app/api/status/route");
    const res = await POST();
    expect(res.status).toBe(403);
  });

  it("returns 403 with no session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { POST } = await import("@/app/api/status/route");
    const res = await POST();
    expect(res.status).toBe(403);
  });

  it("returns the reconciliation result on success", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { checkAndUpdateStatuses } = await import("@/lib/status-checker");
    vi.mocked(checkAndUpdateStatuses).mockResolvedValue({ updated: 3 } as never);

    const { POST } = await import("@/app/api/status/route");
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.updated).toBe(3);
  });

  it("returns 500 when the status checker throws", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { checkAndUpdateStatuses } = await import("@/lib/status-checker");
    vi.mocked(checkAndUpdateStatuses).mockRejectedValue(new Error("arr timeout"));

    const { POST } = await import("@/app/api/status/route");
    const res = await POST();
    expect(res.status).toBe(500);
    const json = await (res as Response).json();
    expect(json.error).toBe("arr timeout");
  });
});
