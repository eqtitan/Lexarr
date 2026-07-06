/**
 * (M2-03) Pure classifier for the Diagnose-modal telemetry hook.
 *
 * Categorizes a down service's error into a small fixed taxonomy so we can
 * group AuditLog rows after beta and decide whether a Phase-2 Restart
 * action targets the right failure modes. No I/O, no side-effects — keep
 * it that way so the modal can call this synchronously and the API route
 * can echo it into AuditLog.detail without re-doing the work.
 *
 * Buckets (mutually exclusive, first match wins):
 *   - "breaker_open"  — circuit breaker is open at the time of click
 *   - "timeout"       — health-check responseMs > 5000 with no breaker open
 *   - "network"       — error matches /ECONNREFUSED|ENETUNREACH|EAI_AGAIN/
 *   - "http_5xx"      — error starts with "5XX " (matches the "503 Service Unavailable" pattern)
 *   - "http_4xx"      — error starts with "4XX "
 *   - "unknown"       — anything else, including no error string
 */
import type { ServiceHealthDTO } from "@/types/dashboard";

export type ErrorClass =
  | "breaker_open"
  | "timeout"
  | "network"
  | "http_5xx"
  | "http_4xx"
  | "unknown";

interface BreakerLike {
  service: string;
  state: "closed" | "open" | "half_open";
}

const NETWORK_RE = /ECONNREFUSED|ENETUNREACH|EAI_AGAIN|EHOSTUNREACH/;
const HTTP_5XX_RE = /^5\d{2}\b/;
const HTTP_4XX_RE = /^4\d{2}\b/;

const TIMEOUT_THRESHOLD_MS = 5_000;

export function classifyError(
  service: ServiceHealthDTO,
  breakers?: ReadonlyArray<BreakerLike>,
): ErrorClass {
  const breaker = breakers?.find((b) => b.service === service.name);
  if (breaker?.state === "open") return "breaker_open";

  const err = service.error ?? "";

  if (service.responseMs > TIMEOUT_THRESHOLD_MS && !breaker) {
    return "timeout";
  }

  if (NETWORK_RE.test(err)) return "network";
  if (HTTP_5XX_RE.test(err)) return "http_5xx";
  if (HTTP_4XX_RE.test(err)) return "http_4xx";

  return "unknown";
}
