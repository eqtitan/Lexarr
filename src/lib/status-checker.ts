/**
 * Shared status-checking logic.
 * Polls *arr apps and updates request statuses in the database.
 * Used by: /api/status (admin), /api/admin/dashboard (piggyback),
 *          instrumentation.ts (background interval), and webhook handlers.
 *
 * 2026-04 — stuck-download detection hardening:
 *   - Errors inside the per-request loop now write lastError + lastCheckedAt
 *     instead of being silently swallowed (items previously became invisible
 *     to Tier B because lastCheckedAt stayed NULL).
 *   - Tier B now includes books (was movie/tv/music only).
 *   - Tier B's stale filter now also matches lastCheckedAt IS NULL.
 *   - New diagnostic rule: monitored + not-in-queue + percent<100 + age>12h
 *     is flagged as stalled with reason "No releases found after <N>h".
 *   - Unreleased detection broadened to movies with status==="announced"
 *     and no known release dates.
 *   - arrId identity guard: detects when the *arr's ID has been reused for
 *     a different title (deletion + re-add) and marks request failed with
 *     a clear reason instead of silently tracking the wrong item.
 */
import { prisma } from "./db";
import * as radarr from "./arr/radarr";
import * as sonarr from "./arr/sonarr";
import * as lidarr from "./arr/lidarr";
import * as lazylibrarian from "./arr/lazylibrarian";
import { notify } from "./notifications";
import { sendToArrAndUpdateStatus } from "./services/request";
import type { MediaType } from "@/types";
import type { ArrQueueRecord } from "@/types/external-apis";

interface LazyLibrarianRecord {
  BookID?: string;
  id?: string;
}

export interface StatusCheckResult {
  updated: number;
  stuckFlagged: number;
  autoRetried: number;
  autoFailed: number;
}

// Hours before a monitored, never-found item is considered "no sources found".
const NO_SOURCES_HOURS = 12;

/**
 * Format a duration (ms) as a short human string like "14h" or "3d".
 */
