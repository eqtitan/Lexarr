/**
 * PR E item 11: Lidarr never received qualityProfileId -- addArtist and
 * addSingleReleaseGroup didn't even accept the parameter, so movies and
 * TV honored an admin's profile choice but music silently ignored it.
 * These tests pin that the POST to Lidarr's /api/v1/artist now carries
 * whatever qualityProfileId router.ts passes through.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { _resetAllBreakers } from "@/lib/arr/circuit-breaker";
import { libraryCache } from "@/lib/cache";

process.env.ARR_HOST = "http://arr.test";
process.env.LIDARR_API_KEY = "lidarr-key";

const realFetch = globalThis.fetch;

beforeEach(() => {
  _resetAllBreakers();
  libraryCache.delete("lidarr:artists");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  _resetAllBreakers();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const LOOKUP = [{ foreignArtistId: "artist-1", artistName: "Test Artist" }];
const PROFILES = [{ id: 7, name: "Lossless" }];
const META_PROFILES = [{ id: 2, name: "All Music" }];
const FOLDERS = [{ path: "/media/music" }];

describe("addArtist passes qualityProfileId through to Lidarr", () => {
  it("uses the given qualityProfileId in the POST body instead of the picked default", async () => {
    let postedBody: Record<string, unknown> | undefined;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/v1/artist/lookup")) return json(LOOKUP);
      if (url.includes("/api/v1/qualityprofile")) return json(PROFILES);
      if (url.includes("/api/v1/rootfolder")) return json(FOLDERS);
      if (url.includes("/api/v1/metadataprofile")) return json(META_PROFILES);
      if (url.endsWith("/api/v1/artist") && init?.method === "POST") {
        postedBody = JSON.parse(String(init.body));
        return json({ id: 55 }, 201);
      }
      if (url.endsWith("/api/v1/artist")) return json([]); // getAllArtistsCached
      throw new Error(`unexpected URL in test: ${url}`);
    }) as typeof fetch;

    const { addArtist } = await import("@/lib/arr/lidarr");
    const result = await addArtist("artist-1", "Test Artist", 9);

    expect(result).toEqual({ id: 55, alreadyExists: false });
    expect(postedBody?.qualityProfileId).toBe(9);
  });

  it("falls back to the picked default profile when no qualityProfileId is given", async () => {
    let postedBody: Record<string, unknown> | undefined;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/v1/artist/lookup")) return json(LOOKUP);
      if (url.includes("/api/v1/qualityprofile")) return json(PROFILES);
      if (url.includes("/api/v1/rootfolder")) return json(FOLDERS);
      if (url.includes("/api/v1/metadataprofile")) return json(META_PROFILES);
      if (url.endsWith("/api/v1/artist") && init?.method === "POST") {
        postedBody = JSON.parse(String(init.body));
        return json({ id: 55 }, 201);
      }
      if (url.endsWith("/api/v1/artist")) return json([]);
      throw new Error(`unexpected URL in test: ${url}`);
    }) as typeof fetch;

    const { addArtist } = await import("@/lib/arr/lidarr");
    await addArtist("artist-1", "Test Artist");

    expect(postedBody?.qualityProfileId).toBe(7);
  });
});

describe("addSingleReleaseGroup passes qualityProfileId through to Lidarr", () => {
  it("uses the given qualityProfileId when creating a new artist for a narrow-monitored release", async () => {
    let postedBody: Record<string, unknown> | undefined;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/v1/artist/lookup")) return json(LOOKUP);
      if (url.includes("/api/v1/qualityprofile")) return json(PROFILES);
      if (url.includes("/api/v1/rootfolder")) return json(FOLDERS);
      if (url.includes("/api/v1/metadataprofile")) return json(META_PROFILES);
      if (url.endsWith("/api/v1/artist") && init?.method === "POST") {
        postedBody = JSON.parse(String(init.body));
        return json({ id: 55 }, 201);
      }
      if (url.endsWith("/api/v1/artist")) return json([]); // getAllArtistsCached
      if (url.includes("/api/v1/album?artistId=55")) {
        return json([
          { id: 900, foreignAlbumId: "release-group-1", title: "X", monitored: false, artistId: 55 },
        ]);
      }
      if (url.includes("/api/v1/album/monitor")) return json({});
      if (url.includes("/api/v1/command")) return json({});
      throw new Error(`unexpected URL in test: ${url}`);
    }) as typeof fetch;

    const { addSingleReleaseGroup } = await import("@/lib/arr/lidarr");
    const result = await addSingleReleaseGroup("artist-1", "release-group-1", 9);

    expect(result).toEqual({ id: 900, alreadyExists: false });
    expect(postedBody?.qualityProfileId).toBe(9);
  });
});
