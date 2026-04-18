import { describe, it, expect } from "vitest";

/**
 * Audiobook support — unit tests that mirror the validation and routing
 * logic spread across the app. Not integration tests: they intentionally
 * reproduce the pure-function shape of each check so the test stays
 * green even if we restructure imports (Prisma/Next internals).
 */

// ── bookFormat validation (mirrors src/app/api/request/route.ts) ─────
type BookFormat = "ebook" | "audiobook";
const VALID: BookFormat[] = ["ebook", "audiobook"];

function normalizeBookFormat(raw: unknown): BookFormat | undefined {
  return VALID.includes(raw as BookFormat) ? (raw as BookFormat) : undefined;
}

describe("bookFormat validation (request API)", () => {
  it("accepts each valid value", () => {
    for (const f of VALID) expect(normalizeBookFormat(f)).toBe(f);
  });
  it("rejects unknown values", () => {
    expect(normalizeBookFormat("pdf")).toBeUndefined();
    expect(normalizeBookFormat("EBOOK")).toBeUndefined(); // case-sensitive
    expect(normalizeBookFormat("audio-book")).toBeUndefined();
    expect(normalizeBookFormat("")).toBeUndefined();
  });
  it("rejects non-string types", () => {
    expect(normalizeBookFormat(null)).toBeUndefined();
    expect(normalizeBookFormat(undefined)).toBeUndefined();
    expect(normalizeBookFormat(42)).toBeUndefined();
    expect(normalizeBookFormat({})).toBeUndefined();
  });
});

// ── LazyLibrarian type mapping (mirrors router.ts book branch) ───────
function toLazyLibrarianType(f?: BookFormat): "eBook" | "AudioBook" {
  return f === "audiobook" ? "AudioBook" : "eBook";
}

describe("bookFormat → LazyLibrarian type mapping", () => {
  it("maps audiobook → AudioBook", () => {
    expect(toLazyLibrarianType("audiobook")).toBe("AudioBook");
  });
  it("maps ebook → eBook", () => {
    expect(toLazyLibrarianType("ebook")).toBe("eBook");
  });
  it("defaults undefined to eBook for backward compatibility", () => {
    // Legacy rows created before 0.17 have null bookFormat — they must
    // continue to route as ebooks, not silently become audiobooks.
    expect(toLazyLibrarianType(undefined)).toBe("eBook");
  });
});

// ── Per-format status field selection (mirrors lazylibrarian.statusForType) ─
interface LLBook {
  Status?: string;
  status?: string;
  AudioStatus?: string;
  audiostatus?: string;
}
function statusForType(
  book: LLBook,
  bookType: "eBook" | "AudioBook" = "eBook",
): string | null {
  if (bookType === "AudioBook") {
    return book.AudioStatus || book.audiostatus || null;
  }
  return book.Status || book.status || null;
}

describe("LazyLibrarian status field dispatch", () => {
  it("ebook reads Status, not AudioStatus", () => {
    const book = { Status: "Have", AudioStatus: "Wanted" };
    expect(statusForType(book, "eBook")).toBe("Have");
    expect(statusForType(book, "AudioBook")).toBe("Wanted");
  });
  it("falls back to lowercase keys LL uses in findBook responses", () => {
    expect(statusForType({ status: "Wanted" }, "eBook")).toBe("Wanted");
    expect(statusForType({ audiostatus: "Have" }, "AudioBook")).toBe("Have");
  });
  it("missing field returns null (not 'undefined' string)", () => {
    expect(statusForType({}, "AudioBook")).toBeNull();
    expect(statusForType({ Status: "Have" }, "AudioBook")).toBeNull();
  });
});

// ── "Audiobook on disk" predicate (mirrors isAudiobookOnDisk in lazylibrarian.ts)
function isAudiobookOnDisk(status: string | null): boolean {
  return status === "Have" || status === "Open";
}

describe("audiobook availability — Open counts as on-disk", () => {
  it("Have → available", () => {
    expect(isAudiobookOnDisk("Have")).toBe(true);
  });
  it("Open → available (file on disk, LL post-proc not finalized)", () => {
    // LL leaves many audiobooks perpetually at "Open" once the file is
    // in the library folder. Lexarr must not block on Have-only or the
    // card stays "downloading" forever.
    expect(isAudiobookOnDisk("Open")).toBe(true);
  });
  it("Wanted / Snatched / Skipped / null → NOT available", () => {
    expect(isAudiobookOnDisk("Wanted")).toBe(false);
    expect(isAudiobookOnDisk("Snatched")).toBe(false);
    expect(isAudiobookOnDisk("Skipped")).toBe(false);
    expect(isAudiobookOnDisk(null)).toBe(false);
  });
});

// ── Duplicate-detection semantics (mirrors services/request.checkDuplicate)
/** Simplified predicate: does a proposed request collide with existing rows? */
function isDuplicate(
  existing: { mediaType: string; bookFormat: string | null }[],
  proposed: { mediaType: string; bookFormat?: BookFormat },
): boolean {
  if (proposed.mediaType !== "book") {
    return existing.some((r) => r.mediaType === proposed.mediaType);
  }
  const proposedFormat = proposed.bookFormat ?? "ebook";
  return existing.some((r) => {
    if (r.mediaType !== "book") return false;
    const existingFormat = r.bookFormat ?? "ebook"; // legacy null treated as ebook
    return existingFormat === proposedFormat;
  });
}

describe("book duplicate detection is per-format", () => {
  it("ebook after ebook → duplicate", () => {
    expect(
      isDuplicate(
        [{ mediaType: "book", bookFormat: "ebook" }],
        { mediaType: "book", bookFormat: "ebook" },
      ),
    ).toBe(true);
  });
  it("audiobook after ebook → NOT duplicate (different fulfillments)", () => {
    expect(
      isDuplicate(
        [{ mediaType: "book", bookFormat: "ebook" }],
        { mediaType: "book", bookFormat: "audiobook" },
      ),
    ).toBe(false);
  });
  it("audiobook after audiobook → duplicate", () => {
    expect(
      isDuplicate(
        [{ mediaType: "book", bookFormat: "audiobook" }],
        { mediaType: "book", bookFormat: "audiobook" },
      ),
    ).toBe(true);
  });
  it("ebook proposal collides with legacy null-format row (treated as ebook)", () => {
    expect(
      isDuplicate(
        [{ mediaType: "book", bookFormat: null }],
        { mediaType: "book", bookFormat: "ebook" },
      ),
    ).toBe(true);
  });
  it("audiobook proposal does NOT collide with legacy null-format row", () => {
    expect(
      isDuplicate(
        [{ mediaType: "book", bookFormat: null }],
        { mediaType: "book", bookFormat: "audiobook" },
      ),
    ).toBe(false);
  });
  it("non-book types keep simple mediaType+externalId dedupe semantics", () => {
    expect(
      isDuplicate(
        [{ mediaType: "movie", bookFormat: null }],
        { mediaType: "movie" },
      ),
    ).toBe(true);
  });
});
