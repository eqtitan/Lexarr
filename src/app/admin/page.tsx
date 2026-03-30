"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface ServiceStatus {
  name: string;
  healthy: boolean;
  error?: string;
}

interface PendingRequest {
  id: string;
  mediaType: string;
  title: string;
  year?: string;
  posterPath?: string;
  createdAt: string;
  user: { name: string; avatar?: string };
}

const typeLabels: Record<string, string> = {
  movie: "Movie",
  tv: "TV",
  music: "Music",
  book: "Book",
};

export default function AdminPage() {
  const { data: session, status: sessionStatus } = useSession();
  const role = (session?.user as any)?.role;
  const router = useRouter();
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session || role !== "admin") {
      router.replace("/");
    }
  }, [session, sessionStatus, role, router]);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/settings").then((r) => r.json()),
      fetch("/api/admin/requests").then((r) => r.json()),
    ])
      .then(([sData, rData]) => {
        setServices(sData.services || []);
        setPending(rData.requests || []);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleAction(requestId: string, action: "approve" | "deny") {
    await fetch("/api/admin/requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, action }),
    });
    setPending((prev) => prev.filter((r) => r.id !== requestId));
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <Link
          href="/admin/users"
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Manage Users
        </Link>
      </div>

      {/* Pending Requests */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            Pending Requests
            <span className="ml-2 rounded-full bg-[var(--warning)] px-2 py-0.5 text-xs font-bold text-black">
              {pending.length}
            </span>
          </h2>
          {pending.map((req) => (
            <div
              key={req.id}
              className="flex items-center gap-4 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]"
            >
              {req.posterPath && (
                <img
                  src={req.posterPath}
                  alt={req.title}
                  className="h-14 w-10 rounded object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {req.title}
                  {req.year && (
                    <span className="ml-1 text-sm text-[var(--muted)]">({req.year})</span>
                  )}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {typeLabels[req.mediaType]} &middot; Requested by {req.user.name}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction(req.id, "approve")}
                  className="rounded-lg bg-[var(--success)] px-3 py-1.5 text-sm font-medium text-white"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleAction(req.id, "deny")}
                  className="rounded-lg bg-[var(--danger)] px-3 py-1.5 text-sm font-medium text-white"
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Service Health */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Service Health</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((s) => (
            <div
              key={s.name}
              className="flex items-center gap-3 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]"
            >
              <div
                className="h-3 w-3 rounded-full"
                style={{
                  background: s.healthy ? "var(--success)" : "var(--danger)",
                }}
              />
              <div>
                <p className="font-medium">{s.name}</p>
                {s.error && (
                  <p className="text-xs text-[var(--danger)]">{s.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
