import { describe, it, expect } from "vitest";
import {
  REQUEST_STATUSES,
  canTransition,
  isRequestStatus,
  isTerminal,
} from "@/lib/request-status";

describe("request lifecycle table", () => {
  it("knows all eight statuses, including cancelled", () => {
    expect(REQUEST_STATUSES).toEqual([
      "pending",
      "approved",
      "downloading",
      "available",
      "stalled",
      "failed",
      "denied",
      "cancelled",
    ]);
    expect(isRequestStatus("cancelled")).toBe(true);
    expect(isRequestStatus("archived")).toBe(false);
  });

  it("treats available, denied and cancelled as terminal", () => {
    expect(REQUEST_STATUSES.filter(isTerminal)).toEqual(["available", "denied", "cancelled"]);
    for (const from of ["available", "denied", "cancelled"] as const) {
      for (const to of REQUEST_STATUSES) expect(canTransition(from, to)).toBe(false);
    }
  });

  it.each([
    ["pending", "approved"],
    ["pending", "denied"],
    ["approved", "downloading"],
    ["approved", "failed"],
    ["approved", "approved"], // admin retry in place
    ["downloading", "available"],
    ["downloading", "approved"], // awaiting release
    ["downloading", "stalled"],
    ["stalled", "failed"],
    ["stalled", "approved"],
    ["failed", "approved"],
    ["failed", "available"], // late arrival: the *arr imported it after Lexarr gave up
    ["stalled", "available"], // late arrival
    ["stalled", "downloading"], // book: LazyLibrarian grabbed a working copy
    ["failed", "downloading"], // same, after Lexarr gave up
  ] as const)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["pending", "downloading"], // must be approved first
    ["pending", "available"],
    ["denied", "approved"], // the resurrection bug #18 fixed
    ["available", "downloading"],
    ["available", "failed"],
    ["denied", "approved"],
  ] as const)("refuses %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("lets an admin cancel anything that isn't finished", () => {
    expect(REQUEST_STATUSES.filter((s) => canTransition(s, "cancelled"))).toEqual([
      "pending",
      "approved",
      "downloading",
      "stalled",
      "failed",
    ]);
  });
});
