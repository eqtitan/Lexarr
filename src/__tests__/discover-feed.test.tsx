/**
 * The Music / Books lists' "Updated …" label and the admin "Refresh now"
 * button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import ReleasesFeed, { updatedAgo } from "@/components/ReleasesFeed";
import type { SearchResult } from "@/types";

vi.mock("@/components/MediaCard", () => ({
  default: ({ result }: { result: SearchResult }) => <div data-testid="card">{result.title}</div>,
}));

const realFetch = globalThis.fetch;
let listTitle: string;
let builtAt: string;
const posts: string[] = [];

beforeEach(() => {
  posts.length = 0;
  listTitle = "Old Pick";
  builtAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(String(url));
      listTitle = "Fresh Pick";
      builtAt = new Date().toISOString();
      return new Response(JSON.stringify({ complete: true }));
    }
    if (String(url).startsWith("/api/discover")) {
      const item: SearchResult = { id: "/works/1", mediaType: "book", title: listTitle };
      return new Response(JSON.stringify({ sections: [{ id: "trending", title: "Trending books", subtitle: "s", items: [item] }], builtAt }));
    }
    return new Response(JSON.stringify({ movies: [], tv: [] }));
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const feed = (isAdmin: boolean) => (
  <ReleasesFeed
    category="book"
    isAdmin={isAdmin}
    libraryStatuses={{}}
    onSelect={() => {}}
    onRequested={() => {}}
    onLoaded={() => {}}
  />
);

describe("discovery list freshness", () => {
  it("shows when the list was built, and no refresh button for a regular user", async () => {
    render(feed(false));
    expect(await screen.findByText("Old Pick")).toBeInTheDocument();
    expect(screen.getByText("Updated 3 h ago")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh now" })).not.toBeInTheDocument();
  });

  it("lets an admin rebuild the lists and shows the new one", async () => {
    render(feed(true));
    await screen.findByText("Old Pick");
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    expect(await screen.findByText("Fresh Pick")).toBeInTheDocument();
    expect(posts).toEqual(["/api/discover"]);
    await waitFor(() => expect(screen.getByText("Updated just now")).toBeInTheDocument());
  });

  it("formats the age", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    expect(updatedAgo("2026-11-14T11:59:40Z", now)).toBe("just now");
    expect(updatedAgo("2026-11-14T11:15:00Z", now)).toBe("45 min ago");
    expect(updatedAgo("2026-11-14T00:00:00Z", now)).toBe("12 h ago");
    expect(updatedAgo("2026-11-10T12:00:00Z", now)).toBe("4 days ago");
  });
});
