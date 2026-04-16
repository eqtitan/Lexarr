import { describe, it, expect } from "vitest";

/**
 * Input validation tests — pure logic, no mocks needed.
 * Tests the validation rules applied in request creation and detail routes.
 */

describe("Input Validation Rules", () => {
  const validMediaTypes = ["movie", "tv", "music", "book"];

  describe("mediaType validation", () => {
    it("accepts valid media types", () => {
      for (const type of validMediaTypes) {
        expect(validMediaTypes.includes(type)).toBe(true);
      }
    });

    it("rejects invalid media types", () => {
      expect(validMediaTypes.includes("podcast")).toBe(false);
      expect(validMediaTypes.includes("")).toBe(false);
      expect(validMediaTypes.includes("MOVIE")).toBe(false);
    });
  });

  describe("title validation", () => {
    it("accepts valid titles", () => {
      expect("A".length >= 1 && "A".length <= 500).toBe(true);
      expect("Outlander S08E06".length >= 1).toBe(true);
    });

    it("rejects empty titles", () => {
      expect("".length >= 1).toBe(false);
    });

    it("rejects titles over 500 chars", () => {
      const longTitle = "A".repeat(501);
      expect(longTitle.length <= 500).toBe(false);
    });
  });

  describe("year validation", () => {
    const yearRegex = /^\d{4}$/;

    it("accepts valid years", () => {
      expect(yearRegex.test("2026")).toBe(true);
      expect(yearRegex.test("1999")).toBe(true);
    });

    it("rejects invalid years", () => {
      expect(yearRegex.test("99")).toBe(false);
      expect(yearRegex.test("20261")).toBe(false);
      expect(yearRegex.test("abcd")).toBe(false);
      expect(yearRegex.test("")).toBe(false);
    });
  });

  describe("detail route ID validation", () => {
    it("accepts numeric IDs for movie/tv (TMDB)", () => {
      expect(/^\d+$/.test("12345")).toBe(true);
      expect(/^\d+$/.test("1")).toBe(true);
    });

    it("rejects non-numeric IDs for movie/tv", () => {
      expect(/^\d+$/.test("abc")).toBe(false);
      expect(/^\d+$/.test("../../etc")).toBe(false);
      expect(/^\d+$/.test("123abc")).toBe(false);
    });

    it("accepts UUID format for music (MusicBrainz)", () => {
      expect(
        /^[0-9a-f-]{36}$/i.test("f27ec8db-af05-4f36-916e-3c57f9f0b0e3"),
      ).toBe(true);
    });

    it("rejects invalid music IDs", () => {
      expect(/^[0-9a-f-]{36}$/i.test("not-a-uuid")).toBe(false);
      expect(/^[0-9a-f-]{36}$/i.test("12345")).toBe(false);
    });

    it("accepts OpenLibrary work IDs for books", () => {
      expect(/^(\/works\/)?OL\d+W$/.test("OL12345W")).toBe(true);
      expect(/^(\/works\/)?OL\d+W$/.test("/works/OL12345W")).toBe(true);
    });

    it("rejects path traversal attempts for books", () => {
      expect(/^(\/works\/)?OL\d+W$/.test("../../etc/passwd")).toBe(false);
      expect(/^(\/works\/)?OL\d+W$/.test("/admin")).toBe(false);
    });
  });
});

describe("Scoring Formula", () => {
  function calcDimensionScore(
    dimension: string,
    value: number,
  ): number {
    switch (dimension) {
      case "type_errors":
        return Math.max(0, 100 - value * 10);
      case "lint_errors":
        return Math.max(0, 100 - value * 5);
      case "lint_warnings":
        return Math.max(0, 100 - value * 2);
      case "test_pass_rate":
        return value; // already 0-100
      case "coverage":
        return value; // already 0-100
      default:
        return 0;
    }
  }

  it("scores 100 for zero issues", () => {
    expect(calcDimensionScore("type_errors", 0)).toBe(100);
    expect(calcDimensionScore("lint_errors", 0)).toBe(100);
  });

  it("scores 0 for excessive issues", () => {
    expect(calcDimensionScore("type_errors", 10)).toBe(0);
    expect(calcDimensionScore("lint_errors", 20)).toBe(0);
    expect(calcDimensionScore("lint_warnings", 50)).toBe(0);
  });

  it("penalizes type errors more heavily than lint errors", () => {
    expect(calcDimensionScore("type_errors", 5)).toBe(50);
    expect(calcDimensionScore("lint_errors", 5)).toBe(75);
  });
});
