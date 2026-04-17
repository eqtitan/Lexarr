/**
 * Tests for the music-search ranking, discography mixer, and secondary-
 * type handling. Guards against the regression that "centuries" returned
 * six partial-match albums instead of the exact-title Fall Out Boy single.
 *
 * These are pure-function tests against exports from __testing in
 * src/lib/search/musicbrainz.ts — no network calls.
 */
import { describe, it, expect } from "vitest";
import { __testing } from "@/lib/search/musicbrainz";

const { rankTextResults, pickDiscographyMix, filterSecondaryTypes, toResult } =
  __testing;

// Minimal fixture builder — only the fields the rankers read.
type RG = {
  id: string;
  title: string;
  "primary-type"?: string;
  "secondary-types"?: string[];
  "first-release-date"?: string;
  releases?: { id: string }[];
  score?: number;
};

function rg(
  id: string,
  title: string,
  primary: string,
  opts: {
    score?: number;
    releases?: number;
    year?: number;
    secondary?: string[];
  } = {},
): RG {
  return {
    id,
    title,
    "primary-type": primary,
    "secondary-types": opts.secondary,
    "first-release-date": opts.year ? `${opts.year}-01-01` : undefined,
    releases: Array.from({ length: opts.releases ?? 1 }, (_, i) => ({
      id: `${id}-r${i}`,
    })),
    score: opts.score ?? 100,
  };
}

describe("rankTextResults (score-first)", () => {
  it("exact-title match (score 100) beats partial-title match (score 85)", () => {
    // The actual "centuries" regression: partial-match album used to beat
    // exact-match single because the old ranker ignored score.
    const partial = rg("a", "Centuries of Sorrow", "Album", {
      score: 85,
      releases: 1,
    });
    const exactSingle = rg("b", "Centuries", "Single", {
      score: 100,
      releases: 1,
    });
    const ranked = rankTextResults([partial, exactSingle]);
    expect(ranked[0].id).toBe("b");
    expect(ranked[1].id).toBe("a");
  });

  it("within same score, ranks by release count descending", () => {
    const popular = rg("a", "Centuries", "Album", {
      score: 100,
      releases: 20,
    });
    const obscure = rg("b", "Centuries", "Album", {
      score: 100,
      releases: 1,
    });
    const ranked = rankTextResults([obscure, popular]);
    expect(ranked[0].id).toBe("a");
  });

  it("within same score and release count, prefers albums over singles", () => {
    const single = rg("a", "Centuries", "Single", {
      score: 100,
      releases: 1,
    });
    const album = rg("b", "Centuries", "Album", { score: 100, releases: 1 });
    const ranked = rankTextResults([single, album]);
    expect(ranked[0].id).toBe("b"); // album wins the tertiary tiebreak
  });

  it("does not systematically bury singles when they have higher score", () => {
    // Regression anchor: even with albums having more releases, a
    // higher-scored single must still win.
    const album = rg("a", "Partial Match Album", "Album", {
      score: 85,
      releases: 10,
    });
    const single = rg("b", "Exact Single", "Single", {
      score: 100,
      releases: 1,
    });
    const ranked = rankTextResults([album, single]);
    expect(ranked[0].id).toBe("b");
  });
});

describe("pickDiscographyMix", () => {
  it("distributes across types instead of returning 15 albums", () => {
    // Fall Out Boy shape: many albums, some EPs, some singles
    const albums = Array.from({ length: 20 }, (_, i) =>
      rg(`alb-${i}`, `Album ${i}`, "Album", { year: 2025 - i }),
    );
    const eps = Array.from({ length: 5 }, (_, i) =>
      rg(`ep-${i}`, `EP ${i}`, "EP", { year: 2025 - i }),
    );
    const singles = Array.from({ length: 10 }, (_, i) =>
      rg(`sgl-${i}`, `Single ${i}`, "Single", { year: 2025 - i }),
    );

    const mixed = pickDiscographyMix([...albums, ...eps, ...singles], 15);
    const types = mixed.map((g) => g["primary-type"]);

    expect(mixed.length).toBe(15);
    expect(types.filter((t) => t === "Single").length).toBeGreaterThan(0);
    expect(types.filter((t) => t === "EP").length).toBeGreaterThan(0);
    expect(types.filter((t) => t === "Album").length).toBeGreaterThan(0);
  });

  it("fills shortfalls from other buckets when one type is scarce", () => {
    // Artist with many albums, no singles — mix should fall back to
    // albums, not leave empty slots.
    const albums = Array.from({ length: 20 }, (_, i) =>
      rg(`alb-${i}`, `Album ${i}`, "Album", { year: 2025 - i }),
    );
    const mixed = pickDiscographyMix(albums, 15);
    expect(mixed.length).toBe(15);
    expect(mixed.every((g) => g["primary-type"] === "Album")).toBe(true);
  });

  it("preserves within-type year-descending order", () => {
    const groups = [
      rg("old", "Old", "Album", { year: 2010 }),
      rg("new", "New", "Album", { year: 2024 }),
      rg("mid", "Mid", "Album", { year: 2018 }),
    ];
    const mixed = pickDiscographyMix(groups, 3);
    const albums = mixed.filter((g) => g["primary-type"] === "Album");
    expect(albums.map((g) => g.id)).toEqual(["new", "mid", "old"]);
  });
});

describe("filterSecondaryTypes", () => {
  it("returns only whitelisted types", () => {
    expect(filterSecondaryTypes(["Live", "Remix"])).toEqual(["Live", "Remix"]);
    expect(filterSecondaryTypes(["Live"])).toEqual(["Live"]);
  });

  it("returns undefined when no whitelisted types are present", () => {
    expect(filterSecondaryTypes(undefined)).toBeUndefined();
    expect(filterSecondaryTypes([])).toBeUndefined();
    // "Broadcast" isn't on the whitelist — filter drops it
    expect(filterSecondaryTypes(["Broadcast"])).toBeUndefined();
  });

  it("drops unknown values but keeps whitelisted ones", () => {
    expect(filterSecondaryTypes(["Live", "SomeFutureType"])).toEqual(["Live"]);
  });
});

describe("toResult", () => {
  it("includes secondaryTypes on the SearchResult", () => {
    const result = toResult(
      rg("live1", "MTV Unplugged", "Album", {
        year: 1993,
        secondary: ["Live", "Acoustic"],
      }),
    );
    expect(result.secondaryTypes).toEqual(["Live", "Acoustic"]);
    expect(result.releaseType).toBe("album");
  });

  it("labels the overview with secondary types when present", () => {
    const result = toResult(
      rg("rmx", "Some Remix EP", "EP", {
        year: 2020,
        secondary: ["Remix"],
      }),
    );
    expect(result.overview).toContain("Remix");
    expect(result.overview).toContain("EP");
  });

  it("omits secondaryTypes cleanly when none are set", () => {
    const result = toResult(rg("plain", "Plain Album", "Album", { year: 2020 }));
    expect(result.secondaryTypes).toBeUndefined();
    expect(result.overview).not.toContain("undefined");
  });
});
