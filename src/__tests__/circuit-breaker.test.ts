import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getBreaker,
  snapshotAllBreakers,
  _resetAllBreakers,
} from "@/lib/arr/circuit-breaker";
import { ArrApiError, arrFetch } from "@/lib/arr/_fetch";

const realFetch = globalThis.fetch;

beforeEach(() => {
  _resetAllBreakers();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
  _resetAllBreakers();
});

function mockFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  globalThis.fetch = vi.fn(impl) as typeof fetch;
}

describe("circuit breaker", () => {
  it("starts in the closed state", () => {
    const b = getBreaker("Radarr");
    expect(b.snapshot().state).toBe("closed");
    expect(b.snapshot().failures).toBe(0);
  });

  it("stays closed when 4xx errors occur (not a service-health signal)", async () => {
    mockFetch(async () => new Response("not found", { status: 404 }));
    for (let i = 0; i < 10; i++) {
      await arrFetch("Radarr", "http://host", "/api/v3/movie/999").catch(
        () => undefined,
      );
    }
    const snap = getBreaker("Radarr").snapshot();
    expect(snap.state).toBe("closed");
    expect(snap.failures).toBe(0);
  });

  it("trips open after 5 consecutive 5xx errors", async () => {
    mockFetch(async () => new Response("upstream dead", { status: 503 }));
    for (let i = 0; i < 5; i++) {
      await arrFetch("Sonarr", "http://host", "/api/v3/series").catch(
        () => undefined,
      );
    }
    expect(getBreaker("Sonarr").snapshot().state).toBe("open");
  });

  it("fails fast when open — does NOT call fetch again", async () => {
    const fetchSpy = vi.fn(
      async () => new Response("", { status: 503 }),
    ) as typeof fetch;
    globalThis.fetch = fetchSpy;

    for (let i = 0; i < 5; i++) {
      await arrFetch("Lidarr", "http://host", "/api/v1/artist").catch(
        () => undefined,
      );
    }
    expect(fetchSpy).toHaveBeenCalledTimes(5);

    // Next call should short-circuit — no new fetch
    await arrFetch("Lidarr", "http://host", "/api/v1/artist").catch(
      () => undefined,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(5);

    // And the thrown error should be the synthetic "breaker open" one
    try {
      await arrFetch("Lidarr", "http://host", "/api/v1/artist");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ArrApiError);
      expect((err as ArrApiError).detail).toMatch(/Circuit breaker open/);
    }
  });

  it("transitions to half_open after cooldown and closes on probe success", async () => {
    // Trip it with 5 failures
    mockFetch(async () => new Response("", { status: 500 }));
    for (let i = 0; i < 5; i++) {
      await arrFetch("Bazarr", "http://host", "/api/ping").catch(
        () => undefined,
      );
    }
    expect(getBreaker("Bazarr").snapshot().state).toBe("open");

    // Advance virtual time past the 30s cooldown
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31_000);

    // Next call should be allowed as a probe — mock a success this time
    mockFetch(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await arrFetch("Bazarr", "http://host", "/api/ping");
    expect(result).toEqual({});
    expect(getBreaker("Bazarr").snapshot().state).toBe("closed");
    vi.useRealTimers();
  });

  it("re-opens when the probe request also fails", async () => {
    mockFetch(async () => new Response("", { status: 500 }));
    for (let i = 0; i < 5; i++) {
      await arrFetch("Prowlarr", "http://host", "/health").catch(
        () => undefined,
      );
    }
    expect(getBreaker("Prowlarr").snapshot().state).toBe("open");

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31_000);

    // Probe also fails → should re-open
    await arrFetch("Prowlarr", "http://host", "/health").catch(
      () => undefined,
    );
    expect(getBreaker("Prowlarr").snapshot().state).toBe("open");
    vi.useRealTimers();
  });

  it("network failures count toward the threshold", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    for (let i = 0; i < 5; i++) {
      await arrFetch("qBit", "http://host", "/api/v2/app/version").catch(
        () => undefined,
      );
    }
    expect(getBreaker("qBit").snapshot().state).toBe("open");
  });

  it("a single success resets the failure counter", async () => {
    let callCount = 0;
    mockFetch(async () => {
      callCount++;
      if (callCount <= 3) return new Response("", { status: 500 });
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    for (let i = 0; i < 3; i++) {
      await arrFetch("NZBGet", "http://host", "/jsonrpc").catch(
        () => undefined,
      );
    }
    expect(getBreaker("NZBGet").snapshot().failures).toBe(3);

    // 4th call succeeds → counter should reset
    await arrFetch("NZBGet", "http://host", "/jsonrpc");
    expect(getBreaker("NZBGet").snapshot().failures).toBe(0);
    expect(getBreaker("NZBGet").snapshot().state).toBe("closed");
  });

  it("snapshotAllBreakers returns a sorted snapshot across services", async () => {
    // Use distinct names for this test so we don't inherit breakers created
    // by earlier tests in the file (they share the module-scoped registry).
    getBreaker("SvcC");
    getBreaker("SvcA");
    getBreaker("SvcB");
    const all = snapshotAllBreakers();
    const localNames = all
      .map((s) => s.service)
      .filter((n) => n.startsWith("Svc"));
    expect(localNames).toEqual(["SvcA", "SvcB", "SvcC"]);
  });
});
