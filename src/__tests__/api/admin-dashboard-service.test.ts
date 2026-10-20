/**
 * Route-level tests for /api/admin/dashboard/[service] (M3 coverage push,
 * remaining zero-coverage routes).
 *
 * The route dynamically imports @/lib/arr/{radarr,sonarr,lidarr} based on
 * the `service` path param, so each of those modules is mocked with the
 * full set of functions the route calls via Promise.allSettled.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

function mockArrModule() {
  return {
    getSystemStatus: vi.fn(),
    getDiskSpace: vi.fn(),
    getQueue: vi.fn(),
    getHistory: vi.fn(),
    health: vi.fn(),
    getWantedMissing: vi.fn(),
    getWantedCutoff: vi.fn(),
    getCalendar: vi.fn(),
    getBlocklist: vi.fn(),
    getTasks: vi.fn(),
    getDownloadClients: vi.fn(),
    getRootFolders: vi.fn(),
    getQualityProfiles: vi.fn(),
    getLibrary: vi.fn(),
  };
}

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/arr/radarr", () => mockArrModule());
vi.mock("@/lib/arr/sonarr", () => mockArrModule());
vi.mock("@/lib/arr/lidarr", () => mockArrModule());

function makeParams(service: string) {
  return { params: Promise.resolve({ service }) };
}

const adminSession = {
  user: { id: "admin-1", name: "Admin", role: "admin" },
  expires: "9999",
};
const userSession = {
  user: { id: "user-1", name: "User", role: "user" },
  expires: "9999",
};

/** Resolve every arr-client mock function to an "everything failed" state
 * so tests only need to override what they care about. */
async function resolveAllRejected(modPath: string) {
  const mod = (await import(modPath)) as ReturnType<typeof mockArrModule>;
  for (const fn of Object.values(mod)) {
    vi.mocked(fn).mockRejectedValue(new Error("unreachable"));
  }
  return mod;
}

