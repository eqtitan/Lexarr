/** Status badge shown on the My Requests page. */

export interface BadgeRequest {
  status: string;
  lastError?: string | null;
  /** Admin reason, shown on a denied or cancelled request */
  adminNote?: string | null;
}

export const statusLabels: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  downloading: "Downloading",
  available: "Available",
  denied: "Denied",
  failed: "Failed",
  stalled: "Stalled",
  cancelled: "Cancelled",
};

/**
 * Derive a short, user-friendly badge label for the request pill.
 * When the poller has surfaced a reason, prefer it over the generic status word
 * so users see "Not Found", "Unreleased", etc. instead of "Downloading" forever.
 */
export function deriveBadge(req: BadgeRequest): { label: string; tooltip: string } {
  const err = (req.lastError || "").trim();
  const lower = err.toLowerCase();

  // Stalled — broken down by reason
  if (req.status === "stalled") {
    if (lower.includes("no releases found") || lower.includes("indexers returned nothing")) {
      return { label: "Not Found", tooltip: err };
    }
    if (lower.includes("partial")) {
      return { label: "Partial — no more sources", tooltip: err };
    }
    if (lower.includes("no progress")) {
      return { label: "Stalled", tooltip: err };
    }
    return { label: "Stalled", tooltip: err || "Stalled — no progress detected" };
  }

  // Failed — includes arrId drift + max-retries
  if (req.status === "failed") {
    if (lower.includes("tracker drift") || lower.includes("arrid")) {
      return { label: "Tracker drift — re-request", tooltip: err };
    }
    if (lower.includes("not yet released")) {
      return { label: "Unreleased", tooltip: err };
    }
    return { label: "Not Found", tooltip: err || "Could not be delivered" };
  }

  // Closed by an admin: the reason is theirs, not a leftover poller error
  if (req.status === "denied" || req.status === "cancelled") {
    const label = statusLabels[req.status];
    return { label, tooltip: req.adminNote?.trim() || `${label} by an admin` };
  }

  // Approved but carrying a diagnostic note (e.g. "Awaiting release")
  if (req.status === "approved" && err) {
    if (lower.includes("awaiting release") || lower.includes("not yet released")) {
      return { label: "Unreleased", tooltip: err };
    }
  }

  return {
    label: statusLabels[req.status] || req.status,
    tooltip: err || statusLabels[req.status] || req.status,
  };
}

