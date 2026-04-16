"use client";

import type { DashboardData } from "@/types/dashboard";

interface KpiProps {
  data: DashboardData;
  onOpenTab: (tab: "overview" | "approvals" | "pipeline" | "analytics") => void;
}

export default function DashboardKpis({ data, onOpenTab }: KpiProps) {
  const totalServices = data.services.length;
  const healthyServices = data.services.filter((s) => s.healthy).length;
  const allHealthy = healthyServices === totalServices;
  const downServices = data.services.filter((s) => !s.healthy);

  const pendingCount = data.pipeline.pending.length;
  const activeCount = data.pipeline.active.length;
  const queueCount = data.queue.length;
  const queueSizeGB = data.queue.reduce((sum, q) => sum + q.sizeGB, 0);
  const queueProgressGB = data.queue.reduce((sum, q) => sum + q.downloadedGB, 0);
  const queueProgressPct =
    queueSizeGB > 0 ? (queueProgressGB / queueSizeGB) * 100 : 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* Stack Health */}
      <div
        className="group relative overflow-hidden rounded-xl px-4 py-3 ring-1 ring-[var(--border)] transition-all hover:ring-[var(--accent)]/60"
        style={{ background: "var(--card)" }}
      >
        <div className="flex items-stretch gap-3">
          <button
            onClick={() => onOpenTab("overview")}
            className="block shrink-0 text-left"
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-flex h-2 w-2 rounded-full"
                style={{
                  background: allHealthy ? "var(--success)" : "var(--danger)",
                  boxShadow: allHealthy
                    ? "0 0 6px var(--success)"
                    : "0 0 6px var(--danger)",
                }}
              />
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                Stack Health
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span
                className="text-2xl font-bold tabular-nums"
                style={{
                  color: allHealthy ? "var(--success)" : "var(--danger)",
                }}
              >
                {healthyServices}
              </span>
              <span className="text-sm text-[var(--muted)]">/ {totalServices}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {allHealthy
                ? "All services healthy"
                : `${downServices.length} service${downServices.length === 1 ? "" : "s"} down`}
            </p>
          </button>
          {!allHealthy && (
            <>
              <div
                className="w-px shrink-0 self-stretch"
                style={{ background: "var(--border)" }}
                aria-hidden="true"
              />
              <div className="flex flex-1 flex-wrap content-start items-start justify-end gap-1.5">
                {downServices.map((svc) => (
                  <a
                    key={svc.name}
                    href={svc.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={svc.error || `${svc.name} is unreachable`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors hover:brightness-125"
                    style={{
                      background: "rgba(239,68,68,0.14)",
                      color: "var(--danger)",
                      border: "1px solid rgba(239,68,68,0.35)",
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: "var(--danger)" }}
                    />
                    {svc.name}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Pending Approvals */}
      <button
        onClick={() => onOpenTab("approvals")}
        className="group relative overflow-hidden rounded-xl px-4 py-3 text-left ring-1 ring-[var(--border)] transition-all hover:ring-[var(--accent)]/60"
        style={{ background: "var(--card)" }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
          Pending Approvals
        </span>
        <div className="mt-1 flex items-baseline gap-1">
          <span
            className="text-2xl font-bold tabular-nums"
            style={{
              color:
                pendingCount > 0 ? "var(--warning)" : "var(--muted)",
            }}
          >
            {pendingCount}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
          {pendingCount === 0
            ? "Nothing awaiting review"
            : pendingCount === 1
              ? "request to review"
              : "requests to review"}
        </p>
      </button>

      {/* Active Downloads */}
      <button
        onClick={() => onOpenTab("pipeline")}
        className="group relative overflow-hidden rounded-xl px-4 py-3 text-left ring-1 ring-[var(--border)] transition-all hover:ring-[var(--accent)]/60"
        style={{ background: "var(--card)" }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
          Active Downloads
        </span>
        <div className="mt-1 flex items-baseline gap-1">
          <span
            className="text-2xl font-bold tabular-nums"
            style={{
              color: activeCount > 0 ? "var(--accent)" : "var(--muted)",
            }}
          >
            {activeCount}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
          {activeCount === 0
            ? "No active requests"
            : activeCount === 1
              ? "request in progress"
              : "requests in progress"}
        </p>
      </button>

      {/* Download Queue */}
      <button
        onClick={() => onOpenTab("pipeline")}
        className="group relative overflow-hidden rounded-xl px-4 py-3 text-left ring-1 ring-[var(--border)] transition-all hover:ring-[var(--accent)]/60"
        style={{ background: "var(--card)" }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
          Download Queue
        </span>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-2xl font-bold tabular-nums">{queueCount}</span>
          <span className="text-sm text-[var(--muted)]">
            {queueSizeGB > 0 && ` · ${queueSizeGB.toFixed(1)} GB`}
          </span>
        </div>
        {queueSizeGB > 0 ? (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${queueProgressPct}%`,
                background: "var(--accent)",
              }}
            />
          </div>
        ) : (
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">Empty</p>
        )}
      </button>

    </div>
  );
}
