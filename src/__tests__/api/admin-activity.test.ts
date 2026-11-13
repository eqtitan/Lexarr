/**
 * Route-level tests for /api/admin/activity (admin dashboard notification inbox).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { pipelineEvent: { findMany: vi.fn() } } }));

function makeReq(url: string): NextRequest {
  return { nextUrl: new URL(url), headers: new Headers() } as unknown as NextRequest;
}
const admin = { user: { id: "a", name: "Admin", role: "admin" }, expires: "9999" };
const user = { user: { id: "u", name: "User", role: "user" }, expires: "9999" };

function ev(id: string, event: string, at: Date, extra: Record<string, unknown> = {}) {
  return {
    id,
    event,
    createdAt: at,
    detail: (extra.detail as string) ?? null,
    request: {
      id: `r-${id}`,
      title: "Dune",
      mediaType: "movie",
      status: (extra.status as string) ?? event,
      lastError: (extra.lastError as string) ?? null,
      user: { name: "alice" },
    },
  };
}

describe("GET /api/admin/activity", () => {
  beforeEach(() => vi.resetAllMocks());

  it("is admin-only", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(user as never);
    const { GET } = await import("@/app/api/admin/activity/route");
    expect((await GET(makeReq("http://x/api/admin/activity"))).status).toBe(403);
  });

  it("asks only for notification-worthy events within the window, newest first", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(admin as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.pipelineEvent.findMany).mockResolvedValue([] as never);
    const { GET } = await import("@/app/api/admin/activity/route");

    await GET(makeReq("http://x/api/admin/activity?days=3"));

    const arg = vi.mocked(prisma.pipelineEvent.findMany).mock.calls[0][0] as {
      where: { event: { in: string[] }; createdAt: { gte: Date } };
      orderBy: unknown;
    };
    expect(arg.where.event.in.sort()).toEqual(["available", "cancelled", "denied", "failed", "stalled", "submitted"]);
    const ageDays = (Date.now() - arg.where.createdAt.gte.getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(2.99);
    expect(ageDays).toBeLessThan(3.01);
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("clamps days to 1..90", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(admin as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.pipelineEvent.findMany).mockResolvedValue([] as never);
    const { GET } = await import("@/app/api/admin/activity/route");

    const body = await (await GET(makeReq("http://x/api/admin/activity?days=999"))).json();
    expect(body.days).toBe(90);
  });

  it("maps rows, explains failures and late arrivals, and drops legacy rows outside the window", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(admin as never);
    const { prisma } = await import("@/lib/db");
    const now = Date.now();
    vi.mocked(prisma.pipelineEvent.findMany).mockResolvedValue([
      ev("legacy", "available", new Date("2026-04-18T02:08:26Z")), // TEXT row SQLite sorted first
      ev("f", "failed", new Date(now - 60_000), { lastError: "No releases found after 12h — indexers returned nothing" }),
      ev("l", "available", new Date(now - 3_600_000), { detail: JSON.stringify({ reason: "late_arrival" }) }),
    ] as never);
    const { GET } = await import("@/app/api/admin/activity/route");

    const { activity } = await (await GET(makeReq("http://x/api/admin/activity"))).json();

    expect(activity.map((a: { id: string }) => a.id)).toEqual(["f", "l"]);
    expect(activity[0]).toMatchObject({ event: "failed", title: "Dune", user: "alice", summary: expect.stringContaining("No releases found") });
    expect(activity[1].summary).toBe("Arrived after Lexarr had given up");
  });
});
