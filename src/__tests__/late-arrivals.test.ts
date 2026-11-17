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
const radarrQueue = vi.fn();
vi.mock("@/lib/arr/radarr", () => ({
  getMovie: (...a: unknown[]) => getMovie(...a),
  getQueue: (...a: unknown[]) => radarrQueue(...a),
}));
const getSeries = vi.fn();
vi.mock("@/lib/arr/sonarr", () => ({
  getSeries: (...a: unknown[]) => getSeries(...a),
  getQueue: vi.fn().mockResolvedValue({ records: [] }),
}));
const getAlbum = vi.fn();
const getArtist = vi.fn();
vi.mock("@/lib/arr/lidarr", () => ({
  getAlbum: (...a: unknown[]) => getAlbum(...a),
  getArtist: (...a: unknown[]) => getArtist(...a),
  getQueue: vi.fn().mockResolvedValue({ records: [] }),
}));
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
  radarrQueue.mockResolvedValue({ records: [] });
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

describe("back in the queue (all media types, 0.30.2)", () => {
  it("moves a failed movie its *arr is downloading again back to downloading", async () => {
    const req = await failedRequest({ failedDaysAgo: 2 });
    getMovie.mockResolvedValue({ hasFile: false });
    radarrQueue.mockResolvedValue({ records: [{ movieId: 7 }] });

    await checker.checkAndUpdateStatuses();

    const row = await prisma.request.findUnique({ where: { id: req.id } });
    expect(row?.status).toBe("downloading");
    expect(row?.lastError).toBeNull();
    const ev = await prisma.pipelineEvent.findFirst({ where: { requestId: req.id, event: "downloading" } });
    expect(JSON.parse(ev!.detail!)).toEqual({ reason: "resnatched_from_failed" });
  });
});

