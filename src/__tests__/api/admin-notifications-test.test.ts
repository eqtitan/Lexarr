/**
 * Route-level tests for /api/admin/notifications/test (M3 coverage push,
 * remaining zero-coverage routes).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    notificationChannel: {
      findUnique: vi.fn(),
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

describe("POST /api/admin/notifications/test", () => {
  const originalFetch = global.fetch;

  beforeEach(() => vi.resetAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { POST } = await import("@/app/api/admin/notifications/test/route");
    const res = await POST(makeReq({ channelId: "c1" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when channelId is missing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);

    const { POST } = await import("@/app/api/admin/notifications/test/route");
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the channel doesn't exist", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.notificationChannel.findUnique).mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/notifications/test/route");
    const res = await POST(makeReq({ channelId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("sends a Discord-shaped payload and returns success", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.notificationChannel.findUnique).mockResolvedValue({
      id: "c1",
      type: "discord",
      webhookUrl: "https://discord.example/webhook",
    } as never);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as never;

    const { POST } = await import("@/app/api/admin/notifications/test/route");
    const res = await POST(makeReq({ channelId: "c1" }));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.success).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.example/webhook");
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.embeds[0].title).toBe("Lexarr Test Notification");
  });

  it("sends a Slack-shaped payload for slack channels", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.notificationChannel.findUnique).mockResolvedValue({
      id: "c2",
      type: "slack",
      webhookUrl: "https://slack.example/webhook",
    } as never);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as never;

    const { POST } = await import("@/app/api/admin/notifications/test/route");
    const res = await POST(makeReq({ channelId: "c2" }));
    expect(res.status).toBe(200);

    const [, opts] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.blocks[0].type).toBe("header");
  });

  it("sends a generic payload for other channel types", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.notificationChannel.findUnique).mockResolvedValue({
      id: "c3",
      type: "generic",
      webhookUrl: "https://generic.example/webhook",
    } as never);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as never;

    const { POST } = await import("@/app/api/admin/notifications/test/route");
    const res = await POST(makeReq({ channelId: "c3" }));
    expect(res.status).toBe(200);

    const [, opts] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.event).toBe("test");
    expect(sentBody.source).toBe("lexarr");
  });

  it("returns 502 when the webhook responds with a non-ok, non-204 status", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.notificationChannel.findUnique).mockResolvedValue({
      id: "c1",
      type: "discord",
      webhookUrl: "https://discord.example/webhook",
    } as never);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("internal server error"),
    });
    global.fetch = fetchMock as never;

    const { POST } = await import("@/app/api/admin/notifications/test/route");
    const res = await POST(makeReq({ channelId: "c1" }));
    expect(res.status).toBe(502);
    const json = await (res as Response).json();
    expect(json.error).toContain("500");
    expect(json.error).toContain("internal server error");
  });

  it("returns 502 when the fetch itself throws (network error)", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.notificationChannel.findUnique).mockResolvedValue({
      id: "c1",
      type: "discord",
      webhookUrl: "https://discord.example/webhook",
    } as never);

    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    global.fetch = fetchMock as never;

    const { POST } = await import("@/app/api/admin/notifications/test/route");
    const res = await POST(makeReq({ channelId: "c1" }));
    expect(res.status).toBe(502);
    const json = await (res as Response).json();
    expect(json.error).toBe("ECONNREFUSED");
  });
});
