/**
 * pipeline-rules.ts is the shared source of truth status-checker.ts
 * (escalation) and warnings.ts (dashboard) both read from -- this pins
 * its shape and the isUnreleased() string-matching it centralizes.
 */
import { describe, it, expect } from "vitest";
import { PIPELINE_RULES, isUnreleased } from "@/lib/pipeline-rules";

describe("PIPELINE_RULES", () => {
  it("every rule's dashboard warning fires before (or with) its auto-escalation tier", () => {
    for (const rule of Object.values(PIPELINE_RULES)) {
      expect(rule.warnThresholdMs).toBeLessThanOrEqual(rule.escalateThresholdMs);
    }
  });

  it("has exactly the four kinds status-checker.ts's tiers pair with", () => {
    expect(Object.keys(PIPELINE_RULES).sort()).toEqual(
      ["check-failing", "never-dispatched", "no-sources-found", "stalled-too-long"].sort(),
    );
  });
});

describe("isUnreleased", () => {
  it("matches both lastError prefixes status-checker.ts's unreleased-movie block writes", () => {
    expect(isUnreleased("Awaiting release: 2026-12-18")).toBe(true);
    expect(isUnreleased("Not yet released (no release date announced)")).toBe(true);
  });

  it("does not match null, empty, or unrelated lastError", () => {
    expect(isUnreleased(null)).toBe(false);
    expect(isUnreleased(undefined)).toBe(false);
    expect(isUnreleased("")).toBe(false);
    expect(isUnreleased("Radarr unreachable")).toBe(false);
  });
});
