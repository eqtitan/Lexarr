import { describe, it, expect, vi, beforeEach } from "vitest";

const arrFetch = vi.fn();
vi.mock("@/lib/arr/_fetch", () => ({
  arrFetch: (...a: unknown[]) => arrFetch(...a),
  ArrApiError: class extends Error {},
  ARR_TIMEOUT_MS: 15_000,
}));
vi.mock("@/lib/env", () => ({
  env: () => ({ ARR_HOST: "http://h", LAZYLIBRARIAN_API_KEY: "k", PROWLARR_API_KEY: "k" }),
}));

import { getSourceSettings } from "@/lib/arr/lazylibrarian";
import { getAppSyncLevel } from "@/lib/arr/prowlarr";

const KEY = "SECRET-INDEXER-KEY";

beforeEach(() => vi.clearAllMocks());

describe("lazylibrarian.getSourceSettings", () => {
  it("keeps name, kind, enabled, priority and seeders only", async () => {
    arrFetch.mockImplementation(async (_s: string, _b: string, path: string) =>
      path.includes("cmd=listProviders")
        ? JSON.stringify({
            newznab: [{ NAME: "Newznab_1", DISPNAME: "altHUB", ENABLED: "1", HOST: "http://prowlarr/9/api", API: KEY, DLPRIORITY: "90" }],
            torznab: [{ NAME: "Torznab_1", DISPNAME: "TPB", ENABLED: "1", API: KEY, DLPRIORITY: "10", SEEDERS: "5" }],
            gen: [{ NAME: "GEN_0", DISPNAME: "Libgen", ENABLED: "0", DLPRIORITY: "80" }],
          })
        : "[20]",
    );
    const s = await getSourceSettings();
    expect(s).toEqual({
      priorityWeight: 20,
      sources: [
        { name: "altHUB", kind: "usenet", enabled: true, priority: 90, seeders: 0 },
        { name: "TPB", kind: "torrent", enabled: true, priority: 10, seeders: 5 },
        { name: "Libgen", kind: "direct", enabled: false, priority: 80, seeders: 0 },
      ],
    });
    expect(JSON.stringify(s)).not.toContain(KEY);
    expect(JSON.stringify(s)).not.toContain("prowlarr");
  });
});

describe("prowlarr.getAppSyncLevel", () => {
  it("returns only the sync level", async () => {
    arrFetch.mockResolvedValue([
      { name: "Radarr", syncLevel: "fullSync", fields: [{ name: "apiKey", value: KEY }] },
      { name: "LazyLibrarian", syncLevel: "addOnly", fields: [{ name: "apiKey", value: KEY }] },
    ]);
    expect(await getAppSyncLevel("LazyLibrarian")).toBe("addOnly");
    expect(await getAppSyncLevel("Readarr")).toBeNull();
  });
});
