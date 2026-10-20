/**
 * The NextAuth catch-all route previously had zero rate limiting on any
 * login path — the credentials provider's bcrypt check and the Jellyfin
 * password proxy were both brute-forceable. These tests cover the
 * callback-path gate added in src/app/api/auth/[...nextauth]/route.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  handlers: {
    GET: vi.fn(),
    POST: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
  RATE_LIMITS: { auth: { limit: 5, windowSeconds: 60 } },
}));

function makeReq(pathname: string): NextRequest {
  return {
    nextUrl: new URL(`http://localhost${pathname}`),
    headers: new Headers(),
  } as unknown as NextRequest;
}

describe("POST /api/auth/[...nextauth]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rate-limits the credentials callback path", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() });
    const { handlers } = await import("@/lib/auth/config");

    const { POST } = await import("@/app/api/auth/[...nextauth]/route");
    const res = await POST(makeReq("/api/auth/callback/credentials"));

    expect(res.status).toBe(429);
    expect(handlers.POST).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledWith("auth:127.0.0.1", { limit: 5, windowSeconds: 60 });
  });

  it("rate-limits the jellyfin callback path the same way", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() });

    const { POST } = await import("@/app/api/auth/[...nextauth]/route");
    const res = await POST(makeReq("/api/auth/callback/jellyfin"));
    expect(res.status).toBe(429);
  });

  it("does not rate-limit non-callback paths (csrf, session, signin)", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const { handlers } = await import("@/lib/auth/config");

    const { POST } = await import("@/app/api/auth/[...nextauth]/route");
    await POST(makeReq("/api/auth/signin"));

    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(handlers.POST).toHaveBeenCalledTimes(1);
  });

  it("delegates to the real handler once under the rate limit", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() });
    const { handlers } = await import("@/lib/auth/config");

    const { POST } = await import("@/app/api/auth/[...nextauth]/route");
    const res = await POST(makeReq("/api/auth/callback/plex"));

    expect(res.status).toBe(200);
    expect(handlers.POST).toHaveBeenCalledTimes(1);
  });
});
