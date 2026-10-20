/**
 * Route-level tests for /api/admin/stack-health (M3 coverage push, remaining
 * zero-coverage routes).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/stack-health", () => ({
  readStackHealth: vi.fn(),
}));

const adminSession = {
  user: { id: "admin-1", name: "Admin", role: "admin" },
  expires: "9999",
};
const userSession = {
  user: { id: "user-1", name: "User", role: "user" },
  expires: "9999",
};

describe("GET /api/admin/stack-health", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/admin/stack-health/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns 403 with no session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { GET } = await import("@/app/api/admin/stack-health/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns { report: null } when the healthcheck file isn't readable", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { readStackHealth } = await import("@/lib/stack-health");
    vi.mocked(readStackHealth).mockResolvedValue(null);

    const { GET } = await import("@/app/api/admin/stack-health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.report).toBeNull();
  });

  it("returns the report for admins", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { readStackHealth } = await import("@/lib/stack-health");
    const report = {
      lastRunAt: "2026-07-10T07:00:00.000Z",
      timestamp: "2026-07-10 07:00:00",
      issueCount: 2,
      cleanedCount: 1,
      autoCleanup: true,
      staleMinutes: 5,
      body: "all good",
    };
    vi.mocked(readStackHealth).mockResolvedValue(report as never);

    const { GET } = await import("@/app/api/admin/stack-health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.report).toEqual(report);
  });
});
