/**
 * AES-256-GCM helpers for encrypting ServiceConnection secrets at rest.
 *
 * Lands in P-06 (pre-1.0.0). No dependency added — uses node's built-in
 * `crypto` module only.
 *
 * Key source, in order of precedence:
 *   1. `LEXARR_DATA_KEY`  — operator-provided, 32 raw bytes as hex (64 chars).
 *   2. HKDF-derived from `NEXTAUTH_SECRET` using the stable salt
 *      "lexarr:service-connection:v1". Lets Lexarr work out of the box on
 *      existing installs without a second secret to manage.
 *
 * The `v1` in the HKDF salt is a version tag — bumping it (and publishing
 * a migration note) is how we'd rotate the derived key family in future.
 *
 * Output format for persisted ciphertext (single base64 string):
 *     base64( iv(12) || authTag(16) || ciphertext(n) )
 * A single field keeps the Prisma schema a plain `String` with no extra
 * companion columns and makes rotation scripts trivial.
 */

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // GCM standard nonce size
const TAG_BYTES = 16;
const HKDF_SALT = "lexarr:service-connection:v1";
const HKDF_INFO = "lexarr:aes-256-gcm";

/**
 * Resolve the AES-256 key used for ServiceConnection secrets.
 *
 * Reads from `process.env` at call time (not module load) so tests can
 * mutate the environment between cases without needing `vi.resetModules()`.
 */
function resolveKey(): Buffer {
  const explicit = process.env.LEXARR_DATA_KEY;
  if (explicit && explicit.length > 0) {
    const buf = hexToBuffer(explicit);
    if (buf.length !== KEY_BYTES) {
      throw new Error(
        `LEXARR_DATA_KEY must decode to ${KEY_BYTES} bytes (64 hex chars); got ${buf.length}.`,
      );
    }
    return buf;
  }

  const nextAuthSecret = process.env.NEXTAUTH_SECRET;
  if (!nextAuthSecret || nextAuthSecret.length === 0) {
    throw new Error(
      "Cannot derive data key: neither LEXARR_DATA_KEY nor NEXTAUTH_SECRET is set.",
    );
  }

  // node:crypto.hkdfSync returns an ArrayBuffer — wrap in Buffer.
  const derived = hkdfSync(
    "sha256",
    Buffer.from(nextAuthSecret, "utf8"),
    Buffer.from(HKDF_SALT, "utf8"),
    Buffer.from(HKDF_INFO, "utf8"),
    KEY_BYTES,
  );
  return Buffer.from(derived);
}

function hexToBuffer(hex: string): Buffer {
  const clean = hex.trim();
  if (!/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error(
      "LEXARR_DATA_KEY must be hex-encoded (0-9, a-f). Generate one with: openssl rand -hex 32",
    );
  }
  if (clean.length % 2 !== 0) {
    throw new Error("LEXARR_DATA_KEY has an odd number of hex chars.");
  }
  return Buffer.from(clean, "hex");
}

/**
 * Encrypt `plaintext` with AES-256-GCM.
 *
 * Returns a single base64 string packing `iv || authTag || ciphertext`.
 */
export function encrypt(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * Decrypt a value produced by `encrypt`.
 *
 * Throws if the key is wrong, the auth tag mismatches, or the payload is
 * malformed — GCM's auth tag makes tampering detectable.
 */
export function decrypt(packed: string): string {
  const buf = Buffer.from(packed, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("Ciphertext payload is too short to be valid.");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);

  const key = resolveKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString("utf8");
}

/**
 * Validate an operator-supplied `LEXARR_DATA_KEY` without throwing.
 * Used by `src/lib/env.ts` to give a helpful startup error.
 */
export function isValidDataKeyHex(hex: string): boolean {
  try {
    return hexToBuffer(hex).length === KEY_BYTES;
  } catch {
    return false;
  }
}
