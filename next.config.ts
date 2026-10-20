import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every Lexarr response.
 *
 * Chosen to be LAN-safe (no HSTS — would break HTTP-over-LAN Unraid
 * setups). The Content-Security-Policy ships REPORT-ONLY first: browsers
 * log violations to the console without blocking anything, and the e2e
 * smoke test fails on any violation. Switch the header name to
 * "Content-Security-Policy" once real use shows none.
 */

// What the UI legitimately loads: poster/cover art (TMDB, Cover Art
// Archive -> archive.org redirects, Open Library, Google Books' http
// thumbnails), 30s music previews (iTunes, Deezer), and Next.js's own
// inline bootstrap script and inline styles. Plex sign-in is a popup
// (window.open), which CSP doesn't restrict.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http://books.google.com",
  "media-src 'self' https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
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
  { key: "Content-Security-Policy-Report-Only", value: CSP },
  // Tells browsers not to cache any HTML/API response of ours — prevents
  // stale auth state after sign-out. Static /_next/ assets keep their own
  // long cache headers because Next.js fingerprints them.
];

const nextConfig: NextConfig = {
  output: "standalone",
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