describe("partial progress on a failed show (0.30.2)", () => {
  async function failedShow(lastError: string) {
    const req = await prisma.request.create({
      data: { userId, mediaType: "tv", externalId: "1877", title: "Example Show", status: "failed", arrId: 26, lastError },
    });
    await prisma.$executeRawUnsafe(`UPDATE "Request" SET "updatedAt" = ? WHERE "id" = ?`, Date.now() - 2 * DAY, req.id);
    return prisma.request.findUnique({ where: { id: req.id } });
  }

  it("keeps 'partial at N%' current without moving updatedAt", async () => {
    const before = await failedShow("No additional releases found after 211d — partial at 5%");
    getSeries.mockResolvedValue({ tmdbId: 1877, status: "ended", statistics: { percentOfEpisodes: 55.96 } });

    await checker.checkAndUpdateStatuses();

    const after = await prisma.request.findUnique({ where: { id: before!.id } });
    expect(after?.status).toBe("failed");
    expect(after?.lastError).toBe("No additional releases found after 211d — partial at 56%");
    expect(after?.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
  });

  it("leaves other reasons alone", async () => {
    const before = await failedShow("No releases found after 12h — indexers returned nothing");
    getSeries.mockResolvedValue({ tmdbId: 1877, status: "ended", statistics: { percentOfEpisodes: 40 } });

    await checker.checkAndUpdateStatuses();

    expect(await prisma.request.findUnique({ where: { id: before!.id } })).toEqual(before);
  });
});

describe("import webhook on a request Lexarr gave up on (0.30.2)", () => {
  it("marks a failed movie available straight away, as a late arrival", async () => {
    const req = await failedRequest({ failedDaysAgo: 3 });
    getMovie.mockResolvedValue({ hasFile: true });

    expect(await checker.checkSingleRequest("movie", 7)).toBe(true);

    expect(await status(req.id)).toBe("available");
    const ev = await prisma.pipelineEvent.findFirst({ where: { requestId: req.id, event: "available" } });
    expect(JSON.parse(ev!.detail!)).toMatchObject({ reason: "late_arrival", from: "failed", notified: true });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("works even right after the sweep looked at the row (no 6h wait)", async () => {
    const req = await failedRequest();
    getMovie.mockResolvedValue({ hasFile: false });
    await checker.checkAndUpdateStatuses(); // sweep checks it: still no file

    getMovie.mockResolvedValue({ hasFile: true }); // Radarr imports, fires the webhook
    expect(await checker.checkSingleRequest("movie", 7)).toBe(true);
    expect(await status(req.id)).toBe("available");
  });

  it("leaves tracker drift and old failures alone", async () => {
    const drift = await failedRequest({ arrId: 11, lastError: "Tracker drift — please re-request. x" });
    const old = await failedRequest({ arrId: 12, updatedDaysAgo: 130 });
    getMovie.mockResolvedValue({ hasFile: true });

    expect(await checker.checkSingleRequest("movie", 11)).toBe(false);
    expect(await checker.checkSingleRequest("movie", 12)).toBe(false);
    expect(await status(drift.id)).toBe("failed");
    expect(await status(old.id)).toBe("failed");
    expect(getMovie).not.toHaveBeenCalled();
  });

  it("doesn't rewrite a failed row as drift when the id now tracks another title", async () => {
    const req = await failedRequest();
    getMovie.mockResolvedValue({ hasFile: true, tmdbId: 999 });

    expect(await checker.checkSingleRequest("movie", 7)).toBe(false);
    const row = await prisma.request.findUnique({ where: { id: req.id } });
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toBe("No releases found after 12h — indexers returned nothing");
  });
});

describe("Lidarr import webhook (checkMusicImport, 0.30.2)", () => {
  const ACE = "00000000-0000-4000-8000-0000000000ac";
  const WOF = "00000000-0000-4000-8000-0000000000f0";
  const music = (data: {
    title: string;
    arrId: number;
    releaseType?: string | null;
    externalId: string;
    externalId2: string;
    status?: string;
  }) => prisma.request.create({ data: { userId, mediaType: "music", status: "downloading", releaseType: null, ...data } });

  it("checks a single by its album id, found through the artist's MusicBrainz id", async () => {
    const single = await music({ title: "Example Single", arrId: 12940, releaseType: "single", externalId: WOF, externalId2: ACE });
    getAlbum.mockResolvedValue({ foreignAlbumId: WOF, statistics: { percentOfTracks: 100, trackFileCount: 4 } });

    expect(await checker.checkMusicImport(9, ACE)).toBe(true);

    expect(getAlbum).toHaveBeenCalledWith(12940);
    expect(await status(single.id)).toBe("available");
  });

  it("never checks a release whose album id merely equals the artist id", async () => {
    // Album 9 belongs to another artist; the webhook said artist 9.
    const other = await music({ title: "Everyday", arrId: 9, releaseType: "album", externalId: "rg-everyday", externalId2: "dmb-mbid" });

    await checker.checkMusicImport(9, ACE);

    expect(getAlbum).not.toHaveBeenCalled();
    const row = await prisma.request.findUnique({ where: { id: other.id } });
    expect(row?.status).toBe("downloading");
    expect(row?.lastError).toBeNull();
  });

  it("still checks an artist-wide request by the artist id", async () => {
    const whole = await music({ title: "Example Artist", arrId: 9, externalId: ACE, externalId2: ACE });
    getArtist.mockResolvedValue({ foreignArtistId: ACE, statistics: { albumCount: 3, percentOfTracks: 100 } });

    expect(await checker.checkMusicImport(9, ACE)).toBe(true);
    expect(await status(whole.id)).toBe("available");
  });

  it("looks the MusicBrainz id up when the payload has none, and recovers a failed single", async () => {
    const single = await music({
      title: "Example Single",
      arrId: 12940,
      releaseType: "single",
      externalId: WOF,
      externalId2: ACE,
      status: "failed",
    });
    getArtist.mockResolvedValue({ foreignArtistId: ACE });
    getAlbum.mockResolvedValue({ foreignAlbumId: WOF, statistics: { percentOfTracks: 100, trackFileCount: 4 } });

    expect(await checker.checkMusicImport(9, null)).toBe(true);
    expect(getArtist).toHaveBeenCalledWith(9);
    expect(await status(single.id)).toBe("available");
  });
});
