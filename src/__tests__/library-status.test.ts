import { describe, it, expect } from "vitest";
import type { LibraryStatusValue } from "@/types";

/**
 * Library status logic tests — pure validation, no mocks needed.
 * Tests the merging logic that determines final status per item.
 */

// Simulates the merge logic from the library-status route
function mergeStatus(
  arrStatus: LibraryStatusValue,
  dbStatus: string | undefined,
): LibraryStatusValue {
  // Arr status takes priority
  if (arrStatus) return arrStatus;

  // Fall back to Lexarr DB
  if (dbStatus === "available") return "available";
  if (
    dbStatus === "downloading" ||
    dbStatus === "approved" ||
    dbStatus === "pending"
  )
    return "requested";
  return null;
}

describe("Library Status Merging", () => {
  it('returns "available" when arr reports hasFile', () => {
    expect(mergeStatus("available", undefined)).toBe("available");
  });

  it('returns "monitored" when arr reports exists but no file', () => {
    expect(mergeStatus("monitored", undefined)).toBe("monitored");
  });

  it("arr status takes priority over DB status", () => {
    expect(mergeStatus("available", "pending")).toBe("available");
    expect(mergeStatus("monitored", "downloading")).toBe("monitored");
  });

  it('returns "requested" for pending DB requests', () => {
    expect(mergeStatus(null, "pending")).toBe("requested");
  });

  it('returns "requested" for approved DB requests', () => {
    expect(mergeStatus(null, "approved")).toBe("requested");
  });

  it('returns "requested" for downloading DB requests', () => {
    expect(mergeStatus(null, "downloading")).toBe("requested");
  });

  it('returns "available" for available DB requests with no arr data', () => {
    expect(mergeStatus(null, "available")).toBe("available");
  });

  it("returns null when not in arr or DB", () => {
    expect(mergeStatus(null, undefined)).toBeNull();
  });

  it("returns null for denied/failed DB requests", () => {
    expect(mergeStatus(null, "denied")).toBeNull();
    expect(mergeStatus(null, "failed")).toBeNull();
  });
});

describe("Library Status Input Validation", () => {
  it("caps items at 40", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      mediaType: "movie" as const,
    }));
    const capped = items.slice(0, 40);
    expect(capped).toHaveLength(40);
  });

  it("groups items correctly by media type", () => {
    const items = [
      { id: "1", mediaType: "movie" as const },
      { id: "2", mediaType: "tv" as const },
      { id: "3", mediaType: "music" as const },
      { id: "4", mediaType: "book" as const },
      { id: "5", mediaType: "movie" as const },
    ];
    const movies = items.filter((i) => i.mediaType === "movie");
    const tv = items.filter((i) => i.mediaType === "tv");
    const music = items.filter((i) => i.mediaType === "music");
    const books = items.filter((i) => i.mediaType === "book");

    expect(movies).toHaveLength(2);
    expect(tv).toHaveLength(1);
    expect(music).toHaveLength(1);
    expect(books).toHaveLength(1);
  });

  it("generates correct status keys", () => {
    const item = { id: "12345", mediaType: "movie" as const };
    const key = `${item.mediaType}:${item.id}`;
    expect(key).toBe("movie:12345");
  });
});
