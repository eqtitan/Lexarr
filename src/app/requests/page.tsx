"use client";

import { useEffect, useState, useCallback } from "react";

interface RequestItem {
  id: string;
  mediaType: string;
  title: string;
  year?: string;
  posterPath?: string;
  status: string;
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
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [jellyfinUrl, setJellyfinUrl] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/requests");
      if (res.ok) {
        const d = await res.json();
        setRequests(d.requests || []);
        setLastRefresh(Date.now());
      }
    } catch {
      // Silently fail on refresh — keep showing last known data
    }
  }, []);

  // Initial load + config
  useEffect(() => {
    Promise.all([
      fetchRequests(),
      fetch("/api/config")
        .then((r) => r.json())
        .then((d) => setJellyfinUrl(d.jellyfinUrl || null))
        .catch(() => null),
    ]).finally(() => setLoading(false));
  }, [fetchRequests]);

  // Auto-refresh every 30 seconds if any requests are in active states
  useEffect(() => {
    const hasActive = requests.some((r) =>
      ["pending", "approved", "downloading"].includes(r.status),
    );
    if (!hasActive) return;

    const interval = setInterval(fetchRequests, 30000);
    return () => clearInterval(interval);
  }, [requests, fetchRequests]);

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
        {requests.map((req) => (
          <div
            key={req.id}
            className="flex items-center gap-4 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]"
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
            </div>
            {req.status === "available" && jellyfinUrl ? (
              <a
                href={buildJellyfinLink(jellyfinUrl, req.title)}
                target="_blank"
                rel="noopener noreferrer"
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
              >
                {statusLabels[req.status] || req.status}
                {req.status === "downloading" && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                )}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
