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

// Mirrors the MusicBrainz normalization in src/lib/search/musicbrainz.ts.
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
    // Narrow flow requires both release-group ID and artist ID.
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
