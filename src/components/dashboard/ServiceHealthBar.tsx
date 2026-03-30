"use client";

import type { ServiceHealthDTO } from "@/types/dashboard";

const CATEGORY_LABELS: Record<string, string> = {
  arr: "Arr Apps",
  download: "Download Clients",
  media: "Media Servers",
  utility: "Utilities",
};

const CATEGORY_ORDER = ["arr", "download", "media", "utility"];

export default function ServiceHealthBar({ services }: { services: ServiceHealthDTO[] }) {
  // Group by category, preserving order
  const grouped = CATEGORY_ORDER.reduce<Record<string, ServiceHealthDTO[]>>((acc, cat) => {
    const items = services.filter((s) => (s.category || "arr") === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([category, svcs]) => (
        <div key={category}>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
            {CATEGORY_LABELS[category] || category}
          </p>
          <div className="flex flex-wrap gap-2">
            {svcs.map((svc) => (
              <a
                key={svc.name}
                href={svc.url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-[var(--border)] transition-all hover:ring-[var(--accent)]/50 hover:bg-[var(--card-hover)]"
                title={svc.error || `${svc.responseMs}ms`}
              >
                <div
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{
                    background: svc.healthy ? "var(--success)" : "var(--danger)",
                    boxShadow: svc.healthy
                      ? "0 0 6px var(--success)"
                      : "0 0 6px var(--danger)",
                  }}
                />
                <span>{svc.name}</span>
                {svc.healthy ? (
                  <span className="text-xs text-[var(--muted)]">{svc.responseMs}ms</span>
                ) : (
                  <span className="text-xs text-[var(--danger)]">down</span>
                )}
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
