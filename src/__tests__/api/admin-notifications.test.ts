/**
 * Route-level tests for /api/admin/notifications (M3 coverage push).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    notificationChannel: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
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

describe("GET /api/admin/notifications", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/admin/notifications/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the channel list for admins", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue([
      { id: "c1" },
    ] as never);

    const { GET } = await import("@/app/api/admin/notifications/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.channels).toHaveLength(1);
  });
});

describe("POST /api/admin/notifications", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { POST } = await import("@/app/api/admin/notifications/route");
    const res = await POST(
      makeReq({ name: "Discord", type: "discord", webhookUrl: "https://x" }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when required fields are missing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { POST } = await import("@/app/api/admin/notifications/route");
    const res = await POST(makeReq({ name: "Discord" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid type", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { POST } = await import("@/app/api/admin/notifications/route");
    const res = await POST(
      makeReq({ name: "X", type: "carrier-pigeon", webhookUrl: "https://x" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns the existing channel (idempotent) when webhookUrl already exists", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.notificationChannel.findFirst).mockResolvedValue({
      id: "existing",
      webhookUrl: "https://hooks.example/x",
    } as never);

    const { POST } = await import("@/app/api/admin/notifications/route");
    const res = await POST(
      makeReq({
        name: "Discord",
        type: "discord",
        webhookUrl: "https://hooks.example/x",
      }),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.alreadyExists).toBe(true);
    expect(json.channel.id).toBe("existing");
  });

  it("creates a new channel and audit-logs", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.notificationChannel.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.notificationChannel.create).mockResolvedValue({
      id: "new-channel",
    } as never);
    const { logAudit } = await import("@/lib/audit");

    const { POST } = await import("@/app/api/admin/notifications/route");
    const res = await POST(
      makeReq({
        name: "Discord",
        type: "discord",
        webhookUrl: "https://hooks.example/new",
      }),
    );
    expect(res.status).toBe(201);
    const json = await (res as Response).json();
    expect(json.channel.id).toBe("new-channel");
    expect(vi.mocked(logAudit)).toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/notifications", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { PATCH } = await import("@/app/api/admin/notifications/route");
    const res = await PATCH(makeReq({ id: "c1", enabled: false }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when id is missing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { PATCH } = await import("@/app/api/admin/notifications/route");
    const res = await PATCH(makeReq({ enabled: false }));
    expect(res.status).toBe(400);
  });

  it("updates the channel with only the provided fields", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.notificationChannel.update).mockResolvedValue({
      id: "c1",
      enabled: false,
    } as never);

    const { PATCH } = await import("@/app/api/admin/notifications/route");
    const res = await PATCH(makeReq({ id: "c1", enabled: false }));
    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.notificationChannel.update)).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { enabled: false },
    });
  });
});

describe("DELETE /api/admin/notifications", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { DELETE } = await import("@/app/api/admin/notifications/route");
    const res = await DELETE(makeReq({ id: "c1" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when id is missing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { DELETE } = await import("@/app/api/admin/notifications/route");
    const res = await DELETE(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("deletes the channel and audit-logs", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.notificationChannel.delete).mockResolvedValue({} as never);
    const { logAudit } = await import("@/lib/audit");

    const { DELETE } = await import("@/app/api/admin/notifications/route");
    const res = await DELETE(makeReq({ id: "c1" }));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.deleted).toBe(true);
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      "admin-1",
      "remove_notification",
      expect.objectContaining({ id: "c1" }),
    );
  });
});
