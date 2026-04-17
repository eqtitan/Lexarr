import { describe, it, expect } from "vitest";

// Mirrors the validation logic in src/app/api/request/route.ts.
type ReleaseType = "album" | "single" | "ep" | "other";
const VALID: ReleaseType[] = ["album", "single", "ep", "other"];

function normalize(raw: unknown): ReleaseType | undefined {
  return VALID.includes(raw as ReleaseType) ? (raw as ReleaseType) : undefined;
}

describe("releaseType validation (request API)", () => {
  it("accepts each valid value", () => {
    for (const r of VALID) expect(normalize(r)).toBe(r);
  });
  it("rejects unknown values", () => {
    expect(normalize("podcast")).toBeUndefined();
    expect(normalize("SINGLE")).toBeUndefined(); // case-sensitive
    expect(normalize("")).toBeUndefined();
  });
  it("rejects non-string types", () => {
    expect(normalize(null)).toBeUndefined();
    expect(normalize(undefined)).toBeUndefined();
    expect(normalize(42)).toBeUndefined();
    expect(normalize({})).toBeUndefined();
  });
});

// Mirrors the MusicBrainz primary-type normalization in src/lib/search/musicbrainz.ts.
function normalizeMbType(mbType?: string): ReleaseType | undefined {
  if (!mbType) return undefined;
  const t = mbType.toLowerCase();
  if (t === "album") return "album";
  if (t === "single") return "single";
  if (t === "ep") return "ep";
  return "other";
}

describe("MusicBrainz primary-type normalization", () => {
  it("maps Album/Single/EP in any case", () => {
    expect(normalizeMbType("Album")).toBe("album");
    expect(normalizeMbType("ALBUM")).toBe("album");
    expect(normalizeMbType("Single")).toBe("single");
    expect(normalizeMbType("EP")).toBe("ep");
  });
  it("maps unknown types to 'other'", () => {
    expect(normalizeMbType("Compilation")).toBe("other");
    expect(normalizeMbType("Soundtrack")).toBe("other");
    expect(normalizeMbType("Broadcast")).toBe("other");
  });
  it("returns undefined for empty input", () => {
    expect(normalizeMbType(undefined)).toBeUndefined();
    expect(normalizeMbType("")).toBeUndefined();
  });
});

// Mirrors the branching in src/lib/arr/router.ts `case "music"`.
function routeMusic(input: {
  releaseType?: ReleaseType;
  artistForeignId?: string;
}): "narrow" | "full-artist" {
  if (
    (input.releaseType === "single" || input.releaseType === "ep") &&
    input.artistForeignId
  ) {
    return "narrow";
  }
  return "full-artist";
}

describe("music routing: narrow vs full-artist", () => {
  it("singles with artist ID → narrow release-group flow", () => {
    expect(routeMusic({ releaseType: "single", artistForeignId: "abc" })).toBe(
      "narrow",
    );
  });
  it("EPs with artist ID → narrow", () => {
    expect(routeMusic({ releaseType: "ep", artistForeignId: "abc" })).toBe(
      "narrow",
    );
  });
  it("albums → full-artist monitoring", () => {
    expect(routeMusic({ releaseType: "album", artistForeignId: "abc" })).toBe(
      "full-artist",
    );
  });
  it("singles WITHOUT artist ID fall back to full-artist", () => {
    expect(routeMusic({ releaseType: "single" })).toBe("full-artist");
  });
  it("missing releaseType → full-artist (safe default)", () => {
    expect(routeMusic({ artistForeignId: "abc" })).toBe("full-artist");
  });
  it("'other' → full-artist", () => {
    expect(routeMusic({ releaseType: "other", artistForeignId: "abc" })).toBe(
      "full-artist",
    );
  });
});

