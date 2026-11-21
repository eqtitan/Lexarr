/**
 * Route-level tests for /api/admin/settings/updates (update-notice opt-in).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({ auth: vi.fn() }));
vi.mock("@/lib/settings", () => ({
  getUpdateCheckEnabled: vi.fn(),
  setUpdateCheckEnabled: vi.fn(),
}));
vi.mock("@/lib/update-check", () => ({ getUpdateStatus: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

function makeReq(body: unknown): NextRequest {
  return {
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => (body === undefined ? Promise.reject(new Error("bad json")) : Promise.resolve(body)),
  } as unknown as NextRequest;
}

const adminSession = { user: { id: "admin-1", name: "Admin", role: "admin" }, expires: "9999" };
const userSession = { user: { id: "user-1", name: "User", role: "user" }, expires: "9999" };

describe("/api/admin/settings/updates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.LEXARR_UPDATE_CHECK;
  });

  it("GET returns 403 for non-admins", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { GET } = await import("@/app/api/admin/settings/updates/route");
    expect((await GET()).status).toBe(403);
  });

  it("GET returns the saved choice and whether the env var overrides it", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { getUpdateCheckEnabled } = await import("@/lib/settings");
    vi.mocked(getUpdateCheckEnabled).mockResolvedValue(true);
    const { GET } = await import("@/app/api/admin/settings/updates/route");

    expect(await (await GET()).json()).toEqual({ enabled: true, lockedByEnv: false });

    process.env.LEXARR_UPDATE_CHECK = "false";
    expect(await (await GET()).json()).toEqual({ enabled: true, lockedByEnv: true });
  });

  it("PUT returns 403 for non-admins and saves nothing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { setUpdateCheckEnabled } = await import("@/lib/settings");
    const { PUT } = await import("@/app/api/admin/settings/updates/route");
    expect((await PUT(makeReq({ enabled: true }))).status).toBe(403);
    expect(setUpdateCheckEnabled).not.toHaveBeenCalled();
  });

  it.each([[undefined], [{}], [{ enabled: "yes" }], [{ enabled: 1 }]])("PUT rejects a bad body (%j)", async (body) => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { setUpdateCheckEnabled } = await import("@/lib/settings");
    const { PUT } = await import("@/app/api/admin/settings/updates/route");
    expect((await PUT(makeReq(body))).status).toBe(400);
    expect(setUpdateCheckEnabled).not.toHaveBeenCalled();
  });

  it("PUT saves the choice, audits it, and returns the fresh status", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { setUpdateCheckEnabled } = await import("@/lib/settings");
    const { getUpdateStatus } = await import("@/lib/update-check");
    const { logAudit } = await import("@/lib/audit");
    const status = { enabled: true, lockedByEnv: false, current: "0.31.0", latest: null, updateAvailable: false, url: "u", checkedAt: null };
    vi.mocked(getUpdateStatus).mockResolvedValue(status);

    const { PUT } = await import("@/app/api/admin/settings/updates/route");
    const res = await PUT(makeReq({ enabled: true }));

    expect(res.status).toBe(200);
    expect(setUpdateCheckEnabled).toHaveBeenCalledWith(true);
    expect(logAudit).toHaveBeenCalledWith("admin-1", "update_settings", { type: "settings", id: "updates.check" }, { enabled: true });
    expect(await res.json()).toEqual({ enabled: true, lockedByEnv: false, status });
  });
});
