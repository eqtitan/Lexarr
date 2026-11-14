import { describe, it, expect } from "vitest";
import { deriveBadge } from "@/lib/request-badge";

describe("My Requests badge", () => {
  it("shows a cancelled request as Cancelled with the admin's note, not the old poller error", () => {
    expect(
      deriveBadge({
        status: "cancelled",
        lastError: "No releases found after 88d — indexers returned nothing",
        adminNote: "Wrong film, cancelled",
      }),
    ).toEqual({ label: "Cancelled", tooltip: "Wrong film, cancelled" });
  });

  it("falls back to a plain reason when the admin left no note", () => {
    expect(deriveBadge({ status: "cancelled", adminNote: null })).toEqual({
      label: "Cancelled",
      tooltip: "Cancelled by an admin",
    });
    expect(deriveBadge({ status: "denied", adminNote: "  " }).tooltip).toBe("Denied by an admin");
  });

  it("keeps the existing reasons for stalled and unreleased requests", () => {
    expect(deriveBadge({ status: "stalled", lastError: "No releases found after 3d" }).label).toBe("Not Found");
    expect(deriveBadge({ status: "approved", lastError: "Awaiting release: 2026-11-17" }).label).toBe("Unreleased");
  });
});
