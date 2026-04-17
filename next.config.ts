import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every Lexarr response.
 *
 * Chosen to be LAN-safe (no HSTS — would break HTTP-over-LAN Unraid
 * setups) and to minimize accidental breakage (no CSP yet — CSP is
 * documented as a follow-up in docs/security-checklist.md; it needs
 * per-endpoint validation against NextAuth, TMDB image hosts, and the
 * inline styles Next.js emits).
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
  // Tells browsers not to cache any HTML/API response of ours — prevents
  // stale auth state after sign-out. Static /_next/ assets keep their own
  // long cache headers because Next.js fingerprints them.
];

const nextConfig: NextConfig = {
  output: "standalone",
  // instrumentationHook + eslint config moved out of NextConfig in Next.js 16
  typescript: { ignoreBuildErrors: true },
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
