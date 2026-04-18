"use client";

import { useState } from "react";
import type { DashboardWarning, WarningSeverity } from "@/types/dashboard";

/**
 * Warning actions — every warning type has an admin action that uses
 * an existing API endpoint. The panel is no longer display-only.
 *
 * Action mapping:
 *   "X is unreachable"       → (no inline action; link to Diagnose)
 *   "Failed download: …"     → POST DELETE /api/{arr}/queue (blocklist)
 *   "Stalled download: …"    → same
 *   "Failed to route: …"     → POST /api/admin/retry
 *   "Not in queue: …"        → POST /api/admin/retry
 *   "Orphaned download: …"   → POST /api/admin/retry
 *   "Stalled: …"             → POST /api/admin/retry
 *   "Pending Xh: …"          → POST /api/admin/approve or /deny
 *   "High failure rate: …"   → external link to Prowlarr
 *   "Large download queue"   → informational, no action
 */

const severityConfig: Record<
  WarningSeverity,
  { border: string; bg: string; icon: string }
> = {
  critical: {
    border: "var(--danger)",
    bg: "rgba(239,68,68,0.08)",
    icon: "\u26A0",
  },
  warning: {
    border: "var(--warning)",
    bg: "rgba(245,158,11,0.08)",
    icon: "\u25B2",
  },
  info: {
    border: "var(--accent)",
    bg: "rgba(99,102,241,0.08)",
    icon: "\u2139",
  },
};

const severityLabels: Record<WarningSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

/**
 * Determine which action a warning supports based on its title.
 * Title-matching is brittle but the warning titles are centralised in
 * src/lib/dashboard/warnings.ts, so a change there + here stays close.
 */
type ActionKind =
  | "retry" // request-level — POST /api/admin/retry with requestId
  | "approve-deny" // pending request — approve/deny buttons
  | "blocklist-queue" // download-client queue item — needs queue ID
  | "none";

function actionForWarning(w: DashboardWarning): ActionKind {
  const t = w.title;
  if (t.startsWith("Pending ")) return "approve-deny";
  if (
    t.startsWith("Failed to route") ||
    t.startsWith("Not in queue") ||
    t.startsWith("Orphaned download") ||
    t.startsWith("Stalled: ")
  ) {
    return "retry";
  }
  // Queue-item warnings now carry queueId + queueSource (0.16.0) so
  // we can fire a blocklist+remove against the right *arr.
  if (
    (t.startsWith("Failed download") || t.startsWith("Stalled download")) &&
    w.queueId !== undefined &&
    w.queueSource
  ) {
    return "blocklist-queue";
  }
  return "none";
}

interface WarningsPanelProps {
  warnings: DashboardWarning[];
  /** Triggered after any action completes, so the parent can refresh. */
  onActionComplete?: () => void;
}

