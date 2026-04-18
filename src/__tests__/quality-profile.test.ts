/**
 * Guards the 0.13.6 fix: Lexarr's fallback quality profile picker must
 * never return "Any" when a capped alternative exists. Without this
 * guard, a Request-click that bypasses DetailPanel's quality picker
 * silently added movies/series with "Any" as their profile, allowing
 * CAM, workprint, Remux-2160p, and everything in between.
 */
import { describe, it, expect } from "vitest";
import {
  pickDefaultProfile,
  RADARR_DEFAULT_PATTERNS,
  SONARR_DEFAULT_PATTERNS,
  LIDARR_DEFAULT_PATTERNS,
} from "@/lib/arr/quality-profile";

// Sample profile shapes modeled on actual Radarr + Sonarr output.
const radarrProfiles = [
  { id: 1, name: "Any" },
  { id: 2, name: "SD" },
  { id: 3, name: "HD-720p" },
  { id: 4, name: "HD-1080p" },
  { id: 5, name: "Ultra-HD" },
  { id: 6, name: "HD - 720p/1080p" },
  { id: 7, name: "HD Bluray + WEB" },
  { id: 8, name: "UHD Bluray + WEB" },
  { id: 9, name: "Remux + WEB 1080p" },
];

describe("pickDefaultProfile", () => {
  it("Radarr: prefers HD Bluray + WEB over any other", () => {
    const pick = pickDefaultProfile(radarrProfiles, RADARR_DEFAULT_PATTERNS);
    expect(pick?.name).toBe("HD Bluray + WEB");
  });

  it("falls through to WEB.*1080p when HD Bluray + WEB is absent", () => {
    const trimmed = radarrProfiles.filter((p) => p.name !== "HD Bluray + WEB");
    const pick = pickDefaultProfile(trimmed, RADARR_DEFAULT_PATTERNS);
    // "Remux + WEB 1080p" matches WEB.*1080p
    expect(pick?.name).toBe("Remux + WEB 1080p");
  });

  it("falls through to any 1080p profile when WEB.*1080p is absent", () => {
    const trimmed = radarrProfiles.filter(
      (p) => !/WEB/i.test(p.name) && p.name !== "HD Bluray + WEB",
    );
    const pick = pickDefaultProfile(trimmed, RADARR_DEFAULT_PATTERNS);
    expect(pick?.name).toContain("1080p");
  });

  it("last resort: returns first non-Any profile when no pattern matches", () => {
    const minimal = [
      { id: 1, name: "Any" },
      { id: 2, name: "SD" },
    ];
    const pick = pickDefaultProfile(minimal, RADARR_DEFAULT_PATTERNS);
    expect(pick?.name).toBe("SD");
  });

  it("only returns Any when every profile is Any (pathological)", () => {
    const pick = pickDefaultProfile(
      [{ id: 1, name: "Any" }],
      RADARR_DEFAULT_PATTERNS,
    );
    // Last-resort fallback — still returns SOMETHING rather than undefined
    expect(pick?.name).toBe("Any");
  });

  it("returns undefined for an empty profile list", () => {
    expect(
      pickDefaultProfile([], RADARR_DEFAULT_PATTERNS),
    ).toBeUndefined();
  });

  it("Sonarr: same preference order as Radarr (shared conventions)", () => {
    const pick = pickDefaultProfile(radarrProfiles, SONARR_DEFAULT_PATTERNS);
    expect(pick?.name).toBe("HD Bluray + WEB");
  });

  it("Lidarr: prefers Standard over High", () => {
    // Music profile names use different conventions — Standard and
    // High are the common TRaSH-recommended ones for Lidarr.
    const lidarrProfiles = [
      { id: 1, name: "Any" },
      { id: 2, name: "Lossless" },
      { id: 3, name: "Standard" },
      { id: 4, name: "High" },
    ];
    const pick = pickDefaultProfile(lidarrProfiles, LIDARR_DEFAULT_PATTERNS);
    expect(pick?.name).toBe("Standard");
  });

  it("Lidarr: falls to High when Standard absent", () => {
    const pick = pickDefaultProfile(
      [
        { id: 1, name: "Any" },
        { id: 2, name: "High" },
      ],
      LIDARR_DEFAULT_PATTERNS,
    );
    expect(pick?.name).toBe("High");
  });

  it("never returns Any when a non-Any profile exists (core invariant)", () => {
    // Vary the profile list — whatever the mix, "Any" must never win
    // if ANY other option is present.
    const variations = [
      [{ id: 1, name: "Any" }, { id: 2, name: "X" }],
      [{ id: 1, name: "Any" }, { id: 2, name: "Weird Custom" }],
      [{ id: 1, name: "any" }, { id: 2, name: "Custom" }], // lowercase
    ];
    for (const list of variations) {
      const pick = pickDefaultProfile(list, RADARR_DEFAULT_PATTERNS);
      expect(pick?.name).not.toMatch(/^any$/i);
    }
  });
});
