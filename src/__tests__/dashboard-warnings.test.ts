/**
 * generateWarnings() is a pure function of its input -- no DB, no mocks
 * needed. Covers the "Not in queue" rule's unreleased-title exclusion:
 * status-checker.ts already correctly parks a not-yet-released movie back
 * at "approved" with a specific lastError, and that must not be flagged
 * as a stuck request (it isn't -- it's just waiting).
 */
import { describe, it, expect } from "vitest";
import { generateWarnings } from "@/lib/dashboard/warnings";
import type { PipelineRequestDTO } from "@/types/dashboard";

function makeActive(overrides: Partial<PipelineRequestDTO> = {}): PipelineRequestDTO {
  const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  return {
    id: "r1",
    title: "Avengers: Doomsday",
    year: "2026",
    mediaType: "movie",
    status: "approved",
    posterPath: null,
    arrId: 42,
    createdAt: fortyMinAgo,
    approvedAt: fortyMinAgo,
    availableAt: null,
    user: { name: "eqtitan", avatar: null },
    events: [],
    lastError: null,
    queueItem: null,
    ...overrides,
  };
}

const emptyInput = { queue: [], pending: [], services: [], indexers: [] };

describe("generateWarnings -- 'Not in queue' rule", () => {
  it("does not flag an approved request parked with an 'Awaiting release:' lastError", () => {
    const req = makeActive({ lastError: "Awaiting release: 2026-12-18" });
    const warnings = generateWarnings({ ...emptyInput, active: [req] });
    expect(warnings.find((w) => w.title.startsWith("Not in queue"))).toBeUndefined();
  });

  it("does not flag an approved request parked with a 'Not yet released' lastError", () => {
    const req = makeActive({ lastError: "Not yet released (no release date announced)" });
    const warnings = generateWarnings({ ...emptyInput, active: [req] });
    expect(warnings.find((w) => w.title.startsWith("Not in queue"))).toBeUndefined();
  });

  it("still flags a genuinely stuck approved request with no lastError", () => {
    const req = makeActive({ lastError: null });
    const warnings = generateWarnings({ ...emptyInput, active: [req] });
    expect(warnings).toContainEqual(
      expect.objectContaining({ title: "Not in queue: Avengers: Doomsday" }),
    );
  });

  it("still flags a genuinely stuck approved request with an unrelated lastError", () => {
    const req = makeActive({ lastError: "Radarr unreachable" });
    const warnings = generateWarnings({ ...emptyInput, active: [req] });
    expect(warnings).toContainEqual(
      expect.objectContaining({ title: "Not in queue: Avengers: Doomsday" }),
    );
  });

  it("does not flag an unreleased request before the 30-minute floor either (no false positive either way)", () => {
    const req = makeActive({
      lastError: "Awaiting release: 2026-12-18",
      approvedAt: new Date().toISOString(),
    });
    const warnings = generateWarnings({ ...emptyInput, active: [req] });
    expect(warnings.find((w) => w.title.startsWith("Not in queue"))).toBeUndefined();
  });
});

describe("generateWarnings -- 'Can't verify' rule (checkFailingSince)", () => {
  // The companion dashboard signal for status-checker.ts's Tier D: a
  // request whose status-check has been throwing (arrId set, so Tier A
  // doesn't see it) needs to show up here well before Tier D's 2h
  // auto-fail, not just silently reaccumulate the same lastError forever.
  it("flags a request whose checkFailingSince is 30+ minutes old, tagged with its pipeline-rules.ts kind", () => {
    const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const req = makeActive({ checkFailingSince: fortyMinAgo, lastError: "Check failed: network fetch failed" });
    const warnings = generateWarnings({ ...emptyInput, active: [req] });
    expect(warnings).toContainEqual(
      expect.objectContaining({
        severity: "critical",
        kind: "check-failing",
        title: "Can't verify: Avengers: Doomsday",
        detail: "Check failed: network fetch failed",
      }),
    );
  });

  it("does not flag a request whose checkFailingSince is under 30 minutes old", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const req = makeActive({ checkFailingSince: fiveMinAgo });
    const warnings = generateWarnings({ ...emptyInput, active: [req] });
    expect(warnings.find((w) => w.title.startsWith("Can't verify"))).toBeUndefined();
  });

  it("does not flag a request with no checkFailingSince (checks are succeeding)", () => {
    const req = makeActive({ checkFailingSince: null });
    const warnings = generateWarnings({ ...emptyInput, active: [req] });
    expect(warnings.find((w) => w.title.startsWith("Can't verify"))).toBeUndefined();
  });
});

describe("generateWarnings -- 'Stuck download' rule (renamed from 'Orphaned download')", () => {
  // orphans.ts has its own, unrelated "orphan" concept (a disk/queue item
  // with no matching Lexarr request -- the opposite direction of
  // mismatch). This warning used to share the same word for "a tracked
  // request with no matching queue item," which is confusing on the same
  // dashboard. Pin the new title so nothing regresses back to the old one.
  it("flags a downloading request with no queue item, approved 2h+ ago, as 'Stuck download'", () => {
    const twoHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const req = makeActive({ status: "downloading", approvedAt: twoHoursAgo, queueItem: null });
    const warnings = generateWarnings({ ...emptyInput, active: [req] });
    expect(warnings).toContainEqual(
      expect.objectContaining({ kind: "no-sources-found", title: "Stuck download: Avengers: Doomsday" }),
    );
    expect(warnings.some((w) => w.title.startsWith("Orphaned download"))).toBe(false);
  });
});

describe("generateWarnings -- 'Failed to route' and 'Stalled' rules carry their pipeline-rules.ts kind", () => {
  it("tags 'Failed to route' with kind: never-dispatched", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const req = makeActive({ status: "approved", arrId: null, approvedAt: twoHoursAgo });
    const warnings = generateWarnings({ ...emptyInput, active: [req] });
    expect(warnings).toContainEqual(
      expect.objectContaining({ kind: "never-dispatched", title: "Failed to route: Avengers: Doomsday" }),
    );
  });

  it("tags 'Stalled' with kind: stalled-too-long", () => {
    const req = makeActive({ status: "stalled", lastError: "No releases found after 14h" });
    const warnings = generateWarnings({ ...emptyInput, active: [req] });
    expect(warnings).toContainEqual(
      expect.objectContaining({ kind: "stalled-too-long", title: "Stalled: Avengers: Doomsday" }),
    );
  });
});
