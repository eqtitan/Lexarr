/**
 * Shared fetch helper for all *arr service integrations.
 *
 * One place to enforce:
 *   - Request timeout (via AbortController)
 *   - Auth header injection (per-service key or basic auth)
 *   - Consistent error type so callers can distinguish connection
 *     failures from HTTP 4xx/5xx
 *
 * Every module under src/lib/arr/ should use this instead of hand-rolling
 * its own fetch wrapper. Historically a few modules (Prowlarr, Bazarr) did
 * not — those had no timeout and would hang indefinitely on slow networks.
 */

/** Default timeout per *arr request. Long enough for large library scans. */
export const ARR_TIMEOUT_MS = 15_000;

/**
 * Strip query-param secrets (apikey/api_key/token=...) out of a path or
 * response body before it lands anywhere that gets logged or surfaced to
 * the admin UI (ArrApiError.message/.path/.detail, which flow into
 * log.ts's serializeError and circuit-breaker.ts's lastError).
 *
 * Most integrations send their key as a header, so this is a no-op for
 * them — but LazyLibrarian's API is querystring-based (its key has to be
 * in the URL to make the real request), and any future integration that
 * does the same gets covered here instead of needing its own fix.
 */
function redactSecrets(text: string): string {
  return text.replace(
    /((?:api_?key|token)=)[^&\s]+/gi,
    "$1***",
  );
}

export class ArrApiError extends Error {
  /** Relative path that failed, e.g. "/api/v3/movie" (secrets redacted) */
  public readonly path: string;
  /** Response body or error.message; may be empty (secrets redacted) */
  public readonly detail: string;

  constructor(
    /** Display name: "Radarr", "Prowlarr", etc. */
    public readonly service: string,
    rawPath: string,
    /** HTTP status code. 0 = network/timeout error (no response) */
    public readonly status: number,
    rawDetail: string,
  ) {
    const safePath = redactSecrets(rawPath);
    const safeDetail = redactSecrets(rawDetail);
    super(`${service} ${safePath}: ${status || "network"} ${safeDetail}`.trim());
    this.name = "ArrApiError";
    this.path = safePath;
    this.detail = safeDetail;
  }

  /** Was this a timeout or network-level failure (no HTTP response)? */
  get isNetworkError(): boolean {
    return this.status === 0;
  }

  /** Did the server respond with a 5xx? */
  get isServerError(): boolean {
    return this.status >= 500 && this.status < 600;
  }

  /** Did the server respond with a 4xx? */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export interface ArrFetchOptions extends RequestInit {
  /** Override the default timeout for this request */
  timeoutMs?: number;
}

/**
 * Perform a fetch against an *arr service.
 *
 * - Fails fast (no fetch attempted) when the service's circuit breaker is
 *   open — see `./circuit-breaker.ts`
 * - Throws `ArrApiError` for any non-2xx response
 * - Throws `ArrApiError` with status=0 for timeouts or network errors
 * - Returns parsed JSON body on success, or raw text if the response has
 *   no JSON content-type
 */
export async function arrFetch<T = unknown>(
  service: string,
  baseUrl: string,
  path: string,
  options: ArrFetchOptions = {},
): Promise<T> {
  const { timeoutMs = ARR_TIMEOUT_MS, headers, ...rest } = options;

  // Lazy import to avoid a circular-dependency hazard (circuit-breaker
  // imports ArrApiError from this file).
  const { getBreaker } = await import("./circuit-breaker");
  const breaker = getBreaker(service);
  breaker.beforeRequest(path); // throws ArrApiError if open

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const apiErr = new ArrApiError(service, path, res.status, body);
      breaker.recordFailure(apiErr);
      throw apiErr;
    }

    breaker.recordSuccess();

    // Some *arr endpoints return empty body on success (e.g. DELETE)
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return (await res.text()) as unknown as T;
    }
    return (await res.json()) as T;
  } catch (err: unknown) {
    if (err instanceof ArrApiError) throw err;
    // AbortError = our timeout fired
    const detail =
      err instanceof Error ? err.message : "Unknown network error";
    const apiErr = new ArrApiError(service, path, 0, detail);
    breaker.recordFailure(apiErr);
    throw apiErr;
  } finally {
    clearTimeout(timeoutId);
  }
}
