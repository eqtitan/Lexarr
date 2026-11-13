/**
 * Concurrency tests for request status transitions, against a real
 * migrated SQLite DB (helpers/test-db.ts), so the Request_active_dedupe_idx
 * partial unique index and real transactions are in play.
 *
 * Covers the races fixed alongside src/lib/request-transition.ts:
 *   - the poller and a webhook both seeing the same import must notify once
 *   - an admin cancel that lands mid-check must not be overwritten
 *   - overlapping poll cycles must not run twice
 *   - a send-to-*arr that finishes after a cancel keeps the cancel
 * and the duplicate check no longer counting denied/cancelled requests.
 */
import { useTestDb, testPrisma } from "./helpers/test-db";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

useTestDb();

const getMovie = vi.fn();
vi.mock("@/lib/arr/radarr", () => ({
  getMovie: (...a: unknown[]) => getMovie(...a),
  getQueue: vi.fn().mockResolvedValue({ records: [] }),
}));
vi.mock("@/lib/arr/sonarr", () => ({}));
vi.mock("@/lib/arr/lidarr", () => ({}));
vi.mock("@/lib/arr/lazylibrarian", () => ({}));
const routeToArr = vi.fn();
vi.mock("@/lib/arr/router", () => ({
  routeToArr: (...a: unknown[]) => routeToArr(...a),
}));
const notify = vi.fn();
vi.mock("@/lib/notifications", () => ({
  notify: (...a: unknown[]) => notify(...a),
}));

let prisma: PrismaClient;
let checker: typeof import("@/lib/status-checker");
let requestService: typeof import("@/lib/services/request");
let userId: string;

beforeAll(async () => {
  prisma = await testPrisma();
  checker = await import("@/lib/status-checker");
  requestService = await import("@/lib/services/request");
});

beforeEach(async () => {
  vi.clearAllMocks();
  userId = (await prisma.user.create({ data: { name: "alice" } })).id;
});

function makeRequest(data: { status: string; arrId?: number; externalId?: string; mediaType?: string }) {
  return prisma.request.create({
    data: {
      userId,
      mediaType: data.mediaType ?? "movie",
      externalId: data.externalId ?? "438631",
      title: "Dune",
      status: data.status,
      arrId: data.arrId,
    },
  });
}

async function events(requestId: string, event: string) {
  return prisma.pipelineEvent.count({ where: { requestId, event } });
}

