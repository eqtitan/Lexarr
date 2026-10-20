import { describe, it, expect } from "vitest";
import { isKnownPosterUrl, validateRequestInput } from "@/lib/services/request";

const base = { mediaType: "movie", externalId: "438631", title: "Dune" };

describe("poster URL allowlist", () => {
  it.each([
    "https://image.tmdb.org/t/p/w300/abc.jpg",
    "https://coverartarchive.org/release-group/rg-1/front-250",
    "https://covers.openlibrary.org/b/id/123-M.jpg",
    "http://books.google.com/books/content?id=x&printsec=frontcover&img=1",
    "https://books.googleusercontent.com/books/content?id=x",
  ])("accepts art from the search sources: %s", (url) => {
    expect(isKnownPosterUrl(url)).toBe(true);
    expect(validateRequestInput({ ...base, posterUrl: url })).toBeNull();
  });

  it.each([
    "https://tracker.example.com/pixel.gif",
    "http://192.168.1.100:7878/api/v3/system/status",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "https://image.tmdb.org.evil.com/x.jpg",
    "not a url",
  ])("refuses anything else: %s", (url) => {
    expect(isKnownPosterUrl(url)).toBe(false);
    expect(validateRequestInput({ ...base, posterUrl: url })).toMatchObject({
      status: 400,
      error: "Invalid poster URL",
    });
  });

  it("still allows a request with no poster", () => {
    expect(validateRequestInput(base)).toBeNull();
  });
});
