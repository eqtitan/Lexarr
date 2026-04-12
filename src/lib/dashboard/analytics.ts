import { prisma } from "@/lib/db";
import type { AnalyticsDTO, IndexerStat, IndexerPerformance, FulfillmentStats, RequestStats, TopRequester } from "@/types/dashboard";
import type { MediaType } from "@/types";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function computeAnalytics(indexerStatsRaw: { radarr?: any; sonarr?: any; lidarr?: any }): Promise<AnalyticsDTO> {
  // ── Request stats ──────────────────────────────────────────────────
  const allRequests = await prisma.request.findMany({
    select: { mediaType: true, status: true, approvedAt: true, availableAt: true, createdAt: true, userId: true },
  });

  const byType: Record<MediaType, number> = { movie: 0, tv: 0, music: 0, book: 0 };
  const byStatus: Record<string, number> = {};

  for (const r of allRequests) {
    byType[r.mediaType as MediaType] = (byType[r.mediaType as MediaType] || 0) + 1;
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }

  const requestStats: RequestStats = {
    total: allRequests.length,
    byType,
    byStatus,
  };

  // ── Fulfillment stats ──────────────────────────────────────────────
  const approvalTimes: number[] = [];
  const fulfillmentTimes: number[] = [];

  for (const r of allRequests) {
    if (r.approvedAt) {
      const mins = (new Date(r.approvedAt).getTime() - new Date(r.createdAt).getTime()) / 60000;
      if (mins >= 0) approvalTimes.push(mins);
    }
    if (r.approvedAt && r.availableAt) {
      const mins = (new Date(r.availableAt).getTime() - new Date(r.approvedAt).getTime()) / 60000;
      if (mins >= 0) fulfillmentTimes.push(mins);
    }
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const fulfillment: FulfillmentStats = {
    avgApprovalMinutes: avg(approvalTimes),
    avgFulfillmentMinutes: avg(fulfillmentTimes),
    medianApprovalMinutes: median(approvalTimes),
    medianFulfillmentMinutes: median(fulfillmentTimes),
  };

  // ── Indexer performance ────────────────────────────────────────────
  const indexers: IndexerStat[] = [];

  for (const [source, stats] of Object.entries(indexerStatsRaw)) {
    if (!stats?.indexers) continue;
    for (const idx of stats.indexers) {
      const queries = (idx.numberOfQueries || 0) + (idx.numberOfRssQueries || 0);
      const grabs = idx.numberOfGrabs || 0;
      const failures = idx.numberOfFailedQueries || 0;
      indexers.push({
        name: idx.indexerName || idx.name || "Unknown",
        queries,
        grabs,
        failures,
        failureRate: queries > 0 ? (failures / queries) * 100 : 0,
        source,
      });
    }
  }

  const recommendations: string[] = [];
  const highFailure = indexers.filter((i) => i.failureRate > 30 && i.queries > 10);
  if (highFailure.length > 0) {
    recommendations.push(`Consider disabling or troubleshooting: ${highFailure.map((i) => i.name).join(", ")}`);
  }
  const zeroGrab = indexers.filter((i) => i.grabs === 0 && i.queries > 20);
  if (zeroGrab.length > 0) {
    recommendations.push(`No grabs from: ${zeroGrab.map((i) => i.name).join(", ")} -- check categories/filters`);
  }
  if (indexers.length === 0) {
    recommendations.push("No indexer data available. Check *arr connections.");
  }

  const indexerPerformance: IndexerPerformance = { indexers, recommendations };

  // ── Top requesters ─────────────────────────────────────────────────
  const userCounts: Record<string, { name: string; avatar: string | null; count: number }> = {};
  for (const r of allRequests) {
    if (!userCounts[r.userId]) {
      userCounts[r.userId] = { name: "", avatar: null, count: 0 };
    }
    userCounts[r.userId].count++;
  }

  const userIds = Object.keys(userCounts);
  if (userIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, avatar: true },
    });
    for (const u of users) {
      if (userCounts[u.id]) {
        userCounts[u.id].name = u.name;
        userCounts[u.id].avatar = u.avatar;
      }
    }
  }

  const topRequesters: TopRequester[] = Object.values(userCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { requests: requestStats, fulfillment, indexers: indexerPerformance, topRequesters };
}
