/**
 * createRequest's qualityProfileId validation (PR D item 10) against a
 * real SQLite DB -- only the *arr quality-profile lookup is mocked, so a
 * stale/invalid ID is caught up front with a clean 400 instead of
 * surfacing later as a post-hoc *arr failure.
 */
import { useTestDb, testPrisma } from "../helpers/test-db";
import { describe, it, expect, vi, beforeEach } from "vitest";

useTestDb();

vi.mock("@/lib/cache", () => ({
  searchCache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));
vi.mock("@/lib/arr/radarr", () => ({
  getQualityProfiles: vi.fn(),
}));
vi.mock("@/lib/arr/sonarr", () => ({
  getQualityProfiles: vi.fn(),
}));

let userId: string;

const baseInput = {
  mediaType: "movie" as const,
  externalId: "157336",
  title: "Interstellar",
};

beforeEach(async () => {
  vi.clearAllMocks();
  const prisma = await testPrisma();
  userId = (await prisma.user.create({ data: { name: "alice" } })).id;
  const { searchCache } = await import("@/lib/cache");
  vi.mocked(searchCache.get).mockReturnValue(undefined);
});

describe("createRequest -- qualityProfileId validation", () => {
  it("accepts a qualityProfileId present in the *arr's profile list", async () => {
    const radarr = await import("@/lib/arr/radarr");
    vi.mocked(radarr.getQualityProfiles).mockResolvedValue([{ id: 4, name: "HD-1080p" }]);

    const { createRequest } = await import("@/lib/services/request");
    const result = await createRequest({ ...baseInput, userId, qualityProfileId: 4 });

    expect(result.ok).toBe(true);
  });

  it("rejects a qualityProfileId not in the *arr's profile list with a clean 400, no row written", async () => {
    const radarr = await import("@/lib/arr/radarr");
    vi.mocked(radarr.getQualityProfiles).mockResolvedValue([{ id: 4, name: "HD-1080p" }]);

    const { createRequest } = await import("@/lib/services/request");
    const result = await createRequest({ ...baseInput, userId, qualityProfileId: 999 });

    expect(result).toEqual({ ok: false, error: "Invalid quality profile", status: 400 });
    const prisma = await testPrisma();
    expect(await prisma.request.count()).toBe(0);
  });

  it("reuses an already-cached profile list instead of hitting the *arr again", async () => {
    const { searchCache } = await import("@/lib/cache");
    vi.mocked(searchCache.get).mockReturnValue([{ id: 4, name: "HD-1080p" }]);
    const radarr = await import("@/lib/arr/radarr");

    const { createRequest } = await import("@/lib/services/request");
    const result = await createRequest({ ...baseInput, userId, qualityProfileId: 4 });

    expect(result.ok).toBe(true);
    expect(radarr.getQualityProfiles).not.toHaveBeenCalled();
  });

  it("fails open (doesn't block the request) when the profile list can't be fetched", async () => {
    const radarr = await import("@/lib/arr/radarr");
    vi.mocked(radarr.getQualityProfiles).mockRejectedValue(new Error("Radarr down"));

    const { createRequest } = await import("@/lib/services/request");
    const result = await createRequest({ ...baseInput, userId, qualityProfileId: 4 });

    expect(result.ok).toBe(true);
  });

  it("skips the check entirely for media types without quality profiles", async () => {
    const radarr = await import("@/lib/arr/radarr");

    const { createRequest } = await import("@/lib/services/request");
    const result = await createRequest({
      mediaType: "music",
      externalId: "mbid-1",
      title: "Some Album",
      userId,
      qualityProfileId: 999,
    });

    expect(result.ok).toBe(true);
    expect(radarr.getQualityProfiles).not.toHaveBeenCalled();
  });
});
