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
import { log } from "./log";
import * as radarr from "./arr/radarr";
import * as sonarr from "./arr/sonarr";
import * as lidarr from "./arr/lidarr";
import { notify } from "./notifications";
import { sendToArrAndUpdateStatus } from "./services/request";
import { updateRequestIfStatus } from "./request-transition";
import { getMediaState } from "./arr/media-state";
import * as lazylibrarian from "./arr/lazylibrarian";
import { PIPELINE_RULES, isUnreleased, IN_THEATERS_MESSAGE } from "./pipeline-rules";
import type { MediaType } from "@/types";
import type { ArrQueueRecord } from "@/types/external-apis";
import type { Prisma } from "@prisma/client";

/**
 * "This request reached its *arr." Movies, shows and music carry the *arr's
 * numeric id in arrId. Books carry LazyLibrarian's id in externalId2, which
 * since OpenLibrary is text ("OL15992072W"), so their arrId is null. Before
 * this, every check below filtered on arrId alone and never looked at those
 * books again: they sat at "downloading" after LazyLibrarian had them.
 * "0" is what 0.28.0 and earlier wrote for an id that didn't parse.
 */
export const SENT_TO_ARR: Prisma.RequestWhereInput = {
  OR: [
    { arrId: { not: null } },
    { mediaType: "book", externalId2: { not: null, notIn: ["0"] } },
  ],
};
import { userFacingError } from "@/lib/user-facing-error";

export interface StatusCheckResult {
  updated: number;
  autoRetried: number;
  autoFailed: number;
  /** failed/stalled requests the late-arrival sweep found on disk. */
  lateArrivals: number;
}

/** Automatic send attempts for an approved request that never reached an *arr. */
const MAX_AUTO_RETRIES = 3;

/**
 * Format a duration (ms) as a short human string like "14h" or "3d".
 */
function ageLabel(ms: number): string {
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/** Tail of the stall reason every media type got before 0.28.3. */
const LEGACY_NO_SOURCES = "indexers returned nothing";

/**
 * Why a book stalled, in words the requester can act on. "Indexers
 * returned nothing" was wrong for most books: LazyLibrarian usually found
 * copies and every download died (seven dead torrents for one title, found
 * live 2026-11-17). Shown to the requester and the admin as lastError.
 */
export async function bookStallReason(
  req: { externalId2: string | null; arrId: number | null; bookFormat: string | null },
  ageMs: number,
): Promise<string> {
  const still = "LazyLibrarian is still searching";
  const bookId = req.externalId2 && req.externalId2 !== "0" ? req.externalId2 : req.arrId ? String(req.arrId) : "";
  const llType = req.bookFormat === "audiobook" ? "AudioBook" : "eBook";
  const attempts = bookId
    ? await lazylibrarian.getBookAttempts(bookId, llType).catch((err: unknown) => {
        log.debug("status-checker: LazyLibrarian history unavailable", { err });
        return null;
      })
    : null;
  if (!attempts || attempts.tried === 0) return `No copy found after ${ageLabel(ageMs)} — ${still}`;
  const n = attempts.tried;
  return `Tried ${n} download${n === 1 ? "" : "s"} in ${ageLabel(ageMs)}, none finished — ${still}`;
}

/**
 * Move a request to "available" and notify its owner -- once. Shared by
 * the poller and the webhook path, which can both see the same import at
 * the same moment; only the caller whose guarded write lands sends the
 * event and notification.
 *
 * `opts.notifyOwner: false` records the move without telling anyone
 * (the late-arrival sweep uses it for titles that failed long ago).
 * `opts.detail` is stored on the pipeline event.
 */
async function markAvailable(
  req: { id: string; userId: string; title: string; mediaType: string; posterPath: string | null },
  fromStatus: string,
  now: Date,
  opts: { notifyOwner?: boolean; detail?: Record<string, unknown> } = {},
): Promise<boolean> {
  const moved = await updateRequestIfStatus(req.id, fromStatus, {
    status: "available",
    availableAt: now,
    lastCheckedAt: now,
    lastError: null,
    checkFailingSince: null,
  });
  if (!moved) return false;

  await prisma.pipelineEvent.create({
    data: {
      requestId: req.id,
      event: "available",
      detail: opts.detail ? JSON.stringify(opts.detail) : undefined,
    },
  });
  if (opts.notifyOwner === false) return true;
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { name: true },
  });
  void notify({
    event: "available",
    title: req.title,
    mediaType: req.mediaType as MediaType,
    status: "available",
    user: user?.name || "Unknown",
    posterUrl: req.posterPath || undefined,
  });
  return true;
}

