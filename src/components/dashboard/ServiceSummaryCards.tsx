"use client";

interface ServiceSummaryCardsProps {
  library: {
    totalItems: number;
    withFiles: number;
    sizeOnDiskGB: number;
    totalEpisodes?: number;
    totalAlbums?: number;
  };
  storage: {
    path: string;
    freeGB: number;
    totalGB: number;
    usedGB: number;
    percentUsed: number;
  }[];
  queue: {
    total: number;
    byStatus: Record<string, number>;
  };
  wanted: {
    missingCount: number;
    cutoffCount: number;
  };
  service: string;
}

export default function ServiceSummaryCards({
  library,
  storage,
  queue,
  wanted,
  service,
}: ServiceSummaryCardsProps) {
  const largestMount = storage.reduce(
    (a, b) => (b.totalGB > a.totalGB ? b : a),
    storage[0] || { path: "N/A", freeGB: 0, totalGB: 0, usedGB: 0, percentUsed: 0 }
  );

  const libraryLabel =
    service === "radarr" ? "Movies" : service === "sonarr" ? "Series" : "Artists";
  const filesLabel =
    service === "radarr"
      ? `${library.withFiles} with files`
      : service === "sonarr"
        ? `${library.withFiles} episodes on disk`
        : `${library.withFiles} tracks on disk`;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {/* Library */}
      <div
        className="rounded-xl p-4 ring-1 ring-[var(--border)]"
        style={{ background: "var(--card)" }}
      >
        <div className="mb-2 flex items-center gap-2">
          <svg className="h-5 w-5" style={{ color: "var(--accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span className="text-sm font-medium text-[var(--muted)]">Library</span>
        </div>
        <div className="text-2xl font-bold">
          {library.totalItems.toLocaleString()}
        </div>
        <div className="mt-1 text-xs text-[var(--muted)]">{libraryLabel}</div>
        <div className="mt-0.5 text-xs text-[var(--muted)]">{filesLabel}</div>
        <div className="mt-1 text-xs text-[var(--muted)]">{library.sizeOnDiskGB} GB on disk</div>
      </div>

      {/* Storage */}
      <div
        className="rounded-xl p-4 ring-1 ring-[var(--border)]"
        style={{ background: "var(--card)" }}
      >
        <div className="mb-2 flex items-center gap-2">
          <svg className="h-5 w-5" style={{ color: "var(--warning)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3z" />
          </svg>
          <span className="text-sm font-medium text-[var(--muted)]">Storage</span>
        </div>
        <div className="text-2xl font-bold">{largestMount.freeGB} GB</div>
        <div className="mt-1 text-xs text-[var(--muted)]">
          free of {largestMount.totalGB} GB
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(largestMount.percentUsed, 100)}%`,
              background:
                largestMount.percentUsed > 90
                  ? "var(--danger)"
                  : largestMount.percentUsed > 75
                    ? "var(--warning)"
                    : "var(--success)",
            }}
          />
        </div>
        <div className="mt-1 text-xs text-[var(--muted)]">{largestMount.percentUsed}% used</div>
      </div>

      {/* Queue */}
      <div
        className="rounded-xl p-4 ring-1 ring-[var(--border)]"
        style={{ background: "var(--card)" }}
      >
        <div className="mb-2 flex items-center gap-2">
          <svg className="h-5 w-5" style={{ color: "var(--success)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span className="text-sm font-medium text-[var(--muted)]">Queue</span>
        </div>
        <div className="text-2xl font-bold">{queue.total}</div>
        <div className="mt-1 text-xs text-[var(--muted)]">active items</div>
        {Object.entries(queue.byStatus).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(queue.byStatus).map(([status, count]) => (
              <span
                key={status}
                className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  background:
                    status === "downloading"
                      ? "rgba(34,197,94,0.15)"
                      : status === "paused"
                        ? "rgba(245,158,11,0.15)"
                        : "rgba(99,102,241,0.15)",
                  color:
                    status === "downloading"
                      ? "var(--success)"
                      : status === "paused"
                        ? "var(--warning)"
                        : "var(--accent)",
                }}
              >
                {count} {status}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Wanted */}
      <div
        className="rounded-xl p-4 ring-1 ring-[var(--border)]"
        style={{ background: "var(--card)" }}
      >
        <div className="mb-2 flex items-center gap-2">
          <svg className="h-5 w-5" style={{ color: "var(--danger)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium text-[var(--muted)]">Wanted</span>
        </div>
        <div className="text-2xl font-bold">{wanted.missingCount}</div>
        <div className="mt-1 text-xs text-[var(--muted)]">missing</div>
        <div className="mt-0.5 text-xs text-[var(--muted)]">
          {wanted.cutoffCount} below cutoff
        </div>
      </div>
    </div>
  );
}