function ageLabel(ms: number): string {
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/**
 * Check all active requests and update their statuses.
 * Safe to call concurrently — each request is updated independently.
 */
export async function checkAndUpdateStatuses(): Promise<StatusCheckResult> {
  const activeRequests = await prisma.request.findMany({
    where: {
      status: { in: ["approved", "downloading"] },
      arrId: { not: null },
    },
  });

  if (activeRequests.length === 0) {
    return { updated: 0, stuckFlagged: 0, autoRetried: 0, autoFailed: 0 };
  }

  let updated = 0;
  const now = new Date();

  for (const req of activeRequests) {
    try {
      let isAvailable = false;
      let inQueue = false;
      let identityMismatch: string | null = null;

      if (req.mediaType === "book") {
        const llBookId = req.externalId2 || String(req.arrId);
        if (!llBookId) continue;
        // Audiobook requests poll LL's AudioStatus field rather than Status.
        // Legacy rows with null bookFormat are treated as ebook.
        const llType =
          req.bookFormat === "audiobook" ? "AudioBook" : "eBook";
        const status = await lazylibrarian.getBookStatus(llBookId, llType);
        isAvailable = status === "Have";
        if (!isAvailable && req.status === "approved") {
          const wanted = await lazylibrarian
            .getQueue()
            .catch(() => ({ records: [] }));
          inQueue = (wanted.records as LazyLibrarianRecord[]).some(
            (r) =>
              String(r.BookID) === llBookId || String(r.id) === llBookId,
          );
        }
      } else if (req.mediaType === "movie" && req.arrId) {
        const movie = await radarr.getMovie(req.arrId);

        // arrId drift: Radarr's numeric ID has been reused for a different film.
        if (movie.tmdbId && req.externalId && String(movie.tmdbId) !== String(req.externalId)) {
          identityMismatch = `Radarr id ${req.arrId} now tracks tmdbId=${movie.tmdbId} but request expected tmdbId=${req.externalId}`;
        }

        // Unreleased content detection (broadened):
        //   1. Known digital/physical release date still in the future
        //   2. Radarr status === "announced" with no release date at all
        if (!identityMismatch && req.status === "downloading") {
          const digitalRelease = movie.digitalRelease
            ? new Date(movie.digitalRelease)
            : null;
          const physicalRelease = movie.physicalRelease
            ? new Date(movie.physicalRelease)
            : null;
          const earliestRelease = digitalRelease && physicalRelease
            ? (digitalRelease < physicalRelease ? digitalRelease : physicalRelease)
            : digitalRelease || physicalRelease;

          if (earliestRelease && earliestRelease > now) {
            const releaseDate = earliestRelease.toISOString().split("T")[0];
            await prisma.request.update({
              where: { id: req.id },
              data: {
                status: "approved",
                lastError: `Awaiting release: ${releaseDate}`,
                lastCheckedAt: now,
              },
            });
            await prisma.pipelineEvent.create({
              data: {
                requestId: req.id,
                event: "approved",
                detail: JSON.stringify({
                  reason: "unreleased",
                  releaseDate,
                }),
              },
            });
            updated++;
            continue;
          }

          if (movie.status === "announced" && !earliestRelease) {
            await prisma.request.update({
              where: { id: req.id },
              data: {
                status: "approved",
                lastError: "Not yet released (no release date announced)",
                lastCheckedAt: now,
              },
            });
            await prisma.pipelineEvent.create({
              data: {
                requestId: req.id,
                event: "approved",
                detail: JSON.stringify({ reason: "announced_no_date" }),
              },
            });
            updated++;
            continue;
          }
        }

        isAvailable = movie.hasFile === true;
        if (!isAvailable && req.status === "approved") {
          const queues = await radarr.getQueue();
          inQueue = (queues?.records || []).some(
            (r: ArrQueueRecord) => r.movieId === req.arrId,
          );
        }
      } else if (req.mediaType === "tv" && req.arrId) {
        const series = await sonarr.getSeries(req.arrId);

        // arrId drift: Sonarr's id has been reused. Lexarr stores tmdbId in externalId
        // (same as Radarr), so compare against series.tmdbId.
        if (series.tmdbId && req.externalId && /^\d+$/.test(String(req.externalId)) &&
            String(series.tmdbId) !== String(req.externalId)) {
          identityMismatch = `Sonarr id ${req.arrId} now tracks tmdbId=${series.tmdbId} but request expected tmdbId=${req.externalId}`;
        }

        isAvailable = series.statistics?.percentOfEpisodes === 100;
        if (!isAvailable && req.status === "approved") {
          const queues = await sonarr.getQueue();
          inQueue = (queues?.records || []).some(
            (r: ArrQueueRecord) => r.seriesId === req.arrId,
          );
        }
      } else if (req.mediaType === "music" && req.arrId) {
        // Two flavors of music requests:
        //   - Full-artist (rare / fallback): req.releaseType is null,
        //     arrId = Lidarr artist id → check at artist level.
        //   - Release-group (default in 0.16.1+): req.releaseType is
        //     "album" | "single" | "ep" | "other", arrId = Lidarr
        //     album id → must use getAlbum, not getArtist.
        // Earlier versions unconditionally called getArtist(arrId),
        // which returned 404 when arrId was actually an album id,
        // and the catch block falsely marked the request as
        // "Deleted from *arr".
        if (req.releaseType) {
          const album = await lidarr.getAlbum(req.arrId);
          // arrId drift on album — MB release-group id stored in
          // externalId, not externalId2, for release-group requests.
          if (album.foreignAlbumId && req.externalId &&
              album.foreignAlbumId !== req.externalId) {
            identityMismatch = `Lidarr album ${req.arrId} now tracks RG=${album.foreignAlbumId} but request expected ${req.externalId}`;
          }
          // An album is "available" when fully downloaded.
          isAvailable =
            album.statistics?.percentOfTracks === 100 &&
            (album.statistics?.trackFileCount ?? 0) > 0;
          if (!isAvailable && req.status === "approved") {
            const queues = await lidarr.getQueue();
            inQueue = (queues?.records || []).some(
              (r: ArrQueueRecord) => r.albumId === req.arrId,
            );
          }
        } else {
          // Full-artist fallback path
          const artist = await lidarr.getArtist(req.arrId);
          if (artist.foreignArtistId && req.externalId2 &&
              artist.foreignArtistId !== req.externalId2) {
            identityMismatch = `Lidarr id ${req.arrId} now tracks MBID=${artist.foreignArtistId} but request expected ${req.externalId2}`;
          }
          isAvailable =
            artist.statistics?.albumCount > 0 &&
            artist.statistics?.percentOfTracks === 100;
          if (!isAvailable && req.status === "approved") {
            const queues = await lidarr.getQueue();
            inQueue = (queues?.records || []).some(
              (r: ArrQueueRecord) => r.artistId === req.arrId,
            );
          }
        }
      }

      if (identityMismatch) {
        await prisma.request.update({
          where: { id: req.id },
          data: {
            status: "failed",
            lastError: `Tracker drift — please re-request. ${identityMismatch}`,
            lastCheckedAt: now,
          },
        });
        await prisma.pipelineEvent.create({
          data: {
            requestId: req.id,
            event: "failed",
            detail: JSON.stringify({ reason: "arrid_drift", note: identityMismatch }),
          },
        });
        updated++;
        continue;
      }

      if (isAvailable && req.status !== "available") {
        await prisma.request.update({
          where: { id: req.id },
          data: { status: "available", availableAt: now, lastCheckedAt: now, lastError: null },
        });
        await prisma.pipelineEvent.create({
          data: { requestId: req.id, event: "available" },
        });

        // Notify user that content is now available
        const user = await prisma.user.findUnique({
          where: { id: req.userId },
          select: { name: true },
        });
        notify({
          event: "available",
          title: req.title,
          mediaType: req.mediaType as MediaType,
          status: "available",
          user: user?.name || "Unknown",
          posterUrl: req.posterPath || undefined,
        });

        updated++;
      } else if (!isAvailable && req.status === "approved" && inQueue) {
        await prisma.request.update({
          where: { id: req.id },
          data: { status: "downloading", lastCheckedAt: now, lastError: null },
        });
        await prisma.pipelineEvent.create({
          data: { requestId: req.id, event: "downloading" },
        });
        updated++;
      } else {
        await prisma.request.update({
          where: { id: req.id },
          data: { lastCheckedAt: now },
        });
      }
    } catch (err: unknown) {
      // Do NOT swallow. Surface the error so admins can see why an item is stuck,
      // and always bump lastCheckedAt so Tier B stale-detection can see this row.
      const msg = err instanceof Error ? err.message : String(err);
      const isDeleted = /\b404\b/.test(msg);
      try {
        if (isDeleted) {
          // Item was deleted from the *arr — no point retrying. Flip to failed now.
          await prisma.request.update({
            where: { id: req.id },
            data: {
              status: "failed",
              lastCheckedAt: now,
              lastError: `Deleted from *arr — please re-request`,
            },
          });
          await prisma.pipelineEvent.create({
            data: {
              requestId: req.id,
              event: "failed",
              detail: JSON.stringify({ reason: "arr_404", raw: msg.slice(0, 200) }),
            },
          });
        } else {
          await prisma.request.update({
            where: { id: req.id },
            data: {
              lastCheckedAt: now,
              lastError: `Check failed: ${msg.slice(0, 240)}`,
            },
          });
        }
      } catch {
        // If even the DB write fails there's nothing meaningful we can do here.
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Tier B — "No releases found" stall detection (NEW)
  // Covers monitored items that have never downloaded anything and are
  // not in the *arr queue. Books are now included. Uses a 12h floor so
  // we don't race the *arr's initial search cycle.
  // ────────────────────────────────────────────────────────────────────
  const noSourcesCutoff = new Date(now.getTime() - NO_SOURCES_HOURS * 60 * 60 * 1000);
  // Age-based filter: any download older than 12h gets re-evaluated regardless of
  // when we last looked. Internal checks return early if the item is in queue /
  // has hasFile, so running this every cycle for old items is cheap.
  const neverFoundCandidates = await prisma.request.findMany({
    where: {
      status: "downloading",
      arrId: { not: null },
      createdAt: { lt: noSourcesCutoff },
    },
  });

  for (const req of neverFoundCandidates) {
    try {
      let inArrQueue = false;
      let hasFile = false;
      let percent = 0;

      if (req.mediaType === "movie" && req.arrId) {
        const movie = await radarr.getMovie(req.arrId);
        hasFile = movie.hasFile === true;
        percent = hasFile ? 100 : 0;
        if (!hasFile) {
          const queues = await radarr.getQueue();
          inArrQueue = (queues?.records || []).some(
            (r: ArrQueueRecord) => r.movieId === req.arrId,
          );
        }
      } else if (req.mediaType === "tv" && req.arrId) {
        const series = await sonarr.getSeries(req.arrId);
        percent = series.statistics?.percentOfEpisodes ?? 0;
        hasFile = percent === 100;
        if (!hasFile) {
          const queues = await sonarr.getQueue();
          inArrQueue = (queues?.records || []).some(
            (r: ArrQueueRecord) => r.seriesId === req.arrId,
          );
        }
      } else if (req.mediaType === "music" && req.arrId) {
        // Same release-group-vs-artist split as the main loop above —
        // see comment there. Tier B runs against the same records so
        // it needs the same dispatch.
        if (req.releaseType) {
          const album = await lidarr.getAlbum(req.arrId);
          percent = album.statistics?.percentOfTracks ?? 0;
          hasFile = percent === 100 && (album.statistics?.trackFileCount ?? 0) > 0;
          if (!hasFile) {
            const queues = await lidarr.getQueue();
            inArrQueue = (queues?.records || []).some(
              (r: ArrQueueRecord) => r.albumId === req.arrId,
            );
          }
        } else {
          const artist = await lidarr.getArtist(req.arrId);
          percent = artist.statistics?.percentOfTracks ?? 0;
          hasFile = artist.statistics?.albumCount > 0 && percent === 100;
          if (!hasFile) {
            const queues = await lidarr.getQueue();
            inArrQueue = (queues?.records || []).some(
              (r: ArrQueueRecord) => r.artistId === req.arrId,
            );
          }
        }
      } else if (req.mediaType === "book") {
        const llBookId = req.externalId2 || String(req.arrId);
        const llType =
          req.bookFormat === "audiobook" ? "AudioBook" : "eBook";
        const status = await lazylibrarian.getBookStatus(llBookId, llType);
        hasFile = status === "Have";
        // Note: LazyLibrarian's "Wanted" state is "still searching, nothing found"
        // — NOT an active download like Radarr/Sonarr queues. So we do NOT treat
        // Wanted-list membership as inArrQueue. Age-based stall applies.
        inArrQueue = false;
      }

      if (hasFile) {
        // Becomes available naturally on the next poll cycle.
        continue;
      }
      if (inArrQueue) {
        // Genuinely downloading — stamp lastCheckedAt so we don't loop on it.
        await prisma.request.update({
          where: { id: req.id },
          data: { lastCheckedAt: now },
        });
        continue;
      }

      const ageMs = now.getTime() - new Date(req.createdAt).getTime();
      const reason =
        percent > 0
          ? `No additional releases found after ${ageLabel(ageMs)} — partial at ${percent.toFixed(0)}%`
          : `No releases found after ${ageLabel(ageMs)} — indexers returned nothing`;

      await prisma.request.update({
        where: { id: req.id },
        data: {
          status: "stalled",
          lastError: reason,
          lastCheckedAt: now,
        },
      });
      await prisma.pipelineEvent.create({
        data: {
          requestId: req.id,
          event: "stalled",
          detail: JSON.stringify({
            reason: "no_sources_found",
            ageHours: Math.floor(ageMs / 3_600_000),
            percent,
          }),
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await prisma.request.update({
          where: { id: req.id },
          data: {
            lastCheckedAt: now,
            lastError: `Stall check failed: ${msg.slice(0, 240)}`,
          },
        });
      } catch {
        // Skip
      }
    }
  }

  // Legacy stuck-event marker retained for PipelineEvent history (24h cutoff).
  const stuckCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const stuck = await prisma.request.findMany({
    where: {
      status: "downloading",
      OR: [
        { lastCheckedAt: { lt: stuckCutoff } },
        { lastCheckedAt: null, createdAt: { lt: stuckCutoff } },
      ],
    },
  });
  for (const req of stuck) {
    const alreadyFlagged = await prisma.pipelineEvent.findFirst({
      where: { requestId: req.id, event: "stalled" },
    });
    if (!alreadyFlagged) {
      await prisma.pipelineEvent.create({
        data: {
          requestId: req.id,
          event: "stalled",
          detail: JSON.stringify({
            reason: "No progress in 24 hours",
            stuckSince: req.updatedAt,
          }),
        },
      });
    }
  }

  // ── Auto-escalation Tier A: Approved + no arrId + >1 hour → auto-retry ──
  let autoRetried = 0;
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const orphanedApproved = await prisma.request.findMany({
    where: {
      status: "approved",
      arrId: null,
      retryCount: { lt: 3 },
      OR: [
        { approvedAt: { lt: oneHourAgo } },
        { approvedAt: null, createdAt: { lt: oneHourAgo } },
      ],
    },
    include: { user: { select: { name: true } } },
  });

  for (const req of orphanedApproved) {
    try {
      const arrError = await sendToArrAndUpdateStatus(req, {
        mediaType: req.mediaType as MediaType,
        externalId: req.externalId,
        artistId: req.externalId2 || undefined,
        title: req.title,
        userName: req.user?.name || "Unknown",
        posterUrl: req.posterPath || undefined,
        releaseType:
          (req.releaseType as import("@/types").MusicReleaseType | null) ||
          undefined,
        bookFormat:
          (req.bookFormat as import("@/types").BookFormat | null) || undefined,
      });

      if (!arrError) {
        autoRetried++;
        await prisma.pipelineEvent.create({
          data: {
            requestId: req.id,
            event: "sent_to_arr",
            detail: JSON.stringify({ autoRetry: true, attempt: req.retryCount + 1 }),
          },
        });
      } else {
        const newRetryCount = req.retryCount + 1;
        if (newRetryCount >= 3) {
          await prisma.request.update({
            where: { id: req.id },
            data: { status: "failed", retryCount: newRetryCount, lastError: arrError },
          });
          await prisma.pipelineEvent.create({
            data: {
              requestId: req.id,
              event: "failed",
              detail: JSON.stringify({ reason: "max_retries", error: arrError }),
            },
          });
        } else {
          await prisma.request.update({
            where: { id: req.id },
            data: { retryCount: newRetryCount, lastError: arrError },
          });
          await prisma.pipelineEvent.create({
            data: {
              requestId: req.id,
              event: "retry_failed",
              detail: JSON.stringify({ attempt: newRetryCount, error: arrError }),
            },
          });
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const newRetryCount = req.retryCount + 1;
      if (newRetryCount >= 3) {
        await prisma.request.update({
          where: { id: req.id },
          data: { status: "failed", retryCount: newRetryCount, lastError: errMsg },
        });
        await prisma.pipelineEvent.create({
          data: {
            requestId: req.id,
            event: "failed",
            detail: JSON.stringify({ reason: "max_retries", error: errMsg }),
          },
        });
      } else {
        await prisma.request.update({
          where: { id: req.id },
          data: { retryCount: newRetryCount, lastError: errMsg },
        });
      }
    }
  }

  // ── Auto-escalation Tier C: Stalled + >48 hours → failed ──
  let autoFailed = 0;
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const stalledTooLong = await prisma.request.findMany({
    where: {
      status: "stalled",
      updatedAt: { lt: fortyEightHoursAgo },
    },
  });

  for (const req of stalledTooLong) {
    await prisma.request.update({
      where: { id: req.id },
      data: {
        status: "failed",
        lastError: req.lastError || "Auto-failed: no progress after 48 hours",
      },
    });
    await prisma.pipelineEvent.create({
      data: {
        requestId: req.id,
        event: "failed",
        detail: JSON.stringify({
          reason: "auto_failed_stalled",
          stalledSince: req.updatedAt?.toISOString(),
        }),
      },
    });
    autoFailed++;
  }

  return { updated, stuckFlagged: stuck.length, autoRetried, autoFailed };
}

/**
 * Update a single request by its arrId and media type.
 * Used by webhook handlers for instant status updates.
 */
export async function checkSingleRequest(
  mediaType: string,
  arrId: number,
): Promise<boolean> {
  const request = await prisma.request.findFirst({
    where: {
      mediaType,
      arrId,
      status: { in: ["approved", "downloading"] },
    },
  });

  if (!request) return false;

  let isAvailable = false;

  try {
    if (mediaType === "movie") {
      const movie = await radarr.getMovie(arrId);
      isAvailable = movie.hasFile === true;
    } else if (mediaType === "tv") {
      const series = await sonarr.getSeries(arrId);
      isAvailable = series.statistics?.percentOfEpisodes === 100;
    } else if (mediaType === "music") {
      // Same split as above — release-group requests store album id
      // as arrId, not artist id. Use request.releaseType as the
      // dispatch key so the webhook-triggered check hits the right
      // Lidarr endpoint.
      if (request.releaseType) {
        const album = await lidarr.getAlbum(arrId);
        isAvailable =
          album.statistics?.percentOfTracks === 100 &&
          (album.statistics?.trackFileCount ?? 0) > 0;
      } else {
        const artist = await lidarr.getArtist(arrId);
        isAvailable =
          artist.statistics?.albumCount > 0 &&
          artist.statistics?.percentOfTracks === 100;
      }
    }
  } catch {
    return false;
  }

  const now = new Date();

  if (isAvailable && request.status !== "available") {
    await prisma.request.update({
      where: { id: request.id },
      data: { status: "available", availableAt: now, lastCheckedAt: now, lastError: null },
    });
    await prisma.pipelineEvent.create({
      data: { requestId: request.id, event: "available" },
    });

    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: { name: true },
    });
    notify({
      event: "available",
      title: request.title,
      mediaType: request.mediaType as MediaType,
      status: "available",
      user: user?.name || "Unknown",
      posterUrl: request.posterPath || undefined,
    });

    return true;
  } else if (!isAvailable && request.status === "approved") {
    await prisma.request.update({
      where: { id: request.id },
      data: { status: "downloading", lastCheckedAt: now, lastError: null },
    });
    await prisma.pipelineEvent.create({
      data: { requestId: request.id, event: "downloading" },
    });
    return true;
  }

  return false;
}

/**
 * Clean dead downloads from *arr queues.
 * Removes items stuck in "warning" state for > 2 hours and blocklists them.
 */
export async function cleanDeadDownloads(): Promise<number> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  let cleaned = 0;

  const queues = await Promise.all([
    radarr.getQueue().catch(() => ({ records: [] as ArrQueueRecord[] })),
    sonarr.getQueue().catch(() => ({ records: [] as ArrQueueRecord[] })),
    lidarr.getQueue().catch(() => ({ records: [] as ArrQueueRecord[] })),
  ]);

  const services = [
    { records: queues[0].records || [], del: radarr.deleteQueueItem },
    { records: queues[1].records || [], del: sonarr.deleteQueueItem },
    { records: queues[2].records || [], del: lidarr.deleteQueueItem },
  ];

  for (const svc of services) {
    for (const item of svc.records) {
      if (
        item.trackedDownloadStatus === "warning" &&
        item.added &&
        new Date(item.added) < twoHoursAgo
      ) {
        try {
          await svc.del(item.id, true);
          cleaned++;
        } catch {
          // Skip items that fail to delete
        }
      }
    }
  }

  return cleaned;
}
