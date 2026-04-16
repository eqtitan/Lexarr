import { describe, it, expect } from "vitest";

// Mirrors the Prowlarr-based aggregation in src/lib/dashboard/analytics.ts.
// Failure rate counts failed queries (direct + RSS), not failed grabs.

interface RawIndexer {
  indexerName?: string;
  name?: string;
  numberOfQueries?: number;
  numberOfRssQueries?: number;
  numberOfGrabs?: number;
  numberOfFailedQueries?: number;
  numberOfFailedRssQueries?: number;
}

function aggregate(raw: RawIndexer[]) {
  const out = raw.map((idx) => {
    const queries =
      (idx.numberOfQueries || 0) + (idx.numberOfRssQueries || 0);
    const grabs = idx.numberOfGrabs || 0;
    const failures =
      (idx.numberOfFailedQueries || 0) +
      (idx.numberOfFailedRssQueries || 0);
    return {
      name: idx.indexerName || idx.name || "Unknown",
      queries,
      grabs,
      failures,
      failureRate: queries > 0 ? (failures / queries) * 100 : 0,
      sources: ["prowlarr"],
    };
  });
  out.sort((a, b) => b.grabs - a.grabs);
  return out;
}

describe("indexer aggregation (Prowlarr stats)", () => {
  it("sums direct + RSS queries into a single total", () => {
    const out = aggregate([
      { indexerName: "NZBgeek", numberOfQueries: 100, numberOfRssQueries: 900 },
    ]);
    expect(out[0].queries).toBe(1000);
  });

  it("sums failed-query and failed-rss-query into failures", () => {
    const out = aggregate([
      {
        indexerName: "1337x",
        numberOfQueries: 800,
        numberOfRssQueries: 200,
        numberOfFailedQueries: 30,
        numberOfFailedRssQueries: 5,
      },
    ]);
    expect(out[0].failures).toBe(35);
    expect(out[0].failureRate).toBeCloseTo(3.5);
  });

  it("guards against divide-by-zero when queries = 0", () => {
    const out = aggregate([
      { indexerName: "Dormant", numberOfQueries: 0, numberOfRssQueries: 0 },
    ]);
    expect(out[0].failureRate).toBe(0);
  });

  it("sorts indexers by grabs descending", () => {
    const out = aggregate([
      { indexerName: "Low", numberOfGrabs: 5 },
      { indexerName: "High", numberOfGrabs: 500 },
      { indexerName: "Mid", numberOfGrabs: 50 },
    ]);
    expect(out.map((i) => i.name)).toEqual(["High", "Mid", "Low"]);
  });

  it("falls back to 'Unknown' when indexerName and name are absent", () => {
    const out = aggregate([{ numberOfGrabs: 1 }]);
    expect(out[0].name).toBe("Unknown");
  });

  it("tags every indexer with prowlarr as the source", () => {
    const out = aggregate([{ indexerName: "Foo" }, { indexerName: "Bar" }]);
    for (const i of out) expect(i.sources).toEqual(["prowlarr"]);
  });
});
