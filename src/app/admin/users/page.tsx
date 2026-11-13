"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { apiSend, failure, useApi } from "@/lib/use-api";
import AddUserForm from "@/components/admin/users/AddUserForm";
import UserRow from "@/components/admin/users/UserRow";
import type { UserItem } from "@/components/admin/users/types";

type UsersResponse = { users: UserItem[] };

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const selfId = session?.user?.id;

  const { data, error, isLoading, mutate } = useApi<UsersResponse>("/api/admin/users");
  const users = data?.users ?? [];

  const [showAdd, setShowAdd] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Clear action errors after a few seconds so they don't linger.
  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(t);
  }, [actionError]);

  /** Optimistic toggle: show it now, save it, refetch either way (rolls back on failure). */
  async function updateUser(userId: string, patch: Partial<Pick<UserItem, "autoApprove" | "role">>) {
    setActionError(null);
    await mutate(
      (d) => d && { users: d.users.map((u) => (u.id === userId ? { ...u, ...patch } : u)) },
      { revalidate: false },
    );
    try {
      await apiSend("/api/admin/users", "PATCH", { userId, ...patch });
    } catch (err) {
      setActionError(failure("Update", err));
    } finally {
      await mutate();
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  const banner = actionError ?? (error ? `Couldn't load users — ${error.message}` : null);

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

      {banner && (
        <div
          className="rounded-lg px-4 py-2 text-sm ring-1"
          style={{ background: "rgba(239,68,68,0.08)", borderColor: "var(--danger)", color: "var(--danger)" }}
          role="alert"
        >
          {banner}
        </div>
      )}

      {showAdd && (
        <AddUserForm
          onError={setActionError}
          onCreated={() => {
            setShowAdd(false);
            void mutate();
          }}
        />
      )}

      {users.length === 0 ? (
        <p className="text-[var(--muted)]">No users registered yet.</p>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === selfId}
              onUpdate={(patch) => void updateUser(user.id, patch)}
              onDeleted={() => void mutate()}
              onError={setActionError}
            />
          ))}
        </div>
      )}
    </div>
  );
}
