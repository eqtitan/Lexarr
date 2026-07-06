"use client";

import { useState } from "react";
import type { OrphanItem } from "@/types/dashboard";

interface OrphansPanelProps {
  /** undefined = still loading, null = fetch failed, [] = clean */
  orphans: OrphanItem[] | null | undefined;
  onRemove: (
    hash: string,
    deleteFiles: boolean,
    folderName: string,
  ) => Promise<void>;
}

function LibraryBadge({ arrHasFile }: { arrHasFile: boolean | null }) {
  if (arrHasFile === true) {
    return (
      <span
        className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={{
          background: "rgba(34,197,94,0.15)",
          color: "var(--success)",
        }}
      >
        In library ✓
      </span>
    );
  }
  if (arrHasFile === false) {
    return (
      <span
        className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={{
          background: "rgba(239,68,68,0.12)",
          color: "var(--danger)",
        }}
      >
        Not in library
      </span>
    );
  }
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{
        background: "rgba(245,158,11,0.12)",
        color: "var(--warning)",
      }}
    >
      Unconfirmed
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-[var(--border)]">
      {[70, 45, 35, 55, 80].map((w, i) => (
        <td key={i} className="px-3 py-2.5">
          <div
            className="h-3 animate-pulse rounded"
            style={{
              width: `${w}%`,
              background: "var(--border)",
            }}
          />
        </td>
      ))}
    </tr>
  );
}

export default function OrphansPanel({ orphans, onRemove }: OrphansPanelProps) {
  const [inflight, setInflight] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  async function doRemove(
    item: OrphanItem,
    deleteFiles: boolean,
  ) {
    if (!item.qbHash) return;
    const key = item.qbHash;
    const action = deleteFiles ? "remove-files" : "remove";
    setInflight((p) => ({ ...p, [key]: action }));
    setRowError((p) => {
      const { [key]: _, ...rest } = p;
      return rest;
    });
    try {
      await onRemove(item.qbHash, deleteFiles, item.folderName);
    } catch (err: unknown) {
      setRowError((p) => ({
        ...p,
        [key]: err instanceof Error ? err.message : "Remove failed",
      }));
    } finally {
      setInflight((p) => {
        const { [key]: _, ...rest } = p;
        return rest;
      });
    }
  }

  // Loading state
  if (orphans === undefined) {
    return (
      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Stuck Orphans
          </h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
              <th className="px-3 py-2 font-medium">Folder</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Stuck</th>
              <th className="px-3 py-2 font-medium">Library</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            <SkeletonRow />
            <SkeletonRow />
          </tbody>
        </table>
      </div>
    );
  }

  // Error / unavailable state
  if (orphans === null) {
    return (
      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <p className="text-xs text-[var(--muted)]">
          Orphan data unavailable — check that the{" "}
          <code className="rounded bg-[var(--border)] px-1">/stack-health</code>{" "}
          volume is mounted.
        </p>
      </div>
    );
  }

  // Clean state
  if (orphans.length === 0) {
    return (
      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <p className="text-xs text-[var(--muted)]">
          No stuck orphans found — stack is clean.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Stuck Orphans
          <span
            className="ml-2 rounded-full px-1.5 py-0.5 text-[10px]"
            style={{
              background: "rgba(245,158,11,0.15)",
              color: "var(--warning)",
            }}
          >
            {orphans.length}
          </span>
        </h3>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
            <th className="px-3 py-2 font-medium">Folder</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Stuck</th>
            <th className="px-3 py-2 font-medium">Library</th>
            <th className="px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {orphans.map((item) => {
            const key = item.qbHash ?? item.folderName;
            const busy = inflight[key];
            const err = rowError[key];
            const canAct = !!item.qbHash;

            return (
              <>
                <tr
                  key={key}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="max-w-[260px] truncate px-3 py-2.5 font-mono text-xs">
                    <span title={item.folderName}>{item.folderName}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs capitalize text-[var(--muted)]">
                    {item.category}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                    {item.daysStuck}d
                    {item.scanCount > 1 && (
                      <span className="ml-1 text-[10px] opacity-60">
                        ×{item.scanCount}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <LibraryBadge arrHasFile={item.arrHasFile} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {/* Remove torrent record only — files stay on disk */}
                      <button
                        onClick={() => doRemove(item, false)}
                        disabled={!canAct || !!busy}
                        className="rounded-md bg-[var(--card)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--card-hover)] disabled:opacity-40"
                        title={
                          canAct
                            ? "Remove torrent from qBittorrent (keep files on disk)"
                            : "No matching torrent found in qBittorrent"
                        }
                      >
                        {busy === "remove" ? "…" : "Remove"}
                      </button>

                      {/* Remove torrent + delete files — only safe when library already has it */}
                      <button
                        onClick={() => doRemove(item, true)}
                        disabled={!canAct || !item.safeToRemove || !!busy}
                        className="rounded-md px-2.5 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                        style={{ background: "var(--warning)" }}
                        title={
                          !canAct
                            ? "No matching torrent found in qBittorrent"
                            : !item.safeToRemove
                              ? "Only enabled when the library already has this content (arrHasFile = true)"
                              : "Remove torrent and delete files from disk"
                        }
                      >
                        {busy === "remove-files" ? "…" : "Remove + files"}
                      </button>
                    </div>
                  </td>
                </tr>
                {err && (
                  <tr
                    key={`${key}-err`}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td
                      colSpan={5}
                      className="px-3 pb-2 text-xs text-[var(--danger)]"
                    >
                      {err}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
