/**
 * Route-level tests for /api/admin/dashboard (M3 coverage push, remaining
 * zero-coverage routes).
 *
 * Mocks at the service-layer boundary: the arr queue/indexer fetchers,
 * @/lib/dashboard/analytics + warnings (pure computation modules), the
 * SERVICE_REGISTRY (so we don't have to mock every downstream arr client
 * it imports), @/lib/stack-health, @/lib/db, and the fire-and-forget
 * @/lib/status-checker piggyback import.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    request: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/arr/radarr", () => ({ getQueueDetails: vi.fn() }));
vi.mock("@/lib/arr/sonarr", () => ({ getQueue: vi.fn() }));
vi.mock("@/lib/arr/lidarr", () => ({ getQueue: vi.fn() }));
vi.mock("@/lib/arr/prowlarr", () => ({ getIndexerStats: vi.fn() }));

vi.mock("@/lib/dashboard/analytics", () => ({
  computeAnalytics: vi.fn(),
}));
vi.mock("@/lib/dashboard/warnings", () => ({
  generateWarnings: vi.fn(),
}));
vi.mock("@/lib/dashboard/services", () => ({
  SERVICE_REGISTRY: [],
}));
vi.mock("@/lib/stack-health", () => ({
  readStackHealth: vi.fn(),
}));
vi.mock("@/lib/status-checker", () => ({
  checkAndUpdateStatuses: vi.fn(),
}));

const adminSession = {
  user: { id: "admin-1", name: "Admin", role: "admin" },
  expires: "9999",
};
const userSession = {
  user: { id: "user-1", name: "User", role: "user" },
  expires: "9999",
};

const emptyAnalytics = {
  requests: { total: 0, byType: { movie: 0, tv: 0, music: 0, book: 0 }, byStatus: {} },
  fulfillment: {
    avgApprovalMinutes: null,
    avgFulfillmentMinutes: null,
    medianApprovalMinutes: null,
    medianFulfillmentMinutes: null,
  },
  indexers: { indexers: [], recommendations: [] },
  topRequesters: [],
};

function baseRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    title: "Some Movie",
    year: "2024",
    mediaType: "movie",
    status: "pending",
    posterPath: null,
    arrId: null,
    createdAt: new Date("2026-07-10T05:00:00.000Z"),
    approvedAt: null,
    availableAt: null,
    retryCount: 0,
    lastError: null,
    adminNote: null,
    user: { name: "Alice", avatar: null },
    events: [],
    ...overrides,
  };
}

/** Wire up the three Promise.allSettled-driven prisma.request.findMany
 * calls (pending, active, recent) in the order the route issues them. */
async function mockPipeline(pending: unknown[], active: unknown[], recent: unknown[]) {
  const { prisma } = await import("@/lib/db");
  vi.mocked(prisma.request.findMany)
    .mockResolvedValueOnce(pending as never)
    .mockResolvedValueOnce(active as never)
    .mockResolvedValueOnce(recent as never);
}

async function mockDefaults() {
  const radarr = await import("@/lib/arr/radarr");
  const sonarr = await import("@/lib/arr/sonarr");
  const lidarr = await import("@/lib/arr/lidarr");
  const prowlarr = await import("@/lib/arr/prowlarr");
  vi.mocked(radarr.getQueueDetails).mockResolvedValue({ records: [] } as never);
  vi.mocked(sonarr.getQueue).mockResolvedValue({ records: [] } as never);
  vi.mocked(lidarr.getQueue).mockResolvedValue({ records: [] } as never);
  vi.mocked(prowlarr.getIndexerStats).mockResolvedValue({ indexers: [] } as never);

  const { computeAnalytics } = await import("@/lib/dashboard/analytics");
  vi.mocked(computeAnalytics).mockResolvedValue(emptyAnalytics as never);
  const { generateWarnings } = await import("@/lib/dashboard/warnings");
  vi.mocked(generateWarnings).mockReturnValue([]);
  const { readStackHealth } = await import("@/lib/stack-health");
  vi.mocked(readStackHealth).mockResolvedValue(null);
  const { checkAndUpdateStatuses } = await import("@/lib/status-checker");
  vi.mocked(checkAndUpdateStatuses).mockResolvedValue({} as never);
}

