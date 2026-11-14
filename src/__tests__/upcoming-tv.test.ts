/**
 * Upcoming TV (Sonarr status "upcoming") is waiting, not stuck: it's parked
 * at "approved" with its premiere date instead of stalling/failing.
 * Real migrated SQLite DB (helpers/test-db.ts).
 */
import { useTestDb, testPrisma } from "./helpers/test-db";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

useTestDb();

const getSeries = vi.fn();
vi.mock("@/lib/arr/sonarr", () => ({
  getSeries: (...a: unknown[]) => getSeries(...a),
  getQueue: vi.fn().mockResolvedValue({ records: [] }),
}));
vi.mock("@/lib/arr/radarr", () => ({ getQueue: vi.fn().mockResolvedValue({ records: [] }) }));
vi.mock("@/lib/arr/lidarr", () => ({}));
vi.mock("@/lib/arr/lazylibrarian", () => ({}));
vi.mock("@/lib/arr/router", () => ({ routeToArr: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notify: vi.fn() }));

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

function show(status: string) {
  return prisma.request.create({
    data: { userId, mediaType: "tv", externalId: String(700000 + seq++), title: "Blade Runner 2099", status, arrId: 36 },
  });
}
const row = (id: string) => prisma.request.findUnique({ where: { id } });
const premiere = new Date(Date.now() + 12 * DAY).toISOString();

describe("upcoming TV", () => {
  it("parks a downloading show that hasn't premiered, with the premiere date", async () => {
    const req = await show("downloading");
    getSeries.mockResolvedValue({ status: "upcoming", firstAired: premiere, statistics: { percentOfEpisodes: 0 } });

    await checker.checkAndUpdateStatuses();

    const r = await row(req.id);
    expect(r?.status).toBe("approved");
    expect(r?.lastError).toBe(`Awaiting release: ${premiere.split("T")[0]}`);
  });

  it("parks it without a date when Sonarr has none", async () => {
    const req = await show("downloading");
    getSeries.mockResolvedValue({ status: "upcoming", statistics: { percentOfEpisodes: 0 } });

    await checker.checkAndUpdateStatuses();

    expect((await row(req.id))?.lastError).toBe("Not yet released (no release date announced)");
  });

  it("never calls an upcoming show available, even if Sonarr reports 100% of 0 episodes", async () => {
    const req = await show("downloading");
    getSeries.mockResolvedValue({ status: "upcoming", firstAired: premiere, statistics: { percentOfEpisodes: 100 } });

    await checker.checkAndUpdateStatuses();

    expect((await row(req.id))?.status).toBe("approved");
  });

  it("moves an already-stalled upcoming show back to approved (so Tier C won't fail it)", async () => {
    const req = await show("stalled");
    getSeries.mockResolvedValue({ status: "upcoming", firstAired: premiere, statistics: { percentOfEpisodes: 0 } });

    await checker.checkAndUpdateStatuses();

    const r = await row(req.id);
    expect(r?.status).toBe("approved");
    expect(r?.lastError).toBe(`Awaiting release: ${premiere.split("T")[0]}`);
    const ev = await prisma.pipelineEvent.findFirst({ where: { requestId: req.id, event: "approved" } });
    expect(JSON.parse(ev!.detail!)).toMatchObject({ reason: "unreleased_from_stalled" });
  });

  it("moves a failed upcoming show back to approved too (given up on before it was out)", async () => {
    const req = await show("failed");
    getSeries.mockResolvedValue({ status: "upcoming", firstAired: premiere, statistics: { percentOfEpisodes: 0 } });

    await checker.checkAndUpdateStatuses();

    const r = await row(req.id);
    expect(r?.status).toBe("approved");
    const ev = await prisma.pipelineEvent.findFirst({ where: { requestId: req.id, event: "approved" } });
    expect(JSON.parse(ev!.detail!)).toMatchObject({ reason: "unreleased_from_failed" });
  });

  it("leaves a show that has aired alone (continuing, not complete)", async () => {
    const req = await show("downloading");
    getSeries.mockResolvedValue({ status: "continuing", firstAired: "2020-01-01", statistics: { percentOfEpisodes: 40 } });

    await checker.checkAndUpdateStatuses();

    expect((await row(req.id))?.status).toBe("downloading");
  });
});

describe("TV identity check", () => {
  it("flags the old wrong-show signature: Sonarr series with no tmdbId whose TVDB id equals the request's TMDB id", async () => {
    const req = await prisma.request.create({
      data: { userId, mediaType: "tv", externalId: "75896", title: "V: The Final Battle", status: "downloading", arrId: 21 },
    });
    getSeries.mockResolvedValue({ title: "Intervention", tvdbId: 75896, tmdbId: 0, status: "continuing", statistics: { percentOfEpisodes: 28 } });

    await checker.checkAndUpdateStatuses();

    const r = await row(req.id);
    expect(r?.status).toBe("failed");
    expect(r?.lastError).toMatch(/Tracker drift.*"Intervention"/);
  });

  it("doesn't flag a correct show that simply lacks a tmdbId in Sonarr", async () => {
    const req = await prisma.request.create({
      data: { userId, mediaType: "tv", externalId: "287620", title: "Stuart Fails", status: "downloading", arrId: 41 },
    });
    getSeries.mockResolvedValue({ title: "Stuart Fails to Save the Universe", tvdbId: 465664, tmdbId: 0, status: "continuing", statistics: { percentOfEpisodes: 20 } });

    await checker.checkAndUpdateStatuses();

    expect((await row(req.id))?.status).toBe("downloading");
  });
});
