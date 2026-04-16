import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import type {
  ArrSystemStatus,
  ArrDiskSpace,
  ArrQueueRecord,
  ArrQueueResponse,
  ArrHistoryRecord,
  ArrHistoryResponse,
  ArrHealthWarning,
  ArrWantedRecord,
  ArrWantedResponse,
  ArrCalendarItem,
  ArrBlocklistResponse,
  ArrTask,
  ArrDownloadClient,
  ArrRootFolder,
  ArrQualityProfile,
  ArrRadarrMovie,
  ArrSonarrSeries,
  ArrLidarrArtist,
} from "@/types/external-apis";

const VALID_SERVICES = ["radarr", "sonarr", "lidarr"] as const;
type ServiceName = (typeof VALID_SERVICES)[number];

function bytesToGB(bytes: number) {
  return Math.round((bytes / 1073741824) * 100) / 100;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function calcUptime(startTime: string) {
  const diff = Date.now() - new Date(startTime).getTime();
  const days = Math.floor(diff / 86400000);
  const hrs = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

async function getClient(service: ServiceName) {
  switch (service) {
    case "radarr":
      return import("@/lib/arr/radarr");
    case "sonarr":
      return import("@/lib/arr/sonarr");
    case "lidarr":
      return import("@/lib/arr/lidarr");
  }
}

function normalizeLibrary(
  service: ServiceName,
  items: (ArrRadarrMovie | ArrSonarrSeries | ArrLidarrArtist)[],
) {
  if (service === "radarr") {
    const movies = items as ArrRadarrMovie[];
    const withFiles = movies.filter((m) => m.hasFile).length;
    const sizeOnDisk = movies.reduce((sum, m) => sum + (m.sizeOnDisk || 0), 0);
    return {
      totalItems: items.length,
      withFiles,
      sizeOnDiskGB: bytesToGB(sizeOnDisk),
    };
  }
  if (service === "sonarr") {
    const series = items as ArrSonarrSeries[];
    let totalEpisodes = 0;
    let episodesWithFiles = 0;
    let sizeOnDisk = 0;
    for (const s of series) {
      const stats = s.statistics || {};
      totalEpisodes += stats.episodeCount || 0;
      episodesWithFiles += stats.episodeFileCount || 0;
      sizeOnDisk += stats.sizeOnDisk || 0;
    }
    return {
      totalItems: items.length,
      withFiles: episodesWithFiles,
      totalEpisodes,
      sizeOnDiskGB: bytesToGB(sizeOnDisk),
    };
  }
  // lidarr
  const artists = items as ArrLidarrArtist[];
  let totalAlbums = 0;
  let tracksWithFiles = 0;
  let sizeOnDisk = 0;
  for (const a of artists) {
    const stats = a.statistics || {};
    totalAlbums += stats.albumCount || 0;
    tracksWithFiles += stats.trackFileCount || 0;
    sizeOnDisk += stats.sizeOnDisk || 0;
  }
  return {
    totalItems: items.length,
    withFiles: tracksWithFiles,
    totalAlbums,
    sizeOnDiskGB: bytesToGB(sizeOnDisk),
  };
}

function normalizeQueue(service: ServiceName, queueData: ArrQueueResponse) {
  const records = queueData?.records || [];
  const idField =
    service === "radarr"
      ? "movieId"
      : service === "sonarr"
        ? "seriesId"
        : "artistId";

  return records.map((r: ArrQueueRecord) => {
    const sizeBytes = r.size || 0;
    const remainingBytes = r.sizeleft || 0;
    const downloadedBytes = sizeBytes - remainingBytes;
    const progress =
      sizeBytes > 0
        ? Math.round((downloadedBytes / sizeBytes) * 100 * 10) / 10
        : 0;

    return {
      id: r.id,
      title: r.title || "Unknown",
      status: (r.status || "unknown").toLowerCase(),
      progress,
      sizeGB: bytesToGB(sizeBytes),
      downloadedGB: bytesToGB(downloadedBytes),
      eta: r.timeleft || null,
      indexer: r.indexer || null,
      downloadClient: r.downloadClient || null,
      quality: r.quality?.quality?.name || null,
      protocol: r.protocol || null,
      contentId: r[idField] || null,
    };
  });
}

function normalizeHistory(records: ArrHistoryRecord[]) {
  return (records || []).slice(0, 20).map((h) => ({
    id: h.id,
    eventType: h.eventType || "unknown",
    title: h.sourceTitle || h.title || "Unknown",
    date: h.date || null,
    dateAgo: h.date ? timeAgo(h.date) : null,
    quality: h.quality?.quality?.name || null,
  }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const { service: serviceParam } = await params;
  const service = serviceParam.toLowerCase() as ServiceName;

  if (!VALID_SERVICES.includes(service)) {
    return NextResponse.json(
      {
        error: `Invalid service: ${serviceParam}. Must be one of: ${VALID_SERVICES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const session = await auth();
  const role = session?.user?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const client = await getClient(service);

  const [
    systemStatusResult,
    diskSpaceResult,
    queueResult,
    historyResult,
    healthResult,
    wantedMissingResult,
    wantedCutoffResult,
    calendarResult,
    blocklistResult,
    tasksResult,
    downloadClientsResult,
    rootFoldersResult,
    qualityProfilesResult,
    libraryResult,
  ] = await Promise.allSettled([
    client.getSystemStatus(),
    client.getDiskSpace(),
    client.getQueue(),
    client.getHistory(20),
    client.health(),
    client.getWantedMissing(20),
    client.getWantedCutoff(20),
    client.getCalendar(),
    client.getBlocklist(10),
    client.getTasks(),
    client.getDownloadClients(),
    client.getRootFolders(),
    client.getQualityProfiles(),
    client.getLibrary(),
  ]);

  const val = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
    r.status === "fulfilled" ? r.value : fallback;

  const systemStatus: ArrSystemStatus = val(systemStatusResult, {});
  const diskSpace: ArrDiskSpace[] = val(diskSpaceResult, []);
  const queueRaw: ArrQueueResponse = val(queueResult, {
    totalRecords: 0,
    records: [],
  });
  const historyRaw: ArrHistoryResponse = val(historyResult, { records: [] });
  const healthWarnings: ArrHealthWarning[] = val(healthResult, []);
  const wantedMissing: ArrWantedResponse = val(wantedMissingResult, {
    totalRecords: 0,
    records: [],
  });
  const wantedCutoff: ArrWantedResponse = val(wantedCutoffResult, {
    totalRecords: 0,
    records: [],
  });
  const calendarItems: ArrCalendarItem[] = val(calendarResult, []);
  const blocklist: ArrBlocklistResponse = val(blocklistResult, {
    totalRecords: 0,
    records: [],
  });
  const tasks: ArrTask[] = val(tasksResult, []);
  const downloadClients: ArrDownloadClient[] = val(downloadClientsResult, []);
  const rootFolders: ArrRootFolder[] = val(rootFoldersResult, []);
  const qualityProfiles: ArrQualityProfile[] = val(
    qualityProfilesResult,
    [],
  );
  const libraryItems: (ArrRadarrMovie | ArrSonarrSeries | ArrLidarrArtist)[] =
    val(libraryResult, []);

  // Normalize storage
  const storage = diskSpace.map((d) => ({
    path: d.path,
    freeGB: bytesToGB(d.freeSpace || 0),
    totalGB: bytesToGB(d.totalSpace || 0),
    usedGB: bytesToGB((d.totalSpace || 0) - (d.freeSpace || 0)),
    percentUsed:
      d.totalSpace > 0
        ? Math.round(((d.totalSpace - d.freeSpace) / d.totalSpace) * 100 * 10) /
          10
        : 0,
  }));

  // Queue normalized
  const queue = normalizeQueue(service, queueRaw);
  const queueByStatus: Record<string, number> = {};
  for (const q of queue) {
    queueByStatus[q.status] = (queueByStatus[q.status] || 0) + 1;
  }

  // Library normalized
  const library = normalizeLibrary(service, libraryItems);

  // History normalized
  const history = normalizeHistory(historyRaw.records);

  // Calendar normalized
  const calendar = calendarItems.map((c) => ({
    id: c.id,
    title: c.title || c.artistName || "Unknown",
    date:
      c.airDateUtc || c.inCinemas || c.releaseDate || c.physicalRelease || null,
    releaseType: c.airDateUtc
      ? "air"
      : c.inCinemas
        ? "theater"
        : c.physicalRelease
          ? "physical"
          : "digital",
    monitored: c.monitored ?? true,
  }));

  // Wanted
  const normalizeWantedRecord = (r: ArrWantedRecord) => ({
    id: r.id,
    title: r.title || r.series?.title || r.artist?.artistName || "Unknown",
    year: r.year || r.seasonNumber || null,
    monitored: r.monitored ?? true,
    status: r.status || null,
  });
  const wanted = {
    missingCount: wantedMissing.totalRecords || 0,
    cutoffCount: wantedCutoff.totalRecords || 0,
    missingRecords: (wantedMissing.records || []).map(normalizeWantedRecord),
    cutoffRecords: (wantedCutoff.records || []).map(normalizeWantedRecord),
  };

  // Tasks
  const normalizedTasks = tasks.map((t) => ({
    name: t.name,
    interval: t.interval ? `${Math.round(t.interval / 60)} min` : null,
    lastExecution: t.lastExecution || null,
    lastExecutionAgo: t.lastExecution ? timeAgo(t.lastExecution) : null,
    nextExecution: t.nextExecution || null,
    lastDuration: t.lastDuration || null,
  }));

  // Download clients
  const normalizedClients = downloadClients.map((dc) => ({
    id: dc.id,
    name: dc.name,
    implementation: dc.implementation,
    enabled: dc.enable ?? true,
    protocol: dc.protocol,
  }));

  // Root folders
  const normalizedRootFolders = rootFolders.map((rf) => ({
    id: rf.id,
    path: rf.path,
    freeSpaceGB: bytesToGB(rf.freeSpace || 0),
    accessible: rf.accessible ?? true,
  }));

  // Quality profiles
  const normalizedProfiles = qualityProfiles.map((qp) => ({
    id: qp.id,
    name: qp.name,
  }));

  // Blocklist
  const normalizedBlocklist = {
    totalRecords: blocklist.totalRecords || 0,
    records: (blocklist.records || []).map((b) => ({
      id: b.id,
      title: b.sourceTitle || "Unknown",
      date: b.date || null,
      indexer: b.indexer || null,
    })),
  };

  const data = {
    service,
    system: {
      version: systemStatus.version || null,
      startTime: systemStatus.startTime || null,
      uptime: systemStatus.startTime
        ? calcUptime(systemStatus.startTime)
        : null,
      runtimeName: systemStatus.runtimeName || null,
      isDocker: systemStatus.isDocker ?? null,
      appName: systemStatus.appName || service,
    },
    storage,
    library,
    queue: { items: queue, total: queue.length, byStatus: queueByStatus },
    history,
    healthWarnings: healthWarnings.map((h) => ({
      type: h.type || "warning",
      message: h.message || "",
      wikiUrl: h.wikiUrl || null,
    })),
    wanted,
    calendar,
    tasks: normalizedTasks,
    downloadClients: normalizedClients,
    rootFolders: normalizedRootFolders,
    qualityProfiles: normalizedProfiles,
    blocklist: normalizedBlocklist,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(data);
}
