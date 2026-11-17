import { describe, it, expect, beforeEach } from "vitest";
import { pickPublicOrigin, publicOrigins } from "@/lib/public-origin";

const LAN = "http://192.168.1.100:5056";
const TS = "https://server.tail0000.ts.net:8443";
const GATEWAY = "172.18.0.1";
const KEYS = ["LEXARR_PUBLIC_URLS", "NEXTAUTH_URL", "LEXARR_TRUSTED_PROXIES", "LEXARR_CLIENT_IP_HEADER"];

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  process.env.LEXARR_PUBLIC_URLS = `${LAN}, ${TS}/`;
  process.env.LEXARR_TRUSTED_PROXIES = GATEWAY;
  process.env.LEXARR_CLIENT_IP_HEADER = "1";
});

// What `tailscale serve` sends (captured on the dev server), with the peer stamp
// scripts/client-ip-preload.cjs adds.
const viaTailscale = (extra: Record<string, string> = {}) =>
  new Headers({
    "x-lexarr-client-ip": `::ffff:${GATEWAY}`,
    host: "server.tail0000.ts.net:8443",
    "x-forwarded-host": "server.tail0000.ts.net:8443",
    "x-forwarded-proto": "https",
    "x-forwarded-for": "100.64.0.10",
    ...extra,
  });
const fromLan = (extra: Record<string, string> = {}) =>
  new Headers({ "x-lexarr-client-ip": "::ffff:192.168.1.211", host: "192.168.1.100:5056", ...extra });

describe("pickPublicOrigin", () => {
  it("keeps LAN visitors on the LAN address", () => {
    expect(pickPublicOrigin(fromLan())).toBe(LAN);
  });

  it("keeps Tailscale visitors on the https tailnet address", () => {
    expect(pickPublicOrigin(viaTailscale())).toBe(TS);
  });

  it("ignores forwarded scheme and host from anyone but the trusted proxy", () => {
    const forged = fromLan({ "x-forwarded-proto": "https", "x-forwarded-host": "server.tail0000.ts.net:8443" });
    expect(pickPublicOrigin(forged)).toBe(LAN);
  });

  it("never returns an address that isn't listed (Host header injection)", () => {
    expect(pickPublicOrigin(fromLan({ host: "evil.example" }))).toBe(LAN);
    expect(pickPublicOrigin(viaTailscale({ "x-forwarded-host": "evil.example" }))).toBe(LAN);
    // Listed host, wrong scheme for it: still not a listed origin.
    expect(pickPublicOrigin(fromLan({ host: "server.tail0000.ts.net:8443" }))).toBe(LAN);
  });

  it("trusts no proxy when the peer stamp isn't present", () => {
    delete process.env.LEXARR_CLIENT_IP_HEADER;
    expect(pickPublicOrigin(viaTailscale())).toBe(LAN);
  });

  it("falls back to NEXTAUTH_URL alone, and to nothing", () => {
    delete process.env.LEXARR_PUBLIC_URLS;
    process.env.NEXTAUTH_URL = `${LAN}/`;
    expect(publicOrigins()).toEqual([LAN]);
    expect(pickPublicOrigin(viaTailscale())).toBe(LAN);
    delete process.env.NEXTAUTH_URL;
    expect(pickPublicOrigin(fromLan())).toBeNull();
  });

  it("drops malformed and non-http entries", () => {
    process.env.LEXARR_PUBLIC_URLS = `not a url, javascript:alert(1), ${LAN}`;
    expect(publicOrigins()).toEqual([LAN]);
  });
});
