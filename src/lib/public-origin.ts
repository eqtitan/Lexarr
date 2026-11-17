/**
 * Which public address is this request using? Lexarr can be reached at
 * more than one (http://192.168.1.100:5056 on the LAN, and
 * https://server.<tailnet>.ts.net:8443 through `tailscale serve`), and
 * Auth.js builds every sign-in redirect and callback URL from one origin.
 * NEXTAUTH_URL pins that to a single address; without it Auth.js uses the
 * server's own URL (http://0.0.0.0:5056 in the standalone build). Either
 * way, sign-in from the other address breaks.
 *
 * LEXARR_PUBLIC_URLS lists every address Lexarr is served at. The request
 * picks one, but only from that list: an unknown Host can't steer
 * redirects anywhere, it just gets the first (primary) address. The
 * scheme and host a proxy reports (X-Forwarded-Proto / -Host) are
 * believed only from a trusted local proxy (LEXARR_TRUSTED_PROXIES), the
 * same rule rate limiting uses.
 */
import { env } from "@/lib/env";
import { isTrustedProxyPeer } from "@/lib/rate-limit";

function origin(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** The allowlist: LEXARR_PUBLIC_URLS, else NEXTAUTH_URL alone. First = primary. */
export function publicOrigins(): string[] {
  const listed = (env().LEXARR_PUBLIC_URLS ?? "")
    .split(",")
    .map(origin)
    .filter((o): o is string => !!o);
  if (listed.length) return [...new Set(listed)];
  const single = env().NEXTAUTH_URL ? origin(env().NEXTAUTH_URL!) : null;
  return single ? [single] : [];
}

/** The listed origin this request arrived on, or the primary one; null if none configured. */
export function pickPublicOrigin(headers: Headers): string | null {
  const list = publicOrigins();
  if (!list.length) return null;

  const viaProxy = isTrustedProxyPeer(headers);
  // Lexarr itself only speaks plain HTTP; https means a trusted proxy said so.
  const proto = viaProxy ? (headers.get("x-forwarded-proto") ?? "http").split(",")[0].trim() : "http";
  const host = ((viaProxy && headers.get("x-forwarded-host")) || headers.get("host") || "").split(",")[0].trim();
  const asked = host ? origin(`${proto}://${host}`) : null;

  return asked && list.includes(asked) ? asked : list[0];
}
