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

interface SupportedRegion {
  code: string;
  label: string;
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
  const role = session?.user?.role;

  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Add form state
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("discord");
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState("all");
  const [adding, setAdding] = useState(false);

  // Per-row in-flight state (toggle / delete)
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  // Test state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    ok: boolean;
    msg: string;
  } | null>(null);

  // Music region-filter state
  const [regions, setRegions] = useState<string[]>([]);
  const [supportedRegions, setSupportedRegions] = useState<SupportedRegion[]>(
    [],
  );
  const [regionsLoaded, setRegionsLoaded] = useState(false);
  const [savedRegions, setSavedRegions] = useState<string[]>([]);
  const [savingRegions, setSavingRegions] = useState(false);
  const [regionSaveMsg, setRegionSaveMsg] = useState<string | null>(null);
  const regionsDirty =
    regions.length !== savedRegions.length ||
    regions.some((r) => !savedRegions.includes(r));

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session || role !== "admin") router.replace("/");
  }, [session, sessionStatus, role, router]);

  const fetchChannels = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/notifications");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setChannels(json.channels || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setLoadError(`Couldn't load notification channels — ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRegions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings/music");
      if (!res.ok) return;
      const json = await res.json();
      setRegions(json.regions || []);
      setSavedRegions(json.regions || []);
      setSupportedRegions(json.supported || []);
      setRegionsLoaded(true);
    } catch {
      // Non-fatal — the section will show a retry if it didn't populate
    }
  }, []);

  useEffect(() => {
    if (role === "admin") {
      fetchChannels();
      fetchRegions();
    }
  }, [role, fetchChannels, fetchRegions]);

  function toggleRegion(code: string) {
    setRegions((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
    setRegionSaveMsg(null);
  }

  async function saveRegions() {
    setSavingRegions(true);
    setRegionSaveMsg(null);
    try {
      const res = await fetch("/api/admin/settings/music", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regions }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setSavedRegions(json.regions || []);
      setRegions(json.regions || []);
      setRegionSaveMsg("Saved");
      setTimeout(() => setRegionSaveMsg(null), 3000);
    } catch (err: unknown) {
      setRegionSaveMsg(
        err instanceof Error ? `Save failed — ${err.message}` : "Save failed",
      );
    } finally {
      setSavingRegions(false);
    }
  }

  // Clear the action-error banner after a few seconds so it doesn't linger.
  useEffect(() => {
    if (!actionError) return;
    const id = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(id);
  }, [actionError]);

  async function handleAdd() {
    if (!newName || !newUrl) return;
    setAdding(true);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          type: newType,
          webhookUrl: newUrl,
          events: newEvents,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setNewName("");
      setNewUrl("");
      setNewEvents("all");
      setShowAdd(false);
      await fetchChannels();
    } catch (err: unknown) {
      setActionError(
        `Add failed — ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    if (togglingId) return;
    setTogglingId(id);
    setActionError(null);
    // Optimistic flip
    setChannels((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: !enabled } : c)),
    );
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled: !enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchChannels();
    } catch (err: unknown) {
      // Roll back the optimistic update
      setChannels((prev) =>
        prev.map((c) => (c.id === id ? { ...c, enabled } : c)),
      );
      setActionError(
        `Toggle failed — ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (confirmingDeleteId !== id) {
      // First click: arm confirmation
      setConfirmingDeleteId(id);
      setTimeout(() => {
        setConfirmingDeleteId((current) => (current === id ? null : current));
      }, 4000);
      return;
    }
    if (deletingId) return;
    setDeletingId(id);
    setConfirmingDeleteId(null);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchChannels();
    } catch (err: unknown) {
      setActionError(
        `Delete failed — ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setDeletingId(null);
    }
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
      setTestResult({
        id,
        ok: res.ok,
        msg: res.ok ? "Test sent" : data.error || "Failed",
      });
    } catch (err: unknown) {
      setTestResult({ id, ok: false, msg: err instanceof Error ? err.message : String(err) });
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

  if (loadError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div
          className="rounded-xl p-4 ring-1"
          style={{
            background: "rgba(239,68,68,0.08)",
            borderColor: "var(--danger)",
          }}
          role="alert"
        >
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {loadError}
          </p>
          <button
            onClick={fetchChannels}
            className="mt-3 rounded-lg px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

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

      {/* Music Search Regions */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">
            Music Search Regions
            <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] ring-1 ring-[var(--border)]">
              preview
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Intended to filter MusicBrainz results by release country.
            Selections are saved but not yet active — MusicBrainz&apos;s
            release-group search index doesn&apos;t expose a country field,
            so a post-fetch artist-country filter is planned for a later
            release. Your choices persist for when it lands.
          </p>
        </div>

        {!regionsLoaded ? (
          <p className="text-sm text-[var(--muted)]">Loading regions…</p>
        ) : (
          <div
            className="rounded-xl p-4 ring-1 ring-[var(--border)] space-y-3"
            style={{ background: "var(--card)" }}
          >
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {supportedRegions.map((r) => {
                const on = regions.includes(r.code);
                return (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => toggleRegion(r.code)}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ring-1 transition-colors"
                    style={{
                      background: on
                        ? "rgba(99,102,241,0.12)"
                        : "var(--background)",
                      borderColor: on ? "var(--accent)" : "var(--border)",
                      color: "var(--foreground)",
                    }}
                  >
                    <span
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                      style={{
                        borderColor: on ? "var(--accent)" : "var(--border)",
                        background: on ? "var(--accent)" : "transparent",
                      }}
                      aria-hidden="true"
                    >
                      {on && (
                        <svg
                          className="h-3 w-3 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="flex-1">
                      <span className="font-medium">{r.code}</span>
                      <span className="ml-1.5 text-xs text-[var(--muted)]">
                        {r.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs text-[var(--muted)]">
                {regions.length === 0
                  ? "No filter — all regions included"
                  : `${regions.length} region${regions.length === 1 ? "" : "s"} selected`}
              </p>
              <div className="flex items-center gap-2">
                {regionSaveMsg && (
                  <span
                    className={`text-xs font-medium ${
                      regionSaveMsg === "Saved"
                        ? "text-[var(--success)]"
                        : "text-[var(--danger)]"
                    }`}
                  >
                    {regionSaveMsg}
                  </span>
                )}
                <button
                  onClick={saveRegions}
                  disabled={!regionsDirty || savingRegions}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: "var(--accent)" }}
                >
                  {savingRegions ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

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
                  placeholder="Discord #requests"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                  Type
                </label>
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
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Webhook URL
              </label>
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Events
              </label>
              <select
                value={newEvents}
                onChange={(e) => setNewEvents(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              >
                {EVENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
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
            No notification channels configured. Add one to get alerts on
            Discord, Slack, or webhooks.
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
                <p className="truncate text-xs text-[var(--muted)]">
                  {ch.webhookUrl}
                </p>
              </div>

              {/* Events badge */}
              <span className="hidden shrink-0 rounded-full bg-[var(--background)] px-2 py-0.5 text-xs text-[var(--muted)] ring-1 ring-[var(--border)] sm:inline">
                {ch.events === "all" ? "All events" : ch.events}
              </span>

              {/* Test result */}
              {testResult?.id === ch.id && (
                <span
                  className={`shrink-0 text-xs font-medium ${testResult.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}
                >
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
                  disabled={togglingId === ch.id}
                  className="rounded-lg px-2 py-1 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: ch.enabled ? "var(--success)" : "var(--muted)",
                  }}
                >
                  {togglingId === ch.id ? "…" : ch.enabled ? "ON" : "OFF"}
                </button>
                <button
                  onClick={() => handleDelete(ch.id)}
                  disabled={deletingId === ch.id}
                  className="rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-[var(--border)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    color: confirmingDeleteId === ch.id ? "white" : "var(--danger)",
                    background:
                      confirmingDeleteId === ch.id ? "var(--danger)" : "transparent",
                  }}
                  title={
                    confirmingDeleteId === ch.id
                      ? "Click again to confirm — clears in 4s"
                      : undefined
                  }
                >
                  {deletingId === ch.id
                    ? "…"
                    : confirmingDeleteId === ch.id
                      ? "Confirm?"
                      : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
