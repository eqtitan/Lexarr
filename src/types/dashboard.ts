import type { MediaType } from ".";
import type { RuleKind } from "@/lib/pipeline-rules";

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
  autoRetryCount?: number;
  lastError?: string | null;
  /** Set when status-checker.ts's per-request check has been throwing since this time; null once a check succeeds. */
  checkFailingSince?: string | null;
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
  /**
   * (M2-02) Docker container name on the Unraid host. When present, the
   * Diagnose modal renders a deep link to the Unraid Docker page so the
   * operator can jump straight to logs / restart controls.
   */
  unraidContainerName?: string;
}


// ── Warnings ────────────────────────────────────────────────────────────

export type WarningSeverity = "critical" | "warning" | "info";

export interface DashboardWarning {
  severity: WarningSeverity;
  title: string;
  detail?: string;
  /**
   * Set when this warning is one of pipeline-rules.ts's four shared
   * stuck-request kinds -- lets WarningsPanel.tsx pick an action without
   * re-parsing `title`. Absent for warnings outside that table (service
   * health, queue items, pending approval, "Not in queue").
   */
  kind?: RuleKind;
  /**
   * For warnings about a specific user request — enables per-request
   * actions (Retry / Approve / Deny) in the admin dashboard panel.
   */
  requestId?: string;
  /**
   * For warnings about a specific *arr-queue item (e.g. failed/stalled
   * downloads) — enables per-queue actions (Blocklist + remove from
   * download client) in the admin dashboard panel.
   */
  queueId?: number;
  /** Which *arr owns the queueId above — dispatches the DELETE call. */
  queueSource?: "radarr" | "sonarr" | "lidarr";
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

// ── Container status (M2-01) ────────────────────────────────────────────

/**
 * Per-service container status surfaced by the Diagnose modal.
 * Sourced primarily from `/stack-health/services/<name>.json` written by
 * the host cron; optionally refreshed live via SSH when configured.
 */
export interface ContainerStatusDTO {
  /** Operator-facing service name (matches the SERVICE_REGISTRY entry). */
  name: string;
  /** docker container status: "running" | "exited" | "restarting" | "dead" | "paused" | null when unknown. */
  status: string | null;
  /** ISO timestamp the container was last started, or null if not running / unknown. */
  startedAt: string | null;
  /** Human-readable uptime ("2d 3h", "47m"); null when not running / unknown. */
  uptime: string | null;
  /** Last 50-ish log lines, oldest first. Empty array when unavailable. */
  logs: string[];
  /** ISO timestamp of when this snapshot was captured (file mtime, or now if refreshed via SSH). */
  asOf: string | null;
  /** "cron" (file-backed snapshot, possibly stale) | "ssh" (live refresh) | null when no data. */
  source: "cron" | "ssh" | null;
  /**
   * Whether the server has SSH credentials configured. Drives the visibility
   * of the "Refresh now" button — the env values themselves are never sent.
   */
  refreshAvailable: boolean;
}
// ── Orphan cleanup ──────────────────────────────────────────────────────

/**
 * A completed-but-unimported torrent folder identified by the stack
 * healthcheck cron. Surfaced in the admin Warnings tab for one-click removal.
 */
export interface OrphanItem {
  /** Raw folder name from orphan-state.txt */
  folderName: string;
  category: "tv" | "movies" | "music" | "books";
  /** Days the folder has been sitting in the completed download directory */
  daysStuck: number;
  /** How many times the healthcheck has attempted (and failed) to import it */
  scanCount: number;
  /** qBittorrent info hash — null when no matching torrent found in qBit */
  qbHash: string | null;
  /** qBittorrent torrent state ("stalledUP", "uploading", etc.) */
  qbState: string | null;
  /** Whether the *arr service reports the content as already having a file.
   *  null when the arr service couldn't be reached or parse failed. */
  arrHasFile: boolean | null;
  /** true iff arrHasFile === true — safe to delete torrent + files */
  safeToRemove: boolean;
}

// ── Stack healthcheck (host cron) ───────────────────────────────────────

export interface StackHealthSummary {
  /** ISO — when the host cron last wrote a report */
  lastRunAt: string;
  /** Minutes since last run */
  staleMinutes: number;
  /** Issues the script found */
  issueCount: number;
  /** Stuck downloads auto-cleaned this run */
  cleanedCount: number;
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
  /** Null when the healthcheck file isn't readable (volume not mounted / no run yet) */
  stackHealth: StackHealthSummary | null;
  generatedAt: string;
}
