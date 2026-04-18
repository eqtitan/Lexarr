/**
 * Tests the 0.15.0 Warnings-actionable panel's title → action routing.
 *
 * The mapping is a judgment call (we match on title prefix since
 * warning records don't carry an explicit action type). Tests pin the
 * mapping so changes to warning titles in src/lib/dashboard/warnings.ts
 * don't silently break the action buttons on the admin dashboard.
 */
import { describe, it, expect } from "vitest";

// Duplicate the mapping function from WarningsPanel for testability.
// If you change this, also change the one in
// src/components/dashboard/WarningsPanel.tsx. The function now takes
// the full warning (not just title) because queue-item warnings need
// queueId + queueSource to resolve to an action.
type ActionKind = "retry" | "approve-deny" | "blocklist-queue" | "none";
interface TestWarning {
  title: string;
  requestId?: string;
  queueId?: number;
  queueSource?: "radarr" | "sonarr" | "lidarr";
}

function actionForWarning(w: TestWarning): ActionKind {
  const t = w.title;
  if (t.startsWith("Pending ")) return "approve-deny";
  if (
    t.startsWith("Failed to route") ||
    t.startsWith("Not in queue") ||
    t.startsWith("Orphaned download") ||
    t.startsWith("Stalled: ")
  ) {
    return "retry";
  }
  if (
    (t.startsWith("Failed download") || t.startsWith("Stalled download")) &&
    w.queueId !== undefined &&
    w.queueSource
  ) {
    return "blocklist-queue";
  }
  return "none";
}

describe("warning action routing", () => {
  it("pending warnings → approve-deny", () => {
    expect(actionForWarning({ title: "Pending 3h: The Bride" })).toBe(
      "approve-deny",
    );
    expect(actionForWarning({ title: "Pending 12h: Some Movie" })).toBe(
      "approve-deny",
    );
  });

  it("request-state warnings → retry", () => {
    expect(actionForWarning({ title: "Failed to route: Ted" })).toBe("retry");
    expect(
      actionForWarning({ title: "Not in queue: Masters of the Universe" }),
    ).toBe("retry");
    expect(actionForWarning({ title: "Orphaned download: Something" })).toBe(
      "retry",
    );
    expect(actionForWarning({ title: "Stalled: Movie Name" })).toBe("retry");
  });

  it("queue-item warnings with queueId + queueSource → blocklist-queue", () => {
    expect(
      actionForWarning({
        title: "Failed download: Intervention S15E02",
        queueId: 42,
        queueSource: "sonarr",
      }),
    ).toBe("blocklist-queue");
    expect(
      actionForWarning({
        title: "Stalled download: Some Show",
        queueId: 100,
        queueSource: "sonarr",
      }),
    ).toBe("blocklist-queue");
    expect(
      actionForWarning({
        title: "Failed download: The Bride",
        queueId: 7,
        queueSource: "radarr",
      }),
    ).toBe("blocklist-queue");
  });

  it("queue-item warnings WITHOUT queueId fall through to none", () => {
    // Defensive: if the warning payload somehow lacks queue info, the
    // button is hidden rather than firing an undefined API call.
    expect(
      actionForWarning({ title: "Failed download: Something" }),
    ).toBe("none");
    expect(
      actionForWarning({
        title: "Failed download: Something",
        queueId: 5,
        // no queueSource
      }),
    ).toBe("none");
  });

  it("service-health warnings → none (user links out to Diagnose modal)", () => {
    expect(actionForWarning({ title: "Lidarr is unreachable" })).toBe("none");
    expect(actionForWarning({ title: "Radarr is unreachable" })).toBe("none");
  });

  it("indexer + informational warnings → none", () => {
    expect(
      actionForWarning({ title: "High failure rate: Prowlarr-NZBFinder" }),
    ).toBe("none");
    expect(
      actionForWarning({ title: "Large download queue (76 items)" }),
    ).toBe("none");
  });

  it("unknown title shapes fall back to none", () => {
    expect(actionForWarning({ title: "Some future warning type" })).toBe(
      "none",
    );
    expect(actionForWarning({ title: "" })).toBe("none");
  });

  it("exact-prefix sensitive — 'Pending' without trailing space shouldn't match", () => {
    expect(actionForWarning({ title: "PendingApproval: Thing" })).toBe("none");
  });
});
