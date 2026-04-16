import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Environment Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("passes when all required vars are set", async () => {
    process.env.NEXTAUTH_SECRET = "test";
    process.env.ARR_HOST = "http://localhost";
    process.env.RADARR_API_KEY = "test";
    process.env.SONARR_API_KEY = "test";
    process.env.LIDARR_API_KEY = "test";
    process.env.TMDB_API_KEY = "test";

    await expect(import("@/lib/env")).resolves.not.toThrow();
  });

  it("throws when NEXTAUTH_SECRET is missing", async () => {
    delete process.env.NEXTAUTH_SECRET;
    process.env.ARR_HOST = "http://localhost";
    process.env.RADARR_API_KEY = "test";
    process.env.SONARR_API_KEY = "test";
    process.env.LIDARR_API_KEY = "test";
    process.env.TMDB_API_KEY = "test";

    await expect(import("@/lib/env")).rejects.toThrow(
      "Environment validation failed",
    );
  });
});
