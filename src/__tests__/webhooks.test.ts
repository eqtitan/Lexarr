import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Mock dependencies before importing routes
vi.mock("@/lib/status-checker", () => ({
  checkSingleRequest: vi.fn().mockResolvedValue(true),
}));

// P-09: webhook routes now read the secret from the validated env module,
// which Zod-validates at module load. Mock the env so tests don't need the
// full required env-var set.
vi.mock("@/lib/env", () => ({
  get env() {
    return {
      LEXARR_WEBHOOK_SECRET: process.env.LEXARR_WEBHOOK_SECRET,
      NEXTAUTH_SECRET: "test",
      ARR_HOST: "http://localhost",
      RADARR_API_KEY: "test",
      SONARR_API_KEY: "test",
      LIDARR_API_KEY: "test",
      TMDB_API_KEY: "test",
    };
  },
}));

describe("Webhook Token Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("when LEXARR_WEBHOOK_SECRET is set", () => {
    it("rejects requests without a token", async () => {
      process.env.LEXARR_WEBHOOK_SECRET = "test-secret-123";
      const { POST } = await import(
        "@/app/api/webhooks/radarr/route"
      );

      const req = new Request("http://localhost/api/webhooks/radarr", {
        method: "POST",
        body: JSON.stringify({ eventType: "Download", movie: { id: 1 } }),
        headers: { "Content-Type": "application/json" },
      });

      // NextRequest needs URL with searchParams
      const url = new URL("http://localhost/api/webhooks/radarr");
      const nextReq = {
        nextUrl: url,
        json: () => req.json(),
      };

      const res = await POST(nextReq as unknown as NextRequest);
      expect(res.status).toBe(401);
    });

    it("rejects requests with wrong token", async () => {
      process.env.LEXARR_WEBHOOK_SECRET = "test-secret-123";
      const { POST } = await import(
        "@/app/api/webhooks/radarr/route"
      );

      const url = new URL(
        "http://localhost/api/webhooks/radarr?token=wrong-token",
      );
      const nextReq = {
        nextUrl: url,
        json: () =>
          Promise.resolve({
            eventType: "Download",
            movie: { id: 1 },
          }),
      };

      const res = await POST(nextReq as unknown as NextRequest);
      expect(res.status).toBe(401);
    });

    it("accepts requests with correct token", async () => {
      process.env.LEXARR_WEBHOOK_SECRET = "test-secret-123";
      const { POST } = await import(
        "@/app/api/webhooks/radarr/route"
      );

      const url = new URL(
        "http://localhost/api/webhooks/radarr?token=test-secret-123",
      );
      const nextReq = {
        nextUrl: url,
        json: () =>
          Promise.resolve({
            eventType: "Download",
            movie: { id: 1 },
          }),
      };

      const res = await POST(nextReq as unknown as NextRequest);
      expect(res.status).toBe(200);
    });
  });

  describe("when LEXARR_WEBHOOK_SECRET is not set", () => {
    it("rejects all requests (secure by default)", async () => {
      delete process.env.LEXARR_WEBHOOK_SECRET;
      const { POST } = await import(
        "@/app/api/webhooks/radarr/route"
      );

      const url = new URL("http://localhost/api/webhooks/radarr");
      const nextReq = {
        nextUrl: url,
        json: () =>
          Promise.resolve({
            eventType: "Download",
            movie: { id: 1 },
          }),
      };

      const res = await POST(nextReq as unknown as NextRequest);
      expect(res.status).toBe(401);
    });
  });
});

/**
 * M3 coverage push: sonarr/lidarr had 0% route coverage and radarr was
 * missing its event-skip / missing-id / error paths. These three routes
 * are near-identical (see route source) so the test shape mirrors across
 * media types intentionally.
 */
