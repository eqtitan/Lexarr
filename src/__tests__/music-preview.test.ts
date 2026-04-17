import { describe, it, expect, afterEach, vi } from "vitest";
import {
  fetchItunesPreview,
  fetchDeezerPreview,
  findMusicPreview,
} from "@/lib/search/music-preview";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  globalThis.fetch = vi.fn(impl) as typeof fetch;
}

describe("fetchItunesPreview", () => {
  it("returns a preview when iTunes has a song result with previewUrl", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              kind: "song",
              previewUrl: "https://audio.itunes.apple.com/preview.m4a",
              trackName: "Centuries",
              artistName: "Fall Out Boy",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await fetchItunesPreview("Fall Out Boy", "Centuries");
    expect(result).toEqual({
      url: "https://audio.itunes.apple.com/preview.m4a",
      source: "itunes",
      trackName: "Centuries",
      artistName: "Fall Out Boy",
    });
  });

  it("skips non-song results and returns the first song with a previewUrl", async () => {
    // iTunes returns mixed kinds; music-videos + podcasts must be ignored.
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          results: [
            { kind: "music-video", previewUrl: "https://vid.example/1.mp4" },
            { kind: "song", previewUrl: "" }, // no audio URL
            {
              kind: "song",
              previewUrl: "https://audio.itunes.apple.com/good.m4a",
              trackName: "Good",
              artistName: "X",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await fetchItunesPreview("X", "Good");
    expect(result?.url).toBe("https://audio.itunes.apple.com/good.m4a");
  });

  it("returns null when the response has no results", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ resultCount: 0, results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await fetchItunesPreview("Nobody", "Nothing")).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    mockFetch(async () => new Response("Internal Error", { status: 500 }));
    expect(await fetchItunesPreview("a", "b")).toBeNull();
  });

  it("returns null on network failure (does not throw)", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await fetchItunesPreview("a", "b")).toBeNull();
  });
});

describe("fetchDeezerPreview", () => {
  it("returns a preview when Deezer has a matching track", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              preview: "https://cdns-preview-9.dzcdn.net/p.mp3",
              title: "Centuries",
              artist: { name: "Fall Out Boy" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await fetchDeezerPreview("Fall Out Boy", "Centuries");
    expect(result).toEqual({
      url: "https://cdns-preview-9.dzcdn.net/p.mp3",
      source: "deezer",
      trackName: "Centuries",
      artistName: "Fall Out Boy",
    });
  });

  it("skips empty preview fields and picks the first non-empty", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          data: [
            { preview: "", title: "Silent" },
            {
              preview: "https://cdns-preview-1.dzcdn.net/good.mp3",
              title: "Good",
              artist: { name: "Y" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await fetchDeezerPreview("Y", "Good");
    expect(result?.url).toBe("https://cdns-preview-1.dzcdn.net/good.mp3");
  });

  it("returns null when Deezer returns an empty data array", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await fetchDeezerPreview("nobody", "nothing")).toBeNull();
  });
});

describe("findMusicPreview", () => {
  it("returns the iTunes result when iTunes has a match", async () => {
    let itunesCalls = 0;
    let deezerCalls = 0;
    mockFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("itunes.apple.com")) {
        itunesCalls++;
        return new Response(
          JSON.stringify({
            results: [
              {
                kind: "song",
                previewUrl: "https://audio.itunes.apple.com/p.m4a",
                trackName: "Centuries",
                artistName: "Fall Out Boy",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      deezerCalls++;
      throw new Error("deezer should not be called");
    });

    const result = await findMusicPreview("Fall Out Boy", "Centuries");
    expect(result?.source).toBe("itunes");
    expect(itunesCalls).toBe(1);
    expect(deezerCalls).toBe(0);
  });

  it("falls back to Deezer when iTunes has no match", async () => {
    mockFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("itunes.apple.com")) {
        return new Response(
          JSON.stringify({ resultCount: 0, results: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              preview: "https://dzcdn/preview.mp3",
              title: "Obscure Song",
              artist: { name: "Obscure Artist" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await findMusicPreview("Obscure Artist", "Obscure Song");
    expect(result?.source).toBe("deezer");
  });

  it("returns null when both providers have no match", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ results: [], data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(
      await findMusicPreview("Nonexistent", "Track That Doesn't Exist"),
    ).toBeNull();
  });

  it("returns null when artist or title is empty (guard against empty URL query)", async () => {
    expect(await findMusicPreview("", "anything")).toBeNull();
    expect(await findMusicPreview("anything", "")).toBeNull();
  });
});

describe("preview-audio exclusivity", () => {
  it("playExclusively pauses the previous audio", async () => {
    const { playExclusively, stopAll, _currentAudioForTest } = await import(
      "@/lib/preview-audio"
    );
    // Reset module state between tests
    stopAll();

    // Fake Audio elements with spy methods
    interface FakeAudio {
      paused: boolean;
      currentTime: number;
      pause: ReturnType<typeof vi.fn>;
      play: ReturnType<typeof vi.fn>;
    }
    const makeAudio = (): FakeAudio => {
      const a: FakeAudio = {
        paused: true,
        currentTime: 0,
        pause: vi.fn(function (this: FakeAudio) {
          this.paused = true;
        }),
        play: vi.fn(async function (this: FakeAudio) {
          this.paused = false;
        }),
      };
      return a;
    };
    const a = makeAudio() as unknown as HTMLAudioElement;
    const b = makeAudio() as unknown as HTMLAudioElement;

    await playExclusively(a);
    expect(_currentAudioForTest()).toBe(a);
    expect(a.play).toHaveBeenCalledTimes(1);

    await playExclusively(b);
    expect(a.pause).toHaveBeenCalledTimes(1);
    expect(b.play).toHaveBeenCalledTimes(1);
    expect(_currentAudioForTest()).toBe(b);
  });

  it("stopAll pauses the current audio and clears the registry", async () => {
    const { playExclusively, stopAll, _currentAudioForTest } = await import(
      "@/lib/preview-audio"
    );
    stopAll();

    const a = {
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
      currentTime: 0,
    } as unknown as HTMLAudioElement;

    await playExclusively(a);
    stopAll();
    expect(a.pause).toHaveBeenCalled();
    expect(_currentAudioForTest()).toBeNull();
  });
});
