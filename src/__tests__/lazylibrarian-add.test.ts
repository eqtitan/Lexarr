import { describe, it, expect, vi, beforeEach } from "vitest";

// A fake LazyLibrarian behind arrFetch: `library` is what getAllBooks
// returns, `findResults` what findBook returns, and `addBehaviour` decides
// what addBook does per id.
const fake = vi.hoisted(() => ({
  library: [] as { BookID: string; BookName: string; Status: string; AuthorID?: string }[],
  findResults: [] as { bookid: string; bookname: string }[],
  addBehaviour: {} as Record<string, "adds" | "drops" | "500">,
  calls: [] as string[],
  inFlight: 0,
  maxInFlight: 0,
}));

vi.mock("@/lib/arr/_fetch", async () => {
  const actual = await vi.importActual<typeof import("@/lib/arr/_fetch")>("@/lib/arr/_fetch");
  return {
    ...actual,
    arrFetch: vi.fn(async (_service: string, _base: string, path: string) => {
      const qs = new URLSearchParams(path.split("?")[1]);
      const cmd = qs.get("cmd") || "";
      const id = qs.get("id") || "";
      fake.calls.push(id ? `${cmd}:${id}` : cmd);
      fake.inFlight++;
      fake.maxInFlight = Math.max(fake.maxInFlight, fake.inFlight);
      await new Promise((r) => setTimeout(r, 1));
      fake.inFlight--;
      switch (cmd) {
        case "findBook":
          return fake.findResults;
        case "getAllBooks":
          return fake.library;
        case "addBook": {
          const how = fake.addBehaviour[id] ?? "adds";
          if (how === "500") throw new actual.ArrApiError("LazyLibrarian", path, 500, "boom");
          if (how === "adds") fake.library.push({ BookID: id, BookName: id, Status: "Skipped", AuthorID: "A1" });
          return "OK";
        }
        case "queueBook": {
          const b = fake.library.find((x) => x.BookID === id);
          if (b) b.Status = "Wanted";
          return "OK"; // LazyLibrarian says OK even for a book it doesn't have
        }
        default:
          return "OK";
      }
    }),
  };
});

import {
  addBook,
  addBookByTitle,
  rankMatches,
  BookNotAddedError,
} from "@/lib/arr/lazylibrarian";

beforeEach(() => {
  fake.library = [];
  fake.findResults = [];
  fake.addBehaviour = {};
  fake.calls = [];
  fake.inFlight = 0;
  fake.maxInFlight = 0;
});

describe("rankMatches", () => {
  const results = [
    { bookid: "OL1W", bookname: "Summary of The Psychology of Money" },
    { bookid: "OL2W", bookname: "Something Else" },
    { bookid: "OL3W", bookname: "The Psychology of Money" },
  ];

  it("puts the work id the user picked first", () => {
    expect(rankMatches(results, "The Psychology of Money", "OL2W")[0]).toBe("OL2W");
  });

  it("prefers an exact title, then a containing title, then LazyLibrarian's order", () => {
    expect(rankMatches(results, "The Psychology of Money")).toEqual(["OL3W", "OL1W", "OL2W"]);
  });

  it("drops results without an id and duplicates", () => {
    expect(rankMatches([{ bookname: "x" }, { bookid: "OL3W" }, { BookID: "OL3W" }], "x")).toEqual(["OL3W"]);
  });
});

describe("addBook", () => {
  it("stores and returns OpenLibrary ids as strings", async () => {
    await expect(addBook("OL15992072W")).resolves.toEqual({ id: "OL15992072W", alreadyExists: false });
    expect(fake.library[0]).toMatchObject({ BookID: "OL15992072W", Status: "Wanted" });
  });

  it("fails when LazyLibrarian says OK but never adds the book", async () => {
    fake.addBehaviour.OL9W = "drops";
    await expect(addBook("OL9W")).rejects.toBeInstanceOf(BookNotAddedError);
  });

  it("sends book adds one at a time", async () => {
    await Promise.all([addBook("OL1W"), addBook("OL2W"), addBook("OL3W")]);
    expect(fake.maxInFlight).toBe(1);
    const adds = fake.calls.filter((c) => c.startsWith("addBook:"));
    expect(adds).toEqual(["addBook:OL1W", "addBook:OL2W", "addBook:OL3W"]);
  });

  it("keeps the queue moving after a failed add", async () => {
    fake.addBehaviour.OL1W = "drops";
    const [a, b] = await Promise.allSettled([addBook("OL1W"), addBook("OL2W")]);
    expect(a.status).toBe("rejected");
    expect(b).toMatchObject({ status: "fulfilled", value: { id: "OL2W" } });
  });
});

describe("addBookByTitle", () => {
  it("adds the work the user picked when LazyLibrarian finds it", async () => {
    fake.findResults = [
      { bookid: "OL7W", bookname: "Metamorphosis" },
      { bookid: "OL8W", bookname: "Metamorphosis" },
    ];
    await expect(addBookByTitle("Metamorphosis", "Kafka", "eBook", "OL8W")).resolves.toMatchObject({ id: "OL8W" });
  });

  it("tries the next match when one is dropped or errors", async () => {
    fake.findResults = [
      { bookid: "OL1W", bookname: "The Art of War" },
      { bookid: "OL2W", bookname: "The Art of War" },
      { bookid: "OL3W", bookname: "The Art of War" },
    ];
    fake.addBehaviour = { OL1W: "drops", OL2W: "500" };
    await expect(addBookByTitle("The Art of War")).resolves.toMatchObject({ id: "OL3W" });
  });

  it("gives up after three matches with the last error", async () => {
    fake.findResults = ["OL1W", "OL2W", "OL3W", "OL4W"].map((bookid) => ({ bookid, bookname: "X" }));
    fake.addBehaviour = { OL1W: "drops", OL2W: "drops", OL3W: "drops" };
    await expect(addBookByTitle("X")).rejects.toBeInstanceOf(BookNotAddedError);
    expect(fake.calls).not.toContain("addBook:OL4W");
  });

  it("reports no results plainly", async () => {
    await expect(addBookByTitle("Nothing", "Nobody")).rejects.toThrow(/No results found/);
  });
});
