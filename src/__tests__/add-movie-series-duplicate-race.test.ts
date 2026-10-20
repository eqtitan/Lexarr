/**
 * addMovie()/addSeries() each do a check-then-insert (getMovieByTmdbId /
 * getSeriesByTmdbId, then POST) with no locking. Two near-simultaneous
 * requests for the same movie/series can both pass the existence check
 * before either POST lands -- Radarr/Sonarr reject the second with 400
 * "already been added". lidarr.ts already recovers from this for
 * addSingleReleaseGroup; these tests cover the same recovery added to
 * radarr.ts and sonarr.ts.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { _resetAllBreakers } from "@/lib/arr/circuit-breaker";
import { libraryCache } from "@/lib/cache";

process.env.ARR_HOST = "http://arr.test";
process.env.RADARR_API_KEY = "radarr-key";
process.env.SONARR_API_KEY = "sonarr-key";

const realFetch = globalThis.fetch;

beforeEach(() => {
  _resetAllBreakers();
  libraryCache.delete("sonarr:series");
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

describe("addMovie TOCTOU recovery", () => {
  it("recovers when Radarr rejects the POST as a duplicate, by re-fetching the now-existing movie", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/v3/movie?tmdbId=")) {
        // First check (pre-POST) says it doesn't exist; recovery re-check
        // (post-400) says it does. Distinguish by call count.
        return json(callCountMovieCheck++ === 0 ? [] : [{ id: 42, hasFile: false }]);
      }
      if (url.includes("/api/v3/movie/lookup")) return json([{ title: "Dune", tmdbId: 438631 }]);
      if (url.includes("/api/v3/qualityprofile")) return json([{ id: 1, name: "HD-1080p" }]);
      if (url.includes("/api/v3/rootfolder")) return json([{ path: "/media/movies" }]);
      if (url.endsWith("/api/v3/movie")) {
        return json({ message: "This movie has already been added." }, 400);
      }
      throw new Error(`unexpected URL in test: ${url}`);
    }) as typeof fetch;
    let callCountMovieCheck = 0;

    const { addMovie } = await import("@/lib/arr/radarr");
    const result = await addMovie(438631, "Dune", 1);
    expect(result).toEqual({ id: 42, alreadyExists: true, hasFile: false });
  });

  it("still throws when the POST fails for a non-duplicate reason", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/v3/movie?tmdbId=")) return json([]);
      if (url.includes("/api/v3/movie/lookup")) return json([{ title: "Dune", tmdbId: 438631 }]);
      if (url.includes("/api/v3/qualityprofile")) return json([{ id: 1, name: "HD-1080p" }]);
      if (url.includes("/api/v3/rootfolder")) return json([{ path: "/media/movies" }]);
      if (url.endsWith("/api/v3/movie")) return json({ message: "root folder invalid" }, 400);
      throw new Error(`unexpected URL in test: ${url}`);
    }) as typeof fetch;

    const { addMovie } = await import("@/lib/arr/radarr");
    await expect(addMovie(438631, "Dune", 1)).rejects.toThrow(/root folder invalid/);
  });
});

describe("library cache invalidation on a successful add", () => {
  it("addMovie drops the cached Radarr library so the new movie shows up immediately", async () => {
    libraryCache.set("radarr:movies", [{ id: 1, tmdbId: 1, hasFile: true }]);
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/v3/movie?tmdbId=")) return json([]);
      if (url.includes("/api/v3/movie/lookup")) return json([{ title: "Dune", tmdbId: 438631 }]);
      if (url.includes("/api/v3/qualityprofile")) return json([{ id: 1, name: "HD-1080p" }]);
      if (url.includes("/api/v3/rootfolder")) return json([{ path: "/media/movies" }]);
      if (url.endsWith("/api/v3/movie")) return json({ id: 99 }, 201);
      throw new Error(`unexpected URL in test: ${url}`);
    }) as typeof fetch;

    const { addMovie } = await import("@/lib/arr/radarr");
    await addMovie(438631, "Dune", 1);
    expect(libraryCache.get("radarr:movies")).toBeUndefined();
  });

  it("addSeries drops the cached Sonarr library so the new series shows up immediately", async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v3/series") && init?.method === "POST") return json({ id: 7 }, 201);
      if (url.endsWith("/api/v3/series")) return json([]);
      if (url.includes("/api/v3/series/lookup")) return json([{ title: "House of the Dragon", tmdbId: 94997 }]);
      if (url.includes("/api/v3/qualityprofile")) return json([{ id: 1, name: "HD-1080p" }]);
      if (url.includes("/api/v3/rootfolder")) return json([{ path: "/media/tv" }]);
      throw new Error(`unexpected URL in test: ${url}`);
    }) as typeof fetch;

    const { addSeries } = await import("@/lib/arr/sonarr");
    await addSeries(94997, "House of the Dragon", 1);
    expect(libraryCache.get("sonarr:series")).toBeUndefined();
  });
});

describe("addSeries TOCTOU recovery", () => {
  it("recovers when Sonarr rejects the POST as a duplicate, by invalidating the cache and re-fetching", async () => {
    let seriesListCallCount = 0;
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v3/series")) {
        seriesListCallCount++;
        // First call (pre-POST, via getAllSeriesCached) says empty; the
        // recovery re-fetch (post-400, after cache invalidation) says the
        // series now exists.
        return json(seriesListCallCount === 1 ? [] : [{ id: 7, tmdbId: 94997 }]);
      }
      if (url.includes("/api/v3/series/lookup")) return json([{ title: "House of the Dragon", tmdbId: 94997 }]);
      if (url.includes("/api/v3/qualityprofile")) return json([{ id: 1, name: "HD-1080p" }]);
      if (url.includes("/api/v3/rootfolder")) return json([{ path: "/media/tv" }]);
      throw new Error(`unexpected URL in test: ${url}`);
    }) as typeof fetch;

    // The POST itself goes to the same "/api/v3/series" URL as the list
    // GET -- distinguish by method instead.
    const baseImpl = globalThis.fetch as unknown as (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v3/series") && init?.method === "POST") {
        return json({ message: "This series has already been added." }, 400);
      }
      return baseImpl(input, init);
    }) as typeof fetch;

    const { addSeries } = await import("@/lib/arr/sonarr");
    const result = await addSeries(94997, "House of the Dragon", 1);
    expect(result).toEqual({ id: 7, alreadyExists: true });
  });
});