export default function WarningsPanel({
  warnings,
  onActionComplete,
}: WarningsPanelProps) {
  // Per-warning action state: keyed by the warning's stable "key"
  // (requestId for request-based warnings, index fallback for the rest).
  const [inflight, setInflight] = useState<Record<string, string>>({}); // key → action name
  const [rowError, setRowError] = useState<Record<string, string>>({});

  if (warnings.length === 0) return null;

  function keyFor(w: DashboardWarning, i: number): string {
    if (w.requestId) return `req:${w.requestId}`;
    if (w.queueId !== undefined) return `queue:${w.queueSource}:${w.queueId}`;
    return `idx:${i}`;
  }

  async function doRetry(w: DashboardWarning, key: string) {
    if (!w.requestId) return;
    setInflight((p) => ({ ...p, [key]: "retry" }));
    setRowError((p) => {
      const { [key]: _, ...rest } = p;
      return rest;
    });
    try {
      const res = await fetch("/api/admin/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: w.requestId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onActionComplete?.();
    } catch (err: unknown) {
      setRowError((p) => ({
        ...p,
        [key]: err instanceof Error ? err.message : "Retry failed",
      }));
    } finally {
      setInflight((p) => {
        const { [key]: _, ...rest } = p;
        return rest;
      });
    }
  }

  async function doBlocklist(w: DashboardWarning, key: string) {
    if (w.queueId === undefined || !w.queueSource) return;
    setInflight((p) => ({ ...p, [key]: "blocklist" }));
    setRowError((p) => {
      const { [key]: _, ...rest } = p;
      return rest;
    });
    try {
      const res = await fetch("/api/admin/queue", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: w.queueSource,
          id: w.queueId,
          blocklist: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onActionComplete?.();
    } catch (err: unknown) {
      setRowError((p) => ({
        ...p,
        [key]: err instanceof Error ? err.message : "Blocklist failed",
      }));
    } finally {
      setInflight((p) => {
        const { [key]: _, ...rest } = p;
        return rest;
      });
    }
  }

  async function doApproveDeny(
    w: DashboardWarning,
    key: string,
    action: "approve" | "deny",
  ) {
    if (!w.requestId) return;
    setInflight((p) => ({ ...p, [key]: action }));
    setRowError((p) => {
      const { [key]: _, ...rest } = p;
      return rest;
    });
    try {
      const res = await fetch("/api/admin/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: w.requestId, action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onActionComplete?.();
    } catch (err: unknown) {
      setRowError((p) => ({
        ...p,
        [key]:
          err instanceof Error
            ? err.message
            : `${action === "approve" ? "Approve" : "Deny"} failed`,
      }));
    } finally {
      setInflight((p) => {
        const { [key]: _, ...rest } = p;
        return rest;
      });
    }
  }

  const grouped: Record<WarningSeverity, { w: DashboardWarning; i: number }[]> = {
    critical: [],
    warning: [],
    info: [],
  };
  warnings.forEach((w, i) => grouped[w.severity].push({ w, i }));

  return (
    <div className="space-y-3">
      {(["critical", "warning", "info"] as WarningSeverity[]).map(
        (severity) => {
          const items = grouped[severity];
          if (items.length === 0) return null;
          const config = severityConfig[severity];

          return (
            <div key={severity} className="space-y-2">
              {items.map(({ w, i }) => {
                const key = keyFor(w, i);
                const action = actionForWarning(w);
                const busy = inflight[key];
                const err = rowError[key];

                return (
                  <div
                    key={key}
                    className="flex items-start gap-3 rounded-lg border-l-4 px-4 py-3"
                    style={{
                      borderLeftColor: config.border,
                      background: config.bg,
                    }}
                  >
                    <span className="flex-shrink-0 text-sm">{config.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{w.title}</p>
                      {w.detail && (
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {w.detail}
                        </p>
                      )}
                      {err && (
                        <p className="mt-1 text-xs text-[var(--danger)]">
                          {err}
                        </p>
                      )}
                    </div>

                    {/* Contextual action buttons */}
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      {action === "retry" && w.requestId && (
                        <button
                          onClick={() => doRetry(w, key)}
                          disabled={!!busy}
                          className="rounded-md bg-[var(--card)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--card-hover)] disabled:opacity-40"
                          title="Retry this request"
                        >
                          {busy === "retry" ? "…" : "Retry"}
                        </button>
                      )}
                      {action === "blocklist-queue" && (
                        <button
                          onClick={() => doBlocklist(w, key)}
                          disabled={!!busy}
                          className="rounded-md px-2.5 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                          style={{ background: "var(--warning)" }}
                          title="Remove from download client + blocklist the release so it isn't re-grabbed"
                        >
                          {busy === "blocklist" ? "…" : "Blocklist"}
                        </button>
                      )}
                      {action === "approve-deny" && w.requestId && (
                        <>
                          <button
                            onClick={() => doApproveDeny(w, key, "approve")}
                            disabled={!!busy}
                            className="rounded-md px-2.5 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                            style={{ background: "var(--success)" }}
                            title="Approve this request"
                          >
                            {busy === "approve" ? "…" : "Approve"}
                          </button>
                          <button
                            onClick={() => doApproveDeny(w, key, "deny")}
                            disabled={!!busy}
                            className="rounded-md px-2.5 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                            style={{ background: "var(--danger)" }}
                            title="Deny this request"
                          >
                            {busy === "deny" ? "…" : "Deny"}
                          </button>
                        </>
                      )}
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                        style={{ color: config.border }}
                      >
                        {severityLabels[severity]}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        },
      )}
    </div>
  );
}
