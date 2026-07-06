import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { APP_VERSION } from "@/lib/version";

describe("build-info", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("falls back to 'unknown' for gitSha/buildTime when env vars are unset", async () => {
    delete process.env.GIT_SHA;
    delete process.env.BUILD_TIME;

    const { getBuildInfo } = await import("@/lib/build-info");
    const info = getBuildInfo();

    expect(info.gitSha).toBe("unknown");
    expect(info.buildTime).toBe("unknown");
  });

  it("reads gitSha/buildTime from env vars when set (as Docker build args do)", async () => {
    process.env.GIT_SHA = "abc1234";
    process.env.BUILD_TIME = "2026-07-06T12:00:00Z";

    const { getBuildInfo } = await import("@/lib/build-info");
    const info = getBuildInfo();

    expect(info.gitSha).toBe("abc1234");
    expect(info.buildTime).toBe("2026-07-06T12:00:00Z");
  });

  it("version always comes from package.json (APP_VERSION), never hardcoded", async () => {
    const { getBuildInfo } = await import("@/lib/build-info");
    expect(getBuildInfo().version).toBe(APP_VERSION);
  });
});
