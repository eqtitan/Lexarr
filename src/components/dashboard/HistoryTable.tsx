"use client";

interface HistoryEvent {
  id: number;
  eventType: string;
  title: string;
  date: string | null;
  dateAgo: string | null;
  quality: string | null;
}

interface HistoryTableProps {
  events: HistoryEvent[];
}

const EVENT_CONFIG: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  grabbed: {
    label: "Grabbed",
    color: "var(--tv)",
    icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4",
  },
  downloadFolderImported: {
    label: "Imported",
    color: "var(--success)",
    icon: "M5 13l4 4L19 7",
  },
  downloadFailed: {
    label: "Failed",
    color: "var(--danger)",
    icon: "M6 18L18 6M6 6l12 12",
  },
  movieFileDeleted: {
    label: "Deleted",
    color: "var(--muted)",
    icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  },
  episodeFileDeleted: {
    label: "Deleted",
    color: "var(--muted)",
    icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  },
  trackFileDeleted: {
    label: "Deleted",
    color: "var(--muted)",
    icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  },
  downloadIgnored: {
    label: "Ignored",
    color: "var(--warning)",
    icon: "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878l4.242 4.242M21 21l-4.878-4.878",
  },
};

function getEventConfig(eventType: string) {
  return (
    EVENT_CONFIG[eventType] || {
      label: eventType,
      color: "var(--muted)",
      icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    }
  );
}

export default function HistoryTable({ events }: HistoryTableProps) {
  if (events.length === 0) {
    return (
      <div
        className="rounded-xl p-6 text-center ring-1 ring-[var(--border)]"
        style={{ background: "var(--card)" }}
      >
        <p className="text-sm text-[var(--muted)]">No recent history</p>
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
                Event
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                Title
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                Quality
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((evt) => {
              const config = getEventConfig(evt.eventType);
              return (
                <tr
                  key={evt.id}
                  className="transition-colors hover:bg-[var(--card-hover)]"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <svg
                        className="h-4 w-4 shrink-0"
                        style={{ color: config.color }}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d={config.icon}
                        />
                      </svg>
                      <span
                        className="text-xs font-medium"
                        style={{ color: config.color }}
                      >
                        {config.label}
                      </span>
                    </div>
                  </td>
                  <td className="max-w-[250px] truncate px-4 py-3 font-medium">
                    {evt.title}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">
                    {evt.dateAgo || "--"}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">
                    {evt.quality || "--"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
