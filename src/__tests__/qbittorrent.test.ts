/**
 * qBittorrent previously bypassed the shared circuit breaker entirely --
 * every caller independently paid a full login + 15s timeout against a
 * down instance, with nothing short-circuiting it. These tests confirm
 * qbFetch (used by every exported function) now participates in the same
 * breaker every other *arr integration uses.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { getBreaker, _resetAllBreakers } from "@/lib/arr/circuit-breaker";

// Set before the first (cached) dynamic import of qbittorrent.ts below --
// BASE/USER/PASS there are read once at module top-level. Deliberately NOT
// using vi.resetModules() per-test: that would make qbittorrent.ts resolve
// a *different* circuit-breaker.ts module instance than the one this file
// statically imported above, so getBreaker("qBittorrent") here would watch
// a breakers Map the code under test isn't actually using.
process.env.QBITTORRENT_URL = "http://qbit.test";
process.env.QBITTORRENT_USER = "admin";
process.env.QBITTORRENT_PASS = "pw";

const realFetch = globalThis.fetch;

beforeEach(() => {
  _resetAllBreakers();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  _resetAllBreakers();
});

describe("qBittorrent circuit breaker", () => {
  it("trips the breaker after repeated 5xx failures and then fails fast", async () => {
    globalThis.fetch = vi.fn(async () => new Response("down", { status: 503 })) as typeof fetch;

    const { health } = await import("@/lib/arr/qbittorrent");
    // FAILURE_THRESHOLD is 5; each health() call does one login attempt
    // that fails with 503, which counts toward the breaker.
    for (let i = 0; i < 5; i++) {
      expect(await health()).toBe(false);
    }

    expect(getBreaker("qBittorrent").snapshot().state).toBe("open");
  });

  it("records success on a healthy response, keeping the breaker closed", async () => {
    globalThis.fetch = vi.fn(async (_input, init) => {
      const isLogin = (init?.body as URLSearchParams | undefined)?.toString().includes("username");
      if (isLogin) {
        return new Response("Ok.", { status: 200, headers: { "set-cookie": "SID=abc123;" } });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const { health } = await import("@/lib/arr/qbittorrent");
    expect(await health()).toBe(true);
    expect(getBreaker("qBittorrent").snapshot().state).toBe("closed");
    expect(getBreaker("qBittorrent").snapshot().failures).toBe(0);
  });

  it("does not count a 404 toward the breaker (not a qBittorrent outage)", async () => {
    globalThis.fetch = vi.fn(async (_input, init) => {
      const isLogin = (init?.body as URLSearchParams | undefined)?.toString().includes("username");
      if (isLogin) {
        return new Response("Ok.", { status: 200, headers: { "set-cookie": "SID=abc123;" } });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const { getTorrentByHash } = await import("@/lib/arr/qbittorrent");
    await getTorrentByHash("deadbeef").catch(() => null);

    expect(getBreaker("qBittorrent").snapshot().failures).toBe(0);
  });
});
