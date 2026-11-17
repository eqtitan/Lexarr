import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every Lexarr response.
 *
 * Chosen to be LAN-safe (no HSTS — would break HTTP-over-LAN Unraid
 * setups). The Content-Security-Policy is enforced; since 0.29.0 it is
 * built per request in src/proxy.ts so scripts need a nonce.
 */

const SECURITY_HEADERS = [
  // Stops the browser from MIME-sniffing responses into executable content.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking protection — Lexarr should never be framed.
  { key: "X-Frame-Options", value: "DENY" },
  // Limits Referer leakage on outbound navigation (e.g. "Open in Jellyfin").
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Explicitly disables browser features Lexarr has no business using.
  // FLoC / Topics is also disabled ("interest-cohort=()").
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()",
  },
  // Content-Security-Policy is set per request with a script nonce by
  // src/proxy.ts (src/lib/csp.ts). Not here: a second, nonce-less CSP
  // header would block Next.js's own scripts.
  // Tells browsers not to cache any HTML/API response of ours — prevents
  // stale auth state after sign-out. Static /_next/ assets keep their own
  // long cache headers because Next.js fingerprints them.
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Don't advertise the framework (X-Powered-By: Next.js) to scanners.
  poweredByHeader: false,
  // instrumentationHook + eslint config moved out of NextConfig in Next.js 16
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "covers.openlibrary.org" },
      { protocol: "https", hostname: "coverartarchive.org" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
