"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";

interface Notification {
  id: string;
  title: string;
  mediaType: string;
  posterPath?: string;
  availableAt: string;
}

export default function NotificationBell() {
  const { data: session } = useSession();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const stored = localStorage.getItem("lexarr:seen-notifications");
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session) return;

    const poll = async () => {
      try {
        const r = await fetch("/api/notifications");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        setNotifications(d.notifications || []);
        setLastSuccessAt(Date.now());
        setPollError(null);
      } catch (err: unknown) {
        setPollError(err instanceof Error ? err.message : "Network error");
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 60_000);
    return () => clearInterval(interval);
  }, [session]);

  // Consider notifications stale if we haven't had a successful poll in 5 min
  const STALE_MS = 5 * 60_000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const isStale =
    !!pollError && (lastSuccessAt === null || now - lastSuccessAt > STALE_MS);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  if (!session) return null;

  const unseen = notifications.filter((n) => !seen.has(n.id));

  function handleOpen() {
    setOpen(!open);
    if (!open) {
      const allIds = notifications.map((n) => n.id);
      const newSeen = new Set([...seen, ...allIds]);
      setSeen(newSeen);
      try {
        localStorage.setItem(
          "lexarr:seen-notifications",
          JSON.stringify([...newSeen]),
        );
      } catch {
        // localStorage unavailable
      }
    }
  }

  const typeLabels: Record<string, string> = {
    movie: "Movie",
    tv: "TV Show",
    music: "Album",
    book: "Book",
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        title={
          isStale
            ? `Notifications may be stale — last updated ${lastSuccessAt ? new Date(lastSuccessAt).toLocaleTimeString() : "never"}`
            : undefined
        }
        className="relative rounded-lg p-2 transition-colors hover:text-[var(--foreground)]"
        style={{
          color: isStale ? "var(--warning)" : "var(--muted)",
          opacity: isStale ? 0.7 : 1,
        }}
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unseen.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white">
            {unseen.length}
          </span>
        )}
        {isStale && unseen.length === 0 && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--warning)]" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-[var(--card)] ring-1 ring-[var(--border)] shadow-xl shadow-black/30 z-50">
          <div className="border-b border-[var(--border)] px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {isStale && (
              <p
                className="mt-0.5 text-[11px]"
                style={{ color: "var(--warning)" }}
                title={pollError || undefined}
              >
                Offline — list may be stale
              </p>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">
              No notifications yet
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0"
                >
                  {n.posterPath && (
                    <img
                      src={n.posterPath}
                      alt=""
                      className="h-10 w-7 rounded object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{n.title}</p>
                    <p className="text-xs text-[var(--success)]">
                      {typeLabels[n.mediaType] || n.mediaType} is ready
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
