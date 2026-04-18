"use client";

import { useRef } from "react";

interface LivePillProps {
  /**
   * ISO timestamp of the last successful fetch. Still accepted for
   * forwards-compat but no longer displayed — the pill's dot color +
   * state label conveys freshness more cleanly than a ticking counter.
   */
  lastUpdatedAt?: string | null;
  /** Whether polling is actively running (not paused, not backgrounded) */
  isLive: boolean;
  /** Reason polling is suspended, if any (e.g. "Paused", "Tab hidden") */
  pausedReason?: string | null;
  /** User clicked the pill — toggle paused/live */
  onTogglePause: () => void;
  /** User hovered the pill — force an immediate fetch (throttled) */
  onForceRefresh: () => void;
}

/**
 * Compact status pill for the admin dashboard.
 *
 *   Click  → toggles pause / resume (user-controlled freshness pause)
 *   Hover  → triggers an immediate refresh (throttled to once per 3s
 *            so mouse-over-while-scrolling doesn't hammer the API)
 *
 * The dot color + label convey state: green+pulse = Live, muted-grey
 * = Paused. No "Xs ago" clutter — the dot being green is the signal
 * that data is fresh.
 */
const HOVER_REFRESH_THROTTLE_MS = 3_000;

export default function LivePill({
  isLive,
  pausedReason,
  onTogglePause,
  onForceRefresh,
}: LivePillProps) {
  const lastHoverRefreshRef = useRef<number>(0);

  function handleMouseEnter() {
    if (!isLive) return; // Don't refresh while explicitly paused
    const now = Date.now();
    if (now - lastHoverRefreshRef.current >= HOVER_REFRESH_THROTTLE_MS) {
      lastHoverRefreshRef.current = now;
      onForceRefresh();
    }
  }

  const dotColor = isLive ? "var(--success)" : "var(--muted)";
  const dotGlow = isLive ? "0 0 6px var(--success)" : "none";

  return (
    <button
      type="button"
      onClick={onTogglePause}
      onMouseEnter={handleMouseEnter}
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 ring-[var(--border)] transition-opacity hover:opacity-80"
      style={{ background: "var(--card)" }}
      title={
        isLive
          ? "Live — auto-refreshing. Hover to refresh now, click to pause."
          : pausedReason
            ? `Paused: ${pausedReason} — click to resume`
            : "Paused — click to resume"
      }
    >
      <span
        className={`inline-flex h-2 w-2 rounded-full ${isLive ? "animate-pulse" : ""}`}
        style={{ background: dotColor, boxShadow: dotGlow }}
        aria-hidden="true"
      />
      <span
        className="font-medium"
        style={{ color: isLive ? "var(--foreground)" : "var(--muted)" }}
      >
        {isLive ? "Live" : pausedReason || "Paused"}
      </span>
    </button>
  );
}