describe("status transitions under concurrency", () => {
  it("notifies once when the poller and a webhook see the same import together", async () => {
    const req = await makeRequest({ status: "downloading", arrId: 7 });
    getMovie.mockResolvedValue({ hasFile: true, tmdbId: 438631 });

    await Promise.all([
      checker.checkAndUpdateStatuses(),
      checker.checkSingleRequest("movie", 7),
    ]);

    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe("available");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(await events(req.id, "available")).toBe(1);
  });

  it("does not overwrite an admin cancel that lands while the check is in flight", async () => {
    const req = await makeRequest({ status: "downloading", arrId: 7 });
    getMovie.mockImplementation(async () => {
      // Admin cancels while the poller is waiting on Radarr.
      await prisma.request.update({ where: { id: req.id }, data: { status: "cancelled" } });
      return { hasFile: true, tmdbId: 438631 };
    });

    await checker.checkAndUpdateStatuses();

    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe("cancelled");
    expect(notify).not.toHaveBeenCalled();
    expect(await events(req.id, "available")).toBe(0);
  });

  it("joins an in-flight cycle instead of starting a second one", async () => {
    await makeRequest({ status: "downloading", arrId: 7 });
    let release!: () => void;
    getMovie.mockImplementation(
      () => new Promise((resolve) => {
        release = () => resolve({ hasFile: false, tmdbId: 438631 });
      }),
    );

    const first = checker.checkAndUpdateStatuses();
    const second = checker.checkAndUpdateStatuses();
    await vi.waitFor(() => expect(getMovie).toHaveBeenCalled());
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe(b);
    expect(getMovie).toHaveBeenCalledTimes(1);
  });

  it("webhook path catches arrId identity drift, same as the poller -- previously only the poller checked", async () => {
    // Regression test: checkSingleRequest (the webhook path) used to call
    // getMediaState with no options, so checkIdentity defaulted false.
    // An *arr id reused for a different title (deleted + re-added) right
    // before a webhook fires could promote this request to "available"
    // based on the wrong title's hasFile. The poller already caught this.
    const req = await makeRequest({ status: "downloading", arrId: 7, externalId: "438631" });
    getMovie.mockResolvedValue({ hasFile: true, tmdbId: 999999 }); // different tmdbId now

    const moved = await checker.checkSingleRequest("movie", 7);

    expect(moved).toBe(true);
    const after = await prisma.request.findUnique({ where: { id: req.id } });
    expect(after?.status).toBe("failed");
    expect(after?.lastError).toMatch(/Tracker drift/);
    expect(notify).not.toHaveBeenCalled(); // not promoted to "available"
  });

  it("keeps a cancel that lands while the request is being sent to the *arr, but still records the arrId", async () => {
    const req = await makeRequest({ status: "approved" });
    routeToArr.mockImplementation(async () => {
      await prisma.request.update({ where: { id: req.id }, data: { status: "cancelled" } });
      return { arrId: 42, alreadyExists: false };
    });

    await requestService.sendToArrAndUpdateStatus(req, {
      mediaType: "movie",
      externalId: "438631",
      title: "Dune",
      userName: "alice",
    });

    const after = await prisma.request.findUnique({ where: { id: req.id } });
    expect(after?.status).toBe("cancelled");
    expect(after?.arrId).toBe(42);
    expect(await events(req.id, "sent_to_arr")).toBe(0);
  });

  it("does not mark a cancelled request failed when the *arr send errors", async () => {
    const req = await makeRequest({ status: "approved" });
    routeToArr.mockImplementation(async () => {
      await prisma.request.update({ where: { id: req.id }, data: { status: "cancelled" } });
      throw new Error("Radarr down");
    });

    await requestService.sendToArrAndUpdateStatus(req, {
      mediaType: "movie",
      externalId: "438631",
      title: "Dune",
      userName: "alice",
    });

    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe("cancelled");
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("lifecycle enforcement", () => {
  it("refuses a move the lifecycle doesn't allow, leaving the row untouched", async () => {
    const { updateRequestIfStatus } = await import("@/lib/request-transition");
    const req = await makeRequest({ status: "denied" });
    expect(await updateRequestIfStatus(req.id, "denied", { status: "approved" })).toBe(false);
    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe("denied");
  });
});

describe("escalations run even when nothing is downloading", () => {
  it("fails a request stalled for 48h+ on a quiet server, and notifies -- previously silent", async () => {
    // Regression: runStatusCheck returned early when no request was
    // approved/downloading with an arrId, skipping every escalation tier.
    const req = await makeRequest({ status: "stalled" });
    const old = new Date(Date.now() - 49 * 60 * 60 * 1000);
    await prisma.request.update({ where: { id: req.id }, data: { updatedAt: old } });

    const result = await checker.checkAndUpdateStatuses();

    expect(result.autoFailed).toBe(1);
    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe("failed");
    // This was pipeline-event-only before -- neither the admin nor the
    // requester learned about a 48h auto-fail on any channel.
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ event: "failed" }));
  });
});

describe("Tier B: 'no sources found' stall detection notifies -- previously silent", () => {
  it("notifies when a downloading request with nothing found for 12h+ is marked stalled", async () => {
    const req = await makeRequest({ status: "downloading", arrId: 7 });
    const old = new Date(Date.now() - 13 * 60 * 60 * 1000);
    await prisma.request.update({ where: { id: req.id }, data: { createdAt: old } });
    getMovie.mockResolvedValue({ hasFile: false, tmdbId: 438631 });

    await checker.checkAndUpdateStatuses();

    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe("stalled");
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ event: "stalled" }));
  });
});

describe("Tier B 'no sources found' is measured from approvedAt, not createdAt", () => {
  // Regression test: a request that sat "pending" for a day before
  // approval used to be eligible for this tier within seconds of being
  // sent to the *arr -- createdAt (a day old) already passed the 12h
  // cutoff, so it could be falsely flagged "stalled" with a misleading
  // "No releases found after 1d" before the *arr had even started
  // searching.
  it("does not flag a request approved recently, even though it was created long ago", async () => {
    const req = await makeRequest({ status: "downloading", arrId: 7 });
    const longAgo = new Date(Date.now() - 36 * 60 * 60 * 1000); // 36h ago
    const justNow = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    await prisma.request.update({
      where: { id: req.id },
      data: { createdAt: longAgo, approvedAt: justNow },
    });
    getMovie.mockResolvedValue({ hasFile: false, tmdbId: 438631 });

    await checker.checkAndUpdateStatuses();

    // Still "downloading", not "stalled" -- approvedAt (5 min ago) hasn't
    // crossed the 12h floor, even though createdAt (36h ago) has.
    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe(
      "downloading",
    );
  });

  it("does flag it once approvedAt itself is past the 12h floor", async () => {
    const req = await makeRequest({ status: "downloading", arrId: 7 });
    const old = new Date(Date.now() - 13 * 60 * 60 * 1000);
    await prisma.request.update({
      where: { id: req.id },
      data: { createdAt: old, approvedAt: old },
    });
    getMovie.mockResolvedValue({ hasFile: false, tmdbId: 438631 });

    await checker.checkAndUpdateStatuses();

    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe("stalled");
  });
});

