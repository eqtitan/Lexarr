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
