import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";
import { computeAnalytics } from "@/lib/dashboard/analytics";
import { generateWarnings } from "@/lib/dashboard/warnings";
import { SERVICE_REGISTRY } from "@/lib/dashboard/services";
import type {
  DashboardData,
  PipelineRequestDTO,
  QueueItemDTO,
  ServiceHealthDTO,
} from "@/types/dashboard";

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizeQueueItem(record: any, source: "radarr" | "sonarr" | "lidarr"): QueueItemDTO {
  const sizeBytes = record.size || 0;
  const remainingBytes = record.sizeleft || 0;
  const downloadedBytes = sizeBytes - remainingBytes;
  const progress = sizeBytes > 0 ? (downloadedBytes / sizeBytes) * 100 : 0;

  return {
    id: record.id,
    title: record.title || "Unknown",
    status: (record.status || "unknown").toLowerCase(),
    progress: Math.round(progress * 10) / 10,
    sizeGB: Math.round((sizeBytes / 1073741824) * 100) / 100,
    downloadedGB: Math.round((downloadedBytes / 1073741824) * 100) / 100,
    eta: record.timeleft || null,
    indexer: record.indexer || null,
    downloadClient: record.downloadClient || null,
    source,
    contentId: record.movieId || record.seriesId || record.artistId || null,
    statusMessages: (record.statusMessages || []).flatMap((m: any) =>
      m.messages || (m.title ? [m.title] : [])
    ),
  };
}

async function checkServiceHealth(
  name: string,
  healthFn: () => Promise<any>
): Promise<ServiceHealthDTO> {
  const start = Date.now();
  try {
    await healthFn();
    return { name, healthy: true, responseMs: Date.now() - start };
  } catch (err: any) {
    return { name, healthy: false, responseMs: Date.now() - start, error: err.message };
  }
}

// ── GET /api/admin/dashboard ─────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Fetch everything in parallel with allSettled so one failure doesn't break all
  const [
    radarrQueueResult,
    sonarrQueueResult,
    lidarrQueueResult,
    radarrIndexerResult,
    sonarrIndexerResult,
    lidarrIndexerResult,
    ...healthSettled
  ] = await Promise.allSettled([
    radarr.getQueueDetails(),
    sonarr.getQueue(),
    lidarr.getQueue(),
    radarr.getIndexerStats(),
    sonarr.getIndexerStats(),
    lidarr.getIndexerStats(),
    // Health checks for all services in SERVICE_REGISTRY order
    ...SERVICE_REGISTRY.map((svc) => checkServiceHealth(svc.name, svc.health)),
  ]);

  // ── Queue ──────────────────────────────────────────────────────────
  const queue: QueueItemDTO[] = [];

  const radarrRecords =
    radarrQueueResult.status === "fulfilled" ? radarrQueueResult.value.records || [] : [];
  const sonarrRecords =
    sonarrQueueResult.status === "fulfilled" ? sonarrQueueResult.value.records || [] : [];
  const lidarrRecords =
    lidarrQueueResult.status === "fulfilled" ? lidarrQueueResult.value.records || [] : [];

  for (const r of radarrRecords) queue.push(normalizeQueueItem(r, "radarr"));
  for (const r of sonarrRecords) queue.push(normalizeQueueItem(r, "sonarr"));
  for (const r of lidarrRecords) queue.push(normalizeQueueItem(r, "lidarr"));

  // ── Services ───────────────────────────────────────────────────────
  const services: ServiceHealthDTO[] = SERVICE_REGISTRY.map((svc, i) => {
    const result = healthSettled[i];
    if (result.status === "fulfilled") {
      return { ...result.value, url: svc.url, category: svc.category };
    }
    return { name: svc.name, healthy: false, responseMs: 0, error: "Health check failed", url: svc.url, category: svc.category };
  });

  // ── Pipeline (DB) ──────────────────────────────────────────────────
  const pendingRequests = await prisma.request.findMany({
    where: { status: "pending" },
    include: {
      user: { select: { name: true, avatar: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  const activeRequests = await prisma.request.findMany({
    where: { status: { in: ["approved", "downloading"] } },
    include: {
      user: { select: { name: true, avatar: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const recentRequests = await prisma.request.findMany({
    where: { status: { in: ["available", "denied", "failed", "stalled"] } },
    include: {
      user: { select: { name: true, avatar: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
  });

  function toPipelineDTO(r: any): PipelineRequestDTO {
    const dto: PipelineRequestDTO = {
      id: r.id,
      title: r.title,
      year: r.year,
      mediaType: r.mediaType,
      status: r.status,
      posterPath: r.posterPath,
      arrId: r.arrId,
      createdAt: r.createdAt.toISOString(),
      approvedAt: r.approvedAt?.toISOString() || null,
      availableAt: r.availableAt?.toISOString() || null,
      user: { name: r.user.name, avatar: r.user.avatar },
      events: r.events.map((e: any) => ({
        id: e.id,
        event: e.event,
        detail: e.detail,
        createdAt: e.createdAt.toISOString(),
      })),
      retryCount: r.retryCount ?? 0,
      lastError: r.lastError ?? null,
      adminNote: r.adminNote ?? null,
      queueItem: null,
    };

    // Merge live queue item if this request has an arrId
    if (r.arrId != null) {
      const match = queue.find((q) => q.contentId === r.arrId);
      if (match) dto.queueItem = match;
    }

    return dto;
  }

  const pending = pendingRequests.map(toPipelineDTO);
  const active = activeRequests.map(toPipelineDTO);
  const recent = recentRequests.map(toPipelineDTO);

  // ── Analytics ──────────────────────────────────────────────────────
  const indexerStatsRaw = {
    radarr: radarrIndexerResult.status === "fulfilled" ? radarrIndexerResult.value : undefined,
    sonarr: sonarrIndexerResult.status === "fulfilled" ? sonarrIndexerResult.value : undefined,
    lidarr: lidarrIndexerResult.status === "fulfilled" ? lidarrIndexerResult.value : undefined,
  };

  const analytics = await computeAnalytics(indexerStatsRaw);

  // ── Warnings ───────────────────────────────────────────────────────
  const warnings = generateWarnings({
    queue,
    pending,
    active,
    services,
    indexers: analytics.indexers.indexers,
  });

  // ── Response ───────────────────────────────────────────────────────
  const data: DashboardData = {
    pipeline: { pending, active, recent },
    queue,
    services,
    analytics,
    warnings,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(data);
}
