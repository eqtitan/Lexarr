/**
 * Admin "Retry all failed" against a real migrated SQLite DB.
 */
import { useTestDb, testPrisma } from "./helpers/test-db";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

useTestDb();

vi.mock("@/lib/arr/radarr", () => ({}));
vi.mock("@/lib/arr/sonarr", () => ({}));
vi.mock("@/lib/arr/lidarr", () => ({}));
vi.mock("@/lib/arr/lazylibrarian", () => ({}));
const routeToArr = vi.fn();
vi.mock("@/lib/arr/router", () => ({
  routeToArr: (...a: unknown[]) => routeToArr(...a),
}));
vi.mock("@/lib/notifications", () => ({ notify: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

let prisma: PrismaClient;
let retry: typeof import("@/lib/services/retry");
let userId: string;
const admin = { id: "admin-1", name: "Admin" };

beforeAll(async () => {
  prisma = await testPrisma();
  retry = await import("@/lib/services/retry");
});

beforeEach(async () => {
  vi.clearAllMocks();
  userId = (await prisma.user.create({ data: { name: `u${Math.random()}` } })).id;
});

let n = 0;
const make = (mediaType: string, status: string, title: string) =>
  prisma.request.create({
    data: { userId, mediaType, externalId: `ext-${++n}`, title, status, lastError: "old" },
  });

describe("retryAllFailed", () => {
  it("re-sends failed requests one at a time and reports the ones that fail again", async () => {
    const a = await make("book", "failed", "Book A");
    const b = await make("book", "failed", "Book B");
    const keep = await make("book", "downloading", "Busy");
    let active = 0;
    let maxActive = 0;
    routeToArr.mockImplementation(async (input: { title: string }) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (input.title === "Book B") throw new Error("LazyLibrarian /api: 500 boom");
      return { arrId: 0, bookId: "OL1W" };
    });

    const r = await retry.retryAllFailed(admin);

    expect(r).toMatchObject({ tried: 2, sent: 1, remaining: 0 });
    expect(r.stillFailing.map((f) => f.title)).toEqual(["Book B"]);
    expect(maxActive).toBe(1);
    expect((await prisma.request.findUnique({ where: { id: a.id } }))?.status).toBe("downloading");
    expect((await prisma.request.findUnique({ where: { id: b.id } }))?.status).toBe("failed");
    expect((await prisma.request.findUnique({ where: { id: keep.id } }))?.status).toBe("downloading");
    expect((await prisma.request.findUnique({ where: { id: a.id } }))?.externalId2).toBe("OL1W");
  });

  it("can be narrowed to one media type", async () => {
    await make("movie", "failed", "Movie");
    const book = await make("book", "failed", "Book");
    routeToArr.mockResolvedValue({ arrId: 0, bookId: "OL2W" });

    const r = await retry.retryAllFailed(admin, "book");

    expect(r.tried).toBe(1);
    expect(routeToArr).toHaveBeenCalledTimes(1);
    expect((await prisma.request.findUnique({ where: { id: book.id } }))?.status).toBe("downloading");
  });
});
