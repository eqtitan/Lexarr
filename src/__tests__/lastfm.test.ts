import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { getArtistListeners, isLastfmEnabled } from "@/lib/search/lastfm";

const realFetch = globalThis.fetch;
const realEnv = process.env.LASTFM_API_KEY;

beforeEach(() => {
  process.env.LASTFM_API_KEY = "test-key-12345";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  if (realEnv === undefined) {
    delete process.env.LASTFM_API_KEY;
  } else {
    process.env.LASTFM_API_KEY = realEnv;
  }
});

function mockFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  globalThis.fetch = vi.fn(impl) as typeof fetch;
}

const VALID_MBID = "d1e61228-0000-0000-0000-000000000000";
// Fall Out Boy's actual MBID format, well-formed
const FOB_MBID = "b9ebaed1-f64b-449b-a00e-d18e4dde5c5b";

describe("isLastfmEnabled", () => {
  it("returns true when LASTFM_API_KEY is set", () => {
    expect(isLastfmEnabled()).toBe(true);
  });

  it("returns false when LASTFM_API_KEY is unset", () => {
    delete process.env.LASTFM_API_KEY;
    expect(isLastfmEnabled()).toBe(false);
  });

  it("returns false when LASTFM_API_KEY is empty string", () => {
    process.env.LASTFM_API_KEY = "";
    expect(isLastfmEnabled()).toBe(false);
  });
});

describe("getArtistListeners", () => {
  it("returns the parsed listener count on a successful response", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          artist: {
            name: "Fall Out Boy",
            mbid: FOB_MBID,
            stats: { listeners: "5234567", playcount: "123456789" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    expect(await getArtistListeners(FOB_MBID)).toBe(5234567);
  });

  it("returns null when LASTFM_API_KEY is unset (feature disabled)", async () => {
    delete process.env.LASTFM_API_KEY;
    // fetch should never be called — bail early
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    expect(await getArtistListeners(FOB_MBID)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null for invalid MBID format (doesn't call network)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    expect(await getArtistListeners("not-a-uuid")).toBeNull();
    expect(await getArtistListeners("")).toBeNull();
    expect(await getArtistListeners("too-short")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when Last.fm returns a non-2xx", async () => {
    mockFetch(async () => new Response("server error", { status: 500 }));
    expect(await getArtistListeners(VALID_MBID)).toBeNull();
  });

  it("returns null when Last.fm returns an error body (code 6 = not found)", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({ error: 6, message: "The artist you supplied could not be found" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    expect(await getArtistListeners(VALID_MBID)).toBeNull();
  });

  it("returns null when listeners field is missing from otherwise-valid response", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({ artist: { name: "Obscure", mbid: VALID_MBID } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    expect(await getArtistListeners(VALID_MBID)).toBeNull();
  });

  it("returns null when listeners is non-numeric", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          artist: { stats: { listeners: "not-a-number" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    expect(await getArtistListeners(VALID_MBID)).toBeNull();
  });

  it("returns null on network failure (does not throw)", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await getArtistListeners(VALID_MBID)).toBeNull();
  });

  it("includes the api_key in the request URL", async () => {
    let capturedUrl = "";
    mockFetch(async (input) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(
        JSON.stringify({ artist: { stats: { listeners: "100" } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    await getArtistListeners(VALID_MBID);
    expect(capturedUrl).toContain("api_key=test-key-12345");
    expect(capturedUrl).toContain(`mbid=${VALID_MBID}`);
    expect(capturedUrl).toContain("method=artist.getinfo");
  });
});
