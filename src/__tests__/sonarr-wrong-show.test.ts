/**
 * Sonarr is TVDB-based. Its `term=tmdb:<id>` lookup, when TVDB has no mapping
 * for that TMDB id, returns the show whose TVDB id equals the number -- a
 * different show. addSeries used to POST lookup[0] blindly (5 of 33 TV
 * requests in production got the wrong show). These tests pin the fix.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { _resetAllBreakers } from "@/lib/arr/circuit-breaker";
import { libraryCache } from "@/lib/cache";

process.env.ARR_HOST = "http://arr.test";
process.env.SONARR_API_KEY = "sonarr-key";

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// "V: The Final Battle" is TMDB tv/75896; TVDB 75896 is "Intervention".
const WRONG = { title: "Intervention", tvdbId: 75896, tmdbId: 11145 };
const RIGHT = { title: "Stuart Fails to Save the Universe", tvdbId: 465664, tmdbId: 287620 };

let posted: Record<string, unknown>[];
let lookups: string[];

function stub(opts: { tmdb: "tvdb" | "none" | "down"; tvdbId?: number; library?: unknown[]; tmdbLookup?: unknown[] }) {
  posted = [];
  lookups = [];
  globalThis.fetch = vi.fn(async (input, init) => {
    const url = String(input);
    if (url.includes("themoviedb") || url.includes("/tv/")) {
      if (opts.tmdb === "down") return json({ status_message: "down" }, 503);
      return json({ tvdb_id: opts.tmdb === "tvdb" ? opts.tvdbId : null });
    }
    if (url.endsWith("/api/v3/series") && init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return json({ id: 99 }, 201);
    }
    if (url.endsWith("/api/v3/series")) return json(opts.library ?? []);
    if (url.includes("/api/v3/series/lookup")) {
      const term = decodeURIComponent(url.split("term=")[1]);
      lookups.push(term);
      if (term === `tvdb:${RIGHT.tvdbId}`) return json([RIGHT]);
      if (term.startsWith("tmdb:")) return json(opts.tmdbLookup ?? [WRONG]);
      return json([]);
    }
    if (url.includes("/api/v3/qualityprofile")) return json([{ id: 1, name: "HD-1080p" }]);
    if (url.includes("/api/v3/rootfolder")) return json([{ path: "/media/tv" }]);
    throw new Error(`unexpected URL in test: ${url}`);
  }) as typeof fetch;
}

beforeEach(() => {
  _resetAllBreakers();
  libraryCache.delete("sonarr:series");
  process.env.TMDB_API_KEY = "tmdb-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  delete process.env.TMDB_API_KEY;
});

describe("addSeries picks the right show", () => {
  it("resolves the TVDB id through TMDB and adds exactly that show", async () => {
    stub({ tmdb: "tvdb", tvdbId: RIGHT.tvdbId });
    const { addSeries } = await import("@/lib/arr/sonarr");

    const r = await addSeries(RIGHT.tmdbId, RIGHT.title, 1);

    expect(r).toMatchObject({ id: 99, alreadyExists: false });
    expect(lookups).toEqual([`tvdb:${RIGHT.tvdbId}`]);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ title: RIGHT.title, tvdbId: RIGHT.tvdbId });
  });

  it("refuses to add anything when TMDB says the show isn't on TVDB (the bug case)", async () => {
    stub({ tmdb: "none" });
    const { addSeries, NOT_ON_TVDB_MESSAGE } = await import("@/lib/arr/sonarr");

    await expect(addSeries(75896, "V: The Final Battle", 1)).rejects.toThrow(NOT_ON_TVDB_MESSAGE);
    expect(posted).toHaveLength(0);
  });

  it("with TMDB down, falls back to Sonarr's tmdb: lookup but rejects a different show", async () => {
    stub({ tmdb: "down" });
    const { addSeries } = await import("@/lib/arr/sonarr");

    await expect(addSeries(75896, "V: The Final Battle", 1)).rejects.toThrow(/Not on TheTVDB/);
    expect(posted).toHaveLength(0);
  });

  it("with TMDB down, still adds when Sonarr's tmdb: result really matches", async () => {
    stub({ tmdb: "down", tmdbLookup: [RIGHT] });
    const { addSeries } = await import("@/lib/arr/sonarr");

    await addSeries(RIGHT.tmdbId, RIGHT.title, 1);
    expect(posted[0]).toMatchObject({ tvdbId: RIGHT.tvdbId });
  });

  it("reuses a series Sonarr already has under that TVDB id even without a tmdbId", async () => {
    stub({ tmdb: "tvdb", tvdbId: RIGHT.tvdbId, library: [{ id: 40, tmdbId: 0, tvdbId: RIGHT.tvdbId }] });
    const { addSeries } = await import("@/lib/arr/sonarr");

    expect(await addSeries(RIGHT.tmdbId, RIGHT.title, 1)).toEqual({ id: 40, alreadyExists: true });
    expect(posted).toHaveLength(0);
  });
});
