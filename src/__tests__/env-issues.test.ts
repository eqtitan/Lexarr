import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { envIssues } from "@/lib/env";

const REQUIRED = {
  NEXTAUTH_SECRET: "s",
  ARR_HOST: "http://localhost",
  RADARR_API_KEY: "r",
  SONARR_API_KEY: "s",
  LIDARR_API_KEY: "l",
  TMDB_API_KEY: "t",
};

describe("envIssues", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original, ...REQUIRED };
  });
  afterAll(() => {
    process.env = original;
  });

  it("is empty when the config is usable", () => {
    expect(envIssues()).toEqual([]);
  });

  it("names a missing variable, and treats an empty one as missing", () => {
    delete process.env.RADARR_API_KEY;
    process.env.TMDB_API_KEY = "  ";
    expect(envIssues()).toEqual(
      expect.arrayContaining([
        { name: "RADARR_API_KEY", problem: "missing" },
        { name: "TMDB_API_KEY", problem: "missing" },
      ]),
    );
  });

  it("marks a malformed value invalid and never returns values", () => {
    process.env.ARR_HOST = "not-a-url";
    const issues = envIssues();
    expect(issues).toEqual([{ name: "ARR_HOST", problem: "invalid" }]);
    expect(JSON.stringify(issues)).not.toContain("not-a-url");
  });
});
