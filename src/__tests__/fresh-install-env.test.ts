/**
 * A fresh install copies .env.example to .env and fills in only the README
 * minimum. Every other line stays `KEY=`, which Docker passes through as "".
 * Those must count as unset, and services must default to ARR_HOST.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { env, validateEnvOrThrow } from "@/lib/env";
import { serviceUrls } from "@/lib/arr/urls";
import { SERVICE_REGISTRY } from "@/lib/dashboard/services";

const original = { ...process.env };

/** .env.example as Docker's --env-file would load it: KEY=value lines, "" for empty. */
function exampleEnv(): Record<string, string> {
  const text = fs.readFileSync(path.resolve(__dirname, "../../.env.example"), "utf8");
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

beforeEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, { NODE_ENV: "test" }, exampleEnv(), {
    // The README's minimum.
    NEXTAUTH_SECRET: "fresh-install-secret",
    NEXTAUTH_URL: "http://192.168.1.100:5056",
    ARR_HOST: "http://192.168.1.100",
    RADARR_API_KEY: "r",
    SONARR_API_KEY: "s",
    LIDARR_API_KEY: "l",
    TMDB_API_KEY: "t",
    LEXARR_WEBHOOK_SECRET: "w",
  });
});

afterAll(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, original);
});

describe("fresh install from .env.example", () => {
  it("passes startup validation with the empty lines left as they are", () => {
    expect(process.env.BOOTSTRAP_ADMIN_PASSWORD).toBe("");
    expect(() => validateEnvOrThrow()).not.toThrow();
  });

  it("treats an empty value as unset", () => {
    expect(env().BOOTSTRAP_ADMIN_PASSWORD).toBeUndefined();
    expect(env().JELLYFIN_URL).toBeUndefined();
  });

  it("still rejects a value that is set but invalid", () => {
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "abc";
    expect(() => validateEnvOrThrow()).toThrow(/BOOTSTRAP_ADMIN_PASSWORD/);
  });

  it("puts every service on ARR_HOST unless its own URL is set", () => {
    expect(serviceUrls.radarr()).toBe("http://192.168.1.100:7878");
    expect(serviceUrls.lazylibrarian()).toBe("http://192.168.1.100:5299");
    expect(serviceUrls.bazarr()).toBe("http://192.168.1.100:6767");
    expect(serviceUrls.qbittorrent()).toBe("http://192.168.1.100:8080");
    expect(serviceUrls.nzbget()).toBe("http://192.168.1.100:6789");
    expect(serviceUrls.jellyfin()).toBe("http://192.168.1.100:8096");
    process.env.JELLYFIN_URL = "http://media.lan:8096";
    expect(serviceUrls.jellyfin()).toBe("http://media.lan:8096");
  });

  it("dashboard links use the same addresses, never a placeholder", () => {
    const urls = SERVICE_REGISTRY.map((s) => s.url);
    expect(urls).toHaveLength(9);
    for (const u of urls) expect(u).toMatch(/^http:\/\/192\.168\.1\.100:\d+$/);
  });
});
