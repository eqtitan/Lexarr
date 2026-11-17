/**
 * Route-level tests for /api/auth/plex (M3 coverage push).
 *
 * The pin id is no longer client-supplied — GET resolves it server-side
 * from a session token set as an httpOnly cookie by POST. These tests
 * cover both the happy path and the vulnerability this closed: an
 * attacker who only has a (possibly guessed) pin id, but not the real
 * session cookie, must not be able to resolve someone else's pin.
 *
 * Also covers two follow-up fixes: the endpoints are fully inert (404)
 * when AUTH_PLEX_ENABLED isn't set, and the session cookie's Secure flag
 * is tied to the actual request/public-URL scheme, not NODE_ENV (Lexarr
 * normally runs in production over plain HTTP on a LAN address, where a
 * NODE_ENV-based check would silently break the whole flow).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/plex", () => ({
  createPlexPin: vi.fn(),
  checkPlexPin: vi.fn(),
  isPlexEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
  isTrustedProxyPeer: vi.fn().mockReturnValue(false),
  RATE_LIMITS: {
    general: { limit: 60, windowSeconds: 60 },
    auth: { limit: 5, windowSeconds: 60 },
  },
}));

function makePostReq(url = "http://lexarr.local/api/auth/plex"): NextRequest {
  return { nextUrl: new URL(url), headers: new Headers() } as unknown as NextRequest;
}

function makeGetReq(cookieToken?: string): NextRequest {
  return {
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        name === "lexarr_plex_pin" && cookieToken
          ? { value: cookieToken }
          : undefined,
    },
  } as unknown as NextRequest;
}

describe("POST /api/auth/plex", () => {
  const originalNextAuthUrl = process.env.NEXTAUTH_URL;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { isPlexEnabled } = await import("@/lib/auth/plex");
    vi.mocked(isPlexEnabled).mockReturnValue(true);
  });
  afterEach(() => {
    process.env.NEXTAUTH_URL = originalNextAuthUrl;
  });

  it("returns a code and auth url, but never the raw pin id", async () => {
    const { createPlexPin } = await import("@/lib/auth/plex");
    vi.mocked(createPlexPin).mockResolvedValue({ id: 123, code: "ABCD" } as never);

    const { POST } = await import("@/app/api/auth/plex/route");
    const res = await POST(makePostReq());
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.code).toBe("ABCD");
    expect(json.authUrl).toContain("ABCD");
    expect(json.pinId).toBeUndefined();
  });

  it("returns 404 and never calls Plex when AUTH_PLEX_ENABLED is off", async () => {
    const { createPlexPin, isPlexEnabled } = await import("@/lib/auth/plex");
    vi.mocked(isPlexEnabled).mockReturnValue(false);

    const { POST } = await import("@/app/api/auth/plex/route");
    const res = await POST(makePostReq());
    expect(res.status).toBe(404);
    expect(createPlexPin).not.toHaveBeenCalled();
  });

  it("sets an httpOnly session cookie scoped to this endpoint", async () => {
    const { createPlexPin } = await import("@/lib/auth/plex");
    vi.mocked(createPlexPin).mockResolvedValue({ id: 123, code: "ABCD" } as never);

    const { POST } = await import("@/app/api/auth/plex/route");
    const res = await POST(makePostReq());
    const cookie = res.cookies.get("lexarr_plex_pin");
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe("/api/auth/plex");
    expect(cookie?.value.length).toBeGreaterThanOrEqual(32);
  });

  it("does not mark the cookie Secure over a plain-HTTP request (the typical LAN deployment)", async () => {
    delete process.env.NEXTAUTH_URL;
    const { createPlexPin } = await import("@/lib/auth/plex");
    vi.mocked(createPlexPin).mockResolvedValue({ id: 123, code: "ABCD" } as never);

    const { POST } = await import("@/app/api/auth/plex/route");
    const res = await POST(makePostReq("http://192.168.1.100:5056/api/auth/plex"));
    const cookie = res.cookies.get("lexarr_plex_pin");
    expect(cookie?.secure).toBe(false);
  });

  it("marks the cookie Secure when the request itself is HTTPS", async () => {
    delete process.env.NEXTAUTH_URL;
    const { createPlexPin } = await import("@/lib/auth/plex");
    vi.mocked(createPlexPin).mockResolvedValue({ id: 123, code: "ABCD" } as never);

    const { POST } = await import("@/app/api/auth/plex/route");
    const res = await POST(makePostReq("https://lexarr.example.com/api/auth/plex"));
    const cookie = res.cookies.get("lexarr_plex_pin");
    expect(cookie?.secure).toBe(true);
  });

  it("marks the cookie Secure when NEXTAUTH_URL is https, even though this request is plain HTTP (TLS-terminating reverse proxy)", async () => {
    process.env.NEXTAUTH_URL = "https://lexarr.example.com";
    const { createPlexPin } = await import("@/lib/auth/plex");
    vi.mocked(createPlexPin).mockResolvedValue({ id: 123, code: "ABCD" } as never);

    const { POST } = await import("@/app/api/auth/plex/route");
    const res = await POST(makePostReq("http://127.0.0.1:5056/api/auth/plex"));
    const cookie = res.cookies.get("lexarr_plex_pin");
    expect(cookie?.secure).toBe(true);
  });

  it("returns 429 and never calls Plex when pin creation is rate limited", async () => {
    const { createPlexPin } = await import("@/lib/auth/plex");
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 30_000 });

    const { POST } = await import("@/app/api/auth/plex/route");
    const res = await POST(makePostReq());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(createPlexPin).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledWith(
      "plex-pin-create:127.0.0.1",
      { limit: 5, windowSeconds: 60 },
    );
  });

  it("returns 500 when Plex pin creation fails", async () => {
    const { createPlexPin } = await import("@/lib/auth/plex");
    vi.mocked(createPlexPin).mockRejectedValue(new Error("Plex unreachable"));

    const { POST } = await import("@/app/api/auth/plex/route");
    const res = await POST(makePostReq());
    expect(res.status).toBe(500);
  });
});

describe("GET /api/auth/plex", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { isPlexEnabled } = await import("@/lib/auth/plex");
    vi.mocked(isPlexEnabled).mockReturnValue(true);
  });

  it("returns 404 when AUTH_PLEX_ENABLED is off, without checking rate limits or the cookie", async () => {
    const { isPlexEnabled } = await import("@/lib/auth/plex");
    vi.mocked(isPlexEnabled).mockReturnValue(false);
    const { checkRateLimit } = await import("@/lib/rate-limit");

    const { GET } = await import("@/app/api/auth/plex/route");
    const res = await GET(makeGetReq("whatever"));
    expect(res.status).toBe(404);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("returns authenticated: false when there is no session cookie at all", async () => {
    const { GET } = await import("@/app/api/auth/plex/route");
    const res = await GET(makeGetReq(undefined));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.authenticated).toBe(false);
  });

  it("does not resolve a guessed/foreign pin id — only a valid session cookie can", async () => {
    // Regression test for the vulnerability this closed: GET used to take
    // ?pinId= straight from the query string, so an attacker could iterate
    // small integers and steal whichever other user's pin resolved next.
    const { checkPlexPin } = await import("@/lib/auth/plex");
    vi.mocked(checkPlexPin).mockResolvedValue("victims-plex-token");

    const { GET } = await import("@/app/api/auth/plex/route");
    // No real session established — this attacker never completed a POST,
    // so they have no valid cookie, regardless of what pin id they might
    // try to guess via a query string (which the route no longer reads).
    const res = await GET(makeGetReq("totally-made-up-token-not-in-cache"));
    const json = await (res as Response).json();
    expect(json.authenticated).toBe(false);
    expect(json.plexToken).toBeUndefined();
    expect(checkPlexPin).not.toHaveBeenCalled();
  });

  it("returns authenticated: false when the pin isn't authorized yet", async () => {
    const { createPlexPin, checkPlexPin } = await import("@/lib/auth/plex");
    vi.mocked(createPlexPin).mockResolvedValue({ id: 123, code: "ABCD" } as never);
    vi.mocked(checkPlexPin).mockResolvedValue(null);

    const { POST, GET } = await import("@/app/api/auth/plex/route");
    const postRes = await POST(makePostReq());
    const token = postRes.cookies.get("lexarr_plex_pin")?.value;

    const res = await GET(makeGetReq(token));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.authenticated).toBe(false);
  });

  it("resolves the real pin id server-side from the session cookie and returns the token", async () => {
    const { createPlexPin, checkPlexPin } = await import("@/lib/auth/plex");
    vi.mocked(createPlexPin).mockResolvedValue({ id: 123, code: "ABCD" } as never);
    vi.mocked(checkPlexPin).mockResolvedValue("plex-token-abc");

    const { POST, GET } = await import("@/app/api/auth/plex/route");
    const postRes = await POST(makePostReq());
    const token = postRes.cookies.get("lexarr_plex_pin")?.value as string;

    const res = await GET(makeGetReq(token));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.authenticated).toBe(true);
    expect(json.plexToken).toBe("plex-token-abc");
    expect(vi.mocked(checkPlexPin)).toHaveBeenCalledWith(123);
  });

  it("is one-shot: the same session token cannot resolve a second time", async () => {
    const { createPlexPin, checkPlexPin } = await import("@/lib/auth/plex");
    vi.mocked(createPlexPin).mockResolvedValue({ id: 123, code: "ABCD" } as never);
    vi.mocked(checkPlexPin).mockResolvedValue("plex-token-abc");

    const { POST, GET } = await import("@/app/api/auth/plex/route");
    const postRes = await POST(makePostReq());
    const token = postRes.cookies.get("lexarr_plex_pin")?.value as string;

    const first = await (await GET(makeGetReq(token))).json();
    expect(first.authenticated).toBe(true);

    const second = await (await GET(makeGetReq(token))).json();
    expect(second.authenticated).toBe(false);
  });

  it("returns 429 when rate limited", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() });

    const { GET } = await import("@/app/api/auth/plex/route");
    const res = await GET(makeGetReq("whatever"));
    expect(res.status).toBe(429);
  });
});
