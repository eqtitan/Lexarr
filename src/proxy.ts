import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "@/lib/csp";
import { hstsHeader } from "@/lib/hsts";

/**
 * Per-request Content-Security-Policy with a script nonce (src/lib/csp.ts).
 * The policy goes on the request too: Next.js reads the nonce from it and
 * stamps it on the scripts it renders. Every route is dynamic (root
 * layout), so each page gets its own nonce.
 *
 * The other security headers stay static in next.config.ts. The CSP must
 * not be set there as well: a browser enforces every CSP header it gets,
 * and a second, nonce-less policy would block Next.js's own scripts.
 */
export function proxy(request: NextRequest) {
  const csp = buildCsp(newNonce(), process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  // Per request: only responses that went out over HTTPS (src/lib/hsts.ts).
  const hsts = hstsHeader(request.headers);
  if (hsts) response.headers.set("Strict-Transport-Security", hsts);
  return response;
}

export const config = {
  // Everything but fingerprinted static files and image optimization, which
  // aren't documents. API responses get the policy too; it costs nothing.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
