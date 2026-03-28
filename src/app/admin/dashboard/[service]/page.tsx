"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import ServiceSummaryCards from "@/components/dashboard/ServiceSummaryCards";
import QueueTable from "@/components/dashboard/QueueTable";
import WantedPanel from "@/components/dashboard/WantedPanel";
import HistoryTable from "@/components/dashboard/HistoryTable";
import CalendarPanel from "@/components/dashboard/CalendarPanel";
import SystemInfoPanel from "@/components/dashboard/SystemInfoPanel";

const VALID_SERVICES = ["radarr", "sonarr", "lidarr"];

export default function ServiceDashboardPage() {
  const params = useParams();
  const service = (params.service as string)?.toLowerCase();
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect non-admins
  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session || role !== "admin") {
      router.replace("/");
    }
  }, [session, sessionStatus, role, router]);

  const fetchData = useCallback(async () => {
    if (!service || !VALID_SERVICES.includes(service)) return;
    try {
      const res = await fetch(`/api/admin/dashboard/${service}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    if (role === "admin") fetchData();
  }, [role, fetchData]);

  // Validate service name
  if (!VALID_SERVICES.includes(service)) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/dashboard"
          className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
        <div
          className="rounded-xl p-6 text-center ring-1 ring-[var(--border)]"
          style={{ background: "var(--card)" }}
        >
          <p className="text-[var(--danger)]">
            Invalid service: {service}. Must be one of: {VALID_SERVICES.join(", ")}
          </p>
        </div>
      </div>
    );
  }

  if (sessionStatus === "loading" || (sessionStatus === "authenticated" && role !== "admin")) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/dashboard"
          className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
        <div
          className="rounded-xl p-6 text-center ring-1 ring-[var(--border)]"
          style={{ background: "var(--card)" }}
        >
          <p className="text-[var(--danger)]">Failed to load {service} data: {error}</p>
          <button
            onClick={fetchData}
            className="mt-3 rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const serviceName = service.charAt(0).toUpperCase() + service.slice(1);

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/admin/dashboard"
        className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{serviceName}</h1>
        {data.system.version && (
          <span
            className="rounded-md px-2 py-0.5 text-xs font-medium"
            style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}
          >
            v{data.system.version}
          </span>
        )}
        {data.system.uptime && (
          <span className="text-xs text-[var(--muted)]">
            Uptime: {data.system.uptime}
          </span>
        )}
        {data.system.isDocker && (
          <span
            className="rounded-md px-2 py-0.5 text-xs font-medium"
            style={{ background: "rgba(59,130,246,0.15)", color: "var(--tv)" }}
          >
            Docker
          </span>
        )}
        <button
          onClick={fetchData}
          className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--card)]"
        >
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <ServiceSummaryCards
        library={data.library}
        storage={data.storage}
        queue={data.queue}
        wanted={data.wanted}
        service={service}
      />

      {/* Health Warnings */}
      {data.healthWarnings.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Health Warnings</h2>
          <div className="space-y-2">
            {data.healthWarnings.map((w: any, i: number) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-xl px-4 py-3 ring-1 ring-[var(--border)]"
                style={{ background: "var(--card)" }}
              >
                <svg
                  className="mt-0.5 h-4 w-4 shrink-0"
                  style={{
                    color:
                      w.type === "error" ? "var(--danger)" : w.type === "warning" ? "var(--warning)" : "var(--muted)",
                  }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div>
                  <p className="text-sm">{w.message}</p>
                  {w.wikiUrl && (
                    <a
                      href={w.wikiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--accent)] hover:underline"
                    >
                      Learn more
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Queue */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Download Queue</h2>
        <QueueTable items={data.queue.items} />
      </div>

      {/* Wanted */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Wanted</h2>
        <WantedPanel
          missingCount={data.wanted.missingCount}
          cutoffCount={data.wanted.cutoffCount}
          missingRecords={data.wanted.missingRecords}
          cutoffRecords={data.wanted.cutoffRecords}
        />
      </div>

      {/* History */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Recent History</h2>
        <HistoryTable events={data.history} />
      </div>

      {/* Calendar */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Upcoming Releases</h2>
        <CalendarPanel items={data.calendar} />
      </div>

      {/* System Info */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">System</h2>
        <SystemInfoPanel
          tasks={data.tasks}
          downloadClients={data.downloadClients}
          qualityProfiles={data.qualityProfiles}
          rootFolders={data.rootFolders}
          blocklist={data.blocklist}
        />
      </div>
    </div>
  );
}
