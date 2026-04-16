import type {
  DashboardWarning,
  QueueItemDTO,
  PipelineRequestDTO,
  IndexerStat,
  ServiceHealthDTO,
} from "@/types/dashboard";

interface WarningInput {
  queue: QueueItemDTO[];
  pending: PipelineRequestDTO[];
  active: PipelineRequestDTO[];
  services: ServiceHealthDTO[];
  indexers: IndexerStat[];
}

export function generateWarnings(input: WarningInput): DashboardWarning[] {
  const warnings: DashboardWarning[] = [];

  // Critical: service down
  for (const svc of input.services) {
    if (!svc.healthy) {
      warnings.push({
        severity: "critical",
        title: `${svc.name} is unreachable`,
        detail: svc.error || "Health check failed",
      });
    }
  }

  // Critical: failed downloads
  for (const item of input.queue) {
    if (item.status === "failed" || item.status === "warning") {
      warnings.push({
        severity: "critical",
        title: `Failed download: ${item.title}`,
        detail: item.statusMessages.join("; ") || `Status: ${item.status}`,
      });
    }
  }

  // Warning: stalled downloads (no progress descriptions / status messages indicating stall)
  for (const item of input.queue) {
    if (
      item.progress > 0 &&
      item.progress < 100 &&
      item.statusMessages.length > 0
    ) {
      const hasStallMessage = item.statusMessages.some(
        (m) =>
          m.toLowerCase().includes("stall") ||
          m.toLowerCase().includes("no progress"),
      );
      if (hasStallMessage) {
        warnings.push({
          severity: "warning",
          title: `Stalled download: ${item.title}`,
          detail: item.statusMessages.join("; "),
        });
      }
    }
  }

  // Warning: long pending requests (2h+)
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  for (const req of input.pending) {
    if (new Date(req.createdAt).getTime() < twoHoursAgo) {
      const hoursAgo = Math.round(
        (Date.now() - new Date(req.createdAt).getTime()) / (60 * 60 * 1000),
      );
      warnings.push({
        severity: "warning",
        title: `Pending ${hoursAgo}h: ${req.title}`,
        detail: `Awaiting approval since ${new Date(req.createdAt).toLocaleString()}`,
        requestId: req.id,
      });
    }
  }

  // Warning: approved but not in queue (30min+)
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  for (const req of input.active) {
    if (req.status === "approved" && !req.queueItem) {
      const approvedTime = req.approvedAt
        ? new Date(req.approvedAt).getTime()
        : new Date(req.createdAt).getTime();
      if (approvedTime < thirtyMinAgo) {
        warnings.push({
          severity: "warning",
          title: `Not in queue: ${req.title}`,
          detail: "Approved but not yet downloading after 30+ minutes",
          requestId: req.id,
        });
      }
    }
  }

  // Warning: indexer failure rate >30%
  for (const idx of input.indexers) {
    if (idx.failureRate > 30 && idx.queries > 10) {
      warnings.push({
        severity: "warning",
        title: `High failure rate: ${idx.name}`,
        detail: `${idx.failureRate.toFixed(0)}% failure rate (${idx.failures}/${idx.queries} queries)`,
      });
    }
  }

  // Info: large queue (20+)
  if (input.queue.length >= 20) {
    warnings.push({
      severity: "info",
      title: `Large download queue (${input.queue.length} items)`,
      detail: "Consider checking available disk space and download speeds",
    });
  }

  // Warning: orphaned downloads (downloading but not in any queue, approved 2h+ ago)
  for (const req of input.active) {
    if (req.status === "downloading" && !req.queueItem) {
      const approvedTime = req.approvedAt
        ? new Date(req.approvedAt).getTime()
        : new Date(req.createdAt).getTime();
      if (approvedTime < twoHoursAgo) {
        warnings.push({
          severity: "warning",
          title: `Orphaned download: ${req.title}`,
          detail: "Marked as downloading but not found in any download queue",
          requestId: req.id,
        });
      }
    }
  }

  // Critical: failed routing (approved but never sent to arr, 1h+ ago)
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const req of input.active) {
    if (req.status === "approved" && !req.arrId) {
      const approvedTime = req.approvedAt
        ? new Date(req.approvedAt).getTime()
        : new Date(req.createdAt).getTime();
      if (approvedTime < oneHourAgo) {
        warnings.push({
          severity: "critical",
          title: `Failed to route: ${req.title}`,
          detail: "Approved over 1 hour ago but never sent to *arr service",
          requestId: req.id,
        });
      }
    }
  }

  // Warning: stalled requests
  for (const req of input.active) {
    if (req.status === "stalled") {
      warnings.push({
        severity: "warning",
        title: `Stalled: ${req.title}`,
        detail: req.lastError || "No download progress detected",
        requestId: req.id,
      });
    }
  }

  return warnings;
}
