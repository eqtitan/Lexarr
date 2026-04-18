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
import LivePill from "@/components/dashboard/LivePill";

/** Polling intervals. Active downloads → faster poll, idle → slower. */
const POLL_ACTIVE_MS = 10_000;
const POLL_IDLE_MS = 60_000;

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
  const [userPaused, setUserPaused] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isLive = !userPaused && !tabHidden;
  const pausedReason = userPaused
    ? "Paused"
    : tabHidden
      ? "Tab hidden"
      : null;

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

  // Adaptive polling: faster when downloads are active, slower when idle,
  // paused entirely when the browser tab is hidden or the user paused.
  const activeDownloads = data?.pipeline.active.length ?? 0;
  useEffect(() => {
    if (!isLive || role !== "admin") return;
    const interval = activeDownloads > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    intervalRef.current = setInterval(fetchDashboard, interval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isLive, role, fetchDashboard, activeDownloads]);

  // Track browser tab visibility so we don't poll in the background.
  useEffect(() => {
    const onVisibilityChange = () => {
      const hidden = document.visibilityState === "hidden";
      setTabHidden(hidden);
      // Fire immediately on re-focus so the UI feels fresh
      if (!hidden && role === "admin") fetchDashboard();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [role, fetchDashboard]);

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
      {/* Status pill — replaces title/timestamp/checkbox/refresh button.
          Nav above already shows "Dashboard"; no need for H1. */}
      <div className="flex justify-end">
        <LivePill
          lastUpdatedAt={data.generatedAt}
          isLive={isLive}
          pausedReason={pausedReason}
          onTogglePause={() => setUserPaused((p) => !p)}
          onForceRefresh={fetchDashboard}
        />
      </div>


      {/* Tabs. On mobile we tighten padding/text so all 5 fit, and add a
          right-edge gradient fade to hint at horizontal scroll when they
          don't. Active tab auto-scrolls into view via scrollIntoView. */}
      <div className="relative">
        <div
          role="tablist"
          aria-label="Dashboard sections"
          className="flex gap-1 overflow-x-auto scrollbar-none border-b border-[var(--border)] snap-x snap-mandatory"
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
                onClick={(e) => {
                  setActiveTab(t.id);
                  // Scroll the newly-active tab into view on mobile where
                  // the row can overflow. `nearest` keeps desktop stable.
                  (e.currentTarget as HTMLButtonElement).scrollIntoView({
                    behavior: "smooth",
                    inline: "center",
                    block: "nearest",
                  });
                }}
                className="relative shrink-0 snap-start flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
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
                    className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white sm:px-1.5 sm:text-[10px]"
                    style={{ background: badgeColor }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* Right-edge fade — hint that tabs scroll on narrow screens. Pointer
            events off so it doesn't block clicks on the last visible tab. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 h-full w-8 sm:hidden"
          style={{
            background:
              "linear-gradient(to right, transparent, var(--background) 80%)",
          }}
        />
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
              <WarningsPanel
                warnings={data.warnings}
                onActionComplete={fetchDashboard}
              />
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
