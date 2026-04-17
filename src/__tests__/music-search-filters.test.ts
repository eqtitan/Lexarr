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

  it("appends country clause for a single allowed region", () => {
    expect(
      buildTextSearchQuery("centuries", { allowedRegions: ["US"] }),
    ).toBe("centuries AND country:us");
  });

  it("appends OR-joined country clause for multiple allowed regions", () => {
    expect(
      buildTextSearchQuery("centuries", { allowedRegions: ["US", "GB"] }),
    ).toBe("centuries AND (country:us OR country:gb)");
  });

  it("combines releaseType and region filters", () => {
    expect(
      buildTextSearchQuery("centuries", {
        releaseType: "single",
        allowedRegions: ["US", "GB"],
      }),
    ).toBe(
      "centuries AND primarytype:Single AND (country:us OR country:gb)",
    );
  });

  it("omits region clause when allowedRegions is empty", () => {
    expect(
      buildTextSearchQuery("centuries", { allowedRegions: [] }),
    ).toBe("centuries");
  });

  it("drops non-ISO region codes silently", () => {
    // Guards against weird data sneaking through from the settings DB.
    expect(
      buildTextSearchQuery("centuries", {
        allowedRegions: ["US", "NOT_A_CODE", "G"],
      }),
    ).toBe("centuries AND country:us");
  });
});

describe("settings sanitizeRegions", () => {
  it("returns the default when input is not an array", () => {
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
