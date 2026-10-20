/**
 * Route-level tests for /api/healthz (M3 coverage push).
 *
 * Unauthenticated liveness/readiness probe. Mocks Prisma's $queryRaw and
 * each arr's health() function to exercise the ok/degraded/503 matrix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/arr/radarr", () => ({ health: vi.fn() }));
vi.mock("@/lib/arr/sonarr", () => ({ health: vi.fn() }));
vi.mock("@/lib/arr/lidarr", () => ({ health: vi.fn() }));

describe("GET /api/healthz", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    (await import("@/lib/health"))._resetReadinessCache();
  });

  it("returns 200 when db is up and at least one arr is reachable", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }] as never);
    const radarr = await import("@/lib/arr/radarr");
    const sonarr = await import("@/lib/arr/sonarr");
    const lidarr = await import("@/lib/arr/lidarr");
    vi.mocked(radarr.health).mockResolvedValue(true);
    vi.mocked(sonarr.health).mockRejectedValue(new Error("down"));
    vi.mocked(lidarr.health).mockRejectedValue(new Error("down"));

    const { GET } = await import("@/app/api/healthz/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.ok).toBe(true);
    expect(json.checks.db.ok).toBe(true);
    expect(json.reason).toBeNull();
  });

  it("returns 503 when the db is unreachable", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("SQLITE_BUSY"));
    const radarr = await import("@/lib/arr/radarr");
    const sonarr = await import("@/lib/arr/sonarr");
    const lidarr = await import("@/lib/arr/lidarr");
    vi.mocked(radarr.health).mockResolvedValue(true);
    vi.mocked(sonarr.health).mockResolvedValue(true);
    vi.mocked(lidarr.health).mockResolvedValue(true);

    const { GET } = await import("@/app/api/healthz/route");
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await (res as Response).json();
    expect(json.ok).toBe(false);
    expect(json.reason).toBe("db-unreachable");
  });

  it("returns 503 when no arr is reachable even if db is up", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }] as never);
    const radarr = await import("@/lib/arr/radarr");
    const sonarr = await import("@/lib/arr/sonarr");
    const lidarr = await import("@/lib/arr/lidarr");
    vi.mocked(radarr.health).mockRejectedValue(new Error("down"));
    vi.mocked(sonarr.health).mockRejectedValue(new Error("down"));
    vi.mocked(lidarr.health).mockRejectedValue(new Error("down"));

    const { GET } = await import("@/app/api/healthz/route");
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await (res as Response).json();
    expect(json.ok).toBe(false);
    expect(json.reason).toBe("no-arr-reachable");
  });

  it("reuses one round of *arr checks for repeated calls within 10s", async () => {
    // Public route: without the cache every hit fanned out to three *arr apps.
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }] as never);
    const radarr = await import("@/lib/arr/radarr");
    const sonarr = await import("@/lib/arr/sonarr");
    const lidarr = await import("@/lib/arr/lidarr");
    vi.mocked(radarr.health).mockResolvedValue(true);
    vi.mocked(sonarr.health).mockResolvedValue(true);
    vi.mocked(lidarr.health).mockResolvedValue(true);

    const { GET } = await import("@/app/api/healthz/route");
    await Promise.all([GET(), GET(), GET()]);
    await GET();

    expect(radarr.health).toHaveBeenCalledTimes(1);
    expect(sonarr.health).toHaveBeenCalledTimes(1);
    expect(lidarr.health).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/livez", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 when the db answers, without calling any *arr", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }] as never);
    const radarr = await import("@/lib/arr/radarr");
    const sonarr = await import("@/lib/arr/sonarr");
    const lidarr = await import("@/lib/arr/lidarr");

    const { GET } = await import("@/app/api/livez/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await (res as Response).json()).ok).toBe(true);
    expect(radarr.health).not.toHaveBeenCalled();
    expect(sonarr.health).not.toHaveBeenCalled();
    expect(lidarr.health).not.toHaveBeenCalled();
  });

  it("stays 200 when every *arr is down (Lexarr itself is fine)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }] as never);
    const radarr = await import("@/lib/arr/radarr");
    vi.mocked(radarr.health).mockRejectedValue(new Error("down"));

    const { GET } = await import("@/app/api/livez/route");
    expect((await GET()).status).toBe(200);
  });

  it("returns 503 when the db is unreachable", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("SQLITE_BUSY"));

    const { GET } = await import("@/app/api/livez/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await (res as Response).json()).ok).toBe(false);
  });
});
