import { PIPELINE_RULES, isUnreleased as isUnreleasedError } from "@/lib/pipeline-rules";
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

function isUnreleased(req: PipelineRequestDTO): boolean {
  return isUnreleasedError(req.lastError);
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

  // Critical: failed downloads. Thread queueId + source so the admin
  // dashboard can wire a per-warning Blocklist button that dispatches
  // DELETE against the right *arr.
  for (const item of input.queue) {
    if (item.status === "failed" || item.status === "warning") {
      warnings.push({
        severity: "critical",
        title: `Failed download: ${item.title}`,
        detail: item.statusMessages.join("; ") || `Status: ${item.status}`,
        queueId: item.id,
        queueSource: item.source,
      });
    }
  }

  // Warning: stalled downloads (progress > 0 < 100 with a stall message).
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
          queueId: item.id,
          queueSource: item.source,
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

  // Warning: approved but not in queue (30min+). Excludes requests
  // status-checker.ts has already correctly parked back at "approved"
  // because the title isn't released yet (its movie-unreleased block
  // writes exactly these two lastError prefixes) -- those aren't stuck,
  // they're just waiting, and flagging them invites a pointless Retry
  // click that just re-confirms an already-added title and gets bounced
  // right back here on the next poll.
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  for (const req of input.active) {
    if (req.status === "approved" && !req.queueItem && !isUnreleased(req)) {
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

  // Warning: stuck downloads (downloading but not in any queue, approved
  // 2h+ ago). Named "Stuck download", not "Orphaned download" -- that
  // name collides with orphans.ts's unrelated concept (a disk/queue item
  // with no matching Lexarr request, the opposite direction of mismatch).
  // Dashboard counterpart of status-checker.ts's Tier B ("no sources
  // found"), which acts later (12h) on the live *arr state rather than
  // this merged queueItem snapshot.
  const noSourcesFound = PIPELINE_RULES["no-sources-found"];
  for (const req of input.active) {
    if (req.status === "downloading" && !req.queueItem) {
      const approvedTime = req.approvedAt
        ? new Date(req.approvedAt).getTime()
        : new Date(req.createdAt).getTime();
      if (approvedTime < Date.now() - noSourcesFound.warnThresholdMs) {
        warnings.push({
          severity: noSourcesFound.severity,
          kind: noSourcesFound.kind,
          title: `${noSourcesFound.titlePrefix}: ${req.title}`,
          detail: "Marked as downloading but not found in any download queue",
          requestId: req.id,
        });
      }
    }
  }

  // Critical: failed routing (approved but never sent to arr). Dashboard
  // counterpart of Tier A, which shares the same 1h threshold -- Tier A
  // paces its own hourly retry attempts against it too.
  const neverDispatched = PIPELINE_RULES["never-dispatched"];
  for (const req of input.active) {
    if (req.status === "approved" && !req.arrId) {
      const approvedTime = req.approvedAt
        ? new Date(req.approvedAt).getTime()
        : new Date(req.createdAt).getTime();
      if (approvedTime < Date.now() - neverDispatched.warnThresholdMs) {
        warnings.push({
          severity: neverDispatched.severity,
          kind: neverDispatched.kind,
          title: `${neverDispatched.titlePrefix}: ${req.title}`,
          detail: "Approved over 1 hour ago but never sent to *arr service",
          requestId: req.id,
        });
      }
    }
  }

  // Warning: stalled requests. Dashboard counterpart of Tier C, which
  // only acts (auto-fails) after its own much longer 48h cutoff --
  // showing this immediately once status-checker.ts has already moved
  // the request to "stalled" is correct, not a missing threshold.
  const stalledTooLong = PIPELINE_RULES["stalled-too-long"];
  for (const req of input.active) {
    if (req.status === "stalled") {
      warnings.push({
        severity: stalledTooLong.severity,
        kind: stalledTooLong.kind,
        title: `${stalledTooLong.titlePrefix}: ${req.title}`,
        detail: req.lastError || "No download progress detected",
        requestId: req.id,
      });
    }
  }

  // Critical: can't verify status (every poll since checkFailingSince has
  // thrown -- network blip, or the *arr choking on this one title).
  // Dashboard counterpart of Tier D, which shares the "arrId set, check
  // failing" condition but acts later (2h) so an admin sees it first
  // instead of the request silently re-accumulating the same error.
  // Distinct from "Failed to route" (no arrId at all) and "Stuck
  // download"/"Not in queue" (check succeeds, nothing just found yet).
  const checkFailing = PIPELINE_RULES["check-failing"];
  for (const req of input.active) {
    if (
      req.checkFailingSince &&
      new Date(req.checkFailingSince).getTime() < Date.now() - checkFailing.warnThresholdMs
    ) {
      warnings.push({
        severity: checkFailing.severity,
        kind: checkFailing.kind,
        title: `${checkFailing.titlePrefix}: ${req.title}`,
        detail: req.lastError || "Status checks have been failing",
        requestId: req.id,
      });
    }
  }

  return warnings;
}
