/**
 * Route-level tests for /api/admin/settings (M3 coverage push).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/arr/radarr", () => ({ health: vi.fn() }));
vi.mock("@/lib/arr/sonarr", () => ({ health: vi.fn() }));
vi.mock("@/lib/arr/lidarr", () => ({ health: vi.fn() }));
vi.mock("@/lib/arr/lazylibrarian", () => ({ health: vi.fn() }));

const adminSession = {
  user: { id: "admin-1", name: "Admin", role: "admin" },
  expires: "9999",
};
const userSession = {
  user: { id: "user-1", name: "User", role: "user" },
  expires: "9999",
};

describe("GET /api/admin/settings", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/admin/settings/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("reports health for all four services, mixing healthy and unhealthy", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const radarr = await import("@/lib/arr/radarr");
    const sonarr = await import("@/lib/arr/sonarr");
    const lidarr = await import("@/lib/arr/lidarr");
    const lazylibrarian = await import("@/lib/arr/lazylibrarian");
    vi.mocked(radarr.health).mockResolvedValue(true);
    vi.mocked(sonarr.health).mockResolvedValue(true);
    vi.mocked(lidarr.health).mockRejectedValue(new Error("connection refused"));
    vi.mocked(lazylibrarian.health).mockResolvedValue(true);

    const { GET } = await import("@/app/api/admin/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.services).toHaveLength(4);
    const lidarrEntry = json.services.find((s: { name: string }) => s.name === "Lidarr");
    expect(lidarrEntry.healthy).toBe(false);
    expect(lidarrEntry.error).toBe("connection refused");
    const radarrEntry = json.services.find((s: { name: string }) => s.name === "Radarr");
    expect(radarrEntry.healthy).toBe(true);
  });
});
