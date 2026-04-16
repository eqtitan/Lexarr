import { describe, it, expect } from "vitest";

/** Extracted from src/app/api/request/route.ts — pure validation, no route deps. */
type MediaType = "movie" | "tv" | "music" | "book";

interface RequestInput {
  mediaType?: string;
  title?: string;
  externalId?: string;
  year?: string;
  posterUrl?: string;
}

function validateRequest(input: RequestInput): { valid: true } | { valid: false; error: string } {
  const { mediaType, title, externalId, year, posterUrl } = input;

  if (!mediaType || !externalId || !title) {
    return { valid: false, error: "Missing required fields" };
  }

  const validMediaTypes: MediaType[] = ["movie", "tv", "music", "book"];
  if (!validMediaTypes.includes(mediaType as MediaType)) {
    return { valid: false, error: "Invalid media type" };
  }
  if (typeof title !== "string" || title.length < 1 || title.length > 500) {
    return { valid: false, error: "Title must be 1-500 characters" };
  }
  if (typeof externalId !== "string" || externalId.length < 1 || externalId.length > 200) {
    return { valid: false, error: "Invalid external ID" };
  }
  if (year && (typeof year !== "string" || !/^\d{4}$/.test(year))) {
    return { valid: false, error: "Year must be 4 digits" };
  }
  if (posterUrl && (typeof posterUrl !== "string" || posterUrl.length > 500)) {
    return { valid: false, error: "Invalid poster URL" };
  }

  return { valid: true };
}

const goodRequest: RequestInput = {
  mediaType: "movie",
  title: "Interstellar",
  externalId: "157336",
  year: "2014",
  posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
};

describe("Request Creation Validation", () => {
  it("accepts a valid movie request", () => {
    expect(validateRequest(goodRequest)).toEqual({ valid: true });
  });

  it("rejects missing mediaType", () => {
    const r = validateRequest({ ...goodRequest, mediaType: undefined });
    expect(r).toEqual({ valid: false, error: "Missing required fields" });
  });

  it("rejects invalid mediaType", () => {
    const r = validateRequest({ ...goodRequest, mediaType: "podcast" });
    expect(r).toEqual({ valid: false, error: "Invalid media type" });
  });

  it("rejects empty title", () => {
    const r = validateRequest({ ...goodRequest, title: "" });
    expect(r).toEqual({ valid: false, error: "Missing required fields" });
  });

  it("rejects title over 500 characters", () => {
    const r = validateRequest({ ...goodRequest, title: "A".repeat(501) });
    expect(r).toEqual({ valid: false, error: "Title must be 1-500 characters" });
  });

  it("rejects empty externalId", () => {
    const r = validateRequest({ ...goodRequest, externalId: "" });
    expect(r).toEqual({ valid: false, error: "Missing required fields" });
  });

  it("rejects externalId over 200 characters", () => {
    const r = validateRequest({ ...goodRequest, externalId: "x".repeat(201) });
    expect(r).toEqual({ valid: false, error: "Invalid external ID" });
  });

  it("accepts valid year '2026'", () => {
    const r = validateRequest({ ...goodRequest, year: "2026" });
    expect(r).toEqual({ valid: true });
  });

  it("rejects invalid year '99'", () => {
    const r = validateRequest({ ...goodRequest, year: "99" });
    expect(r).toEqual({ valid: false, error: "Year must be 4 digits" });
  });

  it("rejects posterUrl over 500 characters", () => {
    const r = validateRequest({ ...goodRequest, posterUrl: "https://x.com/" + "a".repeat(500) });
    expect(r).toEqual({ valid: false, error: "Invalid poster URL" });
  });
});
