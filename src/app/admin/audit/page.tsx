"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  createdAt: string;
  user: { name: string; avatar: string | null } | null;
}

const ACTION_LABELS: Record<string, string> = {
  approve_request: "Approved request",
  deny_request: "Denied request",
  retry_request: "Retried request",
  retry_all_failed: "Retried all failed",
  blocklist_queue: "Blocklisted download",
  create_user: "Created user",
  update_user: "Updated user",
  delete_user: "Deleted user",
  add_notification: "Added notification",
  remove_notification: "Removed notification",
  update_settings: "Updated settings",
  login: "Logged in",
};

const ACTION_COLORS: Record<string, string> = {
  approve_request: "var(--success)",
  deny_request: "var(--danger)",
  retry_request: "var(--accent)",
  retry_all_failed: "var(--accent)",
  blocklist_queue: "var(--warning)",
  create_user: "var(--success)",
  update_user: "var(--tv)",
  delete_user: "var(--danger)",
  add_notification: "var(--music)",
  remove_notification: "var(--warning)",
  update_settings: "var(--tv)",
  login: "var(--muted)",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Bucket label for grouping: "Today", "Yesterday", weekday name (past 7d), or "MMM D". */
function dateBucketLabel(iso: string): string {
  const today = startOfDay(new Date());
  const entry = startOfDay(new Date(iso));
  const diffDays = Math.round((today - entry) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const d = new Date(iso);
  if (diffDays < 7)
    return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Represents either a single audit entry or a run of consecutive
 * same-user/same-action entries collapsed into one row.
 */
interface AuditRow {
  kind: "single" | "run";
  entries: AuditEntry[];
  bucket: string;
}

/**
 * Group entries by date bucket and collapse consecutive same-user +
 * same-action runs within a 10-minute window into one row. Keeps the
 * common-noise cases (bursts of logins, rapid approvals) from dominating
 * the visible list.
 */
function groupEntries(entries: AuditEntry[]): AuditRow[] {
  const COLLAPSE_MS = 10 * 60 * 1000;
  const rows: AuditRow[] = [];
  for (const entry of entries) {
    const bucket = dateBucketLabel(entry.createdAt);
    const last = rows[rows.length - 1];
    const lastEntry = last?.entries[last.entries.length - 1];
    const sameBurst =
      last &&
      lastEntry &&
      last.bucket === bucket &&
      lastEntry.action === entry.action &&
      lastEntry.userId === entry.userId &&
      new Date(lastEntry.createdAt).getTime() -
        new Date(entry.createdAt).getTime() <=
        COLLAPSE_MS;
    if (sameBurst) {
      last.entries.push(entry);
      last.kind = "run";
    } else {
      rows.push({ kind: "single", entries: [entry], bucket });
    }
  }
  return rows;
}

export default function AuditPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const role = session?.user?.role;

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session || role !== "admin") router.replace("/");
  }, [session, sessionStatus, role, router]);

  const fetchLogs = useCallback(async () => {
    setLoadError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filter) params.set("action", filter);
      const res = await fetch(`/api/admin/audit?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setLogs(json.logs || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setLoadError(`Couldn't load audit log — ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (role === "admin") void fetchLogs();
  }, [role, fetchLogs]);

  if (sessionStatus === "loading" || loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <div
          className="rounded-xl p-4 ring-1"
          style={{
            background: "rgba(239,68,68,0.08)",
            borderColor: "var(--danger)",
          }}
          role="alert"
        >
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {loadError}
          </p>
          <button
            onClick={fetchLogs}
            className="mt-3 rounded-lg px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setLoading(true);
          }}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
        >
          <option value="">All Actions</option>
          <option value="approve_request">Approvals</option>
          <option value="deny_request">Denials</option>
          <option value="retry_request">Retries</option>
          <option value="update_user">User Updates</option>
          <option value="add_notification">Notifications Added</option>
          <option value="remove_notification">Notifications Removed</option>
        </select>
      </div>

      {logs.length === 0 ? (
        <p className="py-16 text-center text-sm text-[var(--muted)]">
          No audit log entries yet.
        </p>
      ) : (
        (() => {
          const rows = groupEntries(logs);
          // Group rows by bucket for rendering
          const buckets: { bucket: string; rows: AuditRow[] }[] = [];
          for (const row of rows) {
            const last = buckets[buckets.length - 1];
            if (last && last.bucket === row.bucket) {
              last.rows.push(row);
            } else {
              buckets.push({ bucket: row.bucket, rows: [row] });
            }
          }

          return (
            <div className="space-y-4">
              {buckets.map((b) => (
                <div key={b.bucket}>
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                    {b.bucket}
                  </h2>
                  <div
                    className="rounded-xl ring-1 ring-[var(--border)]"
                    style={{ background: "var(--card)" }}
                  >
                    <div className="divide-y divide-[var(--border)]">
                      {b.rows.map((row) => {
                        const first = row.entries[0]; // newest in the run
                        const last = row.entries[row.entries.length - 1];
                        const count = row.entries.length;
                        const isRun = row.kind === "run";

                        let detail: Record<string, unknown> | null = null;
                        try {
                          if (first.detail && !isRun)
                            detail = JSON.parse(first.detail);
                        } catch {
                          // not JSON
                        }

                        return (
                          <div
                            key={first.id}
                            className="flex items-start gap-3 px-4 py-3"
                          >
                            <div
                              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{
                                background:
                                  ACTION_COLORS[first.action] ||
                                  "var(--muted)",
                              }}
                            />

                            <div className="min-w-0 flex-1">
                              <p className="text-sm">
                                <span className="font-medium">
                                  {first.user?.name || "System"}
                                </span>{" "}
                                <span className="text-[var(--muted)]">
                                  {ACTION_LABELS[first.action] || first.action}
                                </span>
                                {isRun ? (
                                  <span
                                    className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                                    style={{
                                      background:
                                        "var(--card-hover, rgba(255,255,255,0.05))",
                                      color: "var(--muted)",
                                    }}
                                    title={`${count} events, collapsed`}
                                  >
                                    ×{count}
                                  </span>
                                ) : (
                                  first.targetId && (
                                    <span className="ml-1 text-xs text-[var(--muted)]">
                                      ({first.targetType}:{" "}
                                      {first.targetId.slice(0, 8)}...)
                                    </span>
                                  )
                                )}
                              </p>
                              {detail && detail.note ? (
                                <p className="mt-0.5 text-xs text-[var(--muted)]">
                                  Note: {String(detail.note)}
                                </p>
                              ) : null}
                              {detail && detail.retryCount !== undefined ? (
                                <p className="mt-0.5 text-xs text-[var(--muted)]">
                                  Retry #{String(detail.retryCount)}
                                </p>
                              ) : null}
                            </div>

                            <span
                              className="shrink-0 text-xs text-[var(--muted)]"
                              title={
                                isRun
                                  ? `${new Date(
                                      last.createdAt,
                                    ).toLocaleString()} — ${new Date(
                                      first.createdAt,
                                    ).toLocaleString()}`
                                  : new Date(first.createdAt).toLocaleString()
                              }
                            >
                              {timeAgo(first.createdAt)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })()
      )}
    </div>
  );
}
