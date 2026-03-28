"use client";

import type { AnalyticsDTO } from "@/types/dashboard";

function formatMinutes(mins: number | null): string {
  if (mins == null) return "--";
  if (mins < 1) return "<1m";
  if (mins < 60) return `${Math.round(mins)}m`;
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h`;
  return `${(mins / 1440).toFixed(1)}d`;
}

const typeColors: Record<string, string> = {
  movie: "var(--movie)",
  tv: "var(--tv)",
  music: "var(--music)",
  book: "var(--book)",
};

interface AnalyticsGridProps {
  analytics: AnalyticsDTO;
}

export default function AnalyticsGrid({ analytics }: AnalyticsGridProps) {
  const { requests, fulfillment, indexers, topRequesters } = analytics;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Request Stats */}
      <div className="rounded-xl p-4 ring-1 ring-[var(--border)]" style={{ background: "var(--card)" }}>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Requests
        </h4>
        <p className="text-3xl font-bold">{requests.total}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["movie", "tv", "music", "book"] as const).map((type) => (
            <div key={type} className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full" style={{ background: typeColors[type] }} />
              <span className="text-xs text-[var(--muted)]">
                {type.charAt(0).toUpperCase() + type.slice(1)}: {requests.byType[type] || 0}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(requests.byStatus).map(([status, count]) => (
            <span key={status} className="text-xs text-[var(--muted)]">
              {status}: <span className="font-medium text-[var(--foreground)]">{count}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Fulfillment Times */}
      <div className="rounded-xl p-4 ring-1 ring-[var(--border)]" style={{ background: "var(--card)" }}>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Fulfillment Speed
        </h4>
        <div className="space-y-3">
          <div>
            <p className="text-xs text-[var(--muted)]">Avg Approval</p>
            <p className="text-2xl font-bold">{formatMinutes(fulfillment.avgApprovalMinutes)}</p>
            <p className="text-[10px] text-[var(--muted)]">
              Median: {formatMinutes(fulfillment.medianApprovalMinutes)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Avg Download</p>
            <p className="text-2xl font-bold">{formatMinutes(fulfillment.avgFulfillmentMinutes)}</p>
            <p className="text-[10px] text-[var(--muted)]">
              Median: {formatMinutes(fulfillment.medianFulfillmentMinutes)}
            </p>
          </div>
        </div>
      </div>

      {/* Indexer Performance */}
      <div className="rounded-xl p-4 ring-1 ring-[var(--border)]" style={{ background: "var(--card)" }}>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Indexers
        </h4>
        {indexers.indexers.length > 0 ? (
          <div className="space-y-2">
            {indexers.indexers.slice(0, 6).map((idx) => (
              <div key={`${idx.source}-${idx.name}`} className="flex items-center justify-between text-xs">
                <span className="truncate font-medium">{idx.name}</span>
                <div className="flex items-center gap-3 text-[var(--muted)]">
                  <span>{idx.grabs} grabs</span>
                  <span
                    style={{
                      color: idx.failureRate > 30 ? "var(--danger)" : idx.failureRate > 15 ? "var(--warning)" : "var(--success)",
                    }}
                  >
                    {idx.failureRate.toFixed(0)}% fail
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">No indexer data available</p>
        )}
        {indexers.recommendations.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-2">
            {indexers.recommendations.map((rec, i) => (
              <p key={i} className="text-[11px] text-[var(--warning)]">{rec}</p>
            ))}
          </div>
        )}
      </div>

      {/* Top Requesters */}
      <div className="rounded-xl p-4 ring-1 ring-[var(--border)]" style={{ background: "var(--card)" }}>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Top Requesters
        </h4>
        {topRequesters.length > 0 ? (
          <div className="space-y-2">
            {topRequesters.slice(0, 5).map((user, i) => (
              <div key={i} className="flex items-center gap-2">
                {user.avatar ? (
                  <img src={user.avatar} alt={user.name} className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <div
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ background: "var(--accent)", color: "#fff" }}
                  >
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="flex-1 truncate text-sm">{user.name}</span>
                <span className="text-xs font-medium text-[var(--muted)]">{user.count}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">No requests yet</p>
        )}
      </div>
    </div>
  );
}