describe("checkFailingSince tracking", () => {
  // Regression: a request with arrId already set whose per-request check
  // throws repeatedly matched none of Tier A (needs arrId null), Tier B
  // (needs status=downloading) or Tier C (needs status=stalled) -- it
  // just sat at "approved" re-overwriting the same lastError forever,
  // with no record of how long it had been broken. checkFailingSince
  // fixes that: stamped on first failure, left alone on later failures
  // (lastError gets overwritten every cycle; this must not), cleared on
  // the next success.
  it("stamps checkFailingSince on first failure, leaves it unchanged on a second, clears it on success", async () => {
    getMovie.mockRejectedValue(new Error("network fetch failed"));
    const req = await makeRequest({ status: "approved", arrId: 99 });

    await checker.checkAndUpdateStatuses();
    const afterFirst = await prisma.request.findUnique({ where: { id: req.id } });
    expect(afterFirst?.checkFailingSince).not.toBeNull();
    expect(afterFirst?.lastError).toMatch(/^Check failed:/);

    await checker.checkAndUpdateStatuses();
    const afterSecond = await prisma.request.findUnique({ where: { id: req.id } });
    expect(afterSecond?.checkFailingSince?.getTime()).toBe(afterFirst?.checkFailingSince?.getTime());

    getMovie.mockResolvedValue({ hasFile: false, tmdbId: 438631 });
    await checker.checkAndUpdateStatuses();
    const afterSuccess = await prisma.request.findUnique({ where: { id: req.id } });
    expect(afterSuccess?.checkFailingSince).toBeNull();
  });
});

describe("Tier D: can't even check it, for 2h+ -> failed", () => {
  it("fails and notifies once checkFailingSince is over 2 hours old", async () => {
    getMovie.mockRejectedValue(new Error("network fetch failed"));
    const req = await makeRequest({ status: "approved", arrId: 99 });
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await prisma.request.update({
      where: { id: req.id },
      data: { checkFailingSince: threeHoursAgo, lastError: "Check failed: network fetch failed" },
    });

    const result = await checker.checkAndUpdateStatuses();

    expect(result.autoFailed).toBeGreaterThanOrEqual(1);
    expect(await prisma.request.findUnique({ where: { id: req.id } })).toMatchObject({
      status: "failed",
    });
    expect(await events(req.id, "failed")).toBeGreaterThanOrEqual(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ event: "failed" }));
  });

  it("does not fail a request whose checkFailingSince is under 2 hours old", async () => {
    getMovie.mockRejectedValue(new Error("network fetch failed"));
    const req = await makeRequest({ status: "approved", arrId: 99 });
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.request.update({
      where: { id: req.id },
      data: { checkFailingSince: oneHourAgo, lastError: "Check failed: network fetch failed" },
    });

    await checker.checkAndUpdateStatuses();

    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe("approved");
  });
});

describe("unreleased movie: message freshness", () => {
  // Regression: once a downloading request got parked back to "approved"
  // with an "Awaiting release: ..." / "Not yet released ..." lastError,
  // nothing ever re-evaluated that message again -- it was only written on
  // the downloading->approved transition itself. A title whose date later
  // got announced (or changed) stayed on the stale wording forever, and a
  // title that actually released but hadn't been grabbed yet looked
  // identical to a still-unreleased one (dashboard/warnings.ts suppresses
  // "Not in queue" for both), indefinitely invisible.
  it("parks a downloading request back to approved when the movie isn't released yet", async () => {
    getMovie.mockResolvedValue({ hasFile: false, tmdbId: 438631, digitalRelease: "2099-01-01T00:00:00.000Z" });
    const req = await makeRequest({ status: "downloading", arrId: 99 });

    await checker.checkAndUpdateStatuses();

    const updated = await prisma.request.findUnique({ where: { id: req.id } });
    expect(updated?.status).toBe("approved");
    expect(updated?.lastError).toBe("Awaiting release: 2099-01-01");
    expect(await events(req.id, "approved")).toBeGreaterThanOrEqual(1);
  });

  it("refreshes the release-date message on an already-approved row instead of freezing it", async () => {
    getMovie.mockResolvedValue({ hasFile: false, tmdbId: 438631, digitalRelease: "2099-02-15T00:00:00.000Z" });
    const req = await makeRequest({ status: "approved", arrId: 99 });
    await prisma.request.update({
      where: { id: req.id },
      data: { lastError: "Awaiting release: 2099-01-01" },
    });

    await checker.checkAndUpdateStatuses();

    const updated = await prisma.request.findUnique({ where: { id: req.id } });
    expect(updated?.status).toBe("approved");
    expect(updated?.lastError).toBe("Awaiting release: 2099-02-15");
  });

  it("clears a stale unreleased message once the movie releases but hasn't been grabbed yet", async () => {
    getMovie.mockResolvedValue({ hasFile: false, tmdbId: 438631, status: "released" });
    const req = await makeRequest({ status: "approved", arrId: 99 });
    await prisma.request.update({
      where: { id: req.id },
      data: { lastError: "Not yet released (no release date announced)" },
    });

    await checker.checkAndUpdateStatuses();

    const updated = await prisma.request.findUnique({ where: { id: req.id } });
    expect(updated?.status).toBe("approved");
    expect(updated?.lastError).toBeNull();
  });

  it("leaves a null lastError alone when nothing is unreleased and nothing changed", async () => {
    getMovie.mockResolvedValue({ hasFile: false, tmdbId: 438631, status: "released" });
    const req = await makeRequest({ status: "approved", arrId: 99 });

    await checker.checkAndUpdateStatuses();

    const updated = await prisma.request.findUnique({ where: { id: req.id } });
    expect(updated?.lastError).toBeNull();
  });
});

