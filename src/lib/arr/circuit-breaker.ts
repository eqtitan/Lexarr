/**
 * Per-service circuit breaker for *arr API calls.
 *
 * Rationale: when one *arr goes down (container crash, DB lock, network
 * flap), we used to keep hammering it — every request took the full 15s
 * timeout, the background poller piled up on the failing service, and
 * the dashboard crawled. Lexarr's other arrs were fine, but the UI made
 * everything feel broken.
 *
 * The breaker trips per service after a handful of failures in a short
 * window, then fails fast for a cooldown period. A single probe request
 * is allowed when the cooldown expires — if it succeeds, the breaker
 * closes and normal traffic resumes.
 *
 * Only network errors (status === 0) and server errors (5xx) count as
 * "service is failing" signals. A 404 on `/movie/:id` for a deleted item
 * is a legitimate response and must NOT trip the breaker — otherwise
 * looking up one missing item would blind the whole app to the service.
 */

import { ArrApiError } from "./_fetch";

export type BreakerState = "closed" | "open" | "half_open";

/** Config knobs — kept as constants for simplicity; can be hoisted to env later. */
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 30_000;

export interface BreakerSnapshot {
  service: string;
  state: BreakerState;
  failures: number;
  /** ISO timestamp of last observed failure, or null if none yet */
  lastFailureAt: string | null;
  /** ISO timestamp at which the breaker will transition from open → half_open */
  retryAt: string | null;
  /** Short reason string from the last trip (for Diagnose UIs) */
  lastError: string | null;
}

class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private openedAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastError: string | null = null;

  constructor(public readonly service: string) {}

  /**
   * Call before a request. If the breaker is open, throws a synthetic
   * ArrApiError so the caller gets the same error type as a real failure
   * but without waiting for a timeout.
   *
   * If the cooldown has elapsed, transitions to half_open and permits a
   * single probe request.
   */
  beforeRequest(path: string): void {
    if (this.state === "closed") return;

    if (this.state === "open") {
      if (this.openedAt !== null && Date.now() - this.openedAt >= COOLDOWN_MS) {
        this.state = "half_open";
        return; // allow the probe
      }
      throw new ArrApiError(
        this.service,
        path,
        0,
        `Circuit breaker open — last error: ${this.lastError ?? "unknown"}`,
      );
    }

    // half_open: a probe is already in flight; fail fast for concurrent calls
    throw new ArrApiError(
      this.service,
      path,
      0,
      "Circuit breaker half-open — waiting on probe",
    );
  }

  recordSuccess(): void {
    if (this.state !== "closed") {
      // Probe succeeded OR we were already closed and this is a no-op
      this.state = "closed";
    }
    this.failures = 0;
    this.openedAt = null;
    // Keep lastError around for history/UI; cleared on next trip anyway.
  }

  /**
   * Register a failure. Only network or 5xx errors advance the counter;
   * client errors (4xx other than 408/429) are passed through without
   * counting — they mean "your request was bad", not "service is down".
   */
  recordFailure(err: ArrApiError): void {
    // Don't count normal 4xx responses (404, 400, etc.). A 408 Request
    // Timeout or 429 Too Many Requests *do* indicate a struggling upstream
    // and should count.
    const counts =
      err.isNetworkError ||
      err.isServerError ||
      err.status === 408 ||
      err.status === 429;
    if (!counts) return;

    this.failures++;
    this.lastFailureAt = Date.now();
    this.lastError = err.detail || err.message || "unknown";

    if (this.state === "half_open" || this.failures >= FAILURE_THRESHOLD) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  snapshot(): BreakerSnapshot {
    return {
      service: this.service,
      state: this.state,
      failures: this.failures,
      lastFailureAt: this.lastFailureAt
        ? new Date(this.lastFailureAt).toISOString()
        : null,
      retryAt:
        this.state === "open" && this.openedAt !== null
          ? new Date(this.openedAt + COOLDOWN_MS).toISOString()
          : null,
      lastError: this.lastError,
    };
  }

  /** Test helper — resets state so tests don't bleed across cases. */
  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.openedAt = null;
    this.lastFailureAt = null;
    this.lastError = null;
  }
}

// ── Singleton registry ────────────────────────────────────────────────────
// Keyed by the `service` string passed to arrFetch (e.g. "Radarr", "Sonarr").
// In-memory is fine: Lexarr is a single-instance app; if we ever scale out,
// the breaker becomes a cache in front of an external store, not a rewrite.
const breakers = new Map<string, CircuitBreaker>();

export function getBreaker(service: string): CircuitBreaker {
  let b = breakers.get(service);
  if (!b) {
    b = new CircuitBreaker(service);
    breakers.set(service, b);
  }
  return b;
}

/** Snapshot of every known breaker — for Diagnose UIs and /api/admin/arr-status. */
export function snapshotAllBreakers(): BreakerSnapshot[] {
  return Array.from(breakers.values())
    .map((b) => b.snapshot())
    .sort((a, b) => a.service.localeCompare(b.service));
}

/** Test-only: clear every breaker. */
export function _resetAllBreakers(): void {
  for (const b of breakers.values()) b.reset();
}
