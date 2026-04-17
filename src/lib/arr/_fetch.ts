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

export class ArrApiError extends Error {
  constructor(
    /** Display name: "Radarr", "Prowlarr", etc. */
    public readonly service: string,
    /** Relative path that failed, e.g. "/api/v3/movie" */
    public readonly path: string,
    /** HTTP status code. 0 = network/timeout error (no response) */
    public readonly status: number,
    /** Response body or error.message; may be empty */
    public readonly detail: string,
  ) {
    super(`${service} ${path}: ${status || "network"} ${detail}`.trim());
    this.name = "ArrApiError";
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
      throw new ArrApiError(service, path, res.status, body);
    }

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
    throw new ArrApiError(service, path, 0, detail);
  } finally {
    clearTimeout(timeoutId);
  }
}
