"use client";

import { useState } from "react";
import type { PipelineRequestDTO } from "@/types/dashboard";
import StatusBadge from "./StatusBadge";
import ProgressBar from "./ProgressBar";
import PipelineTimeline from "./PipelineTimeline";

const typeColors: Record<string, string> = {
  movie: "var(--movie)",
  tv: "var(--tv)",
  music: "var(--music)",
  book: "var(--book)",
};

const typeLabels: Record<string, string> = {
  movie: "Movie",
  tv: "TV",
  music: "Music",
  book: "Book",
};

interface PipelineTableProps {
  title: string;
  requests: PipelineRequestDTO[];
  showProgress?: boolean;
  onRetry?: (id: string) => void;
}

export default function PipelineTable({ title, requests, showProgress = false, onRetry }: PipelineTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  if (requests.length === 0) return null;

  async function handleRetry(id: string) {
    if (!onRetry) return;
    setRetryingId(id);
    onRetry(id);
    // Reset after a brief delay (parent will refresh data)
    setTimeout(() => setRetryingId(null), 2000);
  }

  return (
    <div className="rounded-xl ring-1 ring-[var(--border)]" style={{ background: "var(--card)" }}>
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          {title}
          <span className="ml-2 text-[var(--foreground)]">{requests.length}</span>
        </h3>
      </div>

      <div className="divide-y divide-[var(--border)]">
        {requests.map((req) => {
          const isExpanded = expandedId === req.id;
          const progress = req.queueItem?.progress ?? 0;
          const eta = req.queueItem?.eta;
          const isStuckApproved = req.status === "approved" && !req.arrId && !req.queueItem;
          const canRetry = ((req.status === "failed" || req.status === "stalled") && (req.retryCount ?? 0) < 3) || isStuckApproved;

          return (
            <div key={req.id}>
              {/* Collapsed row */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : req.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--card-hover)]"
              >
                {/* Poster */}
                {req.posterPath ? (
                  <img
                    src={req.posterPath}
                    alt={req.title}
                    className="h-10 w-7 flex-shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-10 w-7 flex-shrink-0 rounded" style={{ background: "var(--border)" }} />
                )}

                {/* Title + type */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {req.title}
                    {req.year && (
                      <span className="ml-1 text-[var(--muted)]">({req.year})</span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                      style={{ background: typeColors[req.mediaType] || "var(--muted)" }}
                    >
                      {typeLabels[req.mediaType] || req.mediaType}
                    </span>
                    <span className="text-xs text-[var(--muted)]">{req.user.name}</span>
                    {(req.retryCount ?? 0) > 0 && (
                      <span className="text-[10px] text-[var(--warning)]">
                        Retry {req.retryCount}/3
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar (active items only) */}
                {showProgress && req.queueItem && (
                  <div className="w-24 flex-shrink-0">
                    <ProgressBar value={progress} height="3px" />
                    <p className="mt-0.5 text-[10px] text-[var(--muted)] text-right">
                      {progress.toFixed(0)}%{eta ? ` - ${eta}` : ""}
                    </p>
                  </div>
                )}

                {/* Retry button (inline, stops propagation) */}
                {canRetry && onRetry && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRetry(req.id); }}
                    disabled={retryingId === req.id}
                    className="flex-shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: "var(--accent)" }}
                  >
                    {retryingId === req.id ? "..." : "Retry"}
                  </button>
                )}

                {/* Status badge */}
                <StatusBadge status={req.status} />

                {/* Expand chevron */}
                <svg
                  className={`h-4 w-4 flex-shrink-0 text-[var(--muted)] transition-transform ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Expanded: timeline + error + details */}
              {isExpanded && (
                <div className="border-t border-[var(--border)] px-4 py-3" style={{ background: "var(--background)" }}>
                  {/* Error message for failed requests */}
                  {req.lastError && (req.status === "failed" || req.status === "stalled") && (
                    <div className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.1)", color: "var(--danger)" }}>
                      <span className="font-semibold">Error: </span>{req.lastError}
                    </div>
                  )}

                  {/* Admin note */}
                  {req.adminNote && (
                    <div className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(99,102,241,0.1)", color: "var(--accent)" }}>
                      <span className="font-semibold">Note: </span>{req.adminNote}
                    </div>
                  )}

                  <PipelineTimeline events={req.events} currentStatus={req.status} />
                  {req.queueItem && (
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--muted)] sm:grid-cols-4">
                      <div>
                        <span className="font-medium text-[var(--foreground)]">Size: </span>
                        {req.queueItem.sizeGB} GB
                      </div>
                      <div>
                        <span className="font-medium text-[var(--foreground)]">Downloaded: </span>
                        {req.queueItem.downloadedGB} GB
                      </div>
                      {req.queueItem.indexer && (
                        <div>
                          <span className="font-medium text-[var(--foreground)]">Indexer: </span>
                          {req.queueItem.indexer}
                        </div>
                      )}
                      {req.queueItem.downloadClient && (
                        <div>
                          <span className="font-medium text-[var(--foreground)]">Client: </span>
                          {req.queueItem.downloadClient}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
