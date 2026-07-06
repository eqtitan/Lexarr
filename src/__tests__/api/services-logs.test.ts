/**
 * Route-level test for /api/admin/services/[name]/logs (M2-01).
 *
 * Validates: admin gate, service-name validation against SERVICE_REGISTRY,
 * graceful "no data" response when neither cron file nor SSH is available.
 *
 * Mocks the env + container-status module at the boundary so this stays a
 * pure route-level test (the container-status logic itself is exercised
 * via manual + integration paths in the M2-01 plan).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  env: {
    NEXTAUTH_SECRET: "test",
    ARR_HOST: "http://localhost",
    RADARR_API_KEY: "test",
    SONARR_API_KEY: "test",
    LIDARR_API_KEY: "test",
    TMDB_API_KEY: "test",
  },
}));

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/arr/container-status", () => ({
  getStatus: vi.fn(),
  isSshRefreshConfigured: vi.fn(() => false),
}));

function makeReq(url: string): NextRequest {
  const u = new URL(url);
  return {
    headers: new Headers(),
    nextUrl: u,
    url: u.toString(),
  } as unknown as NextRequest;
}

const ctx = (name: string) => ({ params: Promise.resolve({ name }) });

describe("GET /api/admin/services/[name]/logs (M2-01)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", role: "user" },
      expires: "9999",
    } as never);

    const { GET } = await import(
      "@/app/api/admin/services/[name]/logs/route"
    );
    const res = await GET(
      makeReq("http://localhost/api/admin/services/Radarr/logs"),
      ctx("Radarr"),
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for unknown service names (validates against SERVICE_REGISTRY)", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", role: "admin" },
      expires: "9999",
    } as never);

    const { GET } = await import(
      "@/app/api/admin/services/[name]/logs/route"
    );
    const res = await GET(
      makeReq("http://localhost/api/admin/services/..%2Fetc%2Fpasswd/logs"),
      ctx("../etc/passwd"),
    );
    expect(res.status).toBe(404);
  });

  it("rejects unknown service even if it looks valid", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", role: "admin" },
      expires: "9999",
    } as never);

    const { GET } = await import(
      "@/app/api/admin/services/[name]/logs/route"
    );
    const res = await GET(
      makeReq("http://localhost/api/admin/services/MadeUpService/logs"),
      ctx("MadeUpService"),
    );
    expect(res.status).toBe(404);
  });

  it("returns DTO from getStatus on happy path", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", role: "admin" },
      expires: "9999",
    } as never);
    const { getStatus } = await import("@/lib/arr/container-status");
    vi.mocked(getStatus).mockResolvedValue({
      name: "radarr",
      status: "running",
      startedAt: "2026-04-25T00:00:00Z",
      uptime: "2h 15m",
      logs: ["[Info] Started"],
      asOf: "2026-04-25T02:15:00Z",
      source: "cron",
      refreshAvailable: false,
    });

    const { GET } = await import(
      "@/app/api/admin/services/[name]/logs/route"
    );
    const res = await GET(
      makeReq("http://localhost/api/admin/services/Radarr/logs"),
      ctx("Radarr"),
    );
    expect(res.status).toBe(200);
    const body = await (res as Response).json();
    expect(body.status).toBe("running");
    expect(body.uptime).toBe("2h 15m");
    expect(body.source).toBe("cron");
  });

  it("returns structured 'no data' DTO when getStatus returns null", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", role: "admin" },
      expires: "9999",
    } as never);
    const { getStatus } = await import("@/lib/arr/container-status");
    vi.mocked(getStatus).mockResolvedValue(null);

    const { GET } = await import(
      "@/app/api/admin/services/[name]/logs/route"
    );
    const res = await GET(
      makeReq("http://localhost/api/admin/services/Sonarr/logs"),
      ctx("Sonarr"),
    );
    expect(res.status).toBe(200);
    const body = await (res as Response).json();
    expect(body.source).toBe(null);
    expect(body.logs).toEqual([]);
    expect(body.refreshAvailable).toBe(false);
  });

  it("passes refresh=1 query through to getStatus", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", role: "admin" },
      expires: "9999",
    } as never);
    const { getStatus } = await import("@/lib/arr/container-status");
    vi.mocked(getStatus).mockResolvedValue({
      name: "radarr",
      status: "running",
      startedAt: null,
      uptime: null,
      logs: [],
      asOf: new Date().toISOString(),
      source: "ssh",
      refreshAvailable: true,
    });

    const { GET } = await import(
      "@/app/api/admin/services/[name]/logs/route"
    );
    await GET(
      makeReq("http://localhost/api/admin/services/Radarr/logs?refresh=1"),
      ctx("Radarr"),
    );
    expect(vi.mocked(getStatus)).toHaveBeenCalledWith(
      "radarr",
      expect.objectContaining({ refresh: true }),
    );
  });
});
