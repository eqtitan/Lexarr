/**
 * Late-arrival sweep (status-checker.ts): Radarr/Sonarr/Lidarr keep
 * searching after Lexarr fails a request, so a "failed" or "stalled"
 * request whose title later lands on disk must flip to "available".
 * Real migrated SQLite DB (helpers/test-db.ts).
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
vi.mock("@/lib/arr/router", () => ({ routeToArr: vi.fn() }));
const notify = vi.fn();
vi.mock("@/lib/notifications", () => ({
  notify: (...a: unknown[]) => notify(...a),
}));

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
let prisma: PrismaClient;
let checker: typeof import("@/lib/status-checker");
let userId: string;

beforeAll(async () => {
  prisma = await testPrisma();
  checker = await import("@/lib/status-checker");
});

beforeEach(async () => {
  vi.clearAllMocks();
  checker._resetLateArrivalCache();
  userId = (await prisma.user.create({ data: { name: "alice" } })).id;
});

async function failedRequest(opts: {
  arrId?: number | null;
  status?: string;
  lastError?: string;
  failedDaysAgo?: number;
  updatedDaysAgo?: number;
} = {}) {
  const req = await prisma.request.create({
    data: {
      userId,
      mediaType: "movie",
      externalId: String(438631 + seq++),
      title: "Dune",
      status: opts.status ?? "failed",
      arrId: opts.arrId === undefined ? 7 : opts.arrId,
      lastError: opts.lastError ?? "No releases found after 12h — indexers returned nothing",
    },
  });
  if (opts.failedDaysAgo !== undefined) {
    await prisma.pipelineEvent.create({
      data: {
        requestId: req.id,
        event: "failed",
        createdAt: new Date(Date.now() - opts.failedDaysAgo * DAY),
      },
    });
  }
  if (opts.updatedDaysAgo !== undefined) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Request" SET "updatedAt" = ? WHERE "id" = ?`,
      Date.now() - opts.updatedDaysAgo * DAY,
      req.id,
    );
  }
  return req;
}

const status = async (id: string) => (await prisma.request.findUnique({ where: { id } }))?.status;

describe("late-arrival sweep", () => {
  it("flips a failed request to available when the *arr has the file, and notifies a recent one", async () => {
    const req = await failedRequest({ failedDaysAgo: 3 });
    getMovie.mockResolvedValue({ hasFile: true }); // no tmdbId → identity check passes

    const result = await checker.checkAndUpdateStatuses();

    expect(result.lateArrivals).toBe(1);
    const row = await prisma.request.findUnique({ where: { id: req.id } });
    expect(row?.status).toBe("available");
    expect(row?.lastError).toBeNull();
    expect(row?.availableAt).not.toBeNull();
    const ev = await prisma.pipelineEvent.findFirst({ where: { requestId: req.id, event: "available" } });
    expect(JSON.parse(ev!.detail!)).toMatchObject({ reason: "late_arrival", from: "failed", notified: true });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ event: "available", title: "Dune" });
  });

  it("flips an old failure quietly (no notification)", async () => {
    const req = await failedRequest({ failedDaysAgo: 45 });
    getMovie.mockResolvedValue({ hasFile: true }); // no tmdbId → identity check passes

    await checker.checkAndUpdateStatuses();

    expect(await status(req.id)).toBe("available");
    const ev = await prisma.pipelineEvent.findFirst({ where: { requestId: req.id, event: "available" } });
    expect(JSON.parse(ev!.detail!)).toMatchObject({ notified: false });
    expect(notify).not.toHaveBeenCalled();
  });

  it("also recovers a stalled request", async () => {
    const req = await failedRequest({ status: "stalled" });
    getMovie.mockResolvedValue({ hasFile: true }); // no tmdbId → identity check passes

    await checker.checkAndUpdateStatuses();

    expect(await status(req.id)).toBe("available");
  });

  it("leaves it failed, untouched, when there's still no file", async () => {
    const req = await failedRequest();
    const before = await prisma.request.findUnique({ where: { id: req.id } });
    getMovie.mockResolvedValue({ hasFile: false }); // no tmdbId → identity check passes

    const result = await checker.checkAndUpdateStatuses();

    expect(result.lateArrivals).toBe(0);
    const after = await prisma.request.findUnique({ where: { id: req.id } });
    expect(after).toEqual(before); // not even updatedAt moves (Tier C reads it)
  });

  it("skips failures that can't recover: tracker drift and deleted items", async () => {
    const drift = await failedRequest({ lastError: "Tracker drift — please re-request. Radarr id 7 now tracks tmdbId=1" });
    const gone = await failedRequest({ lastError: "Deleted from *arr — please re-request" });
    getMovie.mockResolvedValue({ hasFile: true }); // no tmdbId → identity check passes

    await checker.checkAndUpdateStatuses();

    expect(await status(drift.id)).toBe("failed");
    expect(await status(gone.id)).toBe("failed");
    expect(getMovie).not.toHaveBeenCalled();
  });

  it("won't mark available when the *arr id now tracks a different title", async () => {
    const req = await failedRequest();
    getMovie.mockResolvedValue({ hasFile: true, tmdbId: 999 });

    await checker.checkAndUpdateStatuses();

    expect(await status(req.id)).toBe("failed");
  });

  it("ignores requests outside the 120-day window and ones never sent to an *arr", async () => {
    const old = await failedRequest({ updatedDaysAgo: 130 });
    const neverSent = await failedRequest({ arrId: null });
    getMovie.mockResolvedValue({ hasFile: true }); // no tmdbId → identity check passes

    await checker.checkAndUpdateStatuses();

    expect(await status(old.id)).toBe("failed");
    expect(await status(neverSent.id)).toBe("failed");
    expect(getMovie).not.toHaveBeenCalled();
  });

  it("re-checks a given request at most every 6 hours", async () => {
    await failedRequest();
    getMovie.mockResolvedValue({ hasFile: false }); // no tmdbId → identity check passes

    await checker.checkAndUpdateStatuses();
    await checker.checkAndUpdateStatuses();

    expect(getMovie).toHaveBeenCalledTimes(1);
  });

  it("treats an *arr error as 'not this time' and keeps the row failed", async () => {
    const req = await failedRequest();
    getMovie.mockRejectedValue(new Error("Radarr /api/v3/movie/7: 404"));

    await checker.checkAndUpdateStatuses();

    expect(await status(req.id)).toBe("failed");
  });
});

describe("movies still in theaters", () => {
  async function downloading() {
    return prisma.request.create({
      data: { userId, mediaType: "movie", externalId: String(500000 + seq++), title: "Toy Story 5", status: "downloading", arrId: 9 },
    });
  }

  it("parks an in-theater movie with no home-release date instead of letting it stall", async () => {
    const req = await downloading();
    getMovie.mockResolvedValue({ hasFile: false, status: "inCinemas" });

    await checker.checkAndUpdateStatuses();

    const row = await prisma.request.findUnique({ where: { id: req.id } });
    expect(row?.status).toBe("approved");
    expect(row?.lastError).toBe("In theaters — waiting for digital release");
    const ev = await prisma.pipelineEvent.findFirst({ where: { requestId: req.id, event: "approved" } });
    expect(JSON.parse(ev!.detail!)).toEqual({ reason: "in_theaters" });
  });

  it("uses the announced digital date when there is one", async () => {
    const req = await downloading();
    const future = new Date(Date.now() + 30 * DAY).toISOString();
    getMovie.mockResolvedValue({ hasFile: false, status: "inCinemas", digitalRelease: future });

    await checker.checkAndUpdateStatuses();

    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.lastError).toBe(
      `Awaiting release: ${future.split("T")[0]}`,
    );
  });

  it("doesn't park it once the digital date has passed (it's searchable now)", async () => {
    const req = await downloading();
    getMovie.mockResolvedValue({
      hasFile: false,
      status: "inCinemas",
      digitalRelease: new Date(Date.now() - 5 * DAY).toISOString(),
    });

    await checker.checkAndUpdateStatuses();

    expect(await status(req.id)).toBe("downloading");
  });
});