// Search ranking heuristics (mirrors src/lib/search/musicbrainz.ts internals).
type Rg = {
  "primary-type"?: string;
  "first-release-date"?: string;
  releases?: { id: string }[];
};
const TYPE_WEIGHT: Record<string, number> = {
  album: 0,
  ep: 1,
  single: 2,
  other: 3,
};
function typeWeight(rg: Rg): number {
  return TYPE_WEIGHT[(rg["primary-type"] || "").toLowerCase()] ?? TYPE_WEIGHT.other;
}
function yearOf(rg: Rg): number {
  const d = rg["first-release-date"];
  return d ? parseInt(d.slice(0, 4), 10) || 0 : 0;
}
function rankTextResults(groups: Rg[]): Rg[] {
  return [...groups].sort((a, b) => {
    const ra = a.releases?.length ?? 0;
    const rb = b.releases?.length ?? 0;
    if (ra !== rb) return rb - ra;
    const tw = typeWeight(a) - typeWeight(b);
    if (tw !== 0) return tw;
    return yearOf(b) - yearOf(a);
  });
}

describe("music search ranking (text-search fallback)", () => {
  it("more releases wins over fewer", () => {
    const groups: Rg[] = [
      { "primary-type": "Album", releases: [{ id: "a" }] },
      {
        "primary-type": "Album",
        releases: [{ id: "b" }, { id: "c" }, { id: "d" }],
      },
    ];
    const ranked = rankTextResults(groups);
    expect(ranked[0].releases!.length).toBe(3);
  });
  it("on tied release counts, Album > EP > Single", () => {
    const groups: Rg[] = [
      { "primary-type": "Single", releases: [{ id: "a" }] },
      { "primary-type": "EP", releases: [{ id: "b" }] },
      { "primary-type": "Album", releases: [{ id: "c" }] },
    ];
    const ranked = rankTextResults(groups);
    expect(ranked.map((r) => r["primary-type"])).toEqual([
      "Album",
      "EP",
      "Single",
    ]);
  });
  it("tie-breaks by newer year", () => {
    const groups: Rg[] = [
      {
        "primary-type": "Album",
        releases: [{ id: "a" }],
        "first-release-date": "1990",
      },
      {
        "primary-type": "Album",
        releases: [{ id: "b" }],
        "first-release-date": "2020",
      },
    ];
    const ranked = rankTextResults(groups);
    expect(ranked[0]["first-release-date"]).toBe("2020");
  });
});

// Artist-detection confidence (mirrors detectArtist() in musicbrainz.ts).
type Artist = { id: string; name: string; score?: number };
function detect(query: string, artists: Artist[]): "strong" | "none" {
  if (artists.length === 0) return "none";
  const top = artists[0];
  const runnerUp = artists[1];
  const topScore = top.score ?? 0;
  const runnerScore = runnerUp?.score ?? 0;
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const nameMatches = normalize(top.name) === normalize(query);
  return topScore >= 90 &&
    (topScore - runnerScore >= 10 || !runnerUp) &&
    nameMatches
    ? "strong"
    : "none";
}

describe("artist detection confidence", () => {
  it("strong: exact name + high score + clear gap", () => {
    expect(
      detect("lady gaga", [
        { id: "a", name: "Lady Gaga", score: 100 },
        { id: "b", name: "Lady Gaga Tribute", score: 75 },
      ]),
    ).toBe("strong");
  });
  it("none: score too low", () => {
    expect(
      detect("rumours", [{ id: "a", name: "Rumours", score: 85 }]),
    ).toBe("none");
  });
  it("none: no gap above runner-up", () => {
    expect(
      detect("rumours", [
        { id: "a", name: "Rumours", score: 100 },
        { id: "b", name: "Rumours", score: 99 },
      ]),
    ).toBe("none");
  });
  it("none: name doesn't actually match query", () => {
    expect(
      detect("crablouse", [
        { id: "a", name: "Lords of Acid", score: 100 },
      ]),
    ).toBe("none");
  });
  it("strong: single artist result with perfect match", () => {
    expect(
      detect("drake", [{ id: "a", name: "Drake", score: 100 }]),
    ).toBe("strong");
  });
  it("none: empty results", () => {
    expect(detect("xzqqxx", [])).toBe("none");
  });
  it("strong: handles punctuation differences (case, hyphens, spaces)", () => {
    expect(
      detect("ac dc", [
        { id: "a", name: "AC/DC", score: 100 },
        { id: "b", name: "ACDC Tribute", score: 70 },
      ]),
    ).toBe("strong");
  });
});
