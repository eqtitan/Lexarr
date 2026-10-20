import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for webhook shared-secret tokens.
 *
 * The three webhook routes previously used `token !== secret`, a
 * non-constant-time string comparison -- a theoretical timing side
 * channel for guessing LEXARR_WEBHOOK_SECRET. node:crypto's
 * timingSafeEqual() requires equal-length buffers (it throws otherwise),
 * which would itself leak a length signal, so both sides are hashed to a
 * fixed-length digest first.
 */
export function verifyWebhookToken(
  secret: string | undefined,
  token: string | null,
): boolean {
  if (!secret || !token) return false;
  const secretDigest = createHash("sha256").update(secret).digest();
  const tokenDigest = createHash("sha256").update(token).digest();
  return timingSafeEqual(secretDigest, tokenDigest);
}

/**
 * The shared secret a webhook call presents. Preferred: the password of
 * HTTP Basic auth -- Radarr/Sonarr/Lidarr webhook connections have
 * Username/Password fields, and a header keeps the secret out of URLs and
 * therefore out of proxy/access logs (the username is ignored). Still
 * accepted for existing setups: the `?token=` query parameter.
 */
export function webhookTokenFrom(req: {
  headers: Headers;
  nextUrl: URL;
}): string | null {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep >= 0 && sep < decoded.length - 1) return decoded.slice(sep + 1);
  }
  return req.nextUrl.searchParams.get("token");
}
