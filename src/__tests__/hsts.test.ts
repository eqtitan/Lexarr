import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { hstsHeader, HSTS_DEFAULT_MAX_AGE } from "@/lib/hsts";
import { proxy } from "@/proxy";

const GATEWAY = "172.18.0.1";
const KEYS = ["LEXARR_TRUSTED_PROXIES", "LEXARR_CLIENT_IP_HEADER", "LEXARR_HSTS_MAX_AGE"];

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  process.env.LEXARR_TRUSTED_PROXIES = GATEWAY;
  process.env.LEXARR_CLIENT_IP_HEADER = "1";
});

// What `tailscale serve` sends (captured on the dev server), with the peer stamp
// scripts/client-ip-preload.cjs adds.
const viaTailscale = (extra: Record<string, string> = {}) => ({
  "x-lexarr-client-ip": `::ffff:${GATEWAY}`,
  host: "server.tail0000.ts.net:8443",
  "x-forwarded-host": "server.tail0000.ts.net:8443",
  "x-forwarded-proto": "https",
  "x-forwarded-for": "100.64.0.10",
  ...extra,
});
const fromLan = (extra: Record<string, string> = {}) => ({
  "x-lexarr-client-ip": "::ffff:192.168.1.211",
  host: "192.168.1.100:5056",
  ...extra,
});

describe("Strict-Transport-Security", () => {
  it("is sent over HTTPS through the trusted proxy, 1 day by default", () => {
    expect(hstsHeader(new Headers(viaTailscale()))).toBe(`max-age=${HSTS_DEFAULT_MAX_AGE}`);
    expect(HSTS_DEFAULT_MAX_AGE).toBe(86400);
  });

  it("is never sent on the plain-HTTP LAN address", () => {
    expect(hstsHeader(new Headers(fromLan()))).toBeNull();
  });

  it("ignores a forged X-Forwarded-Proto from a LAN client", () => {
    expect(hstsHeader(new Headers(fromLan({ "x-forwarded-proto": "https" })))).toBeNull();
  });

  it("is not sent when the trusted proxy forwarded plain http", () => {
    expect(hstsHeader(new Headers(viaTailscale({ "x-forwarded-proto": "http" })))).toBeNull();
  });

  it("trusts no proxy without the peer stamp", () => {
    delete process.env.LEXARR_CLIENT_IP_HEADER;
    expect(hstsHeader(new Headers(viaTailscale()))).toBeNull();
  });

  it("LEXARR_HSTS_MAX_AGE raises it, 0 clears it, nonsense falls back, capped at 2 years", () => {
    const at = (v: string) => {
      process.env.LEXARR_HSTS_MAX_AGE = v;
      return hstsHeader(new Headers(viaTailscale()));
    };
    expect(at("31536000")).toBe("max-age=31536000");
    expect(at("0")).toBe("max-age=0");
    expect(at("-5")).toBe(`max-age=${HSTS_DEFAULT_MAX_AGE}`);
    expect(at("1.5")).toBe(`max-age=${HSTS_DEFAULT_MAX_AGE}`);
    expect(at("soon")).toBe(`max-age=${HSTS_DEFAULT_MAX_AGE}`);
    expect(at("999999999")).toBe("max-age=63072000");
  });

  it("the request proxy adds it to HTTPS responses only, beside the CSP", () => {
    const https = proxy(new NextRequest("http://lexarr.test/login", { headers: viaTailscale() }));
    expect(https.headers.get("strict-transport-security")).toBe("max-age=86400");
    expect(https.headers.get("content-security-policy")).toBeTruthy();

    const lan = proxy(new NextRequest("http://lexarr.test/login", { headers: fromLan() }));
    expect(lan.headers.get("strict-transport-security")).toBeNull();
    expect(lan.headers.get("content-security-policy")).toBeTruthy();
  });
});
