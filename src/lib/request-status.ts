/**
 * The request lifecycle: every status a Request can be in and every move
 * between them. This is the single owner of those rules -- status writes go
 * through updateRequestIfStatus() (request-transition.ts), which refuses a
 * move this table doesn't list.
 *
 *   pending ──approve──▶ approved ──sent to *arr / in queue──▶ downloading
 *      │                    │  ▲                                  │   │
 *      │ deny/cancel        │  └──── awaiting release ────────────┘   │
 *      ▼                    ▼                                         ▼
 *   denied / cancelled   failed ◀── drift / 404 / max retries ──  stalled
 *                           │                                         │
 *                           └──────────── admin retry ──▶ approved ◀──┘
 *
 * Late arrivals: failed and stalled can also move to available when the
 * *arr imports the title after Lexarr gave up (status-checker.ts's
 * late-arrival sweep).
 *
 * Terminal: available, denied, cancelled.
 */

export const REQUEST_STATUSES = [
  "pending",
  "approved",
  "downloading",
  "available",
  "stalled",
  "failed",
  "denied",
  "cancelled",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  // Admin approve / deny / cancel.
  pending: ["approved", "denied", "cancelled"],
  // Sent to the *arr or seen in its queue → downloading; already on disk →
  // available; send error, tracker drift, 404 or out of retries → failed;
  // admin retry re-approves in place.
  approved: ["downloading", "available", "failed", "cancelled", "approved"],
  // Imported → available; release date in the future → back to approved;
  // nothing found for 12h+ → stalled; drift / 404 → failed.
  downloading: ["available", "approved", "stalled", "failed", "cancelled"],
  // No progress for 48h → failed; admin retry → approved; imported after
  // all (late-arrival sweep) → available.
  stalled: ["failed", "approved", "cancelled", "available"],
  // Admin retry → approved; the *arr kept searching after Lexarr gave up
  // and imported it later (late-arrival sweep) → available.
  failed: ["approved", "cancelled", "available"],
  available: [],
  denied: [],
  cancelled: [],
};

export function isRequestStatus(value: string): value is RequestStatus {
  return (REQUEST_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: RequestStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
