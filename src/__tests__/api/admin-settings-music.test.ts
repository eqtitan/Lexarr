/**
 * Route-level tests for /api/admin/settings/music (M3 coverage push,
 * remaining zero-coverage routes).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getAllowedRegions: vi.fn(),
  setAllowedRegions: vi.fn(),
  SUPPORTED_REGIONS: [
    { code: "US", label: "United States" },
    { code: "GB", label: "United Kingdom" },
  ],
  DEFAULT_ALLOWED_REGIONS: [],
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
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

describe("GET /api/admin/settings/music", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/admin/settings/music/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the current regions plus supported/default lists", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { getAllowedRegions } = await import("@/lib/settings");
    vi.mocked(getAllowedRegions).mockResolvedValue(["US"] as never);

    const { GET } = await import("@/app/api/admin/settings/music/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.regions).toEqual(["US"]);
    expect(json.supported).toEqual([
      { code: "US", label: "United States" },
      { code: "GB", label: "United Kingdom" },
    ]);
    expect(json.default).toEqual([]);
  });
});

describe("PUT /api/admin/settings/music", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { PUT } = await import("@/app/api/admin/settings/music/route");
    const res = await PUT(makeReq({ regions: ["US"] }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when the admin session has no user id", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { role: "admin" },
      expires: "9999",
    } as never);

    const { PUT } = await import("@/app/api/admin/settings/music/route");
    const res = await PUT(makeReq({ regions: ["US"] }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when the body has no regions array", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { PUT } = await import("@/app/api/admin/settings/music/route");
    const res = await PUT(makeReq({ regions: "US" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the request body fails to parse", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const badReq = {
      headers: new Headers({ "Content-Type": "application/json" }),
      json: () => Promise.reject(new Error("bad json")),
    } as unknown as NextRequest;

    const { PUT } = await import("@/app/api/admin/settings/music/route");
    const res = await PUT(badReq);
    expect(res.status).toBe(400);
  });

  it("saves the regions, audit-logs, and returns the persisted value", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { setAllowedRegions, getAllowedRegions } = await import(
      "@/lib/settings"
    );
    vi.mocked(setAllowedRegions).mockResolvedValue(undefined);
    vi.mocked(getAllowedRegions).mockResolvedValue(["US", "GB"] as never);
    const { logAudit } = await import("@/lib/audit");

    const { PUT } = await import("@/app/api/admin/settings/music/route");
    const res = await PUT(makeReq({ regions: ["US", "GB"] }));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.regions).toEqual(["US", "GB"]);
    expect(vi.mocked(setAllowedRegions)).toHaveBeenCalledWith(["US", "GB"]);
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      "admin-1",
      "update_settings",
      expect.objectContaining({ type: "settings", id: "music.allowedRegions" }),
      expect.objectContaining({ regions: ["US", "GB"] }),
    );
  });

  it("accepts an empty regions array (disables region filtering)", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { setAllowedRegions, getAllowedRegions } = await import(
      "@/lib/settings"
    );
    vi.mocked(setAllowedRegions).mockResolvedValue(undefined);
    vi.mocked(getAllowedRegions).mockResolvedValue([] as never);

    const { PUT } = await import("@/app/api/admin/settings/music/route");
    const res = await PUT(makeReq({ regions: [] }));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.regions).toEqual([]);
  });
});
