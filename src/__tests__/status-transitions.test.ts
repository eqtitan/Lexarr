/**
 * Concurrency tests for request status transitions, against a real
 * throwaway SQLite DB (migrated with `prisma migrate deploy`, so the
 * Request_active_dedupe_idx partial unique index is present too).
 *
 * Covers the races fixed alongside src/lib/request-transition.ts:
 *   - the poller and a webhook both seeing the same import must notify once
 *   - an admin cancel that lands mid-check must not be overwritten
 *   - overlapping poll cycles must not run twice
 *   - a send-to-*arr that finishes after a cancel keeps the cancel
 * and the duplicate check no longer counting denied/cancelled requests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lexarr-transitions-test-"));
const dbPath = path.join(tmpDir, "t.db").replace(/\\/g, "/");
process.env.DATABASE_URL = `file:${dbPath}`;

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
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    cwd: path.resolve(__dirname, "../.."),
    stdio: "pipe",
  });
  prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  await prisma.$connect();
  checker = await import("@/lib/status-checker");
  requestService = await import("@/lib/services/request");
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  const { prisma: appPrisma } = await import("@/lib/db");
  await appPrisma.$disconnect();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.pipelineEvent.deleteMany({});
  await prisma.request.deleteMany({});
  await prisma.user.deleteMany({});
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
