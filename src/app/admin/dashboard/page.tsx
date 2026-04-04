"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { DashboardData } from "@/types/dashboard";
import PendingApprovalsCard from "@/components/dashboard/PendingApprovalsCard";
import PipelineTable from "@/components/dashboard/PipelineTable";
import WarningsPanel from "@/components/dashboard/WarningsPanel";
import AnalyticsGrid from "@/components/dashboard/AnalyticsGrid";
import ServiceHealthBar from "@/components/dashboard/ServiceHealthBar";

export default function DashboardPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoPoll, setAutoPoll] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Redirect non-admins
  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session || role !== "admin") {
      router.replace("/");
    }
  }, [session, sessionStatus, role, router]);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/dashboard");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DashboardData = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (role === "admin") {
      fetchDashboard();
    }
  }, [role, fetchDashboard]);

  // Auto-poll every 15 seconds
  useEffect(() => {
    if (autoPoll && role === "admin") {
      intervalRef.current = setInterval(fetchDashboard, 15000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoPoll, role, fetchDashboard]);

  async function handleApprove(id: string, note?: string) {
    await fetch("/api/admin/requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: id, action: "approve", note }),
    });
    fetchDashboard();
  }

  async function handleDeny(id: string, note?: string) {
    await fetch("/api/admin/requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: id, action: "deny", note }),
    });
    fetchDashboard();
  }

  async function handleRetry(id: string) {
    await fetch("/api/admin/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: id }),
    });
    fetchDashboard();
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
      <div className="rounded-xl p-6 text-center ring-1 ring-[var(--border)]" style={{ background: "var(--card)" }}>
        <p className="text-[var(--danger)]">Failed to load dashboard: {error}</p>
        <button
          onClick={fetchDashboard}
          className="mt-3 rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ background: "var(--accent)" }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          {data.generatedAt && (
            <p className="text-xs text-[var(--muted)]">
              Updated {new Date(data.generatedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={autoPoll}
              onChange={(e) => setAutoPoll(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchDashboard}
            className="rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--card)]"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Service Health */}
      <div className="rounded-xl px-4 py-3 ring-1 ring-[var(--border)]" style={{ background: "var(--card)" }}>
        <ServiceHealthBar services={data.services} />
      </div>

      {/* Warnings */}
      <WarningsPanel warnings={data.warnings} />

      {/* Pending Approvals */}
      <PendingApprovalsCard
        requests={data.pipeline.pending}
        onApprove={handleApprove}
        onDeny={handleDeny}
      />

      {/* Active Pipeline */}
      <PipelineTable
        title="Active Downloads"
        requests={data.pipeline.active}
        showProgress
      />

      {/* Recent */}
      <PipelineTable
        title="Recently Completed"
        requests={data.pipeline.recent}
        onRetry={handleRetry}
      />

      {/* Analytics */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Analytics</h2>
        <AnalyticsGrid analytics={data.analytics} />
      </div>
    </div>
  );
}
