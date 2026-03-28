"use client";

import { useEffect, useState } from "react";

interface RequestItem {
  id: string;
  mediaType: string;
  title: string;
  year?: string;
  posterPath?: string;
  status: string;
  createdAt: string;
}

const statusColors: Record<string, string> = {
  pending: "var(--warning)",
  approved: "var(--accent)",
  downloading: "var(--tv)",
  available: "var(--success)",
  denied: "var(--danger)",
};

const typeLabels: Record<string, string> = {
  movie: "Movie",
  tv: "TV",
  music: "Music",
  book: "Book",
};

export default function RequestsPage() {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/requests")
      .then((r) => r.json())
      .then((d) => setRequests(d.requests || []))
      .finally(() => setLoading(false));
  }, []);

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
      <h1 className="text-2xl font-bold">Requests</h1>
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
                  <span className="ml-1 text-sm text-[var(--muted)]">({req.year})</span>
                )}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {typeLabels[req.mediaType] || req.mediaType} &middot;{" "}
                {new Date(req.createdAt).toLocaleDateString()}
              </p>
            </div>
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold capitalize text-white"
              style={{ background: statusColors[req.status] || "var(--muted)" }}
            >
              {req.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
