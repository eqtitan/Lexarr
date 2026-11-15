import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/arr/lazylibrarian", () => ({
  addBook: vi.fn(async (id: string) => ({ id, alreadyExists: false })),
  addBookByTitle: vi.fn(async () => ({ id: "OL15992072W", alreadyExists: false })),
}));

import * as lazylibrarian from "@/lib/arr/lazylibrarian";
import { routeToArr } from "@/lib/arr/router";

beforeEach(() => vi.clearAllMocks());

const book = { mediaType: "book" as const, title: "Thinking, Fast and Slow" };

describe("routeToArr — books", () => {
  it("passes the picked OpenLibrary work id and returns LazyLibrarian's id as a string", async () => {
    const r = await routeToArr({ ...book, externalId: "/works/OL15992072W|Daniel Kahneman" });
    expect(lazylibrarian.addBookByTitle).toHaveBeenCalledWith(
      "Thinking, Fast and Slow", "Daniel Kahneman", "eBook", "OL15992072W",
    );
    expect(r).toMatchObject({ arrId: 0, bookId: "OL15992072W" });
  });

  it("keeps numeric GoodReads ids in arrId too", async () => {
    vi.mocked(lazylibrarian.addBookByTitle).mockResolvedValueOnce({ id: "40121378", alreadyExists: false });
    const r = await routeToArr({ ...book, externalId: "/works/OL17930368W" });
    expect(r).toMatchObject({ arrId: 40121378, bookId: "40121378" });
  });

  it("re-sends a stored LazyLibrarian id directly", async () => {
    await routeToArr({ ...book, externalId: "/works/OL1W", externalId2: "OL1W-stored" });
    expect(lazylibrarian.addBook).toHaveBeenCalledWith("OL1W-stored", "eBook");
  });

  it('treats the "0" written by older versions as no stored id', async () => {
    await routeToArr({ ...book, externalId: "/works/OL1W", externalId2: "0", bookFormat: "audiobook" });
    expect(lazylibrarian.addBook).not.toHaveBeenCalled();
    expect(lazylibrarian.addBookByTitle).toHaveBeenCalledWith(book.title, undefined, "AudioBook", "OL1W");
  });
});
