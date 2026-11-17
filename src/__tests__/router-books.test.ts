import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/arr/lazylibrarian", () => {
  class BookNotAddedError extends Error {
    constructor(id: string) {
      super(`LazyLibrarian accepted book ${id} but didn't add it to its library`);
      this.name = "BookNotAddedError";
    }
  }
  return {
    BookNotAddedError,
    addBook: vi.fn(async (id: string) => ({ id, alreadyExists: false })),
    addBookByTitle: vi.fn(async () => ({ id: "OL15992072W", alreadyExists: false })),
  };
});

import * as lazylibrarian from "@/lib/arr/lazylibrarian";
import { ArrApiError } from "@/lib/arr/_fetch";
import { routeToArr } from "@/lib/arr/router";

beforeEach(() => vi.clearAllMocks());

const book = { mediaType: "book" as const, title: "Thinking, Fast and Slow" };
const notAdded = (id: string) => new lazylibrarian.BookNotAddedError(id);

describe("routeToArr — books", () => {
  it("adds the picked OpenLibrary work by id, without a title search", async () => {
    const r = await routeToArr({ ...book, externalId: "/works/OL15992072W|Daniel Kahneman" });
    expect(lazylibrarian.addBook).toHaveBeenCalledWith("OL15992072W", "eBook");
    expect(lazylibrarian.addBookByTitle).not.toHaveBeenCalled();
    expect(r).toMatchObject({ arrId: 0, bookId: "OL15992072W" });
  });

  it("falls back to a title search with the work as preferred match when the id add is dropped", async () => {
    vi.mocked(lazylibrarian.addBook).mockRejectedValueOnce(notAdded("OL15992072W"));
    const r = await routeToArr({ ...book, externalId: "/works/OL15992072W|Daniel Kahneman" });
    expect(lazylibrarian.addBookByTitle).toHaveBeenCalledWith(
      "Thinking, Fast and Slow", "Daniel Kahneman", "eBook", "OL15992072W",
    );
    expect(r.bookId).toBe("OL15992072W");
  });

  it("keeps numeric GoodReads ids in arrId too", async () => {
    vi.mocked(lazylibrarian.addBook).mockRejectedValueOnce(notAdded("OL17930368W"));
    vi.mocked(lazylibrarian.addBookByTitle).mockResolvedValueOnce({ id: "40121378", alreadyExists: false });
    const r = await routeToArr({ ...book, externalId: "/works/OL17930368W" });
    expect(r).toMatchObject({ arrId: 40121378, bookId: "40121378" });
  });

  it("tries the picked work before a stored id, then the stored id, then a title search", async () => {
    vi.mocked(lazylibrarian.addBook)
      .mockRejectedValueOnce(new ArrApiError("LazyLibrarian", "/api", 500, "boom"))
      .mockRejectedValueOnce(notAdded("29502358"));
    await routeToArr({ ...book, externalId: "/works/OL1W", externalId2: "29502358" });
    expect(vi.mocked(lazylibrarian.addBook).mock.calls.map((c) => c[0])).toEqual(["OL1W", "29502358"]);
    expect(lazylibrarian.addBookByTitle).toHaveBeenCalledTimes(1);
  });

  it("doesn't re-queue a stored id when the picked work adds", async () => {
    await routeToArr({ ...book, externalId: "/works/OL1W", externalId2: "29502358" });
    expect(lazylibrarian.addBook).toHaveBeenCalledTimes(1);
    expect(lazylibrarian.addBook).toHaveBeenCalledWith("OL1W", "eBook");
  });

  it("stops when LazyLibrarian is unreachable instead of trying more", async () => {
    vi.mocked(lazylibrarian.addBook).mockRejectedValueOnce(
      new ArrApiError("LazyLibrarian", "/api", 0, "This operation was aborted"),
    );
    await expect(routeToArr({ ...book, externalId: "/works/OL1W", externalId2: "29502358" })).rejects.toThrow(
      /aborted/,
    );
    expect(lazylibrarian.addBook).toHaveBeenCalledTimes(1);
    expect(lazylibrarian.addBookByTitle).not.toHaveBeenCalled();
  });

  it('treats the "0" written by older versions as no stored id', async () => {
    await routeToArr({ ...book, externalId: "/works/OL1W", externalId2: "0", bookFormat: "audiobook" });
    expect(lazylibrarian.addBook).toHaveBeenCalledTimes(1);
    expect(lazylibrarian.addBook).toHaveBeenCalledWith("OL1W", "AudioBook");
  });

  it("searches by title when there is no work id", async () => {
    await routeToArr({ ...book, externalId: "|Daniel Kahneman" });
    expect(lazylibrarian.addBook).not.toHaveBeenCalled();
    expect(lazylibrarian.addBookByTitle).toHaveBeenCalledWith(book.title, "Daniel Kahneman", "eBook", undefined);
  });
});
