import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/arr/radarr", () => ({ getMovie: vi.fn(), getQueue: vi.fn() }));
vi.mock("@/lib/arr/sonarr", () => ({ getSeries: vi.fn(), getQueue: vi.fn() }));
vi.mock("@/lib/arr/lidarr", () => ({ getAlbum: vi.fn(), getArtist: vi.fn(), getQueue: vi.fn() }));
vi.mock("@/lib/arr/lazylibrarian", () => ({
  getBookStatus: vi.fn(),
  getQueue: vi.fn(),
}));

import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";
import * as lazylibrarian from "@/lib/arr/lazylibrarian";
import { getMediaState, type MediaStateRequest } from "@/lib/arr/media-state";

const base: MediaStateRequest = {
  mediaType: "movie",
  arrId: 7,
  externalId: "438631",
  externalId2: null,
  releaseType: null,
  bookFormat: null,
};
const NOW = new Date("2026-10-20T12:00:00Z");

beforeEach(() => vi.resetAllMocks());

describe("getMediaState — movies", () => {
  it("is available when Radarr has the file, and skips the queue lookup", async () => {
    vi.mocked(radarr.getMovie).mockResolvedValue({ hasFile: true, tmdbId: 438631 } as never);
    const s = await getMediaState(base, { checkQueue: true, checkIdentity: true, now: NOW });
    expect(s).toMatchObject({ available: true, percent: 100, inQueue: false, identityMismatch: null });
    expect(radarr.getQueue).not.toHaveBeenCalled();
  });

  it("looks in the queue only when asked and not available", async () => {
    vi.mocked(radarr.getMovie).mockResolvedValue({ hasFile: false, tmdbId: 438631 } as never);
    vi.mocked(radarr.getQueue).mockResolvedValue({ records: [{ movieId: 7 }] } as never);
    expect((await getMediaState(base, { checkQueue: true })).inQueue).toBe(true);
    vi.mocked(radarr.getQueue).mockClear();
    expect((await getMediaState(base)).inQueue).toBe(false);
    expect(radarr.getQueue).not.toHaveBeenCalled();
  });

  it("flags tracker drift only when identity checking is on", async () => {
    vi.mocked(radarr.getMovie).mockResolvedValue({ hasFile: false, tmdbId: 999 } as never);
    expect((await getMediaState(base, { checkIdentity: true })).identityMismatch).toMatch(/tmdbId=999/);
    expect((await getMediaState(base)).identityMismatch).toBeNull();
  });

  it("reports the earliest future release date as unreleased", async () => {
    vi.mocked(radarr.getMovie).mockResolvedValue({
      hasFile: false,
      digitalRelease: "2027-01-10T00:00:00Z",
      physicalRelease: "2026-12-01T00:00:00Z",
    } as never);
    expect((await getMediaState(base, { now: NOW })).unreleased).toEqual({ releaseDate: "2026-12-01" });
  });

  it("reports announced-with-no-date as unreleased without a date", async () => {
    vi.mocked(radarr.getMovie).mockResolvedValue({ hasFile: false, status: "announced" } as never);
    expect((await getMediaState(base, { now: NOW })).unreleased).toEqual({ releaseDate: null });
  });

  it("is released once the date has passed", async () => {
    vi.mocked(radarr.getMovie).mockResolvedValue({ hasFile: false, digitalRelease: "2026-01-01" } as never);
    expect((await getMediaState(base, { now: NOW })).unreleased).toBeNull();
  });
});

describe("getMediaState — TV", () => {
  it("is available at 100% of episodes and reports partial progress", async () => {
    vi.mocked(sonarr.getSeries).mockResolvedValue({ statistics: { percentOfEpisodes: 100 } } as never);
    expect(await getMediaState({ ...base, mediaType: "tv" })).toMatchObject({ available: true, percent: 100 });
    vi.mocked(sonarr.getSeries).mockResolvedValue({ statistics: { percentOfEpisodes: 40 } } as never);
    expect(await getMediaState({ ...base, mediaType: "tv" })).toMatchObject({ available: false, percent: 40 });
  });
});

describe("getMediaState — music", () => {
  it("uses the album for release-group requests (arrId is an album id)", async () => {
    vi.mocked(lidarr.getAlbum).mockResolvedValue({
      foreignAlbumId: "rg-1",
      statistics: { percentOfTracks: 100, trackFileCount: 12 },
    } as never);
    const s = await getMediaState(
      { ...base, mediaType: "music", releaseType: "album", externalId: "rg-1" },
      { checkIdentity: true },
    );
    expect(s).toMatchObject({ available: true, identityMismatch: null });
    expect(lidarr.getArtist).not.toHaveBeenCalled();
  });

  it("is not available for an album with no track files", async () => {
    vi.mocked(lidarr.getAlbum).mockResolvedValue({
      statistics: { percentOfTracks: 100, trackFileCount: 0 },
    } as never);
    expect((await getMediaState({ ...base, mediaType: "music", releaseType: "album" })).available).toBe(false);
  });

  it("uses the artist for full-artist requests", async () => {
    vi.mocked(lidarr.getArtist).mockResolvedValue({
      foreignArtistId: "mb-2",
      statistics: { albumCount: 3, percentOfTracks: 100 },
    } as never);
    const s = await getMediaState(
      { ...base, mediaType: "music", externalId2: "mb-1" },
      { checkIdentity: true },
    );
    expect(s.available).toBe(true);
    expect(s.identityMismatch).toMatch(/MBID=mb-2/);
  });
});

describe("getMediaState — books", () => {
  it("ebooks are available at LazyLibrarian status Have", async () => {
    vi.mocked(lazylibrarian.getBookStatus).mockResolvedValue("Have" as never);
    const s = await getMediaState({ ...base, mediaType: "book", externalId2: "LL1" });
    expect(s.available).toBe(true);
    expect(lazylibrarian.getBookStatus).toHaveBeenCalledWith("LL1", "eBook");
  });

  it("audiobooks read the AudioBook status; Open counts as on disk", async () => {
    vi.mocked(lazylibrarian.getBookStatus).mockResolvedValue("Open" as never);
    const s = await getMediaState({ ...base, mediaType: "book", externalId2: "LL1", bookFormat: "audiobook" });
    expect(s.available).toBe(true);
    expect(lazylibrarian.getBookStatus).toHaveBeenCalledWith("LL1", "AudioBook");
  });

  it("a Snatched book is in the queue even without checkQueue", async () => {
    vi.mocked(lazylibrarian.getBookStatus).mockResolvedValue("Snatched" as never);
    const s = await getMediaState({ ...base, mediaType: "book", externalId2: "LL1" });
    expect(s).toMatchObject({ available: false, inQueue: true });
    expect(lazylibrarian.getQueue).not.toHaveBeenCalled();
  });

  it("in-queue means in the Wanted list", async () => {
    vi.mocked(lazylibrarian.getBookStatus).mockResolvedValue("Wanted" as never);
    vi.mocked(lazylibrarian.getQueue).mockResolvedValue({ records: [{ BookID: "LL1" }] } as never);
    const s = await getMediaState({ ...base, mediaType: "book", externalId2: "LL1" }, { checkQueue: true });
    expect(s.inQueue).toBe(true);
  });
});
