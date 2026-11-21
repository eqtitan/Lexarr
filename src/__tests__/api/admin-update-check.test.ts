/**
 * Route-level tests for /api/admin/update-check.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/config", () => ({ auth: vi.fn() }));
vi.mock("@/lib/update-check", () => ({ getUpdateStatus: vi.fn() }));

const status = {
  enabled: true,
  current: "0.31.0",
  latest: "0.32.0",
  updateAvailable: true,
  url: "https://github.com/eqtitan/Lexarr/releases/tag/v0.32.0",
  checkedAt: "2026-11-21T20:00:00.000Z",
};

describe("GET /api/admin/update-check", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 without a session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);
    const { getUpdateStatus } = await import("@/lib/update-check");

    const { GET } = await import("@/app/api/admin/update-check/route");
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getUpdateStatus).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin users", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "user" }, expires: "9999" } as never);

    const { GET } = await import("@/app/api/admin/update-check/route");
    expect((await GET()).status).toBe(403);
  });

  it("returns the update status to an admin", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({ user: { id: "a1", role: "admin" }, expires: "9999" } as never);
    const { getUpdateStatus } = await import("@/lib/update-check");
    vi.mocked(getUpdateStatus).mockResolvedValue(status);

    const { GET } = await import("@/app/api/admin/update-check/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(status);
  });
});
