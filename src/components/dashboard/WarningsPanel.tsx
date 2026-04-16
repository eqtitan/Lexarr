"use client";

import type { DashboardWarning, WarningSeverity } from "@/types/dashboard";

const severityConfig: Record<
  WarningSeverity,
  { border: string; bg: string; icon: string }
> = {
  critical: {
    border: "var(--danger)",
    bg: "rgba(239,68,68,0.08)",
    icon: "\u26A0",
  },
  warning: {
    border: "var(--warning)",
    bg: "rgba(245,158,11,0.08)",
    icon: "\u25B2",
  },
  info: {
    border: "var(--accent)",
    bg: "rgba(99,102,241,0.08)",
    icon: "\u2139",
  },
};

const severityLabels: Record<WarningSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

interface WarningsPanelProps {
  warnings: DashboardWarning[];
}

export default function WarningsPanel({ warnings }: WarningsPanelProps) {
  if (warnings.length === 0) return null;

  const grouped: Record<WarningSeverity, DashboardWarning[]> = {
    critical: [],
    warning: [],
    info: [],
  };

  for (const w of warnings) {
    grouped[w.severity].push(w);
  }

  return (
    <div className="space-y-3">
      {(["critical", "warning", "info"] as WarningSeverity[]).map(
        (severity) => {
          const items = grouped[severity];
          if (items.length === 0) return null;

          const config = severityConfig[severity];

          return (
            <div key={severity} className="space-y-2">
              {items.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg border-l-4 px-4 py-3"
                  style={{
                    borderLeftColor: config.border,
                    background: config.bg,
                  }}
                >
                  <span className="flex-shrink-0 text-sm">{config.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{w.title}</p>
                    {w.detail && (
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {w.detail}
                      </p>
                    )}
                  </div>
                  <span
                    className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                    style={{ color: config.border }}
                  >
                    {severityLabels[severity]}
                  </span>
                </div>
              ))}
            </div>
          );
        },
      )}
    </div>
  );
}
