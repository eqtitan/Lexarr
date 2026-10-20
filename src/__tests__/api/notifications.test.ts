/**
 * Route-level tests for /api/notifications (M3 coverage push).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    request: {
      findMany: vi.fn(),
    },
  },
}));

const userSession = {
  user: { id: "user-1", name: "User", role: "user" },
  expires: "9999",
};

describe("GET /api/notifications", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 with no session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("scopes the query to the current user and available status", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findMany).mockResolvedValue([] as never);

    const { GET } = await import("@/app/api/notifications/route");
    await GET();
    expect(vi.mocked(prisma.request.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          status: "available",
        }),
        take: 20,
      }),
    );
  });

  it("returns the notifications list", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findMany).mockResolvedValue([
      { id: "r1", title: "Interstellar" },
    ] as never);

    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.notifications).toHaveLength(1);
  });
});
