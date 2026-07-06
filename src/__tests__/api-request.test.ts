/**
 * Route-level test for /api/request POST (P-07).
 *
 * Targets the highest-risk user-facing route: creates DB rows, calls *arr,
 * was just refactored in P-03 (dedupe transaction). Mocks the service
 * layer so the test exercises the route's own auth + rate-limit + input
 * validation + status-code mapping behavior, not the underlying tx.
 *
 * The dedupe-tx itself is exercised in src/lib/services/request.ts —
 * unit-testing the tx requires a real DB and is parked for the post-1.0.0
 * coverage push.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { NextRequest } from "next/server";

// Mock the env module so the route import doesn't trip Zod validation
vi.mock("@/lib/env", () => ({
  env: {
    NEXTAUTH_SECRET: "test",
    ARR_HOST: "http://localhost",
    RADARR_API_KEY: "test",
    SONARR_API_KEY: "test",
    LIDARR_API_KEY: "test",
    TMDB_API_KEY: "test",
    LEXARR_WEBHOOK_SECRET: "test",
  },
}));

// Mock auth so each test can set the session shape
vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

// Mock rate-limit so we can flip allowed/denied
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() }),
  getClientIp: vi.fn().mockReturnValue("10.0.0.1"),
  RATE_LIMITS: {
    request: { limit: 10, windowSeconds: 60 },
  },
}));

// Mock createRequest — the service layer is exercised separately
vi.mock("@/lib/services/request", () => ({
  createRequest: vi.fn(),
}));

function makeReq(body: Record<string, unknown>): NextRequest {
  return {
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

const validBody = {
  mediaType: "movie" as const,
  externalId: "157336",
  title: "Interstellar",
  year: "2014",
};

describe("POST /api/request (P-07 route-level)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns 401 when there is no session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);
    // Reset rate-limit + getClientIp to default allowed
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() });
    vi.mocked(rl.getClientIp).mockReturnValue("10.0.0.1");

    const { POST } = await import("@/app/api/request/route");
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate-limited", async () => {
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() });
    vi.mocked(rl.getClientIp).mockReturnValue("10.0.0.1");

    const { POST } = await import("@/app/api/request/route");
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(429);
  });

  it("returns 200 + request on success", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", role: "user", autoApprove: false },
      expires: "9999",
    } as never);
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() });
    vi.mocked(rl.getClientIp).mockReturnValue("10.0.0.1");
    const { createRequest } = await import("@/lib/services/request");
    vi.mocked(createRequest).mockResolvedValue({
      ok: true,
      request: { id: "req-1", title: "Interstellar" } as never,
    });

    const { POST } = await import("@/app/api/request/route");
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.request.id).toBe("req-1");
  });

  it("returns 409 with the existing request when service reports duplicate", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", role: "user", autoApprove: false },
      expires: "9999",
    } as never);
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() });
    vi.mocked(rl.getClientIp).mockReturnValue("10.0.0.1");
    const { createRequest } = await import("@/lib/services/request");
    vi.mocked(createRequest).mockResolvedValue({
      ok: false,
      status: 409,
      error: "Already requested",
      request: { id: "req-existing", title: "Interstellar" } as never,
    });

    const { POST } = await import("@/app/api/request/route");
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(409);
    const json = await (res as Response).json();
    expect(json.error).toBe("Already requested");
    expect(json.request.id).toBe("req-existing");
  });

  it("returns 400 when service reports validation error", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", role: "user", autoApprove: false },
      expires: "9999",
    } as never);
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() });
    vi.mocked(rl.getClientIp).mockReturnValue("10.0.0.1");
    const { createRequest } = await import("@/lib/services/request");
    vi.mocked(createRequest).mockResolvedValue({
      ok: false,
      status: 400,
      error: "Missing required fields",
    });

    const { POST } = await import("@/app/api/request/route");
    const res = await POST(makeReq({ mediaType: "movie" }));
    expect(res.status).toBe(400);
  });
});
