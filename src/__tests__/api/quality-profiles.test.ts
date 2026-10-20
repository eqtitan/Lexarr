/**
 * Route-level tests for /api/quality-profiles (M3 coverage push).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn().mockReturnValue("10.0.0.1"),
  RATE_LIMITS: { general: { limit: 60, windowSeconds: 60 } },
}));

vi.mock("@/lib/cache", () => ({
  searchCache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("@/lib/arr/radarr", () => ({
  getQualityProfiles: vi.fn(),
}));
vi.mock("@/lib/arr/sonarr", () => ({
  getQualityProfiles: vi.fn(),
}));

function makeReq(url: string): NextRequest {
  const u = new URL(url);
  return {
    headers: new Headers(),
    nextUrl: u,
  } as unknown as NextRequest;
}

const userSession = {
  user: { id: "user-1", name: "User", role: "user" },
  expires: "9999",
};

describe("GET /api/quality-profiles", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetAt: Date.now(),
    });
    const { searchCache } = await import("@/lib/cache");
    vi.mocked(searchCache.get).mockReturnValue(undefined);
  });

  it("returns 429 when rate-limited", async () => {
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now(),
    });

    const { GET } = await import("@/app/api/quality-profiles/route");
    const res = await GET(
      makeReq("http://localhost/api/quality-profiles?type=movie"),
    );
    expect(res.status).toBe(429);
  });

  it("returns 401 with no session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { GET } = await import("@/app/api/quality-profiles/route");
    const res = await GET(
      makeReq("http://localhost/api/quality-profiles?type=movie"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid type", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/quality-profiles/route");
    const res = await GET(
      makeReq("http://localhost/api/quality-profiles?type=music"),
    );
    expect(res.status).toBe(400);
  });

  it("returns a cached response without calling the arr", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { searchCache } = await import("@/lib/cache");
    vi.mocked(searchCache.get).mockReturnValue([{ id: 1, name: "HD-1080p" }]);
    const radarr = await import("@/lib/arr/radarr");

    const { GET } = await import("@/app/api/quality-profiles/route");
    const res = await GET(
      makeReq("http://localhost/api/quality-profiles?type=movie"),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json).toEqual([{ id: 1, name: "HD-1080p" }]);
    expect(vi.mocked(radarr.getQualityProfiles)).not.toHaveBeenCalled();
  });

  it("fetches from radarr for type=movie and caches the slim result", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const radarr = await import("@/lib/arr/radarr");
    vi.mocked(radarr.getQualityProfiles).mockResolvedValue([
      { id: 1, name: "HD-1080p", extra: "ignored" } as never,
    ]);
    const { searchCache } = await import("@/lib/cache");

    const { GET } = await import("@/app/api/quality-profiles/route");
    const res = await GET(
      makeReq("http://localhost/api/quality-profiles?type=movie"),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json).toEqual([{ id: 1, name: "HD-1080p" }]);
    expect(vi.mocked(searchCache.set)).toHaveBeenCalledWith(
      "quality-profiles:movie",
      [{ id: 1, name: "HD-1080p" }],
      expect.any(Number),
    );
  });

  it("fetches from sonarr for type=tv", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const sonarr = await import("@/lib/arr/sonarr");
    vi.mocked(sonarr.getQualityProfiles).mockResolvedValue([
      { id: 2, name: "Any" },
    ]);

    const { GET } = await import("@/app/api/quality-profiles/route");
    const res = await GET(
      makeReq("http://localhost/api/quality-profiles?type=tv"),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json).toEqual([{ id: 2, name: "Any" }]);
  });

  it("returns 502 when the arr call fails", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const radarr = await import("@/lib/arr/radarr");
    vi.mocked(radarr.getQualityProfiles).mockRejectedValue(new Error("timeout"));

    const { GET } = await import("@/app/api/quality-profiles/route");
    const res = await GET(
      makeReq("http://localhost/api/quality-profiles?type=movie"),
    );
    expect(res.status).toBe(502);
  });
});
