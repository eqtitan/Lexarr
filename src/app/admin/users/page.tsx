"use client";

import { useEffect, useState } from "react";

interface UserItem {
  id: string;
  name: string;
  email?: string;
  role: string;
  autoApprove: boolean;
  plexId?: string;
  jellyfinId?: string;
  avatar?: string;
  createdAt: string;
  _count: { requests: number };
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((d) => setUsers(d.users || []))
      .finally(() => setLoading(false));
  }, []);

  async function toggleApprove(userId: string, current: boolean) {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, autoApprove: !current }),
    });
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, autoApprove: !current } : u))
    );
  }

  async function toggleRole(userId: string, current: string) {
    const newRole = current === "admin" ? "user" : "admin";
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: newRole }),
    });
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
    );
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
      <h1 className="text-2xl font-bold">User Management</h1>
      {users.length === 0 ? (
        <p className="text-[var(--muted)]">No users registered yet.</p>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center gap-4 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]"
            >
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
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {user.email || "No email"} &middot; {user._count.requests} requests
                  {user.plexId && " · Plex"}
                  {user.jellyfinId && " · Jellyfin"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleApprove(user.id, user.autoApprove)}
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
                  onClick={() => toggleRole(user.id, user.role)}
                  className="rounded-lg bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] ring-1 ring-[var(--border)] transition-all hover:text-[var(--foreground)]"
                >
                  {user.role === "admin" ? "Demote" : "Promote"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
