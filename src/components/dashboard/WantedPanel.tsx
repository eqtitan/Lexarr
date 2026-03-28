"use client";

import { useState } from "react";

interface WantedRecord {
  id: number;
  title: string;
  year: number | string | null;
  monitored: boolean;
  status: string | null;
}

interface WantedPanelProps {
  missingCount: number;
  cutoffCount: number;
  missingRecords: WantedRecord[];
  cutoffRecords: WantedRecord[];
}

export default function WantedPanel({
  missingCount,
  cutoffCount,
  missingRecords,
  cutoffRecords,
}: WantedPanelProps) {
  const [tab, setTab] = useState<"missing" | "cutoff">("missing");
  const records = tab === "missing" ? missingRecords : cutoffRecords;

  return (
    <div
      className="overflow-hidden rounded-xl ring-1 ring-[var(--border)]"
      style={{ background: "var(--card)" }}
    >
      {/* Tabs */}
      <div className="flex" style={{ borderBottom: "1px solid var(--border)" }}>
        <button
          onClick={() => setTab("missing")}
          className="px-4 py-2.5 text-sm font-medium transition-colors"
          style={{
            color: tab === "missing" ? "var(--accent)" : "var(--muted)",
            borderBottom: tab === "missing" ? "2px solid var(--accent)" : "2px solid transparent",
          }}
        >
          Missing ({missingCount})
        </button>
        <button
          onClick={() => setTab("cutoff")}
          className="px-4 py-2.5 text-sm font-medium transition-colors"
          style={{
            color: tab === "cutoff" ? "var(--accent)" : "var(--muted)",
            borderBottom: tab === "cutoff" ? "2px solid var(--accent)" : "2px solid transparent",
          }}
        >
          Below Cutoff ({cutoffCount})
        </button>
      </div>

      {/* Content */}
      {records.length === 0 ? (
        <div className="p-6 text-center text-sm text-[var(--muted)]">
          No {tab === "missing" ? "missing" : "cutoff unmet"} items
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">Title</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">Year / Season</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">Monitored</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr
                  key={r.id}
                  className="transition-colors hover:bg-[var(--card-hover)]"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td className="max-w-[250px] truncate px-4 py-3 font-medium">{r.title}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{r.year ?? "--"}</td>
                  <td className="px-4 py-3">
                    <span
                      className="rounded-md px-2 py-0.5 text-xs font-medium"
                      style={{
                        background: r.monitored ? "rgba(34,197,94,0.15)" : "rgba(107,114,128,0.15)",
                        color: r.monitored ? "var(--success)" : "var(--muted)",
                      }}
                    >
                      {r.monitored ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{r.status || "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
