/**
 * Route-level tests for /api/admin/queue (M3 coverage push).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/lib/arr/radarr", () => ({
  deleteQueueItem: vi.fn(),
}));
vi.mock("@/lib/arr/sonarr", () => ({
  deleteQueueItem: vi.fn(),
}));
vi.mock("@/lib/arr/lidarr", () => ({
  deleteQueueItem: vi.fn(),
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

describe("DELETE /api/admin/queue", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { DELETE } = await import("@/app/api/admin/queue/route");
    const res = await DELETE(makeReq({ source: "radarr", id: 1 }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when source or id is missing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { DELETE } = await import("@/app/api/admin/queue/route");
    const res = await DELETE(makeReq({ source: "radarr" }));
    expect(res.status).toBe(400);
  });

  it("routes to radarr.deleteQueueItem with blocklist defaulting true", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const radarr = await import("@/lib/arr/radarr");
    vi.mocked(radarr.deleteQueueItem).mockResolvedValue(undefined);
    const { logAudit } = await import("@/lib/audit");

    const { DELETE } = await import("@/app/api/admin/queue/route");
    const res = await DELETE(makeReq({ source: "radarr", id: 5 }));
    expect(res.status).toBe(200);
    expect(vi.mocked(radarr.deleteQueueItem)).toHaveBeenCalledWith(5, true);
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      "admin-1",
      "blocklist_queue",
      expect.objectContaining({ id: "5" }),
      expect.objectContaining({ source: "radarr", blocklist: true }),
    );
  });

  it("respects blocklist: false", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const sonarr = await import("@/lib/arr/sonarr");
    vi.mocked(sonarr.deleteQueueItem).mockResolvedValue(undefined);

    const { DELETE } = await import("@/app/api/admin/queue/route");
    const res = await DELETE(
      makeReq({ source: "sonarr", id: 7, blocklist: false }),
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(sonarr.deleteQueueItem)).toHaveBeenCalledWith(7, false);
  });

  it("routes to lidarr.deleteQueueItem", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const lidarr = await import("@/lib/arr/lidarr");
    vi.mocked(lidarr.deleteQueueItem).mockResolvedValue(undefined);

    const { DELETE } = await import("@/app/api/admin/queue/route");
    const res = await DELETE(makeReq({ source: "lidarr", id: 3 }));
    expect(res.status).toBe(200);
    expect(vi.mocked(lidarr.deleteQueueItem)).toHaveBeenCalledWith(3, true);
  });

  it("returns 502 when the arr rejects the delete", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const radarr = await import("@/lib/arr/radarr");
    vi.mocked(radarr.deleteQueueItem).mockRejectedValue(new Error("gone"));

    const { DELETE } = await import("@/app/api/admin/queue/route");
    const res = await DELETE(makeReq({ source: "radarr", id: 5 }));
    expect(res.status).toBe(502);
  });
});
