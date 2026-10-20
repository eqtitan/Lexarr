/**
 * Route-level tests for /api/admin/orphans (M3 coverage push).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/lib/arr/orphans", () => ({
  listOrphans: vi.fn(),
}));

vi.mock("@/lib/arr/qbittorrent", () => ({
  deleteTorrent: vi.fn(),
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

describe("GET /api/admin/orphans", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/admin/orphans/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the orphan list for admins", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { listOrphans } = await import("@/lib/arr/orphans");
    vi.mocked(listOrphans).mockResolvedValue([{ hash: "abc" }] as never);

    const { GET } = await import("@/app/api/admin/orphans/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.orphans).toHaveLength(1);
  });
});

describe("DELETE /api/admin/orphans", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { DELETE } = await import("@/app/api/admin/orphans/route");
    const res = await DELETE(makeReq({ hash: "abc" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when hash is missing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { DELETE } = await import("@/app/api/admin/orphans/route");
    const res = await DELETE(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 502 when qBittorrent rejects the delete", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { deleteTorrent } = await import("@/lib/arr/qbittorrent");
    vi.mocked(deleteTorrent).mockRejectedValue(new Error("not found"));

    const { DELETE } = await import("@/app/api/admin/orphans/route");
    const res = await DELETE(makeReq({ hash: "abc" }));
    expect(res.status).toBe(502);
  });

  it("removes the torrent and audit-logs on success", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { deleteTorrent } = await import("@/lib/arr/qbittorrent");
    vi.mocked(deleteTorrent).mockResolvedValue(undefined);
    const { logAudit } = await import("@/lib/audit");

    const { DELETE } = await import("@/app/api/admin/orphans/route");
    const res = await DELETE(
      makeReq({ hash: "abc", deleteFiles: true, folderName: "Movie.2024" }),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.removed).toBe(true);
    expect(vi.mocked(deleteTorrent)).toHaveBeenCalledWith("abc", true);
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      "admin-1",
      "remove_orphan",
      expect.objectContaining({ id: "abc" }),
      expect.objectContaining({ deleteFiles: true, folderName: "Movie.2024" }),
    );
  });
});
