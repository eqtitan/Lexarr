/**
 * Book requests with OpenLibrary ids (arrId null, LazyLibrarian id in
 * externalId2) must be status-checked like any other sent request, and a
 * downloaded ebook ("Open" in LazyLibrarian) must become available.
 * Real migrated SQLite DB (helpers/test-db.ts).
 */
import { useTestDb, testPrisma } from "./helpers/test-db";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

useTestDb();

const getBookStatus = vi.fn();
const getBookAttempts = vi.fn();
vi.mock("@/lib/arr/radarr", () => ({ getQueue: vi.fn().mockResolvedValue({ records: [] }) }));
vi.mock("@/lib/arr/sonarr", () => ({ getQueue: vi.fn().mockResolvedValue({ records: [] }) }));
vi.mock("@/lib/arr/lidarr", () => ({ getQueue: vi.fn().mockResolvedValue({ records: [] }) }));
vi.mock("@/lib/arr/lazylibrarian", () => ({
  getBookStatus: (...a: unknown[]) => getBookStatus(...a),
  getQueue: vi.fn().mockResolvedValue({ records: [] }),
  getBookAttempts: (...a: unknown[]) => getBookAttempts(...a),
}));
vi.mock("@/lib/arr/router", () => ({ routeToArr: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notify: vi.fn() }));

let prisma: PrismaClient;
let checker: typeof import("@/lib/status-checker");
let userId: string;
let seq = 0;

beforeAll(async () => {
  prisma = await testPrisma();
  checker = await import("@/lib/status-checker");
});

beforeEach(async () => {
  vi.clearAllMocks();
  checker._resetLateArrivalCache();
  userId = (await prisma.user.create({ data: { name: `u${seq++}` } })).id;
});

const book = (externalId2: string | null, status = "downloading", approvedAt = new Date()) =>
  prisma.request.create({
    data: {
      userId,
      mediaType: "book",
      externalId: `/works/OL${100 + seq++}W`,
      externalId2,
      title: "The Psychology of Money",
      status,
      arrId: null,
      approvedAt,
    },
  });

describe("status check for OpenLibrary books", () => {
  it('marks a downloaded ebook ("Open") available even though arrId is null', async () => {
    getBookStatus.mockResolvedValue("Open");
    const req = await book("OL21640039W");

    await checker.checkAndUpdateStatuses();

    expect(getBookStatus).toHaveBeenCalledWith("OL21640039W", "eBook");
    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe("available");
  });

  it("still counts Have as available", async () => {
    getBookStatus.mockResolvedValue("Have");
    const req = await book("OL1W");
    await checker.checkAndUpdateStatuses();
    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe("available");
  });

  it("leaves a Wanted book downloading", async () => {
    getBookStatus.mockResolvedValue("Wanted");
    const req = await book("OL2W");
    await checker.checkAndUpdateStatuses();
    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe("downloading");
  });

  it('ignores the legacy "0" id', async () => {
    getBookStatus.mockResolvedValue("Open");
    await book("0");
    await checker.checkAndUpdateStatuses();
    expect(getBookStatus).not.toHaveBeenCalledWith("0", expect.anything());
  });

  it("flips a stalled OpenLibrary book that later downloaded (late-arrival sweep)", async () => {
    getBookStatus.mockResolvedValue("Open");
    const req = await book("OL3W", "stalled");
    await checker.checkAndUpdateStatuses();
    expect((await prisma.request.findUnique({ where: { id: req.id } }))?.status).toBe("available");
  });
});

const TWO_DAYS_AGO = () => new Date(Date.now() - 50 * 3_600_000);
const reload = async (id: string) => prisma.request.findUnique({ where: { id } });

describe("stalled books", () => {
  it("says how many downloads LazyLibrarian tried", async () => {
    getBookStatus.mockResolvedValue("Wanted");
    getBookAttempts.mockResolvedValue({ tried: 7, failed: 7 });
    const req = await book("OL1968368W", "downloading", TWO_DAYS_AGO());
    await checker.checkAndUpdateStatuses();
    const row = await reload(req.id);
    expect(row?.status).toBe("stalled");
    expect(row?.lastError).toBe("Tried 7 downloads in 2d, none finished — LazyLibrarian is still searching");
    expect(getBookAttempts).toHaveBeenCalledWith("OL1968368W", "eBook");
  });

  it("says no copy was found when nothing was tried", async () => {
    getBookStatus.mockResolvedValue("Wanted");
    getBookAttempts.mockResolvedValue({ tried: 0, failed: 0 });
    const req = await book("OL25740044W", "downloading", TWO_DAYS_AGO());
    await checker.checkAndUpdateStatuses();
    expect((await reload(req.id))?.lastError).toBe("No copy found after 2d — LazyLibrarian is still searching");
  });

  it("still stalls with a plain reason when the history call fails", async () => {
    getBookStatus.mockResolvedValue("Wanted");
    getBookAttempts.mockRejectedValue(new Error("timeout"));
    const req = await book("OL3W", "downloading", TWO_DAYS_AGO());
    await checker.checkAndUpdateStatuses();
    const row = await reload(req.id);
    expect(row?.status).toBe("stalled");
    expect(row?.lastError).toMatch(/^No copy found after 2d/);
  });

  it("doesn't stall a book that is downloading right now", async () => {
    getBookStatus.mockResolvedValue("Snatched");
    const req = await book("OL4W", "downloading", TWO_DAYS_AGO());
    await checker.checkAndUpdateStatuses();
    expect((await reload(req.id))?.status).toBe("downloading");
    expect(getBookAttempts).not.toHaveBeenCalled();
  });

  it("moves a stalled book back to downloading when LazyLibrarian grabs a copy", async () => {
    getBookStatus.mockResolvedValue("Snatched");
    const req = await book("OL5W", "stalled");
    await prisma.request.update({ where: { id: req.id }, data: { lastError: "No copy found after 2d" } });
    await checker.checkAndUpdateStatuses();
    const row = await reload(req.id);
    expect(row).toMatchObject({ status: "downloading", lastError: null });
    const ev = await prisma.pipelineEvent.findFirst({ where: { requestId: req.id, event: "downloading" } });
    expect(ev?.detail).toContain("resnatched_from_stalled");
  });
});
