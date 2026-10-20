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

  it("refreshing an existing key at capacity does not evict an unrelated entry", async () => {
    // healthCache has maxEntries=20 -- small enough to fill deterministically.
    const { healthCache } = await import("@/lib/cache");
    healthCache.clear();
    for (let i = 0; i < 20; i++) healthCache.set(`svc-${i}`, i);
    expect(healthCache.size).toBe(20);

    // Overwriting an already-present key shouldn't evict anything -- in
    // particular not the oldest key ("svc-0"), which a size>=maxEntries
    // check with no has()-guard would wrongly evict on every refresh.
    healthCache.set("svc-10", "refreshed");
    expect(healthCache.size).toBe(20);
    expect(healthCache.get("svc-0")).toBe(0);
    expect(healthCache.get("svc-10")).toBe("refreshed");

    // A genuinely new key at capacity still evicts the oldest entry.
    healthCache.set("svc-new", "new");
    expect(healthCache.size).toBe(20);
    expect(healthCache.get("svc-0")).toBeUndefined();
    expect(healthCache.get("svc-new")).toBe("new");
  });
});
