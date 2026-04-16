"use client";

interface QueueItem {
  id: number;
  title: string;
  status: string;
  progress: number;
  sizeGB: number;
  downloadedGB: number;
  eta: string | null;
  indexer: string | null;
  downloadClient: string | null;
  quality: string | null;
  protocol: string | null;
}

interface QueueTableProps {
  items: QueueItem[];
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    downloading: { bg: "rgba(34,197,94,0.15)", fg: "var(--success)" },
    paused: { bg: "rgba(245,158,11,0.15)", fg: "var(--warning)" },
    queued: { bg: "rgba(99,102,241,0.15)", fg: "var(--accent)" },
    warning: { bg: "rgba(245,158,11,0.15)", fg: "var(--warning)" },
    failed: { bg: "rgba(239,68,68,0.15)", fg: "var(--danger)" },
  };
  const c = colors[status] || {
    bg: "rgba(107,114,128,0.15)",
    fg: "var(--muted)",
  };

  return (
    <span
      className="rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ background: c.bg, color: c.fg }}
    >
      {status}
    </span>
  );
}

export default function QueueTable({ items }: QueueTableProps) {
  if (items.length === 0) {
    return (
      <div
        className="rounded-xl p-6 text-center ring-1 ring-[var(--border)]"
        style={{ background: "var(--card)" }}
      >
        <p className="text-sm text-[var(--muted)]">No active downloads</p>
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-xl ring-1 ring-[var(--border)]"
      style={{ background: "var(--card)" }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                Title
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                Progress
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                Size
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                ETA
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                Client
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                Indexer
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                Quality
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                Protocol
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="transition-colors hover:bg-[var(--card-hover)]"
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td className="max-w-[200px] truncate px-4 py-3 font-medium">
                  {item.title}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={item.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-1.5 w-20 overflow-hidden rounded-full"
                      style={{ background: "var(--border)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(item.progress, 100)}%`,
                          background: "var(--accent)",
                        }}
                      />
                    </div>
                    <span className="text-xs text-[var(--muted)]">
                      {item.progress}%
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted)]">
                  {item.sizeGB} GB
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted)]">
                  {item.eta || "--"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted)]">
                  {item.downloadClient || "--"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted)]">
                  {item.indexer || "--"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted)]">
                  {item.quality || "--"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted)]">
                  {item.protocol || "--"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
