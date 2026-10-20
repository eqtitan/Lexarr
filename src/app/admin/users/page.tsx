"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";

interface UserItem {
  id: string;
  name: string;
  email?: string;
  role: string;
  autoApprove: boolean;
  maxRequests?: number;
  plexId?: string;
  jellyfinId?: string;
  avatar?: string;
  createdAt: string;
  _count: { requests: number };
}

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const selfId = session?.user?.id;

  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  // Add-user form state
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [newAutoApprove, setNewAutoApprove] = useState(false);
  const [adding, setAdding] = useState(false);

  // Per-row in-flight + confirm state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  // Reset-password inline prompt state
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPromptId, setResetPromptId] = useState<string | null>(null);
  const [resetPromptValue, setResetPromptValue] = useState("");
  const [resetOkId, setResetOkId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      const d = await res.json();
      setUsers(d.users || []);
    } catch {
      // Silent — user stays on last good state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  // Clear action errors after a few seconds so they don't linger
  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(t);
  }, [actionError]);

  async function toggleApprove(userId: string, current: boolean) {
    setActionError(null);
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, autoApprove: !current } : u)),
    );
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, autoApprove: !current }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err: unknown) {
      // Rollback
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, autoApprove: current } : u)),
      );
      setActionError(
        err instanceof Error ? err.message : "Toggle approve failed",
      );
    }
  }

  async function toggleRole(userId: string, current: string) {
    setActionError(null);
    const newRole = current === "admin" ? "user" : "admin";
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)),
    );
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err: unknown) {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: current } : u)),
      );
      setActionError(err instanceof Error ? err.message : "Toggle role failed");
    }
  }

  async function handleAddUser() {
    if (!newName || newName.length < 2) {
      setActionError("Name must be at least 2 characters");
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      setActionError("Password must be at least 8 characters");
      return;
    }
    setAdding(true);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          password: newPassword,
          role: newRole,
          autoApprove: newAutoApprove,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Reset form + refresh list
      setNewName("");
      setNewPassword("");
      setNewRole("user");
      setNewAutoApprove(false);
      setShowAdd(false);
      await fetchUsers();
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? `Add failed — ${err.message}` : "Add failed",
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleResetPassword(userId: string) {
    if (resetPromptValue.length < 8) {
      setActionError("Password must be at least 8 characters");
      return;
    }
    setResettingId(userId);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, password: resetPromptValue }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResetPromptValue("");
      setResetPromptId(null);
      setResetOkId(userId);
      setTimeout(() => setResetOkId(null), 3000);
    } catch (err: unknown) {
      setActionError(
        err instanceof Error
          ? `Reset failed — ${err.message}`
          : "Reset failed",
      );
    } finally {
      setResettingId(null);
    }
  }

  async function handleDelete(userId: string) {
    if (userId === selfId) {
      setActionError("You can't delete your own account from here");
      return;
    }
    // Two-click confirmation pattern: first click arms, second confirms.
    if (confirmingDeleteId !== userId) {
      setConfirmingDeleteId(userId);
      setTimeout(() => {
        setConfirmingDeleteId((cur) => (cur === userId ? null : cur));
      }, 4000);
      return;
    }
    if (deletingId) return;
    setDeletingId(userId);
    setConfirmingDeleteId(null);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? `Delete failed — ${err.message}` : "Delete failed",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">User Management</h1>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--accent)" }}
        >
          {showAdd ? "Cancel" : "Add User"}
        </button>
      </div>

      {actionError && (
        <div
          className="rounded-lg px-4 py-2 text-sm ring-1"
          style={{
            background: "rgba(239,68,68,0.08)",
            borderColor: "var(--danger)",
            color: "var(--danger)",
          }}
          role="alert"
        >
          {actionError}
        </div>
      )}

      {/* Add user form */}
      {showAdd && (
        <div
          className="rounded-xl p-4 ring-1 ring-[var(--border)] space-y-3"
          style={{ background: "var(--card)" }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Jane Smith"
                autoComplete="off"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Password{" "}
                <span className="text-[10px]">(≥8 chars)</span>
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Role
              </label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "admin" | "user")}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Auto-approve requests
              </label>
              <div className="flex h-[38px] items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNewAutoApprove(!newAutoApprove)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                  style={{
                    background: newAutoApprove ? "var(--success)" : "var(--card)",
                    color: newAutoApprove ? "white" : "var(--muted)",
                    border: newAutoApprove ? "none" : "1px solid var(--border)",
                  }}
                >
                  {newAutoApprove ? "Auto ✓" : "Manual"}
                </button>
                <span className="text-xs text-[var(--muted)]">
                  {newAutoApprove
                    ? "Requests skip admin review"
                    : "Requests need approval"}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={handleAddUser}
            disabled={adding || !newName || !newPassword}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {adding ? "Creating…" : "Create User"}
          </button>
        </div>
      )}

      {users.length === 0 ? (
        <p className="text-[var(--muted)]">No users registered yet.</p>
      ) : (
        <div className="space-y-2">
          {users.map((user) => {
            const isSelf = user.id === selfId;
            const resetOpen = resetPromptId === user.id;
            return (
              <div
                key={user.id}
                className="overflow-hidden rounded-xl bg-[var(--card)] ring-1 ring-[var(--border)]"
              >
                <div className="flex items-center gap-4 p-4">
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="h-10 w-10 rounded-full object-cover"
                  />
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
                    {user.email || "No email"} &middot; {user._count.requests}{" "}
                    requests
                    {user.plexId && " · Plex"}
                    {user.jellyfinId && " · Jellyfin"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleApprove(user.id, user.autoApprove)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                    style={{
                      background: user.autoApprove
                        ? "var(--success)"
                        : "var(--card)",
                      color: user.autoApprove ? "white" : "var(--muted)",
                      border: user.autoApprove ? "none" : "1px solid var(--border)",
                    }}
                  >
                    {user.autoApprove ? "Auto ✓" : "Manual"}
                  </button>
                  <button
                    onClick={() => toggleRole(user.id, user.role)}
                    disabled={isSelf}
                    className="rounded-lg bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] ring-1 ring-[var(--border)] transition-all hover:text-[var(--foreground)] disabled:opacity-40 disabled:cursor-not-allowed"
                    title={isSelf ? "Can't demote yourself" : undefined}
                  >
                    {user.role === "admin" ? "Demote" : "Promote"}
                  </button>
                  <button
                    onClick={() => {
                      setResetPromptValue("");
                      setResetPromptId(
                        resetPromptId === user.id ? null : user.id,
                      );
                    }}
                    className="rounded-lg bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] ring-1 ring-[var(--border)] transition-all hover:text-[var(--foreground)]"
                    title="Reset this user's password"
                  >
                    {resetOkId === user.id ? "Reset ✓" : "Reset"}
                  </button>
                  <button
                    onClick={() => handleDelete(user.id)}
                    disabled={isSelf || deletingId === user.id}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-[var(--border)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      color: confirmingDeleteId === user.id ? "white" : "var(--danger)",
                      background:
                        confirmingDeleteId === user.id ? "var(--danger)" : "transparent",
                    }}
                    title={
                      isSelf
                        ? "Can't delete yourself"
                        : confirmingDeleteId === user.id
                          ? "Click again to confirm — clears in 4s. This deletes the user's request history."
                          : "Delete user (also deletes their request history)"
                    }
                  >
                    {deletingId === user.id
                      ? "…"
                      : confirmingDeleteId === user.id
                        ? "Confirm?"
                        : "Delete"}
                  </button>
                </div>
                </div>
                {/* Inline reset-password prompt — appears below the row
                    when the Reset button is clicked. Cancelling clears
                    both the input and the prompt state. */}
                {resetOpen && (
                  <div className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--background)]/40 px-4 py-3">
                    <label className="shrink-0 text-xs text-[var(--muted)]">
                      New password:
                    </label>
                    <input
                      type="password"
                      value={resetPromptValue}
                      onChange={(e) => setResetPromptValue(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      autoFocus
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          resetPromptValue.length >= 8 &&
                          resettingId !== user.id
                        ) {
                          void handleResetPassword(user.id);
                        } else if (e.key === "Escape") {
                          setResetPromptId(null);
                          setResetPromptValue("");
                        }
                      }}
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => handleResetPassword(user.id)}
                      disabled={
                        resetPromptValue.length < 8 || resettingId === user.id
                      }
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: "var(--accent)" }}
                    >
                      {resettingId === user.id ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setResetPromptId(null);
                        setResetPromptValue("");
                      }}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
