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
// src/components/dashboard/WarningsPanel.tsx.
type ActionKind = "retry" | "approve-deny" | "blocklist-queue" | "none";

function actionForWarning(title: string): ActionKind {
  if (title.startsWith("Pending ")) return "approve-deny";
  if (
    title.startsWith("Failed to route") ||
    title.startsWith("Not in queue") ||
    title.startsWith("Orphaned download") ||
    title.startsWith("Stalled: ")
  ) {
    return "retry";
  }
  if (title.startsWith("Failed download") || title.startsWith("Stalled download")) {
    return "none";
  }
  return "none";
}

describe("warning action routing", () => {
  it("pending warnings → approve-deny", () => {
    expect(actionForWarning("Pending 3h: The Bride")).toBe("approve-deny");
    expect(actionForWarning("Pending 12h: Some Movie")).toBe("approve-deny");
  });

  it("request-state warnings with a requestId → retry", () => {
    expect(actionForWarning("Failed to route: Ted")).toBe("retry");
    expect(actionForWarning("Not in queue: Masters of the Universe")).toBe(
      "retry",
    );
    expect(actionForWarning("Orphaned download: Something")).toBe("retry");
    expect(actionForWarning("Stalled: Movie Name")).toBe("retry");
  });

  it("queue-item warnings → none (queue id not yet threaded through)", () => {
    // These are tracked as known limitation — requires adding queueId to
    // DashboardWarning payload.
    expect(actionForWarning("Failed download: Intervention S15E02")).toBe(
      "none",
    );
    expect(actionForWarning("Stalled download: Some Show")).toBe("none");
  });

  it("service-health warnings → none (user links out to Diagnose modal)", () => {
    expect(actionForWarning("Lidarr is unreachable")).toBe("none");
    expect(actionForWarning("Radarr is unreachable")).toBe("none");
  });

  it("indexer + informational warnings → none", () => {
    expect(actionForWarning("High failure rate: Prowlarr-NZBFinder")).toBe(
      "none",
    );
    expect(actionForWarning("Large download queue (76 items)")).toBe("none");
  });

  it("unknown title shapes fall back to none", () => {
    expect(actionForWarning("Some future warning type")).toBe("none");
    expect(actionForWarning("")).toBe("none");
  });

  it("is exact-prefix sensitive — 'Pending' without trailing space shouldn't match", () => {
    // Guards against a warning like "PendingApproval" accidentally
    // matching "Pending ". The actual warning format includes a space
    // + duration: "Pending 3h: Title".
    expect(actionForWarning("PendingApproval: Thing")).toBe("none");
  });
});
