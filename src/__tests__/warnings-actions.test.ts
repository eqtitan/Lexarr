/**
 * Tests the 0.15.0 Warnings-actionable panel's title → action routing.
 *
 * Imports the real `actionForWarning` from WarningsPanel.tsx (exported
 * for this purpose) instead of a hand-maintained duplicate -- the old
 * duplicate had already drifted out of sync with the real function
 * (missing the "Can't verify" kind added in a later change), which is
 * exactly the kind of silent divergence pipeline-rules.ts exists to
 * prevent. The four pipeline-rules.ts-backed warnings route by `kind`
 * now, not by title; the rest (pending approval, "Not in queue", queue
 * items, service health) still route by title, since they aren't part
 * of that table.
 */
import { describe, it, expect } from "vitest";
import { actionForWarning } from "@/components/dashboard/WarningsPanel";

describe("warning action routing", () => {
  it("pending warnings → approve-deny", () => {
    expect(actionForWarning({ severity: "warning", title: "Pending 3h: The Bride" })).toBe(
      "approve-deny",
    );
    expect(actionForWarning({ severity: "warning", title: "Pending 12h: Some Movie" })).toBe(
      "approve-deny",
    );
  });

  it("pipeline-rules.ts warnings (kind set) → retry", () => {
    expect(
      actionForWarning({ severity: "critical", title: "Failed to route: Ted", kind: "never-dispatched" }),
    ).toBe("retry");
    expect(
      actionForWarning({
        severity: "warning",
        title: "Stuck download: Something",
        kind: "no-sources-found",
      }),
    ).toBe("retry");
    expect(
      actionForWarning({ severity: "warning", title: "Stalled: Movie Name", kind: "stalled-too-long" }),
    ).toBe("retry");
    expect(
      actionForWarning({ severity: "critical", title: "Can't verify: Avengers", kind: "check-failing" }),
    ).toBe("retry");
  });

  it("'Not in queue' → retry by title (no pipeline-rules.ts kind -- not part of that table)", () => {
    expect(
      actionForWarning({ severity: "warning", title: "Not in queue: Masters of the Universe" }),
    ).toBe("retry");
  });

  it("queue-item warnings with queueId + queueSource → blocklist-queue", () => {
    expect(
      actionForWarning({
        severity: "critical",
        title: "Failed download: Intervention S15E02",
        queueId: 42,
        queueSource: "sonarr",
      }),
    ).toBe("blocklist-queue");
    expect(
      actionForWarning({
        severity: "warning",
        title: "Stalled download: Some Show",
        queueId: 100,
        queueSource: "sonarr",
      }),
    ).toBe("blocklist-queue");
    expect(
      actionForWarning({
        severity: "critical",
        title: "Failed download: The Bride",
        queueId: 7,
        queueSource: "radarr",
      }),
    ).toBe("blocklist-queue");
  });

  it("queue-item warnings WITHOUT queueId fall through to none", () => {
    // Defensive: if the warning payload somehow lacks queue info, the
    // button is hidden rather than firing an undefined API call.
    expect(actionForWarning({ severity: "critical", title: "Failed download: Something" })).toBe(
      "none",
    );
    expect(
      actionForWarning({
        severity: "critical",
        title: "Failed download: Something",
        queueId: 5,
        // no queueSource
      }),
    ).toBe("none");
  });

  it("service-health warnings → none (user links out to Diagnose modal)", () => {
    expect(actionForWarning({ severity: "critical", title: "Lidarr is unreachable" })).toBe("none");
    expect(actionForWarning({ severity: "critical", title: "Radarr is unreachable" })).toBe("none");
  });

  it("indexer + informational warnings → none", () => {
    expect(
      actionForWarning({ severity: "warning", title: "High failure rate: Prowlarr-NZBFinder" }),
    ).toBe("none");
    expect(
      actionForWarning({ severity: "info", title: "Large download queue (76 items)" }),
    ).toBe("none");
  });

  it("unknown title shapes with no kind fall back to none", () => {
    expect(actionForWarning({ severity: "info", title: "Some future warning type" })).toBe("none");
    expect(actionForWarning({ severity: "info", title: "" })).toBe("none");
  });

  it("exact-prefix sensitive — 'Pending' without trailing space shouldn't match", () => {
    expect(actionForWarning({ severity: "warning", title: "PendingApproval: Thing" })).toBe("none");
  });
});
