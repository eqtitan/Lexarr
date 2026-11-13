"use client";

/**
 * Admin notification inbox: request events across all users (new request,
 * available, failed, stalled, denied, cancelled), newest first. Items newer
 * than `seenAt` (when the admin last opened the tab) are highlighted.
 */

export interface ActivityItem {
  id: string;
  event: string;
  at: string;
  requestId: string;
  title: string;
  mediaType: string;
  currentStatus: string;
  user: string;
  summary: string | null;
}

const LABELS: Record<string, string> = {
  submitted: "New request",
  available: "Now available",
  failed: "Failed",
  stalled: "Stalled",
  denied: "Denied",
  cancelled: "Cancelled",
};

const COLORS: Record<string, string> = {
  submitted: "var(--accent)",
  available: "var(--success)",
  failed: "var(--danger)",
  stalled: "var(--warning)",
  denied: "var(--muted)",
  cancelled: "var(--muted)",
};

const MEDIA: Record<string, string> = { movie: "🎬", tv: "📺", music: "🎵", book: "📚" };

const FILTERS = [
  { id: "all", label: "All" },
  { id: "problems", label: "Problems" },
  { id: "available", label: "Available" },
  { id: "submitted", label: "Requests" },
] as const;
export type ActivityFilter = (typeof FILTERS)[number]["id"];

function matches(item: ActivityItem, filter: ActivityFilter): boolean {
  if (filter === "all") return true;
  if (filter === "problems") return item.event === "failed" || item.event === "stalled";
  return item.event === filter;
}

function ago(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function ActivityPanel({
  items,
  error,
  seenAt,
  filter,
  onFilter,
  days,
}: {
  items: ActivityItem[] | undefined;
  error: string | null;
  seenAt: number;
  filter: ActivityFilter;
  onFilter: (f: ActivityFilter) => void;
  days: number;
}) {
  const now = Date.now();
  const shown = (items ?? []).filter((i) => matches(i, filter));

  return (
    <div className="rounded-xl p-4 ring-1 ring-[var(--border)]" style={{ background: "var(--card)" }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Activity · last {days} days
        </h4>
        <div className="flex gap-1" role="group" aria-label="Filter activity">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => onFilter(f.id)}
              aria-pressed={filter === f.id}
              className="rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-[var(--border)] transition-colors"
              style={{
                color: filter === f.id ? "var(--foreground)" : "var(--muted)",
                background: filter === f.id ? "var(--background)" : "transparent",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mb-2 text-xs" style={{ color: "var(--danger)" }}>
          Couldn&apos;t load activity — {error}
        </p>
      )}

      {items === undefined && !error ? (
        <p className="text-xs text-[var(--muted)]">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">
          {filter === "all" ? "No request activity yet." : "Nothing here for this filter."}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {shown.map((i) => {
            const isNew = Date.parse(i.at) > seenAt;
            return (
              <li key={i.id} className="flex items-start gap-3 py-2 text-xs">
                <span
                  aria-hidden="true"
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: COLORS[i.event] ?? "var(--muted)", opacity: isNew ? 1 : 0.45 }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold" style={{ color: COLORS[i.event] ?? "var(--muted)" }}>
                      {LABELS[i.event] ?? i.event}
                    </span>
                    <span className="truncate font-medium">
                      {MEDIA[i.mediaType] ?? ""} {i.title}
                    </span>
                    {isNew && (
                      <span className="rounded px-1 text-[9px] font-bold uppercase text-white" style={{ background: "var(--accent)" }}>
                        new
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                    {i.user} · {ago(i.at, now)}
                    {i.currentStatus !== i.event && ` · now ${i.currentStatus}`}
                  </div>
                  {i.summary && <div className="mt-0.5 break-words text-[11px] text-[var(--muted)]">{i.summary}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