/** The parked-at-"approved" reason for a title that isn't out yet. Every
 *  string here must match a prefix in pipeline-rules.ts's
 *  UNRELEASED_ERROR_PREFIXES, so the dashboard treats it as waiting. */
function unreleasedMessage(u: { releaseDate: string | null; inTheaters?: boolean }): string {
  if (u.releaseDate) return `Awaiting release: ${u.releaseDate}`;
  if (u.inTheaters) return IN_THEATERS_MESSAGE;
  return "Not yet released (no release date announced)";
}

// ── Late-arrival sweep ──────────────────────────────────────────────────
// Lexarr gives up on a request (stalled at 12h, failed at ~60h) long before
// the *arr does: Radarr/Sonarr/Lidarr keep the title monitored and grab it
// whenever a release shows up. Before this sweep "failed" was terminal and
// never re-checked, so titles that downloaded days later still showed as
// failed (found live 2026-11-13: 21 of 51 failed requests were on disk).

/** Re-check a given failed/stalled request at most this often. */
export const LATE_ARRIVAL_RECHECK_MS = 6 * 60 * 60 * 1000;
/** Stop looking this long after the request failed. */
export const LATE_ARRIVAL_WINDOW_MS = 120 * 24 * 60 * 60 * 1000;
/** Tell the requester only if it failed this recently; older ones flip quietly. */
export const LATE_ARRIVAL_NOTIFY_MS = 30 * 24 * 60 * 60 * 1000;
/** Failures that can't fix themselves: the *arr tracks something else, or the
 *  item is gone. Re-checking those would be wrong (drift) or pointless (404). */
const UNRECOVERABLE_PREFIXES = ["Tracker drift", "Deleted from *arr"];

/** requestId → when the sweep last checked it. In memory on purpose: a
 *  write to the row would bump updatedAt, which Tier C reads as "stalled
 *  since". A restart just means each row is re-checked once early. */
const lateArrivalCheckedAt = new Map<string, number>();

/** Test hook: forget when rows were last swept. */
export function _resetLateArrivalCache(): void {
  lateArrivalCheckedAt.clear();
}

async function sweepLateArrivals(now: Date): Promise<number> {
  const candidates = await prisma.request.findMany({
    where: {
      status: { in: ["failed", "stalled"] },
      ...SENT_TO_ARR,
      updatedAt: { gt: new Date(now.getTime() - LATE_ARRIVAL_WINDOW_MS) },
    },
  });

  let recovered = 0;
  for (const req of candidates) {
    if (!lateArrivalEligible(req, now)) continue;
    const last = lateArrivalCheckedAt.get(req.id);
    if (last !== undefined && now.getTime() - last < LATE_ARRIVAL_RECHECK_MS) continue;
    lateArrivalCheckedAt.set(req.id, now.getTime());

    try {
      if (await checkLateArrival(req, now)) recovered++;
    } catch (err) {
      // A 404 / network error just means "not this time" -- the row stays
      // failed exactly as it was. Debug only: this runs for every candidate.
      log.debug("status-checker: late-arrival check failed", { requestId: req.id, err });
    }
  }
  return recovered;
}

/** May the late-arrival logic touch this failed/stalled row? Not when the
 *  failure can't fix itself, and not long after Lexarr gave up. */
function lateArrivalEligible(req: { lastError: string | null; updatedAt: Date }, now: Date): boolean {
  if (req.lastError && UNRECOVERABLE_PREFIXES.some((p) => req.lastError!.startsWith(p))) return false;
  return now.getTime() - req.updatedAt.getTime() < LATE_ARRIVAL_WINDOW_MS;
}

/** Tier B's reason for a title that got part of the way ("— partial at 56%"). */
const PARTIAL_AT = /— partial at (\d+)%$/;

/**
 * Look at one failed or stalled request again and move it on if its *arr
 * has: on disk → available; not out yet → approved; downloading again →
 * downloading. Returns true only for a move to available. Shared by the
 * sweep (each row at most every 6h) and the import webhooks (right away),
 * so a title imported after Lexarr gave up shows as available within
 * seconds instead of hours (found live).
 * Throws on an *arr error; callers treat that as "not this time".
 */
