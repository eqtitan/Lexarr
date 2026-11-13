"use client";

import { useState, useCallback } from "react";
import { useApi } from "@/lib/use-api";
import PipelineTimeline from "@/components/dashboard/PipelineTimeline";
import type { PipelineEventDTO } from "@/types/dashboard";

interface RequestItem {
  id: string;
  mediaType: string;
  title: string;
  year?: string;
  posterPath?: string;
  status: string;
  lastError?: string | null;
  createdAt: string;
  updatedAt?: string;
}

const statusColors: Record<string, string> = {
  pending: "var(--warning)",
  approved: "var(--accent)",
  downloading: "var(--tv)",
  available: "var(--success)",
  denied: "var(--danger)",
  failed: "var(--danger)",
  stalled: "var(--warning)",
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  downloading: "Downloading",
  available: "Available",
  denied: "Denied",
  failed: "Failed",
  stalled: "Stalled",
};

const typeLabels: Record<string, string> = {
  movie: "Movie",
  tv: "TV",
  music: "Music",
  book: "Book",
};

/**
 * Derive a short, user-friendly badge label for the request pill.
 * When the poller has surfaced a reason, prefer it over the generic status word
 * so users see "Not Found", "Unreleased", etc. instead of "Downloading" forever.
 */
function deriveBadge(req: RequestItem): { label: string; tooltip: string } {
  const err = (req.lastError || "").trim();
  const lower = err.toLowerCase();

  // Stalled — broken down by reason
  if (req.status === "stalled") {
    if (lower.includes("no releases found") || lower.includes("indexers returned nothing")) {
      return { label: "Not Found", tooltip: err };
    }
    if (lower.includes("partial")) {
      return { label: "Partial — no more sources", tooltip: err };
    }
    if (lower.includes("no progress")) {
      return { label: "Stalled", tooltip: err };
    }
    return { label: "Stalled", tooltip: err || "Stalled — no progress detected" };
  }

  // Failed — includes arrId drift + max-retries
  if (req.status === "failed") {
    if (lower.includes("tracker drift") || lower.includes("arrid")) {
      return { label: "Tracker drift — re-request", tooltip: err };
    }
    if (lower.includes("not yet released")) {
      return { label: "Unreleased", tooltip: err };
    }
    return { label: "Not Found", tooltip: err || "Could not be delivered" };
  }

  // Approved but carrying a diagnostic note (e.g. "Awaiting release")
  if (req.status === "approved" && err) {
    if (lower.includes("awaiting release") || lower.includes("not yet released")) {
      return { label: "Unreleased", tooltip: err };
    }
  }

  return {
    label: statusLabels[req.status] || req.status,
    tooltip: err || statusLabels[req.status] || req.status,
  };
}

