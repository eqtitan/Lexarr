"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { DashboardData } from "@/types/dashboard";
import PendingApprovalsCard from "@/components/dashboard/PendingApprovalsCard";
import PipelineTable from "@/components/dashboard/PipelineTable";
import AnalyticsGrid from "@/components/dashboard/AnalyticsGrid";
import DashboardKpis from "@/components/dashboard/DashboardKpis";
import WarningsPanel from "@/components/dashboard/WarningsPanel";
import IndexerPerformancePanel from "@/components/dashboard/IndexerPerformancePanel";

type TabId = "overview" | "approvals" | "pipeline" | "analytics" | "warnings";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "approvals", label: "Approvals" },
  { id: "pipeline", label: "Pipeline" },
  { id: "analytics", label: "Analytics" },
  { id: "warnings", label: "Warnings" },
];

export default function DashboardPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const role = session?.user?.role;

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoPoll, setAutoPoll] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role === "admin") {
      fetchDashboard();
    }
  }, [role, fetchDashboard]);

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

  if (
    sessionStatus === "loading" ||
    (sessionStatus === "authenticated" && role !== "admin")
  ) {
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
      <div
        className="rounded-xl p-6 text-center ring-1 ring-[var(--border)]"
        style={{ background: "var(--card)" }}
      >
        <p className="text-[var(--danger)]">
          Failed to load dashboard: {error}
        </p>
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

  const pendingCount = data.pipeline.pending.length;
  const activeCount = data.pipeline.active.length;
  const warningCount = data.warnings.length;
  const criticalCount = data.warnings.filter(
    (w) => w.severity === "critical",
  ).length;
  const hasCritical = criticalCount > 0;

  const tabBadge: Record<TabId, number> = {
    overview: 0,
    approvals: pendingCount,
    pipeline: activeCount,
    analytics: 0,
    warnings: warningCount,
  };

  return (
    <div className="space-y-5">
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


      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Dashboard sections"
        className="flex gap-1 overflow-x-auto scrollbar-none border-b border-[var(--border)]"
      >
        {TABS.map((t) => {
          const isActive = activeTab === t.id;
          const badge = tabBadge[t.id];
          // Warnings tab goes red ONLY when a critical warning exists
          const isWarningsTabRed = t.id === "warnings" && hasCritical;
          const activeColor = isWarningsTabRed
            ? "var(--danger)"
            : "var(--accent)";
          const tabTextColor = isActive
            ? activeColor
            : isWarningsTabRed
              ? "var(--danger)"
              : "var(--muted)";
          const badgeColor = isWarningsTabRed
            ? "var(--danger)"
            : t.id === "warnings"
              ? "var(--warning)"
              : t.id === "approvals"
                ? "var(--warning)"
                : "var(--accent)";
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(t.id)}
              className="relative shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors"
              style={{
                color: tabTextColor,
                borderBottom: isActive
                  ? `2px solid ${activeColor}`
                  : "2px solid transparent",
                marginBottom: "-1px",
              }}
            >
              {t.label}
              {badge > 0 && (
                <span
                  className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white"
                  style={{ background: badgeColor }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab panels */}
      <div role="tabpanel" aria-labelledby={activeTab}>
        {activeTab === "overview" && (
          <div className="space-y-5">
            <DashboardKpis data={data} onOpenTab={setActiveTab} />
            <IndexerPerformancePanel indexers={data.analytics.indexers} />
          </div>
        )}

        {activeTab === "approvals" && (
          <PendingApprovalsCard
            requests={data.pipeline.pending}
            onApprove={handleApprove}
            onDeny={handleDeny}
          />
        )}

        {activeTab === "pipeline" && (
          <div className="space-y-5">
            <PipelineTable
              title="Active Downloads"
              requests={data.pipeline.active}
              showProgress
            />
            <PipelineTable
              title="Recently Completed"
              requests={data.pipeline.recent}
              onRetry={handleRetry}
            />
          </div>
        )}

        {activeTab === "analytics" && (
          <AnalyticsGrid analytics={data.analytics} />
        )}

        {activeTab === "warnings" && (
          <>
            {data.warnings.length > 0 ? (
              <WarningsPanel warnings={data.warnings} />
            ) : (
              <div
                className="rounded-xl px-4 py-10 text-center ring-1 ring-[var(--border)]"
                style={{ background: "var(--card)" }}
              >
                <p className="text-sm text-[var(--muted)]">
                  No warnings — all systems nominal.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
