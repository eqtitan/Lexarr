"use client";

import type { PipelineRequestDTO } from "@/types/dashboard";

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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

interface PendingApprovalsCardProps {
  requests: PipelineRequestDTO[];
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

export default function PendingApprovalsCard({
  requests,
  onApprove,
  onDeny,
}: PendingApprovalsCardProps) {
  if (requests.length === 0) return null;

  return (
    <div
      className="rounded-xl p-4 ring-1"
      style={{
        background: "var(--card)",
        boxShadow: "inset 0 0 0 1px var(--warning)",
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-lg font-semibold">Pending Approvals</h3>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-bold"
          style={{ background: "var(--warning)", color: "#000" }}
        >
          {requests.length}
        </span>
      </div>

      <div className="space-y-2">
        {requests.map((req) => (
          <div
            key={req.id}
            className="flex items-center gap-3 rounded-lg p-3 transition-colors"
            style={{ background: "var(--background)" }}
          >
            {req.posterPath && (
              <img
                src={req.posterPath}
                alt={req.title}
                className="h-12 w-8 flex-shrink-0 rounded object-cover"
              />
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {req.title}
                {req.year && (
                  <span className="ml-1 text-[var(--muted)]">({req.year})</span>
                )}
              </p>
              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <span
                  className="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                  style={{ background: typeColors[req.mediaType] || "var(--muted)" }}
                >
                  {typeLabels[req.mediaType] || req.mediaType}
                </span>
                <span>{req.user.name}</span>
                <span>{timeAgo(req.createdAt)}</span>
              </div>
            </div>

            <div className="flex flex-shrink-0 gap-2">
              <button
                onClick={() => onApprove(req.id)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--success)" }}
              >
                Approve
              </button>
              <button
                onClick={() => onDeny(req.id)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--danger)" }}
              >
                Deny
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
