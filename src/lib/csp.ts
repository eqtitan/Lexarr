/**
 * Lexarr's Content-Security-Policy, built per request by src/proxy.ts.
 *
 * Scripts: a fresh nonce per request plus 'strict-dynamic'. Next.js reads
 * the nonce from the request's CSP header and puts it on its own inline
 * bootstrap and chunk scripts, so any other inline or injected script is
 * refused. Before 0.29.0 script-src allowed 'unsafe-inline', which let an
 * injected <script> run.
 *
 * Styles keep 'unsafe-inline': React style={...} attributes are used all
 * over the UI, and a nonce can't cover style attributes. Styles can't run
 * code.
 *
 * What the UI legitimately loads: poster/cover art (TMDB, Cover Art Archive
 * -> archive.org redirects, Open Library, Google Books' http thumbnails),
 * 30s music previews (iTunes, Deezer). Plex sign-in is a popup
 * (window.open), which CSP doesn't restrict.
 */
export function buildCsp(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' only in `next dev` (React's dev error overlay uses eval).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
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
}

/** 128 random bits, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
