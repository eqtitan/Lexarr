import { describe, it, expect, vi, beforeEach } from "vitest";

const arrFetch = vi.fn();
vi.mock("@/lib/arr/_fetch", () => ({
  arrFetch: (...a: unknown[]) => arrFetch(...a),
  ArrApiError: class extends Error {},
  ARR_TIMEOUT_MS: 15_000,
}));
vi.mock("@/lib/env", () => ({ env: () => ({ ARR_HOST: "http://ll", LAZYLIBRARIAN_API_KEY: "k" }) }));

import { getBookAttempts, _resetHistoryCache } from "@/lib/arr/lazylibrarian";

const SECRET = "https://prowlarr/9/api?apikey=SECRET";
const rows = [
  { BookID: "OL1W", AuxInfo: "eBook", Status: "Failed", NZBurl: SECRET },
  { BookID: "OL1W", AuxInfo: "eBook", Status: "Failed", NZBurl: SECRET },
  { BookID: "OL1W", AuxInfo: "eBook", Status: "Snatched", NZBurl: SECRET },
  { BookID: "OL1W", AuxInfo: "AudioBook", Status: "Failed", NZBurl: SECRET },
  { BookID: "OL2W", AuxInfo: "eBook", Status: "Failed", NZBurl: SECRET },
];

beforeEach(() => {
  vi.clearAllMocks();
  _resetHistoryCache();
  arrFetch.mockResolvedValue(rows);
});

describe("lazylibrarian.getBookAttempts", () => {
  it("counts this book's attempts for one format", async () => {
    expect(await getBookAttempts("OL1W", "eBook")).toEqual({ tried: 3, failed: 2 });
    expect(await getBookAttempts("OL1W", "AudioBook")).toEqual({ tried: 1, failed: 1 });
    expect(await getBookAttempts("OL9W")).toEqual({ tried: 0, failed: 0 });
  });

  it("fetches history once per minute, not once per book", async () => {
    await getBookAttempts("OL1W");
    await getBookAttempts("OL2W");
    expect(arrFetch).toHaveBeenCalledTimes(1);
    expect(String(arrFetch.mock.calls[0][2])).toContain("cmd=getHistory");
  });

  it("returns only counts, never download URLs", async () => {
    const r = await getBookAttempts("OL1W");
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(Object.keys(r).sort()).toEqual(["failed", "tried"]);
  });

  it("treats a non-array reply as no history", async () => {
    arrFetch.mockResolvedValue("Error");
    expect(await getBookAttempts("OL1W")).toEqual({ tried: 0, failed: 0 });
  });
});
