import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { arrFetch, ArrApiError } from "@/lib/arr/_fetch";
import { _resetAllBreakers } from "@/lib/arr/circuit-breaker";

const realFetch = globalThis.fetch;

beforeEach(() => {
  _resetAllBreakers();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  _resetAllBreakers();
});

function mockFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  globalThis.fetch = vi.fn(impl) as typeof fetch;
}

describe("arrFetch", () => {
  it("returns parsed JSON on 2xx with application/json content-type", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ ok: true, count: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const data = await arrFetch<{ ok: boolean; count: number }>(
      "Radarr",
      "http://host",
      "/api/v3/movie",
    );
    expect(data).toEqual({ ok: true, count: 3 });
  });

  it("returns raw text when response is not JSON", async () => {
    mockFetch(async () =>
      new Response("Ok.", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const data = await arrFetch<string>("qBit", "http://host", "/api/v2/auth/login");
    expect(data).toBe("Ok.");
  });

  it("throws ArrApiError with status on 4xx", async () => {
    mockFetch(async () =>
      new Response("not found", {
        status: 404,
        headers: { "content-type": "text/plain" },
      }),
    );
    try {
      await arrFetch("Sonarr", "http://host", "/api/v3/series/999");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ArrApiError);
      const e = err as ArrApiError;
      expect(e.service).toBe("Sonarr");
      expect(e.path).toBe("/api/v3/series/999");
      expect(e.status).toBe(404);
      expect(e.isClientError).toBe(true);
      expect(e.isServerError).toBe(false);
      expect(e.isNetworkError).toBe(false);
    }
  });

  it("throws ArrApiError with status=0 on fetch network failure", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    try {
      await arrFetch("Prowlarr", "http://host", "/api/v1/health");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ArrApiError);
      const e = err as ArrApiError;
      expect(e.service).toBe("Prowlarr");
      expect(e.status).toBe(0);
      expect(e.isNetworkError).toBe(true);
      expect(e.detail).toContain("fetch failed");
    }
  });

  it("throws ArrApiError on timeout (AbortController fires)", async () => {
    mockFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          // Reject as soon as AbortController fires, mimicking real fetch
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
          // Otherwise never resolve — caller's timeout must kick in
        }),
    );
    try {
      await arrFetch("Lidarr", "http://host", "/api/v1/artist", {
        timeoutMs: 50,
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ArrApiError);
      const e = err as ArrApiError;
      expect(e.status).toBe(0);
      expect(e.isNetworkError).toBe(true);
    }
  });

  it("injects Content-Type: application/json but lets caller override", async () => {
    let captured: RequestInit | undefined;
    mockFetch(async (_input, init) => {
      captured = init;
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await arrFetch("Radarr", "http://host", "/api/v3/movie", {
      headers: { "X-Api-Key": "secret", "Content-Type": "application/xml" },
    });

    const h = captured?.headers as Record<string, string>;
    expect(h["X-Api-Key"]).toBe("secret");
    // Caller's explicit Content-Type wins over the default
    expect(h["Content-Type"]).toBe("application/xml");
  });

  it("redacts apikey/api_key/token query params out of path, detail, and message", async () => {
    // Regression test: LazyLibrarian's API is querystring-based, so its
    // key has to be in the URL to make the real request -- but it must
    // not end up in anything that gets logged or shown in the admin UI.
    mockFetch(async () =>
      new Response("upstream said apikey=leaked-body-secret failed", {
        status: 500,
      }),
    );
    try {
      await arrFetch(
        "LazyLibrarian",
        "http://host",
        "/api?cmd=getIndex&apikey=super-secret-key&id=1",
      );
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as ArrApiError;
      expect(e.path).not.toContain("super-secret-key");
      expect(e.path).toContain("apikey=***");
      expect(e.path).toContain("cmd=getIndex");
      expect(e.detail).not.toContain("leaked-body-secret");
      expect(e.message).not.toContain("super-secret-key");
      expect(e.message).not.toContain("leaked-body-secret");
    }
  });

  it("isServerError true for 5xx", async () => {
    mockFetch(async () => new Response("upstream error", { status: 502 }));
    try {
      await arrFetch("Bazarr", "http://host", "/api/subtitles");
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as ArrApiError;
      expect(e.status).toBe(502);
      expect(e.isServerError).toBe(true);
      expect(e.isClientError).toBe(false);
      expect(e.isNetworkError).toBe(false);
    }
  });
});
