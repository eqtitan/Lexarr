"use client";

interface CalendarItem {
  id: number;
  title: string;
  date: string | null;
  releaseType: string;
  monitored: boolean;
}

interface CalendarPanelProps {
  items: CalendarItem[];
}

const RELEASE_LABELS: Record<string, string> = {
  air: "Airing",
  theater: "In Theaters",
  physical: "Physical Release",
  digital: "Digital Release",
};

export default function CalendarPanel({ items }: CalendarPanelProps) {
  if (items.length === 0) {
    return (
      <div
        className="rounded-xl p-6 text-center ring-1 ring-[var(--border)]"
        style={{ background: "var(--card)" }}
      >
        <p className="text-sm text-[var(--muted)]">No upcoming releases</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-xl p-4 ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--card-hover)]"
          style={{ background: "var(--card)" }}
        >
          <div className="mb-1 font-medium leading-snug">{item.title}</div>
          {item.date && (
            <div className="text-xs text-[var(--muted)]">
              {new Date(item.date).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          )}
          <div className="mt-2">
            <span
              className="rounded-md px-2 py-0.5 text-[10px] font-medium"
              style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}
            >
              {RELEASE_LABELS[item.releaseType] || item.releaseType}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