async function checkLateArrival(req: Prisma.RequestGetPayload<object>, now: Date): Promise<boolean> {
  // Books always report LazyLibrarian's "Snatched" as in-queue; asking for
  // their queue would also count every Wanted book as downloading.
  const state = await getMediaState(req, { checkIdentity: true, checkQueue: req.mediaType !== "book", now });
  if (state.identityMismatch) return false;

  // A stalled or failed title that turns out not to be out yet (a show
  // that hasn't premiered, a movie still in theaters) isn't stuck: park
  // it back at "approved" with the reason, where the main loop keeps
  // watching it and the *arr grabs it on release day. The main loop
  // never looks at stalled/failed rows, so without this a stalled one
  // would be failed by Tier C after 48h, and a failed one (given up on
  // before in-theaters counted as unreleased) would stay failed.
  if (!state.available && state.unreleased) {
    const moved = await updateRequestIfStatus(req.id, req.status, {
      status: "approved",
      lastError: unreleasedMessage(state.unreleased),
      lastCheckedAt: now,
    });
    if (moved) {
      await prisma.pipelineEvent.create({
        data: {
          requestId: req.id,
          event: "approved",
          detail: JSON.stringify({ reason: `unreleased_from_${req.status}`, releaseDate: state.unreleased.releaseDate }),
        },
      });
      lateArrivalCheckedAt.delete(req.id);
    }
    return false;
  }
  // A stalled or failed title its *arr is downloading again (a later
  // search found a copy) is back in progress. Books had this first; for
  // movies, shows and music the request stayed "failed" until the file
  // landed. Back at "downloading" the main loop
  // and the stall tiers watch it again.
  if (!state.available && state.inQueue) {
    const moved = await updateRequestIfStatus(req.id, req.status, {
      status: "downloading",
      lastError: null,
      lastCheckedAt: now,
    });
    if (moved) {
      await prisma.pipelineEvent.create({
        data: {
          requestId: req.id,
          event: "downloading",
          detail: JSON.stringify({ reason: `resnatched_from_${req.status}` }),
        },
      });
      lateArrivalCheckedAt.delete(req.id);
    }
    return false;
  }
  // Books stalled before 0.28.3 still carry the generic "indexers
  // returned nothing", usually wrong (LazyLibrarian had tried and lost
  // several downloads). Rewrite it once with the real reason. updatedAt
  // is kept so the 48h stalled → failed clock doesn't restart.
  if (
    !state.available &&
    req.mediaType === "book" &&
    req.status === "stalled" &&
    req.lastError?.endsWith(LEGACY_NO_SOURCES)
  ) {
    const ageMs = now.getTime() - new Date(req.approvedAt ?? req.createdAt).getTime();
    await updateRequestIfStatus(req.id, "stalled", {
      lastError: await bookStallReason(req, ageMs),
      updatedAt: req.updatedAt,
    });
    return false;
  }
  // A show that kept filling in after Lexarr gave up: keep "partial at N%"
  // true (a show read 5% at 56%). Message only -- updatedAt is kept, so
  // neither the 48h clock nor the 120-day window moves.
  const partial = req.lastError?.match(PARTIAL_AT);
  if (!state.available && partial && state.percent > 0) {
    const pct = state.percent.toFixed(0);
    if (pct !== partial[1]) {
      await updateRequestIfStatus(req.id, req.status, {
        lastError: req.lastError!.replace(PARTIAL_AT, `— partial at ${pct}%`),
        updatedAt: req.updatedAt,
      });
    }
    return false;
  }
  if (!state.available) return false;

  // When did Lexarr give up? The newest "failed" event, else the row's
  // last write (a failed row is otherwise left untouched).
  const failedEvent = await prisma.pipelineEvent.findFirst({
    where: { requestId: req.id, event: "failed" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const gaveUpAt = failedEvent?.createdAt ?? req.updatedAt;
  const notifyOwner = now.getTime() - gaveUpAt.getTime() <= LATE_ARRIVAL_NOTIFY_MS;

  const moved = await markAvailable(req, req.status, now, {
    notifyOwner,
    detail: {
      reason: "late_arrival",
      from: req.status,
      gaveUpAt: gaveUpAt.toISOString(),
      previousError: req.lastError?.slice(0, 200) ?? null,
      notified: notifyOwner,
    },
  });
  if (moved) {
    lateArrivalCheckedAt.delete(req.id);
    log.info("status-checker: late arrival recovered", {
      requestId: req.id,
      title: req.title,
      from: req.status,
      notified: notifyOwner,
    });
  }
  return moved;
}

// The cycle currently running, if any. A cycle makes one *arr call per
// active request with a 15s timeout each, so with an *arr down it can
// outlast the 60s interval; overlapping cycles would double every
// transition's side effects.
let inFlight: Promise<StatusCheckResult> | null = null;

/**
 * Check all active requests and update their statuses.
 *
 * Only one cycle runs at a time: a call made while a cycle is running
 * (the background interval, the admin "check now" button, the dashboard
 * piggyback) joins that cycle and gets its result. Every write is
 * guarded on the status the cycle read (updateRequestIfStatus), so a
 * concurrent admin action or webhook always wins over a stale snapshot.
 */
export function checkAndUpdateStatuses(): Promise<StatusCheckResult> {
  if (!inFlight) {
    inFlight = runStatusCheck().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function runStatusCheck(): Promise<StatusCheckResult> {
  const activeRequests = await prisma.request.findMany({
    where: {
      status: { in: ["approved", "downloading"] },
      ...SENT_TO_ARR,
    },
  });

  let updated = 0;
  const now = new Date();

  for (const req of activeRequests) {
    try {
      const state = await getMediaState(req, {
        checkQueue: req.status === "approved",
        checkIdentity: true,
        now,
      });
      const { available: isAvailable, inQueue, identityMismatch } = state;

      // Unreleased movie (release date still in the future, or announced
      // with no date yet): not expected to download, so park it back at
      // "approved" with the reason instead of leaving it "downloading".
      // Also re-enters here for an already-approved row still carrying one
      // of these messages, so a date that gets announced (or changes)
      // after the initial park isn't frozen on the original wording --
      // this is a message refresh only, not a status change, in that case.
      if (!identityMismatch && state.unreleased && (req.status === "downloading" || isUnreleased(req.lastError))) {
        const { releaseDate, inTheaters } = state.unreleased;
        const newError = unreleasedMessage(state.unreleased);
        if (req.status === "approved" && req.lastError === newError) {
          // Nothing changed -- just prove the check ran.
          await updateRequestIfStatus(req.id, req.status, { lastCheckedAt: now });
          continue;
        }
        const moved = await updateRequestIfStatus(req.id, req.status, {
          status: "approved",
          lastError: newError,
          lastCheckedAt: now,
        });
        if (moved && req.status === "downloading") {
          await prisma.pipelineEvent.create({
            data: {
              requestId: req.id,
              event: "approved",
              detail: JSON.stringify(
                releaseDate
                  ? { reason: "unreleased", releaseDate }
                  : inTheaters
                    ? { reason: "in_theaters" }
                    : { reason: "announced_no_date" },
              ),
            },
          });
          updated++;
        }
        continue;
      }

      if (identityMismatch) {
        const moved = await updateRequestIfStatus(req.id, req.status, {
          status: "failed",
          lastError: `Tracker drift — please re-request. ${identityMismatch}`,
          lastCheckedAt: now,
        });
        if (moved) {
          await prisma.pipelineEvent.create({
            data: {
              requestId: req.id,
              event: "failed",
              detail: JSON.stringify({ reason: "arrid_drift", note: identityMismatch }),
            },
          });
          updated++;
        }
        continue;
      }

      if (isAvailable) {
        if (await markAvailable(req, req.status, now)) updated++;
      } else if (req.status === "approved" && inQueue) {
        const moved = await updateRequestIfStatus(req.id, "approved", {
          status: "downloading",
          lastCheckedAt: now,
          lastError: null,
          checkFailingSince: null,
        });
        if (moved) {
          await prisma.pipelineEvent.create({
            data: { requestId: req.id, event: "downloading" },
          });
          updated++;
        }
      } else {
        // A successful check (even one that changes nothing) proves the
        // *arr is reachable and this request's record is fine -- clear
        // any in-progress "check-failing" streak from a prior blip. Also
        // clear a stale "unreleased" message: state.unreleased is falsy
        // here (the block above already handles the still-unreleased
        // case), so if lastError is still one of those markers the title
        // has since released but nothing's grabbed it yet -- clearing it
        // lets the normal "Not in queue" warning / Tier B apply instead of
        // leaving it silently suppressed forever.
        await updateRequestIfStatus(req.id, req.status, {
          lastCheckedAt: now,
          checkFailingSince: req.checkFailingSince ? null : undefined,
          lastError: isUnreleased(req.lastError) ? null : undefined,
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
          const moved = await updateRequestIfStatus(req.id, req.status, {
            status: "failed",
            lastCheckedAt: now,
            lastError: `Deleted from *arr — please re-request`,
            checkFailingSince: null,
          });
          if (moved) {
            await prisma.pipelineEvent.create({
              data: {
                requestId: req.id,
                event: "failed",
                detail: JSON.stringify({ reason: "arr_404", raw: msg.slice(0, 200) }),
              },
            });
          }
        } else {
          // Stamp checkFailingSince on the FIRST failure only -- lastError
          // gets overwritten every cycle, which previously made it
          // impossible to tell a 5-minute blip from a 2-month-old one (see
          // the new escalation tier below, which reads this field).
          await updateRequestIfStatus(req.id, req.status, {
            lastCheckedAt: now,
            lastError: userFacingError(`Check failed: ${msg}`),
            checkFailingSince: req.checkFailingSince ?? now,
          });
        }
      } catch (err) {
        log.error("status-checker: could not record a failed check", { err });
        // If even the DB write fails there's nothing meaningful we can do here.
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Tier B — "No releases found" stall detection (NEW)
  // Covers monitored items that have never downloaded anything and are
  // not in the *arr queue. Books are now included. Uses a 12h floor so
  // we don't race the *arr's initial search cycle.
  //
  // Measured from approvedAt (when the request actually reached the
  // *arr), not createdAt (when the user first submitted it) -- a request
  // that sat "pending" for a day before approval would otherwise be
  // eligible for this tier within seconds of being sent, flagged
  // "stalled" with a misleading "No releases found after 1d" before the
  // *arr had even started searching. Same approvedAt-with-createdAt-
  // fallback pattern Tier A already uses below.
  // ────────────────────────────────────────────────────────────────────
  const noSourcesCutoff = new Date(
    now.getTime() - PIPELINE_RULES["no-sources-found"].escalateThresholdMs,
  );
  // Age-based filter: any download older than 12h gets re-evaluated regardless of
  // when we last looked. Internal checks return early if the item is in queue /
  // has hasFile, so running this every cycle for old items is cheap.
  const neverFoundCandidates = await prisma.request.findMany({
    where: {
      status: "downloading",
      AND: [
        SENT_TO_ARR,
        {
          OR: [
            { approvedAt: { lt: noSourcesCutoff } },
            { approvedAt: null, createdAt: { lt: noSourcesCutoff } },
          ],
        },
      ],
    },
  });

  for (const req of neverFoundCandidates) {
    try {
      // LazyLibrarian's Wanted list means "still searching", not an active
      // download, so books never count as in-queue here: the age-based
      // stall applies to them.
      const state = await getMediaState(req, { checkQueue: req.mediaType !== "book" });
      const hasFile = state.available;
      const inArrQueue = state.inQueue;
      const percent = state.percent;

      if (hasFile) {
        // Becomes available naturally on the next poll cycle.
        continue;
      }
      if (inArrQueue) {
        // Genuinely downloading — stamp lastCheckedAt so we don't loop on it.
        await updateRequestIfStatus(req.id, "downloading", {
          lastCheckedAt: now,
          checkFailingSince: req.checkFailingSince ? null : undefined,
        });
        continue;
      }

      const ageMs = now.getTime() - new Date(req.approvedAt ?? req.createdAt).getTime();
      const reason =
        req.mediaType === "book"
          ? await bookStallReason(req, ageMs)
          : percent > 0
            ? `No additional releases found after ${ageLabel(ageMs)} — partial at ${percent.toFixed(0)}%`
            : `No releases found after ${ageLabel(ageMs)} — ${LEGACY_NO_SOURCES}`;

      const moved = await updateRequestIfStatus(req.id, "downloading", {
        status: "stalled",
        lastError: reason,
        lastCheckedAt: now,
        checkFailingSince: null,
      });
      if (!moved) continue;
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
      // Previously silent on every channel -- this was pipeline-event-only,
      // so neither the admin nor the requester learned a title stalled
      // until someone happened to open the dashboard.
      const stalledUser = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { name: true },
      });
      void notify({
        event: "stalled",
        title: req.title,
        mediaType: req.mediaType as MediaType,
        status: "stalled",
        user: stalledUser?.name || "Unknown",
        detail: reason,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await updateRequestIfStatus(req.id, "downloading", {
          lastCheckedAt: now,
          lastError: userFacingError(`Stall check failed: ${msg}`),
          checkFailingSince: req.checkFailingSince ?? now,
        });
      } catch (err) {
        log.error("status-checker: could not record a failed stall check", { err });
        // Skip
      }
    }
  }

  // (Removed: a legacy 24h lastCheckedAt-staleness "stuck" marker used to
  // live here. It could only fire when polling itself had been failing
  // for 24h straight -- a case lastError from the per-request catch block
  // above already surfaces -- so it only ever added a confusing duplicate
  // "stalled" PipelineEvent with no status change. Tier B above is the
  // real stall detector now.)

  // ── Auto-escalation Tier A: approved but never reached an *arr → retry ──
  // Up to MAX_AUTO_RETRIES attempts, at most one per hour (each recorded
  // attempt bumps updatedAt). The request stays "approved" between attempts
  // and is only marked failed -- and its owner notified -- after the last
  // one. (Before, the first failed attempt already marked it failed, so the
  // later retries never happened.)
  //
  // Tracked via autoRetryCount, NOT retryCount: retryCount is the admin's
  // manual-retry counter (services/retry.ts), which has no cap. Sharing one
  // counter meant this silent, unattended loop could burn through most of
  // an admin's manual retry budget before they ever saw the request --
  // worse, retry.ts's old hard cap meant the Retry button could disappear
  // from the dashboard with no explanation. Keeping the counters separate
  // means an admin always gets a full, uncapped set of manual attempts
  // regardless of how many background attempts already ran.
  let autoRetried = 0;
  const oneHourAgo = new Date(
    now.getTime() - PIPELINE_RULES["never-dispatched"].escalateThresholdMs,
  );
  const orphanedApproved = await prisma.request.findMany({
    where: {
      status: "approved",
      arrId: null,
      autoRetryCount: { lt: MAX_AUTO_RETRIES },
      updatedAt: { lt: oneHourAgo },
      OR: [
        { approvedAt: { lt: oneHourAgo } },
        { approvedAt: null, createdAt: { lt: oneHourAgo } },
      ],
    },
    include: { user: { select: { name: true } } },
  });

  for (const req of orphanedApproved) {
    const attempt = req.autoRetryCount + 1;
    let arrError: string | undefined;
    try {
      arrError = await sendToArrAndUpdateStatus(req, {
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
        failOnError: false,
      });
    } catch (err: unknown) {
      arrError = err instanceof Error ? err.message : String(err);
    }

    if (!arrError) {
      autoRetried++;
      await prisma.pipelineEvent.create({
        data: {
          requestId: req.id,
          event: "sent_to_arr",
          detail: JSON.stringify({ autoRetry: true, attempt }),
        },
      });
      continue;
    }

    if (attempt >= MAX_AUTO_RETRIES) {
      const moved = await updateRequestIfStatus(req.id, "approved", {
        status: "failed",
        autoRetryCount: attempt,
        lastError: userFacingError(arrError),
      });
      if (moved) {
        await prisma.pipelineEvent.create({
          data: {
            requestId: req.id,
            event: "failed",
            detail: JSON.stringify({ reason: "max_retries", error: arrError }),
          },
        });
        void notify({
          event: "failed",
          title: req.title,
          mediaType: req.mediaType as MediaType,
          status: "failed",
          user: req.user?.name || "Unknown",
          detail: arrError,
        });
      }
    } else {
      const recorded = await updateRequestIfStatus(req.id, "approved", {
        autoRetryCount: attempt,
        lastError: userFacingError(arrError),
      });
      if (recorded) {
        await prisma.pipelineEvent.create({
          data: {
            requestId: req.id,
            event: "retry_failed",
            detail: JSON.stringify({ attempt, error: arrError }),
          },
        });
      }
    }
  }

  // ── Auto-escalation Tier C: Stalled + >48 hours → failed ──
  let autoFailed = 0;
  const fortyEightHoursAgo = new Date(
    now.getTime() - PIPELINE_RULES["stalled-too-long"].escalateThresholdMs,
  );
  const stalledTooLong = await prisma.request.findMany({
    where: {
      status: "stalled",
      updatedAt: { lt: fortyEightHoursAgo },
    },
  });

  for (const req of stalledTooLong) {
    const moved = await updateRequestIfStatus(req.id, "stalled", {
      status: "failed",
      lastError: req.lastError || "Auto-failed: no progress after 48 hours",
    });
    if (!moved) continue;
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
    // Previously silent -- a request could auto-fail after 48h stalled
    // with nobody, admin or requester, ever told.
    const failedUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { name: true },
    });
    void notify({
      event: "failed",
      title: req.title,
      mediaType: req.mediaType as MediaType,
      status: "failed",
      user: failedUser?.name || "Unknown",
      detail: req.lastError || "No progress after 48 hours",
    });
    autoFailed++;
  }

  // ── Auto-escalation Tier D: can't even check it, for >2 hours → failed ──
  // Covers a request that already has an arrId (so Tier A's "never
  // dispatched" rule doesn't see it) and isn't "downloading" (so Tier B's
  // "no sources found" rule doesn't see it either) -- its *arr record is
  // throwing on every poll (network blip, the *arr choking on this one
  // title, etc.). Previously nothing ever escalated this: lastError gets
  // overwritten with the same string every cycle, so the request would
  // just sit at its current status re-accumulating that error forever,
  // with only a passive dashboard badge (if any) to notice it.
  const twoHoursAgo = new Date(
    now.getTime() - PIPELINE_RULES["check-failing"].escalateThresholdMs,
  );
  const checkFailingTooLong = await prisma.request.findMany({
    where: {
      status: { in: ["approved", "downloading"] },
      ...SENT_TO_ARR,
      checkFailingSince: { lt: twoHoursAgo },
    },
    include: { user: { select: { name: true } } },
  });

  for (const req of checkFailingTooLong) {
    const moved = await updateRequestIfStatus(req.id, req.status, {
      status: "failed",
      lastError: req.lastError || "Auto-failed: couldn't verify status for 2+ hours",
    });
    if (!moved) continue;
    await prisma.pipelineEvent.create({
      data: {
        requestId: req.id,
        event: "failed",
        detail: JSON.stringify({
          reason: "check_failing_too_long",
          checkFailingSince: req.checkFailingSince?.toISOString(),
        }),
      },
    });
    void notify({
      event: "failed",
      title: req.title,
      mediaType: req.mediaType as MediaType,
      status: "failed",
      user: req.user?.name || "Unknown",
      detail: req.lastError || "Couldn't verify status for 2+ hours",
    });
    autoFailed++;
  }

  // ── Late arrivals: failed/stalled titles the *arr imported anyway ──
  const lateArrivals = await sweepLateArrivals(now);

  return { updated, autoRetried, autoFailed, lateArrivals };
}

/**
 * Update a single request by its arrId and media type.
 * Used by webhook handlers for instant status updates.
 * `scope` narrows which rows that arrId may match (music: artist-wide
 * requests vs one release, whose arrIds are different Lidarr id spaces).
 */
export async function checkSingleRequest(
  mediaType: string,
  arrId: number,
  scope: Prisma.RequestWhereInput = {},
): Promise<boolean> {
  const request = await prisma.request.findFirst({
    where: {
      ...scope,
      mediaType,
      arrId,
      status: { in: ["approved", "downloading"] },
    },
  });

  if (!request) return checkSingleLateArrival(mediaType, arrId, scope);

  let isAvailable: boolean;
  let identityMismatch: string | null;
  try {
    // checkIdentity: true -- matches the poller (runStatusCheck), which
    // was the only path actually catching an *arr ID being reused for a
    // different title (deleted + re-added). Without it, a webhook firing
    // right after that happens could promote this request to "available"
    // based on an unrelated title's hasFile.
    const state = await getMediaState(request, { checkIdentity: true });
    isAvailable = state.available;
    identityMismatch = state.identityMismatch;
  } catch (err) {
    log.warn("status-checker: webhook-triggered check failed", { err });
    return false;
  }

  const now = new Date();

  if (identityMismatch) {
    const moved = await updateRequestIfStatus(request.id, request.status, {
      status: "failed",
      lastError: `Tracker drift — please re-request. ${identityMismatch}`,
      lastCheckedAt: now,
    });
    if (moved) {
      await prisma.pipelineEvent.create({
        data: {
          requestId: request.id,
          event: "failed",
          detail: JSON.stringify({ reason: "arrid_drift", note: identityMismatch }),
        },
      });
    }
    return moved;
  }

  if (isAvailable) {
    return markAvailable(request, request.status, now);
  }
  if (request.status === "approved") {
    const moved = await updateRequestIfStatus(request.id, "approved", {
      status: "downloading",
      lastCheckedAt: now,
      lastError: null,
    });
    if (!moved) return false;
    await prisma.pipelineEvent.create({
      data: { requestId: request.id, event: "downloading" },
    });
    return true;
  }

  return false;
}

/**
 * Webhook for a title Lexarr had already given up on (failed or stalled):
 * run the late-arrival check now instead of waiting up to 6h for the
 * sweep. Tracker drift / deleted rows and ones outside the 120-day window
 * stay as they are, exactly as in the sweep.
 */
async function checkSingleLateArrival(
  mediaType: string,
  arrId: number,
  scope: Prisma.RequestWhereInput,
): Promise<boolean> {
  const now = new Date();
  const request = await prisma.request.findFirst({
    where: { ...scope, mediaType, arrId, status: { in: ["failed", "stalled"] } },
    orderBy: { updatedAt: "desc" },
  });
  if (!request || !lateArrivalEligible(request, now)) return false;
  try {
    return await checkLateArrival(request, now);
  } catch (err) {
    log.warn("status-checker: webhook-triggered late-arrival check failed", { err });
    return false;
  }
}

/**
 * Lidarr import webhook. Lidarr names the artist, not the album, but music
 * requests come in two kinds with different ids in arrId: artist-wide ones
 * (no releaseType) hold the Lidarr *artist* id, release requests (album,
 * EP, single) hold the Lidarr *album* id. Matching every request on the
 * artist id missed all release requests, and could check an unrelated
 * release whose album id happened to equal it (artist 9 vs album 9, found
 * live 2026-11-17) and flag it as tracker drift. Release requests carry
 * the artist's MusicBrainz id in externalId2, so they're found by that.
 */
export async function checkMusicImport(artistId: number, artistMbid?: string | null): Promise<boolean> {
  let updated = await checkSingleRequest("music", artistId, { releaseType: null });

  const mbid = artistMbid || (await lidarr.getArtist(artistId))?.foreignArtistId;
  if (!mbid) return updated;
  const releases = await prisma.request.findMany({
    where: {
      mediaType: "music",
      releaseType: { not: null },
      externalId2: mbid,
      arrId: { not: null },
      status: { in: ["approved", "downloading", "failed", "stalled"] },
    },
    select: { id: true, arrId: true },
  });
  for (const r of releases) {
    if (await checkSingleRequest("music", r.arrId!, { id: r.id })) updated = true;
  }
  return updated;
}

/**
 * Clean dead downloads from *arr queues.
 * Removes items stuck in "warning" state for > 2 hours and blocklists them.
 */
export async function cleanDeadDownloads(): Promise<number> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  let cleaned = 0;

  const queues = await Promise.all([
    radarr.getQueue().catch((err: unknown) => {
      log.warn("cleanDeadDownloads: Radarr queue fetch failed", { err });
      return { records: [] as ArrQueueRecord[] };
    }),
    sonarr.getQueue().catch((err: unknown) => {
      log.warn("cleanDeadDownloads: Sonarr queue fetch failed", { err });
      return { records: [] as ArrQueueRecord[] };
    }),
    lidarr.getQueue().catch((err: unknown) => {
      log.warn("cleanDeadDownloads: Lidarr queue fetch failed", { err });
      return { records: [] as ArrQueueRecord[] };
    }),
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
        } catch (err) {
          log.warn("cleanDeadDownloads: removing a dead download failed", { err });
          // Skip items that fail to delete
        }
      }
    }
  }

  return cleaned;
}
