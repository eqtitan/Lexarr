"use client";

import { useState } from "react";
import { apiSend, failure } from "@/lib/use-api";
import type { UserItem } from "./types";

const SMALL_BUTTON =
  "rounded-lg bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] ring-1 ring-[var(--border)] transition-all hover:text-[var(--foreground)]";

/**
 * One user: auto-approve and role toggles, an inline reset-password prompt,
 * and a two-click delete. Toggles go through onUpdate (optimistic in the
 * page); reset and delete talk to the API directly.
 */
export default function UserRow({
  user,
  isSelf,
  onUpdate,
  onDeleted,
  onError,
}: {
  user: UserItem;
  isSelf: boolean;
  onUpdate: (patch: Partial<Pick<UserItem, "autoApprove" | "role">>) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const [resetOpen, setResetOpen] = useState(false);
  const [resetValue, setResetValue] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetOk, setResetOk] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function closeReset() {
    setResetOpen(false);
    setResetValue("");
  }

  async function handleReset() {
    if (resetValue.length < 8) return onError("Password must be at least 8 characters");
    setResetting(true);
    try {
      await apiSend("/api/admin/users", "PATCH", { userId: user.id, password: resetValue });
      closeReset();
      setResetOk(true);
      setTimeout(() => setResetOk(false), 3000);
    } catch (err) {
      onError(failure("Reset", err));
    } finally {
      setResetting(false);
    }
  }

  async function handleDelete() {
    if (isSelf) return onError("You can't delete your own account from here");
    // Two-click confirmation: the first click arms it for 4 seconds.
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    if (deleting) return;
    setDeleting(true);
    setConfirmingDelete(false);
    try {
      await apiSend("/api/admin/users", "DELETE", { userId: user.id });
      onDeleted();
    } catch (err) {
      onError(failure("Delete", err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl bg-[var(--card)] ring-1 ring-[var(--border)]">
      <div className="flex items-center gap-4 p-4">
        {user.avatar ? (
          <img src={user.avatar} alt={user.name} className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-bold text-white">
            {user.name[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {user.name}
            {user.role === "admin" && (
              <span className="ml-2 rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                ADMIN
              </span>
            )}
            {isSelf && (
              <span className="ml-2 rounded bg-[var(--muted)]/30 px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted)]">
                YOU
              </span>
            )}
          </p>
          <p className="text-xs text-[var(--muted)]">
            {user.email || "No email"} &middot; {user._count.requests} requests
            {user.plexId && " · Plex"}
            {user.jellyfinId && " · Jellyfin"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onUpdate({ autoApprove: !user.autoApprove })}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
            style={{
              background: user.autoApprove ? "var(--success)" : "var(--card)",
              color: user.autoApprove ? "white" : "var(--muted)",
              border: user.autoApprove ? "none" : "1px solid var(--border)",
            }}
          >
            {user.autoApprove ? "Auto ✓" : "Manual"}
          </button>
          <button
            onClick={() => onUpdate({ role: user.role === "admin" ? "user" : "admin" })}
            disabled={isSelf}
            className={`${SMALL_BUTTON} disabled:opacity-40 disabled:cursor-not-allowed`}
            title={isSelf ? "Can't demote yourself" : undefined}
          >
            {user.role === "admin" ? "Demote" : "Promote"}
          </button>
          <button
            onClick={() => {
              setResetValue("");
              setResetOpen(!resetOpen);
            }}
            className={SMALL_BUTTON}
            title="Reset this user's password"
          >
            {resetOk ? "Reset ✓" : "Reset"}
          </button>
          <button
            onClick={handleDelete}
            disabled={isSelf || deleting}
            className="rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-[var(--border)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              color: confirmingDelete ? "white" : "var(--danger)",
              background: confirmingDelete ? "var(--danger)" : "transparent",
            }}
            title={
              isSelf
                ? "Can't delete yourself"
                : confirmingDelete
                  ? "Click again to confirm — clears in 4s. This deletes the user's request history."
                  : "Delete user (also deletes their request history)"
            }
          >
            {deleting ? "…" : confirmingDelete ? "Confirm?" : "Delete"}
          </button>
        </div>
      </div>
      {resetOpen && (
        <div className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--background)]/40 px-4 py-3">
          <label className="shrink-0 text-xs text-[var(--muted)]">New password:</label>
          <input
            type="password"
            value={resetValue}
            onChange={(e) => setResetValue(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && resetValue.length >= 8 && !resetting) void handleReset();
              else if (e.key === "Escape") closeReset();
            }}
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={handleReset}
            disabled={resetValue.length < 8 || resetting}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "var(--accent)" }}
          >
            {resetting ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={closeReset}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
