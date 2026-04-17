"use client";

import { useEffect, useState } from "react";

interface LivePillProps {
  /** ISO timestamp of the last successful fetch */
  lastUpdatedAt: string | null;
  /** Whether polling is actively running (not paused, not backgrounded) */
  isLive: boolean;
  /** Reason polling is suspended, if any (e.g. "Paused", "Tab hidden") */
  pausedReason?: string | null;
  /** User clicked the pill — toggle paused/live */
  onTogglePause: () => void;
  /** User clicked the refresh icon — force an immediate fetch */
  onForceRefresh: () => void;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function LivePill({
  lastUpdatedAt,
  isLive,
  pausedReason,
  onTogglePause,
  onForceRefresh,
}: LivePillProps) {
  // Local tick so the "Xs ago" label updates without waiting on parent
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const dotColor = isLive ? "var(--success)" : "var(--muted)";
  const dotGlow = isLive ? "0 0 6px var(--success)" : "none";

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 ring-[var(--border)]"
      style={{ background: "var(--card)" }}
    >
      <button
        onClick={onTogglePause}
        className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
        title={
          isLive
            ? "Auto-refresh is running — click to pause"
            : pausedReason
              ? `Paused: ${pausedReason} — click to resume`
              : "Paused — click to resume"
        }
      >
        <span
          className={`inline-flex h-2 w-2 rounded-full ${isLive ? "animate-pulse" : ""}`}
          style={{ background: dotColor, boxShadow: dotGlow }}
        />
        <span className="font-medium" style={{ color: isLive ? "var(--foreground)" : "var(--muted)" }}>
          {isLive ? "Live" : pausedReason || "Paused"}
        </span>
      </button>
      <span className="text-[var(--muted)]">·</span>
      <span className="text-[var(--muted)] tabular-nums">{formatRelative(lastUpdatedAt)}</span>
      <button
        onClick={onForceRefresh}
        className="ml-1 flex h-4 w-4 items-center justify-center text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
        title="Refresh now"
        aria-label="Refresh now"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582M20 20v-5h-.581M4.582 9a8 8 0 0114.419-3M19.418 15a8 8 0 01-14.419 3"
          />
        </svg>
      </button>
    </div>
  );
}
