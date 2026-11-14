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

const getAllMoviesCached = vi.fn();
vi.mock("@/lib/arr/radarr", () => ({
  getAllMoviesCached: (...args: unknown[]) => getAllMoviesCached(...args),
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
  getAllMoviesCached.mockResolvedValue([]);
  getAllSeriesCached.mockResolvedValue([]);
  getAllArtistsCached.mockResolvedValue([]);
});

describe("getLibraryStatuses", () => {
  it("returns an empty map for an empty input without touching any service", async () => {
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([]);
    expect(result).toEqual({});
    expect(getAllMoviesCached).not.toHaveBeenCalled();
  });

  it("fetches the movie library once regardless of how many movie items are checked (no N+1)", async () => {
    getAllMoviesCached.mockResolvedValue([
      { id: 1, tmdbId: 603, hasFile: true },
      { id: 2, tmdbId: 604, hasFile: false },
    ]);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    await getLibraryStatuses([
      { id: "603", mediaType: "movie" },
      { id: "604", mediaType: "movie" },
      { id: "605", mediaType: "movie" },
    ]);
    expect(getAllMoviesCached).toHaveBeenCalledTimes(1);
  });

  it("marks a movie 'available' when Radarr reports hasFile", async () => {
    getAllMoviesCached.mockResolvedValue([{ id: 1, tmdbId: 603, hasFile: true }]);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([{ id: "603", mediaType: "movie" }]);
    expect(result["movie:603"]).toBe("available");
  });

  it("marks a movie 'monitored' when Radarr reports it exists without a file", async () => {
    getAllMoviesCached.mockResolvedValue([{ id: 1, tmdbId: 603, hasFile: false }]);
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
    getAllMoviesCached.mockResolvedValue([]);
    findMany.mockResolvedValue([
      { externalId: "603", mediaType: "movie", status: "pending" },
    ]);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([{ id: "603", mediaType: "movie" }]);
    expect(result["movie:603"]).toBe("requested");
  });

  it("prefers arr status over a conflicting DB status", async () => {
    getAllMoviesCached.mockResolvedValue([{ id: 1, tmdbId: 603, hasFile: true }]);
    findMany.mockResolvedValue([
      { externalId: "603", mediaType: "movie", status: "denied" },
    ]);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([{ id: "603", mediaType: "movie" }]);
    expect(result["movie:603"]).toBe("available");
  });

  it("returns null for items absent from both *arr and the DB", async () => {
    getAllMoviesCached.mockResolvedValue([]);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([{ id: "603", mediaType: "movie" }]);
    expect(result["movie:603"]).toBeNull();
  });

  it("swallows a Radarr/Sonarr failure and treats the item as not-in-library", async () => {
    getAllMoviesCached.mockRejectedValue(new Error("Radarr unreachable"));
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([{ id: "603", mediaType: "movie" }]);
    expect(result["movie:603"]).toBeNull();
  });

  it("checks albums one by one: an album by a Lidarr artist is only monitored if that album is", async () => {
    getAllArtistsCached.mockResolvedValue([{ id: 7, foreignArtistId: "ar-1" }]);
    getAlbumsForArtist.mockResolvedValue([
      { id: 1, foreignAlbumId: "rg-wanted", monitored: true, artistId: 7, title: "Wanted" },
      { id: 2, foreignAlbumId: "rg-unmonitored", monitored: false, artistId: 7, title: "Not wanted" },
    ]);
    const { getLibraryStatuses } = await import("@/lib/services/library-status");
    const result = await getLibraryStatuses([
      { id: "rg-wanted", mediaType: "music", artistId: "ar-1", releaseType: "album" },
      { id: "rg-unmonitored", mediaType: "music", artistId: "ar-1", releaseType: "album" },
      { id: "rg-new", mediaType: "music", artistId: "ar-1", releaseType: "album" },
      { id: "ar-1", mediaType: "music" },
    ]);
    expect(result["music:rg-wanted"]).toBe("monitored");
    expect(result["music:rg-unmonitored"]).toBeNull();
    expect(result["music:rg-new"]).toBeNull();
    expect(result["music:ar-1"]).toBe("monitored");
    expect(getAlbumsForArtist).toHaveBeenCalledTimes(1);
  });
});
