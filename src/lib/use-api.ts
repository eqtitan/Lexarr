"use client";

/**
 * The one way the UI talks to Lexarr's own API.
 *
 * - useApi(url, options): reads, cached and de-duplicated by SWR. Polling is
 *   `refreshInterval`, not hand-rolled setInterval; `error` is set instead of
 *   failures being swallowed.
 * - apiSend(url, method, body): writes. Throws an ApiError carrying the
 *   server's own message ("Can't remove the last admin ...") rather than a
 *   bare "HTTP 409".
 */
import useSWR, { type SWRConfiguration } from "swr";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export function apiSend<T = unknown>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  return apiFetch<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Pass `null` as the url to skip fetching (e.g. until the session loads). */
export function useApi<T>(url: string | null, config?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(url, (u: string) => apiFetch<T>(u), {
    revalidateOnFocus: false,
    ...config,
  });
}

/** "Add failed — <server message>" for an action's error banner. */
export function failure(action: string, err: unknown): string {
  return `${action} failed — ${err instanceof Error ? err.message : "unknown error"}`;
}
