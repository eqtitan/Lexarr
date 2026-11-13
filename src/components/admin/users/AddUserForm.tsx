"use client";

import { useState } from "react";
import { apiSend, failure } from "@/lib/use-api";

const INPUT =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]";
const LABEL = "mb-1 block text-xs font-medium text-[var(--muted)]";

/** Create a local-credentials user. Calls onCreated after a successful add. */
export default function AddUserForm({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [autoApprove, setAutoApprove] = useState(false);
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    if (name.length < 2) return onError("Name must be at least 2 characters");
    if (password.length < 8) return onError("Password must be at least 8 characters");
    setAdding(true);
    try {
      await apiSend("/api/admin/users", "POST", { name, password, role, autoApprove });
      onCreated();
    } catch (err) {
      onError(failure("Add", err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="rounded-xl p-4 ring-1 ring-[var(--border)] space-y-3" style={{ background: "var(--card)" }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL}>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jane Smith"
            autoComplete="off"
            className={INPUT}
          />
        </div>
        <div>
          <label className={LABEL}>
            Password <span className="text-[10px]">(≥8 chars)</span>
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            className={INPUT}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL}>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "user")} className={INPUT}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label className={LABEL}>Auto-approve requests</label>
          <div className="flex h-[38px] items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoApprove(!autoApprove)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
              style={{
                background: autoApprove ? "var(--success)" : "var(--card)",
                color: autoApprove ? "white" : "var(--muted)",
                border: autoApprove ? "none" : "1px solid var(--border)",
              }}
            >
              {autoApprove ? "Auto ✓" : "Manual"}
            </button>
            <span className="text-xs text-[var(--muted)]">
              {autoApprove ? "Requests skip admin review" : "Requests need approval"}
            </span>
          </div>
        </div>
      </div>
      <button
        onClick={handleAdd}
        disabled={adding || !name || !password}
        className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ background: "var(--accent)" }}
      >
        {adding ? "Creating…" : "Create User"}
      </button>
    </div>
  );
}
