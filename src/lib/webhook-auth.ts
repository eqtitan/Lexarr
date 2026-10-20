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
