/**
 * Route-level tests for /api/music-preview (M3 coverage push).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn().mockReturnValue("10.0.0.1"),
  RATE_LIMITS: { search: { limit: 30, windowSeconds: 60 } },
}));

vi.mock("@/lib/cache", () => ({
  libraryCache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("@/lib/search/music-preview", () => ({
  findMusicPreview: vi.fn(),
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

const validUrl =
  "http://localhost/api/music-preview?mbid=b84ac3c9-9c17-4370-b7e2-df91769c0e18&artist=Radiohead&title=Paranoid+Android";

describe("GET /api/music-preview", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 29,
      resetAt: Date.now(),
    });
    const { libraryCache } = await import("@/lib/cache");
    vi.mocked(libraryCache.get).mockReturnValue(undefined);
  });

  it("returns 401 with no session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { GET } = await import("@/app/api/music-preview/route");
    const res = await GET(makeReq(validUrl));
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate-limited", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const rl = await import("@/lib/rate-limit");
    vi.mocked(rl.checkRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now(),
    });

    const { GET } = await import("@/app/api/music-preview/route");
    const res = await GET(makeReq(validUrl));
    expect(res.status).toBe(429);
  });

  it("returns 400 when mbid/artist/title are missing", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/music-preview/route");
    const res = await GET(
      makeReq("http://localhost/api/music-preview?artist=Radiohead"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed mbid", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/music-preview/route");
    const res = await GET(
      makeReq(
        "http://localhost/api/music-preview?mbid=not-a-uuid&artist=Radiohead&title=Song",
      ),
    );
    expect(res.status).toBe(400);
  });

  it("returns a cached preview without calling findMusicPreview", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { libraryCache } = await import("@/lib/cache");
    vi.mocked(libraryCache.get).mockReturnValue({ url: "cached-url" });
    const { findMusicPreview } = await import("@/lib/search/music-preview");

    const { GET } = await import("@/app/api/music-preview/route");
    const res = await GET(makeReq(validUrl));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.cached).toBe(true);
    expect(json.preview.url).toBe("cached-url");
    expect(vi.mocked(findMusicPreview)).not.toHaveBeenCalled();
  });

  it("fetches, caches, and returns a fresh preview", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { findMusicPreview } = await import("@/lib/search/music-preview");
    vi.mocked(findMusicPreview).mockResolvedValue({
      url: "https://preview.example/track.mp3",
      source: "itunes",
      trackName: "Paranoid Android",
      artistName: "Radiohead",
    });
    const { libraryCache } = await import("@/lib/cache");

    const { GET } = await import("@/app/api/music-preview/route");
    const res = await GET(makeReq(validUrl));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.preview.url).toBe("https://preview.example/track.mp3");
    expect(vi.mocked(libraryCache.set)).toHaveBeenCalledWith(
      "preview:b84ac3c9-9c17-4370-b7e2-df91769c0e18",
      json.preview,
    );
  });

  it("caches a null preview (miss) too", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);
    const { findMusicPreview } = await import("@/lib/search/music-preview");
    vi.mocked(findMusicPreview).mockResolvedValue(null);
    const { libraryCache } = await import("@/lib/cache");

    const { GET } = await import("@/app/api/music-preview/route");
    const res = await GET(makeReq(validUrl));
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.preview).toBeNull();
    expect(vi.mocked(libraryCache.set)).toHaveBeenCalledWith(
      "preview:b84ac3c9-9c17-4370-b7e2-df91769c0e18",
      null,
    );
  });
});
