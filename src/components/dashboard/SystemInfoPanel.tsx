"use client";

import { useState } from "react";

interface Task {
  name: string;
  interval: string | null;
  lastExecution: string | null;
  lastExecutionAgo: string | null;
  nextExecution: string | null;
  lastDuration: string | null;
}

interface DownloadClient {
  id: number;
  name: string;
  implementation: string;
  enabled: boolean;
  protocol: string;
}

interface RootFolder {
  id: number;
  path: string;
  freeSpaceGB: number;
  accessible: boolean;
}

interface QualityProfile {
  id: number;
  name: string;
}

interface BlocklistEntry {
  id: number;
  title: string;
  date: string | null;
  indexer: string | null;
}

interface SystemInfoPanelProps {
  tasks: Task[];
  downloadClients: DownloadClient[];
  qualityProfiles: QualityProfile[];
  rootFolders: RootFolder[];
  blocklist: { totalRecords: number; records: BlocklistEntry[] };
}

function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="rounded-xl ring-1 ring-[var(--border)]"
      style={{ background: "var(--card)" }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[var(--card-hover)]"
        style={{ borderRadius: open ? "0.75rem 0.75rem 0 0" : "0.75rem" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{title}</span>
          {count !== undefined && (
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                background: "rgba(99,102,241,0.15)",
                color: "var(--accent)",
              }}
            >
              {count}
            </span>
          )}
        </div>
        <svg
          className="h-4 w-4 text-[var(--muted)] transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {open && (
        <div style={{ borderTop: "1px solid var(--border)" }}>{children}</div>
      )}
    </div>
  );
}

export default function SystemInfoPanel({
  tasks,
  downloadClients,
  qualityProfiles,
  rootFolders,
  blocklist,
}: SystemInfoPanelProps) {
  return (
    <div className="space-y-3">
      {/* Scheduled Tasks */}
      <CollapsibleSection title="Scheduled Tasks" count={tasks.length}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)]">
                  Name
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)]">
                  Interval
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)]">
                  Last Run
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)]">
                  Next Run
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)]">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr
                  key={t.name}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td className="px-4 py-2 font-medium">{t.name}</td>
                  <td className="px-4 py-2 text-xs text-[var(--muted)]">
                    {t.interval || "--"}
                  </td>
                  <td className="px-4 py-2 text-xs text-[var(--muted)]">
                    {t.lastExecutionAgo || "--"}
                  </td>
                  <td className="px-4 py-2 text-xs text-[var(--muted)]">
                    {t.nextExecution
                      ? new Date(t.nextExecution).toLocaleTimeString()
                      : "--"}
                  </td>
                  <td className="px-4 py-2 text-xs text-[var(--muted)]">
                    {t.lastDuration || "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {/* Download Clients */}
      <CollapsibleSection
        title="Download Clients"
        count={downloadClients.length}
      >
        <div className="p-4 space-y-2">
          {downloadClients.map((dc) => (
            <div
              key={dc.id}
              className="flex items-center justify-between rounded-lg px-3 py-2 ring-1 ring-[var(--border)]"
              style={{ background: "var(--background)" }}
            >
              <div>
                <span className="text-sm font-medium">{dc.name}</span>
                <span className="ml-2 text-xs text-[var(--muted)]">
                  {dc.implementation}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted)]">
                  {dc.protocol}
                </span>
                <span
                  className="rounded-md px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    background: dc.enabled
                      ? "rgba(34,197,94,0.15)"
                      : "rgba(239,68,68,0.15)",
                    color: dc.enabled ? "var(--success)" : "var(--danger)",
                  }}
                >
                  {dc.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Quality Profiles */}
      <CollapsibleSection
        title="Quality Profiles"
        count={qualityProfiles.length}
      >
        <div className="flex flex-wrap gap-2 p-4">
          {qualityProfiles.map((qp) => (
            <span
              key={qp.id}
              className="rounded-full px-3 py-1 text-xs font-medium ring-1 ring-[var(--border)]"
              style={{ background: "var(--background)" }}
            >
              {qp.name}
            </span>
          ))}
        </div>
      </CollapsibleSection>

      {/* Root Folders */}
      <CollapsibleSection title="Root Folders" count={rootFolders.length}>
        <div className="p-4 space-y-2">
          {rootFolders.map((rf) => (
            <div
              key={rf.id}
              className="flex items-center justify-between rounded-lg px-3 py-2 ring-1 ring-[var(--border)]"
              style={{ background: "var(--background)" }}
            >
              <span className="text-sm font-mono">{rf.path}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted)]">
                  {rf.freeSpaceGB} GB free
                </span>
                <span
                  className="rounded-md px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    background: rf.accessible
                      ? "rgba(34,197,94,0.15)"
                      : "rgba(239,68,68,0.15)",
                    color: rf.accessible ? "var(--success)" : "var(--danger)",
                  }}
                >
                  {rf.accessible ? "Accessible" : "Inaccessible"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Blocklist */}
      <CollapsibleSection title="Blocklist" count={blocklist.totalRecords}>
        {blocklist.records.length === 0 ? (
          <div className="p-4 text-center text-sm text-[var(--muted)]">
            No blocklist entries
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)]">
                    Title
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)]">
                    Date
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)]">
                    Indexer
                  </th>
                </tr>
              </thead>
              <tbody>
                {blocklist.records.map((b) => (
                  <tr
                    key={b.id}
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <td className="max-w-[250px] truncate px-4 py-2 font-medium">
                      {b.title}
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--muted)]">
                      {b.date ? new Date(b.date).toLocaleDateString() : "--"}
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--muted)]">
                      {b.indexer || "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