describe("GET /api/admin/dashboard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import("@/app/api/admin/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns 403 with no session", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { GET } = await import("@/app/api/admin/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("assembles an empty dashboard when nothing is happening", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    await mockDefaults();
    await mockPipeline([], [], []);

    const { GET } = await import("@/app/api/admin/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.pipeline).toEqual({ pending: [], active: [], recent: [] });
    expect(json.queue).toEqual([]);
    expect(json.services).toEqual([]);
    expect(json.warnings).toEqual([]);
    expect(json.stackHealth).toBeNull();
    expect(json.analytics).toEqual(emptyAnalytics);
    expect(typeof json.generatedAt).toBe("string");
  });

  it("normalizes queue items from all three *arr sources and merges a live queue item onto an active request by arrId", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    await mockDefaults();

    const radarr = await import("@/lib/arr/radarr");
    vi.mocked(radarr.getQueueDetails).mockResolvedValue({
      records: [
        {
          id: 100,
          movieId: 42,
          title: "Downloading Movie",
          status: "Downloading",
          size: 1000,
          sizeleft: 250,
          timeleft: "00:05:00",
          indexer: "NZBgeek",
          downloadClient: "SABnzbd",
          statusMessages: [{ title: "warning msg" }],
        },
      ],
    } as never);
    const sonarr = await import("@/lib/arr/sonarr");
    vi.mocked(sonarr.getQueue).mockResolvedValue({
      records: [{ id: 101, seriesId: 7, title: "A Show", status: "queued" }],
    } as never);
    const lidarr = await import("@/lib/arr/lidarr");
    vi.mocked(lidarr.getQueue).mockResolvedValue({
      records: [{ id: 102, artistId: 9, title: "An Album", status: "completed" }],
    } as never);

    const activeRequest = baseRequestRow({
      id: "req-active",
      status: "downloading",
      arrId: 42,
    });
    await mockPipeline([], [activeRequest], []);

    const { GET } = await import("@/app/api/admin/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();

    expect(json.queue).toHaveLength(3);
    const radarrItem = json.queue.find((q: { source: string }) => q.source === "radarr");
    expect(radarrItem).toMatchObject({
      title: "Downloading Movie",
      status: "downloading",
      sizeGB: expect.any(Number),
      downloadedGB: expect.any(Number),
      contentId: 42,
      statusMessages: ["warning msg"],
    });
    expect(radarrItem.progress).toBeCloseTo(75, 1);

    expect(json.pipeline.active).toHaveLength(1);
    expect(json.pipeline.active[0].queueItem).toMatchObject({
      contentId: 42,
      title: "Downloading Movie",
    });
  });

  it("falls back to an empty queue slice when an *arr queue call rejects", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    await mockDefaults();

    const radarr = await import("@/lib/arr/radarr");
    vi.mocked(radarr.getQueueDetails).mockRejectedValue(new Error("radarr down"));

    await mockPipeline([], [], []);

    const { GET } = await import("@/app/api/admin/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.queue).toEqual([]);
  });

  it("builds services from SERVICE_REGISTRY, including a failing health check", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    await mockDefaults();
    await mockPipeline([], [], []);

    const servicesMod = await import("@/lib/dashboard/services");
    (servicesMod.SERVICE_REGISTRY as unknown[]).push(
      {
        name: "Radarr",
        category: "arr",
        url: "http://host:7878",
        health: vi.fn().mockResolvedValue(undefined),
        unraidContainerName: "radarr",
      },
      {
        name: "Sonarr",
        category: "arr",
        url: "http://host:8989",
        health: vi.fn().mockRejectedValue(new Error("connection refused")),
        unraidContainerName: "sonarr",
      },
    );

    const { GET } = await import("@/app/api/admin/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await (res as Response).json();

    expect(json.services).toHaveLength(2);
    const radarrSvc = json.services.find((s: { name: string }) => s.name === "Radarr");
    expect(radarrSvc.healthy).toBe(true);
    expect(radarrSvc.url).toBe("http://host:7878");
    expect(radarrSvc.unraidContainerName).toBe("radarr");

    const sonarrSvc = json.services.find((s: { name: string }) => s.name === "Sonarr");
    expect(sonarrSvc.healthy).toBe(false);
    expect(sonarrSvc.error).toBe("connection refused");
  });

  it("maps the stack health report into a StackHealthSummary when present", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    await mockDefaults();
    await mockPipeline([], [], []);

    const { readStackHealth } = await import("@/lib/stack-health");
    vi.mocked(readStackHealth).mockResolvedValue({
      lastRunAt: "2026-07-10T07:00:00.000Z",
      timestamp: "2026-07-10 07:00:00",
      issueCount: 3,
      cleanedCount: 1,
      autoCleanup: true,
      staleMinutes: 4,
      body: "ok",
    } as never);

    const { GET } = await import("@/app/api/admin/dashboard/route");
    const res = await GET();
    const json = await (res as Response).json();
    expect(json.stackHealth).toEqual({
      lastRunAt: "2026-07-10T07:00:00.000Z",
      staleMinutes: 4,
      issueCount: 3,
      cleanedCount: 1,
    });
  });

  it("is read-only: loading the dashboard does not trigger a status sweep", async () => {
    // It used to fire checkAndUpdateStatuses() on every poll (every 10s
    // while downloads were active).
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    await mockDefaults();
    await mockPipeline([], [], []);

    const { GET } = await import("@/app/api/admin/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0)); // let any fire-and-forget start
    const { checkAndUpdateStatuses } = await import("@/lib/status-checker");
    expect(checkAndUpdateStatuses).not.toHaveBeenCalled();
  });

  it("passes queue, pending, active, services, and indexer data through to warnings/analytics", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    await mockDefaults();

    const { generateWarnings } = await import("@/lib/dashboard/warnings");
    const customWarnings = [
      { severity: "critical", title: "Radarr is unreachable" },
    ];
    vi.mocked(generateWarnings).mockReturnValue(customWarnings as never);

    const pendingRow = baseRequestRow({ id: "req-pending", status: "pending" });
    await mockPipeline([pendingRow], [], []);

    const { GET } = await import("@/app/api/admin/dashboard/route");
    const res = await GET();
    const json = await (res as Response).json();
    expect(json.warnings).toEqual(customWarnings);
    expect(json.pipeline.pending).toHaveLength(1);
    expect(json.pipeline.pending[0].title).toBe("Some Movie");
  });
});
