/**
 * Route-level tests for /api/admin/arr-breakers (M3 coverage push, remaining
 * zero-coverage routes).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/arr/circuit-breaker", () => ({
  snapshotAllBreakers: vi.fn(),
}));

const adminSession = {
  user: { id: "admin-1", name: "Admin", role: "admin" },
  expires: "9999",
};
const userSession = {
  user: { id: "user-1", name: "User", role: "user" },
  expires: "9999",
};

describe("GET /api/admin/arr-breakers", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/admin/arr-breakers/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns 403 with no session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { GET } = await import("@/app/api/admin/arr-breakers/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the breaker snapshot for admins", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { snapshotAllBreakers } = await import("@/lib/arr/circuit-breaker");
    const snapshot = [
      {
        service: "radarr",
        state: "closed",
        failures: 0,
        lastFailureAt: null,
        retryAt: null,
        lastError: null,
      },
      {
        service: "sonarr",
        state: "open",
        failures: 5,
        lastFailureAt: "2026-07-10T07:00:00.000Z",
        retryAt: "2026-07-10T07:00:30.000Z",
        lastError: "connection refused",
      },
    ];
    vi.mocked(snapshotAllBreakers).mockReturnValue(snapshot as never);

    const { GET } = await import("@/app/api/admin/arr-breakers/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.breakers).toEqual(snapshot);
  });
});
