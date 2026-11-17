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
vi.mock("@/lib/arr/radarr", () => ({ getQueue: vi.fn().mockResolvedValue({ records: [] }) }));
vi.mock("@/lib/arr/sonarr", () => ({ getQueue: vi.fn().mockResolvedValue({ records: [] }) }));
vi.mock("@/lib/arr/lidarr", () => ({ getQueue: vi.fn().mockResolvedValue({ records: [] }) }));
vi.mock("@/lib/arr/lazylibrarian", () => ({
  getBookStatus: (...a: unknown[]) => getBookStatus(...a),
  isAudiobookOnDisk: vi.fn().mockResolvedValue(false),
  getQueue: vi.fn().mockResolvedValue({ records: [] }),
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

const book = (externalId2: string | null, status = "downloading") =>
  prisma.request.create({
    data: {
      userId,
      mediaType: "book",
      externalId: `/works/OL${100 + seq++}W`,
      externalId2,
      title: "The Psychology of Money",
      status,
      arrId: null,
      approvedAt: new Date(),
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
