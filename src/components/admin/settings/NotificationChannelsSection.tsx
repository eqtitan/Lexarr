"use client";

import { useState } from "react";
import { apiSend, failure, useApi } from "@/lib/use-api";

interface NotificationChannel {
  id: string;
  name: string;
  type: string;
  webhookUrl: string;
  events: string;
  enabled: boolean;
  createdAt: string;
}

const EVENT_OPTIONS = [
  { value: "all", label: "All Events" },
  { value: "submitted", label: "New Request" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
  { value: "available", label: "Available" },
  { value: "failed", label: "Failed" },
  { value: "stalled", label: "Stalled" },
];

const TYPE_COLORS: Record<string, string> = {
  discord: "#5865f2",
  slack: "#4a154b",
  webhook: "var(--muted)",
};

const INPUT =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]";
const LABEL = "mb-1 block text-xs font-medium text-[var(--muted)]";

const API = "/api/admin/notifications";

/** Discord / Slack / webhook channels: list, add, test, enable/disable, delete. */
export default function NotificationChannelsSection({ onError }: { onError: (message: string) => void }) {
  const { data, error, isLoading, mutate } = useApi<{ channels: NotificationChannel[] }>(API);
  const channels = data?.channels ?? [];
  const [showAdd, setShowAdd] = useState(false);

  if (isLoading) return <p className="text-sm text-[var(--muted)]">Loading notification channels…</p>;
  if (error) {
    return (
      <div
        className="rounded-xl p-4 ring-1"
        style={{ background: "rgba(239,68,68,0.08)", borderColor: "var(--danger)" }}
        role="alert"
      >
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          Couldn&apos;t load notification channels — {error.message}
        </p>
        <button
          onClick={() => void mutate()}
          className="mt-3 rounded-lg px-3 py-1.5 text-sm font-medium text-white"
          style={{ background: "var(--accent)" }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Notification Channels</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--accent)" }}
        >
          {showAdd ? "Cancel" : "Add Channel"}
        </button>
      </div>

      {showAdd && (
        <AddChannelForm
          onError={onError}
          onAdded={() => {
            setShowAdd(false);
            void mutate();
          }}
        />
      )}

      {channels.length === 0 && !showAdd && (
        <p className="py-8 text-center text-sm text-[var(--muted)]">
          No notification channels configured. Add one to get alerts on Discord, Slack, or webhooks.
        </p>
      )}

      <div className="space-y-2">
        {channels.map((ch) => (
          <ChannelRow key={ch.id} channel={ch} onChanged={() => void mutate()} onError={onError} />
        ))}
      </div>
    </section>
  );
}

function AddChannelForm({ onAdded, onError }: { onAdded: () => void; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("discord");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("all");
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    if (!name || !url) return;
    setAdding(true);
    try {
      await apiSend(API, "POST", { name, type, webhookUrl: url, events });
      onAdded();
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
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Discord #requests" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={INPUT}>
            <option value="discord">Discord</option>
            <option value="slack">Slack</option>
            <option value="webhook">Generic Webhook</option>
          </select>
        </div>
      </div>
      <div>
        <label className={LABEL}>Webhook URL</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://discord.com/api/webhooks/..."
          className={INPUT}
        />
      </div>
      <div>
        <label className={LABEL}>Events</label>
        <select value={events} onChange={(e) => setEvents(e.target.value)} className={INPUT}>
          {EVENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={handleAdd}
        disabled={adding || !name || !url}
        className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ background: "var(--accent)" }}
      >
        {adding ? "Adding..." : "Add Channel"}
      </button>
    </div>
  );
}

function ChannelRow({
  channel: ch,
  onChanged,
  onError,
}: {
  channel: NotificationChannel;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(ch.enabled); // optimistic
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function toggle() {
    if (toggling) return;
    setToggling(true);
    setEnabled(!enabled);
    try {
      await apiSend(API, "PATCH", { id: ch.id, enabled: !enabled });
      onChanged();
    } catch (err) {
      setEnabled(enabled); // roll back
      onError(failure("Toggle", err));
    } finally {
      setToggling(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      await apiSend(`${API}/test`, "POST", { channelId: ch.id });
      setTestResult({ ok: true, msg: "Test sent" });
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : "Failed" });
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 4000);
    }
  }

  async function remove() {
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
      await apiSend(API, "DELETE", { id: ch.id });
      onChanged();
    } catch (err) {
      onError(failure("Delete", err));
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-[var(--border)]" style={{ background: "var(--card)" }}>
      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-xs font-bold text-white"
        style={{ background: TYPE_COLORS[ch.type] || "var(--muted)" }}
      >
        {ch.type.toUpperCase()}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{ch.name}</p>
        <p className="truncate text-xs text-[var(--muted)]">{ch.webhookUrl}</p>
      </div>

      <span className="hidden shrink-0 rounded-full bg-[var(--background)] px-2 py-0.5 text-xs text-[var(--muted)] ring-1 ring-[var(--border)] sm:inline">
        {ch.events === "all" ? "All events" : ch.events}
      </span>

      {testResult && (
        <span className={`shrink-0 text-xs font-medium ${testResult.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
          {testResult.msg}
        </span>
      )}

      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={test}
          disabled={testing}
          className="rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--card-hover)] disabled:opacity-50"
        >
          {testing ? "..." : "Test"}
        </button>
        <button
          onClick={toggle}
          disabled={toggling}
          className="rounded-lg px-2 py-1 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: enabled ? "var(--success)" : "var(--muted)" }}
        >
          {toggling ? "…" : enabled ? "ON" : "OFF"}
        </button>
        <button
          onClick={remove}
          disabled={deleting}
          className="rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-[var(--border)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            color: confirmingDelete ? "white" : "var(--danger)",
            background: confirmingDelete ? "var(--danger)" : "transparent",
          }}
          title={confirmingDelete ? "Click again to confirm — clears in 4s" : undefined}
        >
          {deleting ? "…" : confirmingDelete ? "Confirm?" : "Delete"}
        </button>
      </div>
    </div>
  );
}
