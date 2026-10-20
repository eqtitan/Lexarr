/**
 * Jellyfin's health() used to be a bare fetch with no timeout -- the one
 * integration that never got migrated onto the shared arrFetch helper, so
 * a slow/hung Jellyfin (e.g. mid-library-scan) could hang indefinitely.
 * These tests confirm it now goes through arrFetch (timeout + breaker).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { health } from "@/lib/arr/jellyfin";
import { ArrApiError } from "@/lib/arr/_fetch";
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

describe("jellyfin.health", () => {
  it("returns the health text on success", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("Healthy", { status: 200, headers: { "content-type": "text/plain" } }),
    ) as typeof fetch;

    await expect(health()).resolves.toBe("Healthy");
  });

  it("throws ArrApiError (not a bare Error) on a non-2xx response -- proves it now goes through arrFetch", async () => {
    globalThis.fetch = vi.fn(async () => new Response("down", { status: 503 })) as typeof fetch;

    await expect(health()).rejects.toBeInstanceOf(ArrApiError);
  });
});