function makeWebhookReq(url: string, body: unknown): NextRequest {
  const u = new URL(url);
  return {
    nextUrl: u,
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

describe("Webhook routes — event handling (M3)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv, LEXARR_WEBHOOK_SECRET: "test-secret-123" };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("radarr", () => {
    it("skips events that aren't Download/MovieFileImported/Upgrade", async () => {
      const { POST } = await import("@/app/api/webhooks/radarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/radarr?token=test-secret-123",
          { eventType: "Test", movie: { id: 1 } },
        ),
      );
      expect(res.status).toBe(200);
      const json = await (res as Response).json();
      expect(json).toEqual({ ok: true, skipped: "Test" });
    });

    it("skips when the payload has no movie id", async () => {
      const { POST } = await import("@/app/api/webhooks/radarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/radarr?token=test-secret-123",
          { eventType: "Download" },
        ),
      );
      expect(res.status).toBe(200);
      const json = await (res as Response).json();
      expect(json).toEqual({ ok: true, skipped: "no movie id" });
    });

    it("calls checkSingleRequest and returns 200 on a valid import event", async () => {
      const { checkSingleRequest } = await import("@/lib/status-checker");
      vi.mocked(checkSingleRequest).mockResolvedValue(true);

      const { POST } = await import("@/app/api/webhooks/radarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/radarr?token=test-secret-123",
          { eventType: "MovieFileImported", movie: { id: 42 } },
        ),
      );
      expect(res.status).toBe(200);
      const json = await (res as Response).json();
      expect(json).toEqual({ ok: true, updated: true });
      expect(vi.mocked(checkSingleRequest)).toHaveBeenCalledWith("movie", 42);
    });

    it("returns 500 when checkSingleRequest throws", async () => {
      const { checkSingleRequest } = await import("@/lib/status-checker");
      vi.mocked(checkSingleRequest).mockRejectedValue(new Error("db down"));

      const { POST } = await import("@/app/api/webhooks/radarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/radarr?token=test-secret-123",
          { eventType: "Upgrade", movie: { id: 42 } },
        ),
      );
      expect(res.status).toBe(500);
      const json = await (res as Response).json();
      expect(json.error).toBe("db down");
    });
  });

  describe("sonarr", () => {
    it("rejects requests with an invalid token", async () => {
      const { POST } = await import("@/app/api/webhooks/sonarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/sonarr?token=wrong",
          { eventType: "Download", series: { id: 1 } },
        ),
      );
      expect(res.status).toBe(401);
    });

    it("skips events that aren't Download/EpisodeFileImported/Upgrade", async () => {
      const { POST } = await import("@/app/api/webhooks/sonarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/sonarr?token=test-secret-123",
          { eventType: "Test", series: { id: 1 } },
        ),
      );
      expect(res.status).toBe(200);
      const json = await (res as Response).json();
      expect(json).toEqual({ ok: true, skipped: "Test" });
    });

    it("skips when the payload has no series id", async () => {
      const { POST } = await import("@/app/api/webhooks/sonarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/sonarr?token=test-secret-123",
          { eventType: "EpisodeFileImported" },
        ),
      );
      expect(res.status).toBe(200);
      const json = await (res as Response).json();
      expect(json).toEqual({ ok: true, skipped: "no series id" });
    });

    it("calls checkSingleRequest with mediaType tv on a valid import event", async () => {
      const { checkSingleRequest } = await import("@/lib/status-checker");
      vi.mocked(checkSingleRequest).mockResolvedValue(true);

      const { POST } = await import("@/app/api/webhooks/sonarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/sonarr?token=test-secret-123",
          { eventType: "EpisodeFileImported", series: { id: 7 } },
        ),
      );
      expect(res.status).toBe(200);
      const json = await (res as Response).json();
      expect(json).toEqual({ ok: true, updated: true });
      expect(vi.mocked(checkSingleRequest)).toHaveBeenCalledWith("tv", 7);
    });

    it("returns 500 when checkSingleRequest throws", async () => {
      const { checkSingleRequest } = await import("@/lib/status-checker");
      vi.mocked(checkSingleRequest).mockRejectedValue(new Error("timeout"));

      const { POST } = await import("@/app/api/webhooks/sonarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/sonarr?token=test-secret-123",
          { eventType: "Download", series: { id: 7 } },
        ),
      );
      expect(res.status).toBe(500);
      const json = await (res as Response).json();
      expect(json.error).toBe("timeout");
    });
  });

  describe("lidarr", () => {
    it("rejects requests with an invalid token", async () => {
      const { POST } = await import("@/app/api/webhooks/lidarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/lidarr?token=wrong",
          { eventType: "Download", artist: { id: 1 } },
        ),
      );
      expect(res.status).toBe(401);
    });

    it("skips events that aren't Download/TrackFileImported/Upgrade", async () => {
      const { POST } = await import("@/app/api/webhooks/lidarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/lidarr?token=test-secret-123",
          { eventType: "Test", artist: { id: 1 } },
        ),
      );
      expect(res.status).toBe(200);
      const json = await (res as Response).json();
      expect(json).toEqual({ ok: true, skipped: "Test" });
    });

    it("skips when the payload has no artist id", async () => {
      const { POST } = await import("@/app/api/webhooks/lidarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/lidarr?token=test-secret-123",
          { eventType: "TrackFileImported" },
        ),
      );
      expect(res.status).toBe(200);
      const json = await (res as Response).json();
      expect(json).toEqual({ ok: true, skipped: "no artist id" });
    });

    it("calls checkSingleRequest with mediaType music on a valid import event", async () => {
      const { checkSingleRequest } = await import("@/lib/status-checker");
      vi.mocked(checkSingleRequest).mockResolvedValue(true);

      const { POST } = await import("@/app/api/webhooks/lidarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/lidarr?token=test-secret-123",
          { eventType: "TrackFileImported", artist: { id: 9 } },
        ),
      );
      expect(res.status).toBe(200);
      const json = await (res as Response).json();
      expect(json).toEqual({ ok: true, updated: true });
      expect(vi.mocked(checkSingleRequest)).toHaveBeenCalledWith("music", 9);
    });

    it("returns 500 when checkSingleRequest throws", async () => {
      const { checkSingleRequest } = await import("@/lib/status-checker");
      vi.mocked(checkSingleRequest).mockRejectedValue(new Error("lidarr unreachable"));

      const { POST } = await import("@/app/api/webhooks/lidarr/route");
      const res = await POST(
        makeWebhookReq(
          "http://localhost/api/webhooks/lidarr?token=test-secret-123",
          { eventType: "Upgrade", artist: { id: 9 } },
        ),
      );
      expect(res.status).toBe(500);
      const json = await (res as Response).json();
      expect(json.error).toBe("lidarr unreachable");
    });
  });
});
