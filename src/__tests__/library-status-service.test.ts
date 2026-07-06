/**
 * Tests for src/lib/services/library-status.ts — extracted from the
 * /api/library-status route so /api/releases could reuse it to filter the
 * New Releases feed. This exercises the actual merge logic (arr status vs
 * DB fallback) against mocked *arr clients + Prisma; library-status.test.ts
 * covers the same merge rules as a pure simulation and is left as-is.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/db", () => ({
  prisma: { request: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

const getMovieByTmdbId = vi.fn();
vi.mock("@/lib/arr/radarr", () => ({
  getMovieByTmdbId: (...args: unknown[]) => getMovieByTmdbId(...args),
}));

const getAllSeriesCached = vi.fn();
vi.mock("@/lib/arr/sonarr", () => ({
  getAllSeriesCached: (...args: unknown[]) => getAllSeriesCached(...args),
}));

const getAllArtistsCached = vi.fn();
const getAlbumsForArtist = vi.fn();
vi.mock("@/lib/arr/lidarr", () => ({
  getAllArtistsCached: (...args: unknown[]) => getAllArtistsCached(...args),
  getAlbumsForArtist: (...args: unknown[]) => getAlbumsForArtist(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  getAllSeriesCached.mockResolvedValue([]);
  getAllArtistsCached.mockResolvedValue([]);
});

describe("getLibraryStatuses", () => {
  it("returns an empty map for an empty input without touching any service", async () => {
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([]);
    expect(result).toEqual({});
    expect(getMovieByTmdbId).not.toHaveBeenCalled();
  });

  it("marks a movie 'available' when Radarr reports hasFile", async () => {
    getMovieByTmdbId.mockResolvedValue({ id: 1, hasFile: true });
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([{ id: "603", mediaType: "movie" }]);
    expect(result["movie:603"]).toBe("available");
  });

  it("marks a movie 'monitored' when Radarr reports it exists without a file", async () => {
    getMovieByTmdbId.mockResolvedValue({ id: 1, hasFile: false });
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([{ id: "603", mediaType: "movie" }]);
    expect(result["movie:603"]).toBe("monitored");
  });

  it("marks a TV show 'monitored' when it matches Sonarr's series list by tmdbId", async () => {
    getAllSeriesCached.mockResolvedValue([{ id: 1, tmdbId: 9999 }]);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([{ id: "9999", mediaType: "tv" }]);
    expect(result["tv:9999"]).toBe("monitored");
  });

  it("falls back to the Lexarr DB request status when *arr has no record", async () => {
    getMovieByTmdbId.mockResolvedValue(null);
    findMany.mockResolvedValue([
      { externalId: "603", mediaType: "movie", status: "pending" },
    ]);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([{ id: "603", mediaType: "movie" }]);
    expect(result["movie:603"]).toBe("requested");
  });

  it("prefers arr status over a conflicting DB status", async () => {
    getMovieByTmdbId.mockResolvedValue({ id: 1, hasFile: true });
    findMany.mockResolvedValue([
      { externalId: "603", mediaType: "movie", status: "denied" },
    ]);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([{ id: "603", mediaType: "movie" }]);
    expect(result["movie:603"]).toBe("available");
  });

  it("returns null for items absent from both *arr and the DB", async () => {
    getMovieByTmdbId.mockResolvedValue(null);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([{ id: "603", mediaType: "movie" }]);
    expect(result["movie:603"]).toBeNull();
  });

  it("swallows a Radarr/Sonarr failure and treats the item as not-in-library", async () => {
    getMovieByTmdbId.mockRejectedValue(new Error("Radarr unreachable"));
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([{ id: "603", mediaType: "movie" }]);
    expect(result["movie:603"]).toBeNull();
  });
});