describe("auto-retry of approved requests that never reached an *arr", () => {
  // Backdate so the request is past the 1h grace period and not retried
  // within the last hour.
  async function makeStuckApproved() {
    const req = await makeRequest({ status: "approved" });
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    // An explicit updatedAt overrides Prisma's automatic @updatedAt.
    await prisma.request.update({ where: { id: req.id }, data: { approvedAt: old, updatedAt: old } });
    return req;
  }
  async function backdateUpdatedAt(id: string) {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await prisma.request.update({ where: { id }, data: { updatedAt: old } });
  }

  it("retries three times, staying approved between attempts, then fails and notifies once", async () => {
    // Regression: the first failed attempt used to mark the request failed,
    // so attempts 2 and 3 never happened.
    routeToArr.mockRejectedValue(new Error("Radarr down"));
    const req = await makeStuckApproved();

    for (const attempt of [1, 2]) {
      await checker.checkAndUpdateStatuses();
      const row = await prisma.request.findUnique({ where: { id: req.id } });
      expect(row).toMatchObject({ status: "approved", autoRetryCount: attempt, lastError: "Radarr down" });
      expect(notify).not.toHaveBeenCalled();
      await backdateUpdatedAt(req.id);
    }

    await checker.checkAndUpdateStatuses();
    expect(await prisma.request.findUnique({ where: { id: req.id } })).toMatchObject({
      status: "failed",
      autoRetryCount: 3,
    });
    expect(routeToArr).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ event: "failed" }));
  });

  it("does not touch retryCount (the separate manual-retry counter)", async () => {
    // Regression test for the bug this fix addresses: Tier A used to share
    // retryCount with the admin's manual retry (services/retry.ts), so a
    // few silent background attempts could eat most of an admin's capped
    // manual-retry budget before they ever saw the request.
    routeToArr.mockRejectedValue(new Error("Radarr down"));
    const req = await makeStuckApproved();

    for (const attempt of [1, 2, 3]) {
      await checker.checkAndUpdateStatuses();
      expect(await prisma.request.findUnique({ where: { id: req.id } })).toMatchObject({
        autoRetryCount: attempt,
        retryCount: 0,
      });
      await backdateUpdatedAt(req.id);
    }
  });

  it("waits an hour between attempts", async () => {
    routeToArr.mockRejectedValue(new Error("Radarr down"));
    await makeStuckApproved();
    await checker.checkAndUpdateStatuses();
    await checker.checkAndUpdateStatuses(); // updatedAt is now fresh
    expect(routeToArr).toHaveBeenCalledTimes(1);
  });

  it("moves on to downloading when a retry succeeds", async () => {
    routeToArr.mockResolvedValue({ arrId: 42, alreadyExists: false });
    const req = await makeStuckApproved();
    await checker.checkAndUpdateStatuses();
    expect(await prisma.request.findUnique({ where: { id: req.id } })).toMatchObject({
      status: "downloading",
      arrId: 42,
    });
  });
});

describe("checkDuplicate", () => {
  it.each(["denied", "cancelled"])("lets a title be requested again after it was %s", async (status) => {
    await makeRequest({ status });
    expect(await requestService.checkDuplicate("438631", "movie")).toBeNull();
  });

  it.each(["pending", "approved", "downloading", "available", "failed", "stalled"])(
    "still blocks a duplicate while an existing request is %s",
    async (status) => {
      await makeRequest({ status });
      expect((await requestService.checkDuplicate("438631", "movie"))?.status).toBe(409);
    },
  );

  it("creates a fresh request for a previously denied title (app check and DB index agree)", async () => {
    await makeRequest({ status: "denied" });
    const result = await requestService.createRequest({
      userId,
      mediaType: "movie",
      externalId: "438631",
      title: "Dune",
    });
    expect(result.ok).toBe(true);
    expect(await prisma.request.count({ where: { externalId: "438631" } })).toBe(2);
  });
});
