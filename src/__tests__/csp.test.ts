import { describe, it, expect } from "vitest";
import { buildCsp, newNonce } from "@/lib/csp";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";

const directive = (csp: string, name: string) =>
  csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

describe("Content-Security-Policy", () => {
  it("scripts need the nonce; no unsafe-inline or unsafe-eval in production", () => {
    const s = directive(buildCsp("abc123"), "script-src");
    expect(s).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("allows eval only in development", () => {
    expect(directive(buildCsp("n", true), "script-src")).toContain("'unsafe-eval'");
  });

  it("keeps the lockdown directives", () => {
    const csp = buildCsp("n");
    for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
      expect(csp).toContain(d);
    }
  });

  it("nonces are random and 128-bit", () => {
    const a = newNonce();
    expect(a).not.toBe(newNonce());
    expect(atob(a)).toHaveLength(16);
  });

  it("proxy puts the same fresh policy on the request (for Next.js) and the response", () => {
    const res = proxy(new NextRequest("http://lexarr.test/login"));
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    // NextResponse.next({ request: { headers } }) forwards request headers as x-middleware-request-*.
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    const again = proxy(new NextRequest("http://lexarr.test/login")).headers.get("content-security-policy");
    expect(again).not.toBe(csp);
  });
});
