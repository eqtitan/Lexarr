/**
 * Strict-Transport-Security for the HTTPS address only.
 *
 * Lexarr itself speaks plain HTTP. HTTPS exists only through a trusted local
 * proxy (`tailscale serve`), so the header goes out only when that proxy
 * says the visitor used https. Never on the plain LAN address: a browser
 * would refuse it there anyway, and a forged X-Forwarded-Proto from a LAN
 * client is ignored, as everywhere else.
 *
 * Browsers remember HSTS for max-age seconds, so it outlives any rollback
 * of Lexarr. LEXARR_HSTS_MAX_AGE (seconds, default 1 day) lets an operator
 * raise it once HTTPS has proven itself, or send 0, which tells browsers
 * to forget it. No includeSubDomains / preload: those reach beyond this host.
 */
import { env } from "@/lib/env";
import { isTrustedProxyPeer } from "@/lib/trusted-proxy";

export const HSTS_DEFAULT_MAX_AGE = 86_400;
const HSTS_MAX_MAX_AGE = 63_072_000; // 2 years

function maxAge(): number {
  const raw = env().LEXARR_HSTS_MAX_AGE?.trim();
  if (!raw) return HSTS_DEFAULT_MAX_AGE;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, HSTS_MAX_MAX_AGE) : HSTS_DEFAULT_MAX_AGE;
}

/** The header value for this request, or null when it didn't arrive over HTTPS. */
export function hstsHeader(headers: Headers): string | null {
  if (!isTrustedProxyPeer(headers)) return null;
  const proto = (headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  return proto === "https" ? `max-age=${maxAge()}` : null;
}
