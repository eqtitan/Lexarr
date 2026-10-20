import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { env, validateEnvOrThrow } from "@/lib/env";

const REQUIRED = {
  NEXTAUTH_SECRET: "test",
  ARR_HOST: "http://localhost",
  RADARR_API_KEY: "test",
  SONARR_API_KEY: "test",
  LIDARR_API_KEY: "test",
  TMDB_API_KEY: "test",
};

describe("Environment validation (startup)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED };
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("passes when all required vars are set", () => {
    expect(() => validateEnvOrThrow()).not.toThrow();
  });

  it("throws, naming the variable, when NEXTAUTH_SECRET is missing", () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(() => validateEnvOrThrow()).toThrow(/Environment validation failed[\s\S]*NEXTAUTH_SECRET/);
  });

  it("warns when LEXARR_WEBHOOK_SECRET is unset", () => {
    delete process.env.LEXARR_WEBHOOK_SECRET;
    validateEnvOrThrow();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("LEXARR_WEBHOOK_SECRET"));
  });
});

describe("env() accessor", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("reads values at call time, not at import", () => {
    process.env.JELLYFIN_URL = "http://first:8096";
    expect(env().JELLYFIN_URL).toBe("http://first:8096");
    process.env.JELLYFIN_URL = "http://second:8096";
    expect(env().JELLYFIN_URL).toBe("http://second:8096");
  });

  it("never throws on invalid config (startup validation is the fail-fast path)", () => {
    delete process.env.NEXTAUTH_SECRET;
    process.env.RADARR_API_KEY = "still-readable";
    expect(() => env()).not.toThrow();
    expect(env().RADARR_API_KEY).toBe("still-readable");
  });
});
