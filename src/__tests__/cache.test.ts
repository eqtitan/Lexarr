import { describe, it, expect, vi, beforeEach } from "vitest";

// Test the TTLCache class directly
describe("TTLCache", () => {
  let _TTLCache: unknown;

  beforeEach(async () => {
    vi.useFakeTimers();
    const mod = await import("@/lib/cache");
    _TTLCache = (mod as Record<string, unknown>).TTLCache || (mod as Record<string, unknown>).default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves values", async () => {
    const { searchCache } = await import("@/lib/cache");
    searchCache.set("test-key", [{ id: "1", title: "Test" }]);
    expect(searchCache.get("test-key")).toEqual([
      { id: "1", title: "Test" },
    ]);
  });

  it("returns undefined for missing keys", async () => {
    const { searchCache } = await import("@/lib/cache");
    expect(searchCache.get("nonexistent")).toBeUndefined();
  });

  it("expires entries after TTL", async () => {
    const { searchCache } = await import("@/lib/cache");
    searchCache.set("expiring", [{ id: "1", title: "Test" }]);
    expect(searchCache.get("expiring")).toBeDefined();

    // Advance past the 5-minute TTL
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(searchCache.get("expiring")).toBeUndefined();
  });
});
