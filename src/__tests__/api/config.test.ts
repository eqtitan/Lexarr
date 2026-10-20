/**
 * Route-level tests for /api/config (M3 coverage push).
 * Public, unauthenticated feature-flag endpoint — no mocks needed beyond
 * process.env, which the route reads directly.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";

describe("GET /api/config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.JELLYFIN_URL;
    delete process.env.AUTH_PLEX_ENABLED;
    delete process.env.AUTH_JELLYFIN_ENABLED;
    delete process.env.UNRAID_BASE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns nulls/defaults when nothing is configured", async () => {
    const { GET } = await import("@/app/api/config/route");
    const res = await GET();
    const json = await (res as Response).json();
    expect(json.jellyfinUrl).toBeNull();
    expect(json.plexEnabled).toBe(false);
    expect(json.jellyfinEnabled).toBe(true);
    expect(json.unraidBaseUrl).toBeNull();
  });

  it("reflects JELLYFIN_URL and unraidBaseUrl when set", async () => {
    process.env.JELLYFIN_URL = "http://jellyfin.local:8096";
    process.env.UNRAID_BASE_URL = "http://unraid.local";
    const { GET } = await import("@/app/api/config/route");
    const res = await GET();
    const json = await (res as Response).json();
    expect(json.jellyfinUrl).toBe("http://jellyfin.local:8096");
    expect(json.unraidBaseUrl).toBe("http://unraid.local");
  });

  it("enables plex when AUTH_PLEX_ENABLED=true", async () => {
    process.env.AUTH_PLEX_ENABLED = "true";
    const { GET } = await import("@/app/api/config/route");
    const res = await GET();
    const json = await (res as Response).json();
    expect(json.plexEnabled).toBe(true);
  });

  it("disables jellyfin only when AUTH_JELLYFIN_ENABLED=false", async () => {
    process.env.AUTH_JELLYFIN_ENABLED = "false";
    const { GET } = await import("@/app/api/config/route");
    const res = await GET();
    const json = await (res as Response).json();
    expect(json.jellyfinEnabled).toBe(false);
  });
});
