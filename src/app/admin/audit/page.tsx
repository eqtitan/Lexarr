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
  update_user: "Updated user",
  add_notification: "Added notification",
  remove_notification: "Removed notification",
  login: "Logged in",
};

const ACTION_COLORS: Record<string, string> = {
  approve_request: "var(--success)",
  deny_request: "var(--danger)",
  retry_request: "var(--accent)",
  update_user: "var(--tv)",
  add_notification: "var(--music)",
  remove_notification: "var(--warning)",
  login: "var(--muted)",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

export default function AuditPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session || role !== "admin") router.replace("/");
  }, [session, sessionStatus, role, router]);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filter) params.set("action", filter);
      const res = await fetch(`/api/admin/audit?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setLogs(json.logs || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (role === "admin") fetchLogs();
  }, [role, fetchLogs]);

  if (sessionStatus === "loading" || loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <select
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setLoading(true); }}
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
        <div className="rounded-xl ring-1 ring-[var(--border)]" style={{ background: "var(--card)" }}>
          <div className="divide-y divide-[var(--border)]">
            {logs.map((entry) => {
              let detail: Record<string, any> | null = null;
              try {
                if (entry.detail) detail = JSON.parse(entry.detail);
              } catch {
                // not JSON
              }

              return (
                <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                  {/* Action dot */}
                  <div
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: ACTION_COLORS[entry.action] || "var(--muted)" }}
                  />

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{entry.user?.name || "System"}</span>
                      {" "}
                      <span className="text-[var(--muted)]">
                        {ACTION_LABELS[entry.action] || entry.action}
                      </span>
                      {entry.targetId && (
                        <span className="ml-1 text-xs text-[var(--muted)]">
                          ({entry.targetType}: {entry.targetId.slice(0, 8)}...)
                        </span>
                      )}
                    </p>
                    {detail?.note && (
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        Note: {detail.note}
                      </p>
                    )}
                    {detail?.retryCount !== undefined && (
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        Retry #{detail.retryCount}
                      </p>
                    )}
                  </div>

                  {/* Timestamp */}
                  <span className="shrink-0 text-xs text-[var(--muted)]" title={new Date(entry.createdAt).toLocaleString()}>
                    {timeAgo(entry.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
