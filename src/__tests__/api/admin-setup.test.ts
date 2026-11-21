/**
 * Route-level tests for /api/admin/setup (first-run setup guide state).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({ auth: vi.fn() }));
vi.mock("@/lib/setup", () => ({ getSetupInfo: vi.fn() }));
vi.mock("@/lib/settings", () => ({ setSetupStatus: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

const info = {
  status: "pending",
  autoLaunch: true,
  webhookSecretSet: true,
  registrationOpen: false,
  plexEnabled: false,
  jellyfinEnabled: true,
};

function makeReq(body: unknown): NextRequest {
  return {
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => (body === undefined ? Promise.reject(new Error("bad json")) : Promise.resolve(body)),
  } as unknown as NextRequest;
}

const adminSession = { user: { id: "admin-1", name: "Admin", role: "admin" }, expires: "9999" };
const userSession = { user: { id: "user-1", name: "User", role: "user" }, expires: "9999" };

describe("/api/admin/setup", () => {
  beforeEach(() => vi.resetAllMocks());

  it("GET returns 403 without an admin session", async () => {
    const { auth } = await import("@/lib/auth/config");
    const { GET } = await import("@/app/api/admin/setup/route");
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET()).status).toBe(403);
    vi.mocked(auth).mockResolvedValue(userSession as never);
    expect((await GET()).status).toBe(403);
  });

  it("GET returns the setup info to an admin", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { getSetupInfo } = await import("@/lib/setup");
    vi.mocked(getSetupInfo).mockResolvedValue(info as never);
    const { GET } = await import("@/app/api/admin/setup/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(info);
  });

  it("PUT returns 403 for non-admins and saves nothing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { setSetupStatus } = await import("@/lib/settings");
    const { PUT } = await import("@/app/api/admin/setup/route");
    expect((await PUT(makeReq({ status: "completed" }))).status).toBe(403);
    expect(setSetupStatus).not.toHaveBeenCalled();
  });

  it.each([[undefined], [{}], [{ status: "pending" }], [{ status: "done" }], [{ status: 1 }]])(
    "PUT rejects a bad body (%j)",
    async (body) => {
      const { auth } = await import("@/lib/auth/config");
      vi.mocked(auth).mockResolvedValue(adminSession as never);
      const { setSetupStatus } = await import("@/lib/settings");
      const { PUT } = await import("@/app/api/admin/setup/route");
      expect((await PUT(makeReq(body))).status).toBe(400);
      expect(setSetupStatus).not.toHaveBeenCalled();
    },
  );

  it.each(["completed", "skipped"] as const)("PUT saves %s and audits it", async (status) => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { getSetupInfo } = await import("@/lib/setup");
    vi.mocked(getSetupInfo).mockResolvedValue({ ...info, status, autoLaunch: false } as never);
    const { setSetupStatus } = await import("@/lib/settings");
    const { logAudit } = await import("@/lib/audit");

    const { PUT } = await import("@/app/api/admin/setup/route");
    const res = await PUT(makeReq({ status }));

    expect(res.status).toBe(200);
    expect(setSetupStatus).toHaveBeenCalledWith(status);
    expect(logAudit).toHaveBeenCalledWith("admin-1", "update_settings", { type: "settings", id: "setup.status" }, { status });
    expect(await res.json()).toMatchObject({ status, autoLaunch: false });
  });
});
