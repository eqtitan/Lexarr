"use client";

import type { IndexerPerformance } from "@/types/dashboard";

export default function IndexerPerformancePanel({
  indexers,
}: {
  indexers: IndexerPerformance;
}) {
  return (
    <div
      className="rounded-xl p-4 ring-1 ring-[var(--border)]"
      style={{ background: "var(--card)" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Indexer Performance
        </h4>
        {indexers.indexers.length > 0 && (
          <span className="text-[11px] text-[var(--muted)]">
            {indexers.indexers.length} indexer
            {indexers.indexers.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {indexers.indexers.length > 0 ? (
        <div className="space-y-2">
          {indexers.indexers.slice(0, 8).map((idx) => (
            <div
              key={idx.name}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium">{idx.name}</span>
                <div className="flex shrink-0 gap-0.5">
                  {idx.sources.map((s) => (
                    <span
                      key={s}
                      className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase text-[var(--muted)] ring-1 ring-[var(--border)]"
                    >
                      {s.charAt(0)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-[var(--muted)] tabular-nums">
                <span>{idx.grabs.toLocaleString()} grabs</span>
                <span
                  style={{
                    color:
                      idx.failureRate > 30
                        ? "var(--danger)"
                        : idx.failureRate > 15
                          ? "var(--warning)"
                          : "var(--success)",
                  }}
                >
                  {idx.failureRate.toFixed(0)}% fail
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          No indexer data available
        </p>
      )}
      {indexers.recommendations.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-2">
          {indexers.recommendations.map((rec, i) => (
            <p key={i} className="text-[11px] text-[var(--warning)]">
              {rec}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
