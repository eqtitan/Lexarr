/**
 * Route-level tests for /api/requests and /api/requests/[id]/events
 * (M3 coverage push). Both are read-only, auth-gated, Prisma-backed routes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    request: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    pipelineEvent: {
      findMany: vi.fn(),
    },
  },
}));

const adminSession = {
  user: { id: "admin-1", name: "Admin", role: "admin" },
  expires: "9999",
};
const userSession = {
  user: { id: "user-1", name: "User", role: "user" },
  expires: "9999",
};

describe("GET /api/requests", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 with no session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { GET } = await import("@/app/api/requests/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("scopes results to the current user for non-admins", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findMany).mockResolvedValue([] as never);

    const { GET } = await import("@/app/api/requests/route");
    await GET();
    expect(vi.mocked(prisma.request.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    );
  });

  it("returns all requests for admins (no userId filter)", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findMany).mockResolvedValue([
      { id: "r1" },
      { id: "r2" },
    ] as never);

    const { GET } = await import("@/app/api/requests/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.requests).toHaveLength(2);
    expect(vi.mocked(prisma.request.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});

describe("GET /api/requests/[id]/events", () => {
  beforeEach(() => vi.resetAllMocks());

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("returns 401 with no session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { GET } = await import("@/app/api/requests/[id]/events/route");
    const res = await GET({} as never, ctx("r1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the request doesn't exist", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findUnique).mockResolvedValue(null);

    const { GET } = await import("@/app/api/requests/[id]/events/route");
    const res = await GET({} as never, ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) when a non-owner non-admin asks for someone else's request", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findUnique).mockResolvedValue({
      id: "r1",
      userId: "someone-else",
    } as never);

    const { GET } = await import("@/app/api/requests/[id]/events/route");
    const res = await GET({} as never, ctx("r1"));
    expect(res.status).toBe(404);
  });

  it("returns events for the owning user", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findUnique).mockResolvedValue({
      id: "r1",
      userId: "user-1",
    } as never);
    vi.mocked(prisma.pipelineEvent.findMany).mockResolvedValue([
      {
        id: "e1",
        event: "approved",
        detail: null,
        createdAt: new Date("2026-05-01T00:00:00Z"),
      },
    ] as never);

    const { GET } = await import("@/app/api/requests/[id]/events/route");
    const res = await GET({} as never, ctx("r1"));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.events).toHaveLength(1);
    expect(json.events[0].createdAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("allows an admin to read another user's request events", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.request.findUnique).mockResolvedValue({
      id: "r1",
      userId: "someone-else",
    } as never);
    vi.mocked(prisma.pipelineEvent.findMany).mockResolvedValue([] as never);

    const { GET } = await import("@/app/api/requests/[id]/events/route");
    const res = await GET({} as never, ctx("r1"));
    expect(res.status).toBe(200);
  });
});
