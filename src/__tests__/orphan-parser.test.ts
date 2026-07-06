import { describe, it, expect } from "vitest";
import { parseOrphanStateLine } from "@/lib/arr/orphans";

describe("parseOrphanStateLine", () => {
  it("parses a valid tv line", () => {
    const result = parseOrphanStateLine(
      "tv|Rick.and.Morty.S04E08.1080p.WEBRip.x264-BTX[rarbg]|1779534001|12",
    );
    expect(result).toEqual({
      category: "tv",
      folderName: "Rick.and.Morty.S04E08.1080p.WEBRip.x264-BTX[rarbg]",
      unixTs: 1779534001,
      scanCount: 12,
    });
  });

  it("parses a valid movies line", () => {
    const result = parseOrphanStateLine(
      "movies|The.Bride.2026.1080p.BluRay.x264-KNiVES|1747000000|3",
    );
    expect(result).toEqual({
      category: "movies",
      folderName: "The.Bride.2026.1080p.BluRay.x264-KNiVES",
      unixTs: 1747000000,
      scanCount: 3,
    });
  });

  it("parses music and books categories", () => {
    expect(parseOrphanStateLine("music|Metallica - Black Album|1700000000|1")?.category).toBe("music");
    expect(parseOrphanStateLine("books|Some.Book.2024|1700000000|2")?.category).toBe("books");
  });

  it("returns null for empty lines", () => {
    expect(parseOrphanStateLine("")).toBeNull();
    expect(parseOrphanStateLine("   ")).toBeNull();
  });

  it("returns null for comment lines", () => {
    expect(parseOrphanStateLine("# This is a comment")).toBeNull();
  });

  it("returns null when fewer than 4 pipe-separated fields", () => {
    expect(parseOrphanStateLine("tv|SomeFolder|1700000000")).toBeNull();
    expect(parseOrphanStateLine("tv|SomeFolder")).toBeNull();
    expect(parseOrphanStateLine("onlyone")).toBeNull();
  });

  it("returns null for unknown categories", () => {
    expect(parseOrphanStateLine("anime|SomeFolder|1700000000|5")).toBeNull();
    expect(parseOrphanStateLine("torrents|SomeFolder|1700000000|1")).toBeNull();
  });

  it("returns null when timestamp is not a number", () => {
    expect(parseOrphanStateLine("tv|SomeFolder|not-a-number|5")).toBeNull();
  });

  it("returns null when scan count is not a number", () => {
    expect(parseOrphanStateLine("tv|SomeFolder|1700000000|abc")).toBeNull();
  });

  it("returns null when folder name is empty", () => {
    expect(parseOrphanStateLine("tv||1700000000|5")).toBeNull();
  });

  it("handles extra fields gracefully (ignores them)", () => {
    const result = parseOrphanStateLine("tv|SomeFolder|1700000000|5|extra|fields");
    expect(result).not.toBeNull();
    expect(result?.folderName).toBe("SomeFolder");
    expect(result?.scanCount).toBe(5);
  });
});
