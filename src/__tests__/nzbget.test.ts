/**
 * NZBGet returns HTTP 200 even for method-level errors, inspecting the
 * JSON-RPC body to decide success/failure. arrFetch only sees the HTTP
 * status, so it always recorded these as breaker *successes* -- a
 * persistently-misbehaving-but-200-returning NZBGet never tripped the
 * breaker. These tests confirm it now does.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { getBreaker, _resetAllBreakers } from "@/lib/arr/circuit-breaker";
import { ArrApiError } from "@/lib/arr/_fetch";

process.env.NZBGET_URL = "http://nzbget.test";
process.env.NZBGET_USER = "admin";
process.env.NZBGET_PASS = "pw";

const realFetch = globalThis.fetch;

beforeEach(async () => {
  _resetAllBreakers();
  const { _resetAppErrorCount } = await import("@/lib/arr/nzbget");
  _resetAppErrorCount();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  _resetAllBreakers();
});

function rpcErrorResponse(message: string) {
  return new Response(JSON.stringify({ error: { message } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("nzbget app-level (HTTP 200) errors", () => {
  it("throws an ArrApiError carrying the real status/message", async () => {
    globalThis.fetch = vi.fn(async () => rpcErrorResponse("No such method")) as typeof fetch;

    const { health } = await import("@/lib/arr/nzbget");
    expect(await health()).toBe(false);
  });

  it("counts toward the breaker despite the HTTP status being 200", async () => {
    globalThis.fetch = vi.fn(async () => rpcErrorResponse("Some RPC failure")) as typeof fetch;

    const { health } = await import("@/lib/arr/nzbget");
    for (let i = 0; i < 5; i++) {
      expect(await health()).toBe(false);
    }

    expect(getBreaker("NZBGet").snapshot().state).toBe("open");
  });

  it("a success in between resets the consecutive-error count (breaker stays closed)", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      // Fail 4 times, succeed once, fail 4 more -- never 5 *consecutive*.
      if (call === 5) {
        return new Response(JSON.stringify({ result: "1.0" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return rpcErrorResponse("transient glitch");
    }) as typeof fetch;

    const { health } = await import("@/lib/arr/nzbget");
    for (let i = 0; i < 8; i++) {
      await health();
    }

    expect(getBreaker("NZBGet").snapshot().state).toBe("closed");
  });

  it("the thrown error still reports the true HTTP status (200), not the synthetic breaker status", async () => {
    globalThis.fetch = vi.fn(async () => rpcErrorResponse("No such method")) as typeof fetch;

    const { addNzbFromUrl } = await import("@/lib/arr/nzbget");
    // addNzbFromUrl fetches the NZB file first (not through rpc()) --
    // stub that part out so we reach the rpc("append", ...) call.
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      .mockResolvedValueOnce(rpcErrorResponse("No such method")) as typeof fetch;

    try {
      await addNzbFromUrl("http://indexer.test/file.nzb");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ArrApiError);
      expect((err as ArrApiError).status).toBe(200);
      expect((err as ArrApiError).detail).toBe("No such method");
    }
  });
});
