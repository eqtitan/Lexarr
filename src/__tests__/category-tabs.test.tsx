/**
 * The category chips (All / Movies / TV / Music / Books) must change what the
 * home page shows when nothing is typed. They used to filter search results
 * only, so with an empty search box every chip showed the same movie + TV feed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import SearchBar from "@/components/SearchBar";
import ReleasesFeed from "@/components/ReleasesFeed";
import type { MediaType, SearchResult } from "@/types";

vi.mock("@/components/MediaCard", () => ({
  default: ({ result }: { result: SearchResult }) => <div data-testid="card">{result.title}</div>,
}));

const realFetch = globalThis.fetch;
const movie: SearchResult = { id: "1", mediaType: "movie", title: "A New Movie" };
const show: SearchResult = { id: "2", mediaType: "tv", title: "A New Show" };
const album: SearchResult = { id: "rg-1", mediaType: "music", title: "A Chart Album", artistId: "ar-1" };
const book: SearchResult = { id: "/works/OL1W", mediaType: "book", title: "A Trending Book" };
let discover: Record<"music" | "book", { id: string; title: string; subtitle: string; items: SearchResult[] }[]>;

class RO {
  observe() {}
  disconnect() {}
}

function Home() {
  const [category, setCategory] = useState<MediaType | null>(null);
  return (
    <>
      <SearchBar onSearch={() => {}} onFilterChange={setCategory} />
      <ReleasesFeed category={category} libraryStatuses={{}} onSelect={() => {}} onRequested={() => {}} onLoaded={() => {}} />
    </>
  );
}

const titles = () => screen.queryAllByTestId("card").map((c) => c.textContent);
const chip = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", RO);
  discover = {
    music: [
      { id: "chart", title: "Popular new albums", subtitle: "s", items: [album] },
      { id: "your-artists", title: "New from your artists", subtitle: "s", items: [] },
    ],
    book: [{ id: "trending", title: "Trending books", subtitle: "s", items: [book] }],
  };
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.startsWith("/api/discover")) {
      const type = new URL(u, "http://x").searchParams.get("type") as "music" | "book";
      return new Response(JSON.stringify({ sections: discover[type] }));
    }
    return new Response(JSON.stringify({ movies: [movie], tv: [show] }));
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
});

describe("category chips filter the home feed", () => {
  it("All shows both new movies and new TV", async () => {
    render(<Home />);
    expect(await screen.findByText("A New Movie")).toBeInTheDocument();
    expect(titles()).toEqual(["A New Movie", "A New Show"]);
  });

  it("Movies shows only movies, TV only TV, and All brings both back", async () => {
    render(<Home />);
    await screen.findByText("A New Movie");

    chip("Movies");
    expect(titles()).toEqual(["A New Movie"]);
    expect(screen.queryByText("New TV Shows")).not.toBeInTheDocument();

    chip("TV");
    expect(titles()).toEqual(["A New Show"]);
    expect(screen.queryByText("New Movies")).not.toBeInTheDocument();

    chip("All");
    expect(titles()).toEqual(["A New Movie", "A New Show"]);
  });

  it("Music shows popular albums and Books shows trending books, not the movie/TV feed", async () => {
    render(<Home />);
    await screen.findByText("A New Movie");

    chip("Music");
    expect(await screen.findByText("A Chart Album")).toBeInTheDocument();
    expect(titles()).toEqual(["A Chart Album"]);
    expect(screen.getByText("Popular new albums")).toBeInTheDocument();
    // An empty section is left out rather than shown with no cards.
    expect(screen.queryByText("New from your artists")).not.toBeInTheDocument();

    chip("Books");
    expect(await screen.findByText("A Trending Book")).toBeInTheDocument();
    expect(titles()).toEqual(["A Trending Book"]);
  });

  it("falls back to the search hint when a list comes back empty or fails", async () => {
    discover.music = [{ id: "chart", title: "Popular new albums", subtitle: "s", items: [] }];
    discover.book = undefined as never; // malformed answer
    render(<Home />);
    await screen.findByText("A New Movie");

    chip("Music");
    expect(await screen.findByText("Find music")).toBeInTheDocument();
    expect(titles()).toEqual([]);

    chip("Books");
    expect(await screen.findByText("Find books")).toBeInTheDocument();
  });

  it("marks the selected chip as pressed", async () => {
    render(<Home />);
    await screen.findByText("A New Movie");
    chip("TV");
    expect(screen.getByRole("button", { name: "TV" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
  });
});
