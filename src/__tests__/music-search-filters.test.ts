/**
 * Tests for the 0.12.0 music search filters: releaseType sub-chip and
 * the admin-configurable region filter. These are applied as extra
 * clauses in the MusicBrainz query string.
 */
import { describe, it, expect } from "vitest";
import { __testing } from "@/lib/search/musicbrainz";
import { __testing as settingsTesting, DEFAULT_ALLOWED_REGIONS } from "@/lib/settings";

const { buildTextSearchQuery } = __testing;
const { sanitizeRegions } = settingsTesting;

describe("buildTextSearchQuery", () => {
  it("returns the raw query when no filters are set", () => {
    expect(buildTextSearchQuery("centuries")).toBe("centuries");
  });

  it("trims whitespace from the query", () => {
    expect(buildTextSearchQuery("  centuries  ")).toBe("centuries");
  });

  it("appends primarytype clause for releaseType=single", () => {
    expect(
      buildTextSearchQuery("centuries", { releaseType: "single" }),
    ).toBe("centuries AND primarytype:Single");
  });

  it("appends primarytype clause for releaseType=ep", () => {
    expect(buildTextSearchQuery("centuries", { releaseType: "ep" })).toBe(
      "centuries AND primarytype:EP",
    );
  });

  it("appends primarytype clause for releaseType=album", () => {
    expect(
      buildTextSearchQuery("centuries", { releaseType: "album" }),
    ).toBe("centuries AND primarytype:Album");
  });

  it("ignores allowedRegions entirely (MB release-group index has no country field)", () => {
    // This is a regression guard. Early in 0.12.0 the query builder
    // emitted `country:us` clauses, which MB silently zero-matched.
    // The setting still exists for forward-compatibility with a
    // post-fetch implementation, but the query builder must not
    // reintroduce the broken clause.
    expect(
      buildTextSearchQuery("centuries", { allowedRegions: ["US"] }),
    ).toBe("centuries");
    expect(
      buildTextSearchQuery("centuries", { allowedRegions: ["US", "GB"] }),
    ).toBe("centuries");
    expect(
      buildTextSearchQuery("centuries", {
        releaseType: "single",
        allowedRegions: ["US", "GB"],
      }),
    ).toBe("centuries AND primarytype:Single");
  });

  it("omits all filter clauses when nothing is specified", () => {
    expect(
      buildTextSearchQuery("centuries", { allowedRegions: [] }),
    ).toBe("centuries");
  });
});

describe("settings sanitizeRegions", () => {
  it("returns the default (empty array) when input is not an array", () => {
    // Default became empty in 0.12.1 after we removed the broken
    // country-filter clause. See buildTextSearchQuery docs above.
    expect(DEFAULT_ALLOWED_REGIONS).toEqual([]);
    expect(sanitizeRegions(null)).toEqual(DEFAULT_ALLOWED_REGIONS);
    expect(sanitizeRegions("US,GB")).toEqual(DEFAULT_ALLOWED_REGIONS);
    expect(sanitizeRegions({})).toEqual(DEFAULT_ALLOWED_REGIONS);
    expect(sanitizeRegions(undefined)).toEqual(DEFAULT_ALLOWED_REGIONS);
  });

  it("preserves an empty array (means: no region filter)", () => {
    expect(sanitizeRegions([])).toEqual([]);
  });

  it("filters out unsupported region codes", () => {
    expect(sanitizeRegions(["US", "XX", "GB"])).toEqual(["US", "GB"]);
  });

  it("filters out non-string entries", () => {
    expect(sanitizeRegions(["US", 42, null, "GB"])).toEqual(["US", "GB"]);
  });

  it("returns only supported codes when all supplied are unsupported", () => {
    expect(sanitizeRegions(["XX", "YY", "ZZ"])).toEqual([]);
  });
});
