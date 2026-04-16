import type { MediaType } from ".";

// ── Pipeline ────────────────────────────────────────────────────────────

export interface PipelineEventDTO {
  id: string;
  event: string;
  detail: string | null;
  createdAt: string;
}

export interface PipelineRequestDTO {
  id: string;
  title: string;
  year: string | null;
  mediaType: MediaType;
  status: string;
  posterPath: string | null;
  arrId: number | null;
  createdAt: string;
  approvedAt: string | null;
  availableAt: string | null;
  user: { name: string; avatar: string | null };
  events: PipelineEventDTO[];
  retryCount?: number;
  lastError?: string | null;
  adminNote?: string | null;
  /** Merged from live *arr queue */
  queueItem?: QueueItemDTO | null;
}

// ── Queue ───────────────────────────────────────────────────────────────

export interface QueueItemDTO {
  id: number;
  title: string;
  status: string;
  progress: number; // 0-100
  sizeGB: number;
  downloadedGB: number;
  eta: string | null;
  indexer: string | null;
  downloadClient: string | null;
  /** Which *arr service owns this */
  source: "radarr" | "sonarr" | "lidarr";
  /** The arr-internal content ID (movieId / seriesId / artistId) */
  contentId: number | null;
  statusMessages: string[];
}

// ── Services ────────────────────────────────────────────────────────────

export interface ServiceHealthDTO {
  name: string;
  healthy: boolean;
  responseMs: number;
  error?: string;
  url?: string;
  category?: "arr" | "download" | "media" | "utility";
}

// ── Warnings ────────────────────────────────────────────────────────────

export type WarningSeverity = "critical" | "warning" | "info";

export interface DashboardWarning {
  severity: WarningSeverity;
  title: string;
  detail?: string;
  requestId?: string;
}

// ── Analytics ───────────────────────────────────────────────────────────

export interface RequestStats {
  total: number;
  byType: Record<MediaType, number>;
  byStatus: Record<string, number>;
}

export interface FulfillmentStats {
  avgApprovalMinutes: number | null;
  avgFulfillmentMinutes: number | null;
  medianApprovalMinutes: number | null;
  medianFulfillmentMinutes: number | null;
}

export interface IndexerStat {
  name: string;
  queries: number;
  grabs: number;
  failures: number;
  failureRate: number;
  /** All *arr services that use this indexer (radarr, sonarr, lidarr) */
  sources: string[];
}

export interface IndexerPerformance {
  indexers: IndexerStat[];
  recommendations: string[];
}

export interface TopRequester {
  name: string;
  avatar: string | null;
  count: number;
}

export interface AnalyticsDTO {
  requests: RequestStats;
  fulfillment: FulfillmentStats;
  indexers: IndexerPerformance;
  topRequesters: TopRequester[];
}

// ── Full dashboard response ─────────────────────────────────────────────

export interface DashboardData {
  pipeline: {
    pending: PipelineRequestDTO[];
    active: PipelineRequestDTO[];
    recent: PipelineRequestDTO[];
  };
  queue: QueueItemDTO[];
  services: ServiceHealthDTO[];
  analytics: AnalyticsDTO;
  warnings: DashboardWarning[];
  generatedAt: string;
}
