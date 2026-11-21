import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const REQUIRED = {
  NEXTAUTH_SECRET: "s",
  ARR_HOST: "http://localhost",
  RADARR_API_KEY: "r",
  SONARR_API_KEY: "s",
  LIDARR_API_KEY: "l",
  TMDB_API_KEY: "t",
};
const req = (path: string) => new NextRequest(`http://lexarr.test${path}`);

describe("proxy in setup-needed mode", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original, ...REQUIRED };
  });
  afterAll(() => {
    process.env = original;
  });

  it("passes everything through when configured", () => {
    expect(proxy(req("/")).status).toBe(200);
    expect(proxy(req("/api/search")).status).toBe(200);
  });

  describe("with a required variable missing", () => {
    beforeEach(() => {
      delete process.env.SONARR_API_KEY;
    });

    it("redirects pages to /setup-needed", () => {
      const res = proxy(req("/admin"));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/setup-needed");
    });

    it("answers APIs with 503 and variable names only", async () => {
      const res = proxy(req("/api/search"));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "setup_needed", missing: ["SONARR_API_KEY"] });
    });

    it("still serves the setup page and the liveness and version probes", () => {
      for (const p of ["/setup-needed", "/api/livez", "/api/version"]) {
        expect(proxy(req(p)).status).toBe(200);
      }
    });
  });
});