function buildJellyfinLink(jellyfinUrl: string, title: string): string {
  return `${jellyfinUrl}/web/index.html#!/search.html?query=${encodeURIComponent(title)}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function RequestsPage() {
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  // Auto-refresh every 30 seconds while any request is in an active state.
  // A failed refresh keeps showing the last known data.
  const { data, isLoading, mutate } = useApi<{ requests: RequestItem[] }>("/api/requests", {
    refreshInterval: (d) =>
      d?.requests.some((r) => ["pending", "approved", "downloading"].includes(r.status)) ? 30_000 : 0,
    onSuccess: () => setLastRefresh(Date.now()),
  });
  const { data: config, isLoading: configLoading } = useApi<{ jellyfinUrl?: string }>("/api/config");
  const requests = data?.requests ?? [];
  const jellyfinUrl = config?.jellyfinUrl || null;
  const loading = isLoading || configLoading;
  const fetchRequests = () => void mutate();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Cached timeline events, keyed by request id.
  // `null` sentinel = fetch failed; undefined = never fetched.
  const [timelines, setTimelines] = useState<
    Record<string, PipelineEventDTO[] | null>
  >({});

  const toggleTimeline = useCallback(
    async (req: RequestItem) => {
      const next = expandedId === req.id ? null : req.id;
      setExpandedId(next);
      // Only fetch the first time a row is expanded
      if (next && timelines[req.id] === undefined) {
        try {
          const res = await fetch(`/api/requests/${req.id}/events`);
          if (res.ok) {
            const d = await res.json();
            setTimelines((prev) => ({ ...prev, [req.id]: d.events || [] }));
          } else {
            setTimelines((prev) => ({ ...prev, [req.id]: null }));
          }
        } catch {
          setTimelines((prev) => ({ ...prev, [req.id]: null }));
        }
      }
    },
    [expandedId, timelines],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <p className="py-16 text-center text-[var(--muted)]">
        No requests yet. Search for something and hit Request!
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Requests</h1>
        <button
          onClick={fetchRequests}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)] hover:ring-[var(--accent)]/50"
          title="Refresh requests"
        >
          <span className="flex items-center gap-1.5">
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Updated {timeAgo(new Date(lastRefresh).toISOString())}
          </span>
        </button>
      </div>
      <div className="space-y-2">
        {requests.map((req) => {
          const badge = deriveBadge(req);
          const isProblem = req.status === "stalled" || req.status === "failed";
          const isExpanded = expandedId === req.id;
          const events = timelines[req.id];
          return (
            <div
              key={req.id}
              className="overflow-hidden rounded-xl bg-[var(--card)] ring-1 ring-[var(--border)]"
            >
              <button
                type="button"
                onClick={() => toggleTimeline(req)}
                className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-[var(--card-hover)]/50"
                aria-expanded={isExpanded}
                aria-controls={`timeline-${req.id}`}
              >
              {req.posterPath && (
                <img
                  src={req.posterPath}
                  alt={req.title}
                  className="h-16 w-11 rounded object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {req.title}
                  {req.year && (
                    <span className="ml-1 text-sm text-[var(--muted)]">
                      ({req.year})
                    </span>
                  )}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {typeLabels[req.mediaType] || req.mediaType} &middot;{" "}
                  {new Date(req.createdAt).toLocaleDateString()}
                  {req.status === "downloading" && (
                    <span className="ml-1 text-[var(--tv)]">
                      &middot; {timeAgo(req.updatedAt || req.createdAt)}
                    </span>
                  )}
                </p>
                {isProblem && req.lastError && (
                  <p
                    className="mt-1 truncate text-xs"
                    style={{ color: "var(--muted)" }}
                    title={req.lastError}
                  >
                    {req.lastError}
                  </p>
                )}
              </div>
              {req.status === "available" && jellyfinUrl ? (
                <a
                  href={buildJellyfinLink(jellyfinUrl, req.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-80"
                  style={{ background: statusColors.available }}
                  title="Open in Jellyfin"
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
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  Watch
                </a>
              ) : (
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                  style={{
                    background: statusColors[req.status] || "var(--muted)",
                  }}
                  title={badge.tooltip}
                >
                  {badge.label}
                  {req.status === "downloading" && (
                    <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  )}
                </span>
              )}
              <svg
                className={`h-4 w-4 text-[var(--muted)] transition-transform ${
                  isExpanded ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
              </button>
              {isExpanded && (
                <div
                  id={`timeline-${req.id}`}
                  className="border-t border-[var(--border)] bg-[var(--background)]/40 px-4 py-3"
                >
                  {events === undefined ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-[var(--muted)]">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                      Loading lifecycle…
                    </div>
                  ) : events === null ? (
                    <p className="py-2 text-xs text-[var(--danger)]">
                      Couldn&apos;t load lifecycle events.
                    </p>
                  ) : events.length === 0 ? (
                    <p className="py-2 text-xs text-[var(--muted)]">
                      No lifecycle events recorded yet.
                    </p>
                  ) : (
                    <PipelineTimeline
                      events={events}
                      currentStatus={req.status}
                    />
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
