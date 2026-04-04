"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

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

export default function SettingsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;

  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form state
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("discord");
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState("all");
  const [adding, setAdding] = useState(false);

  // Test state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session || role !== "admin") router.replace("/");
  }, [session, sessionStatus, role, router]);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setChannels(json.channels || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role === "admin") fetchChannels();
  }, [role, fetchChannels]);

  async function handleAdd() {
    if (!newName || !newUrl) return;
    setAdding(true);
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, type: newType, webhookUrl: newUrl, events: newEvents }),
      });
      if (res.ok) {
        setNewName("");
        setNewUrl("");
        setNewEvents("all");
        setShowAdd(false);
        fetchChannels();
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    await fetch("/api/admin/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled: !enabled }),
    });
    fetchChannels();
  }

  async function handleDelete(id: string) {
    await fetch("/api/admin/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchChannels();
  }

  async function handleTest(id: string) {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: id }),
      });
      const data = await res.json();
      setTestResult({ id, ok: res.ok, msg: res.ok ? "Test sent" : data.error || "Failed" });
    } catch (err: any) {
      setTestResult({ id, ok: false, msg: err.message });
    } finally {
      setTestingId(null);
      setTimeout(() => setTestResult(null), 4000);
    }
  }

  if (sessionStatus === "loading" || loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Notification Channels */}
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

        {/* Add form */}
        {showAdd && (
          <div className="rounded-xl p-4 ring-1 ring-[var(--border)] space-y-3" style={{ background: "var(--card)" }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Discord #requests"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Type</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                >
                  <option value="discord">Discord</option>
                  <option value="slack">Slack</option>
                  <option value="webhook">Generic Webhook</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Webhook URL</label>
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Events</label>
              <select
                value={newEvents}
                onChange={(e) => setNewEvents(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              >
                {EVENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleAdd}
              disabled={adding || !newName || !newUrl}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {adding ? "Adding..." : "Add Channel"}
            </button>
          </div>
        )}

        {/* Channel list */}
        {channels.length === 0 && !showAdd && (
          <p className="py-8 text-center text-sm text-[var(--muted)]">
            No notification channels configured. Add one to get alerts on Discord, Slack, or webhooks.
          </p>
        )}

        <div className="space-y-2">
          {channels.map((ch) => (
            <div
              key={ch.id}
              className="flex items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-[var(--border)]"
              style={{ background: "var(--card)" }}
            >
              {/* Type badge */}
              <span
                className="shrink-0 rounded-md px-2 py-0.5 text-xs font-bold text-white"
                style={{ background: TYPE_COLORS[ch.type] || "var(--muted)" }}
              >
                {ch.type.toUpperCase()}
              </span>

              {/* Name + URL */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{ch.name}</p>
                <p className="truncate text-xs text-[var(--muted)]">{ch.webhookUrl}</p>
              </div>

              {/* Events badge */}
              <span className="hidden shrink-0 rounded-full bg-[var(--background)] px-2 py-0.5 text-xs text-[var(--muted)] ring-1 ring-[var(--border)] sm:inline">
                {ch.events === "all" ? "All events" : ch.events}
              </span>

              {/* Test result */}
              {testResult?.id === ch.id && (
                <span className={`shrink-0 text-xs font-medium ${testResult.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                  {testResult.msg}
                </span>
              )}

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => handleTest(ch.id)}
                  disabled={testingId === ch.id}
                  className="rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--card-hover)] disabled:opacity-50"
                >
                  {testingId === ch.id ? "..." : "Test"}
                </button>
                <button
                  onClick={() => handleToggle(ch.id, ch.enabled)}
                  className="rounded-lg px-2 py-1 text-xs font-bold text-white transition-opacity hover:opacity-90"
                  style={{ background: ch.enabled ? "var(--success)" : "var(--muted)" }}
                >
                  {ch.enabled ? "ON" : "OFF"}
                </button>
                <button
                  onClick={() => handleDelete(ch.id)}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--danger)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--danger)] hover:text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
