"use client";

import { useState } from "react";
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
  onApprove: (id: string, note?: string) => void;
  onDeny: (id: string, note?: string) => void;
}

export default function PendingApprovalsCard({
  requests,
  onApprove,
  onDeny,
}: PendingApprovalsCardProps) {
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteAction, setNoteAction] = useState<"approve" | "deny">("approve");

  if (requests.length === 0) return null;

  function startAction(id: string, action: "approve" | "deny") {
    if (noteId === id && noteAction === action) {
      // Confirm: execute with note
      if (action === "approve") onApprove(id, noteText || undefined);
      else onDeny(id, noteText || undefined);
      setNoteId(null);
      setNoteText("");
    } else {
      // First click: show note field
      setNoteId(id);
      setNoteAction(action);
      setNoteText("");
    }
  }

  function cancelNote() {
    setNoteId(null);
    setNoteText("");
  }

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
        {requests.map((req) => {
          const showNote = noteId === req.id;

          return (
            <div key={req.id}>
              <div
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
                      <span className="ml-1 text-[var(--muted)]">
                        ({req.year})
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <span
                      className="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                      style={{
                        background: typeColors[req.mediaType] || "var(--muted)",
                      }}
                    >
                      {typeLabels[req.mediaType] || req.mediaType}
                    </span>
                    <span>{req.user.name}</span>
                    <span>{timeAgo(req.createdAt)}</span>
                  </div>
                </div>

                <div className="flex flex-shrink-0 gap-2">
                  <button
                    onClick={() => startAction(req.id, "approve")}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                    style={{
                      background:
                        showNote && noteAction === "approve"
                          ? "var(--accent)"
                          : "var(--success)",
                    }}
                  >
                    {showNote && noteAction === "approve"
                      ? "Confirm"
                      : "Approve"}
                  </button>
                  <button
                    onClick={() => startAction(req.id, "deny")}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                    style={{
                      background:
                        showNote && noteAction === "deny"
                          ? "var(--accent)"
                          : "var(--danger)",
                    }}
                  >
                    {showNote && noteAction === "deny" ? "Confirm" : "Deny"}
                  </button>
                </div>
              </div>

              {/* Note input (shown on first click) */}
              {showNote && (
                <div
                  className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2"
                  style={{ background: "var(--background)" }}
                >
                  <input
                    type="text"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Add a note (optional)..."
                    className="flex-1 rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") startAction(req.id, noteAction);
                      if (e.key === "Escape") cancelNote();
                    }}
                  />
                  <button
                    onClick={cancelNote}
                    className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
