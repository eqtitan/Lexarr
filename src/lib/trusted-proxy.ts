/**
 * Which TCP peers are trusted local proxies (LEXARR_TRUSTED_PROXIES)?
 *
 * Kept apart from rate-limit.ts, which opens the database, so the request
 * proxy (src/proxy.ts) can ask without pulling Prisma in.
 */
import { env } from "@/lib/env";

/** LEXARR_TRUSTED_PROXIES: exact TCP peer addresses of local proxies. */
export const trustedProxies = () =>
  (env().LEXARR_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^::ffff:/, ""))
    .filter(Boolean);

/**
 * Did this request come straight from a listed local proxy? Only then are
 * the X-Forwarded-* headers it carries believed (for the client address in
 * rate-limit.ts, scheme and host in public-origin.ts, HTTPS in hsts.ts).
 * Needs the peer address stamped by scripts/client-ip-preload.cjs.
 */
export function isTrustedProxyPeer(headers: Headers): boolean {
  if (env().LEXARR_CLIENT_IP_HEADER !== "1") return false;
  const peer = headers.get("x-lexarr-client-ip")?.replace(/^::ffff:/, "");
  return !!peer && trustedProxies().includes(peer);
}