describe("GET /api/admin/dashboard/[service]", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 for an invalid service name", async () => {
    const { GET } = await import(
      "@/app/api/admin/dashboard/[service]/route"
    );
    const res = await GET(new Request("http://x") as never, makeParams("plex"));
    expect(res.status).toBe(400);
    const json = await (res as Response).json();
    expect(json.error).toContain("plex");
  });

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(userSession as never);

    const { GET } = await import(
      "@/app/api/admin/dashboard/[service]/route"
    );
    const res = await GET(
      new Request("http://x") as never,
      makeParams("radarr"),
    );
    expect(res.status).toBe(403);
  });

  it("lowercases the service param before validating", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    await resolveAllRejected("@/lib/arr/radarr");

    const { GET } = await import(
      "@/app/api/admin/dashboard/[service]/route"
    );
    const res = await GET(
      new Request("http://x") as never,
      makeParams("RADARR"),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.service).toBe("radarr");
  });

  it("returns safe fallbacks when every arr call rejects", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    await resolveAllRejected("@/lib/arr/radarr");

    const { GET } = await import(
      "@/app/api/admin/dashboard/[service]/route"
    );
    const res = await GET(
      new Request("http://x") as never,
      makeParams("radarr"),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.system.version).toBeNull();
    expect(json.storage).toEqual([]);
    expect(json.queue).toEqual({ items: [], total: 0, byStatus: {} });
    expect(json.history).toEqual([]);
    expect(json.wanted).toEqual({
      missingCount: 0,
      cutoffCount: 0,
      missingRecords: [],
      cutoffRecords: [],
    });
    expect(json.library.totalItems).toBe(0);
  });

  it("normalizes a full radarr payload", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const radarr = await resolveAllRejected("@/lib/arr/radarr");

    vi.mocked(radarr.getSystemStatus).mockResolvedValue({
      version: "5.1.0",
      startTime: new Date(Date.now() - 3 * 3600_000).toISOString(),
      runtimeName: "netcore",
      isDocker: true,
      appName: "Radarr",
    } as never);
    vi.mocked(radarr.getDiskSpace).mockResolvedValue([
      { path: "/data", freeSpace: 10 * 1073741824, totalSpace: 100 * 1073741824 },
    ] as never);
    vi.mocked(radarr.getQueue).mockResolvedValue({
      totalRecords: 1,
      records: [
        {
          id: 1,
          movieId: 42,
          title: "Some Movie",
          status: "downloading",
          size: 1000,
          sizeleft: 400,
          timeleft: "00:10:00",
          indexer: "NZBgeek",
          downloadClient: "SABnzbd",
          quality: { quality: { name: "WEBDL-1080p" } },
          protocol: "usenet",
        },
      ],
    } as never);
    vi.mocked(radarr.getHistory).mockResolvedValue({
      records: [
        {
          id: 9,
          eventType: "downloadFolderImported",
          sourceTitle: "Some Movie",
          date: new Date(Date.now() - 5 * 60000).toISOString(),
          quality: { quality: { name: "WEBDL-1080p" } },
        },
      ],
    } as never);
    vi.mocked(radarr.health).mockResolvedValue([
      { type: "warning", message: "Update available", wikiUrl: "https://wiki" },
    ] as never);
    vi.mocked(radarr.getWantedMissing).mockResolvedValue({
      totalRecords: 2,
      records: [{ id: 1, title: "Missing Movie", year: 2024, monitored: true }],
    } as never);
    vi.mocked(radarr.getWantedCutoff).mockResolvedValue({
      totalRecords: 1,
      records: [{ id: 2, title: "Cutoff Movie", monitored: true }],
    } as never);
    vi.mocked(radarr.getCalendar).mockResolvedValue([
      { id: 3, title: "Upcoming", inCinemas: "2026-08-01", monitored: true },
    ] as never);
    vi.mocked(radarr.getBlocklist).mockResolvedValue({
      totalRecords: 1,
      records: [{ id: 4, sourceTitle: "Bad Release", date: "2026-07-01", indexer: "X" }],
    } as never);
    vi.mocked(radarr.getTasks).mockResolvedValue([
      {
        name: "RefreshMonitoredDownloads",
        interval: 120,
        lastExecution: new Date(Date.now() - 60000).toISOString(),
        nextExecution: null,
        lastDuration: "00:00:05",
      },
    ] as never);
    vi.mocked(radarr.getDownloadClients).mockResolvedValue([
      { id: 1, name: "SABnzbd", implementation: "Sabnzbd", enable: true, protocol: "usenet" },
    ] as never);
    vi.mocked(radarr.getRootFolders).mockResolvedValue([
      { id: 1, path: "/data/movies", freeSpace: 5 * 1073741824, accessible: true },
    ] as never);
    vi.mocked(radarr.getQualityProfiles).mockResolvedValue([
      { id: 1, name: "HD-1080p" },
    ] as never);
    vi.mocked(radarr.getLibrary).mockResolvedValue([
      { hasFile: true, sizeOnDisk: 2 * 1073741824 },
      { hasFile: false, sizeOnDisk: 0 },
    ] as never);

    const { GET } = await import(
      "@/app/api/admin/dashboard/[service]/route"
    );
    const res = await GET(
      new Request("http://x") as never,
      makeParams("radarr"),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();

    expect(json.service).toBe("radarr");
    expect(json.system.version).toBe("5.1.0");
    expect(json.system.uptime).toMatch(/h|m/);
    expect(json.storage[0]).toMatchObject({ path: "/data", freeGB: 10, totalGB: 100 });
    expect(json.queue.total).toBe(1);
    expect(json.queue.items[0]).toMatchObject({
      title: "Some Movie",
      status: "downloading",
      contentId: 42,
      quality: "WEBDL-1080p",
    });
    expect(json.queue.byStatus.downloading).toBe(1);
    expect(json.history).toHaveLength(1);
    expect(json.healthWarnings[0].message).toBe("Update available");
    expect(json.wanted.missingCount).toBe(2);
    expect(json.wanted.cutoffCount).toBe(1);
    expect(json.calendar[0].releaseType).toBe("theater");
    expect(json.blocklist.totalRecords).toBe(1);
    expect(json.tasks[0].interval).toBe("2 min");
    expect(json.downloadClients[0].name).toBe("SABnzbd");
    expect(json.rootFolders[0].freeSpaceGB).toBe(5);
    expect(json.qualityProfiles[0].name).toBe("HD-1080p");
    expect(json.library).toMatchObject({ totalItems: 2, withFiles: 1, sizeOnDiskGB: 2 });
  });

  it("normalizes a sonarr payload using episode-based library stats", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const sonarr = await resolveAllRejected("@/lib/arr/sonarr");

    vi.mocked(sonarr.getQueue).mockResolvedValue({
      totalRecords: 1,
      records: [
        {
          id: 1,
          seriesId: 7,
          title: "Some Show",
          status: "queued",
          size: 500,
          sizeleft: 500,
        },
      ],
    } as never);
    vi.mocked(sonarr.getLibrary).mockResolvedValue([
      {
        statistics: {
          episodeCount: 10,
          episodeFileCount: 4,
          sizeOnDisk: 4 * 1073741824,
        },
      },
    ] as never);

    const { GET } = await import(
      "@/app/api/admin/dashboard/[service]/route"
    );
    const res = await GET(
      new Request("http://x") as never,
      makeParams("sonarr"),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.service).toBe("sonarr");
    expect(json.queue.items[0].contentId).toBe(7);
    expect(json.library).toMatchObject({
      totalItems: 1,
      withFiles: 4,
      totalEpisodes: 10,
      sizeOnDiskGB: 4,
    });
  });

  it("normalizes a lidarr payload using track-based library stats", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue(adminSession as never);
    const lidarr = await resolveAllRejected("@/lib/arr/lidarr");

    vi.mocked(lidarr.getQueue).mockResolvedValue({
      totalRecords: 0,
      records: [],
    } as never);
    vi.mocked(lidarr.getLibrary).mockResolvedValue([
      {
        statistics: {
          albumCount: 3,
          trackFileCount: 20,
          sizeOnDisk: 1073741824,
        },
      },
    ] as never);

    const { GET } = await import(
      "@/app/api/admin/dashboard/[service]/route"
    );
    const res = await GET(
      new Request("http://x") as never,
      makeParams("lidarr"),
    );
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json.service).toBe("lidarr");
    expect(json.library).toMatchObject({
      totalItems: 1,
      withFiles: 20,
      totalAlbums: 3,
      sizeOnDiskGB: 1,
    });
  });
});
