/**
 * Failures that must never break the caller -- but must not vanish either.
 * (Before 2026-10-20 these catch blocks swallowed the error silently.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: { create: vi.fn() },
    notificationChannel: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/log", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prisma } from "@/lib/db";
import { log } from "@/lib/log";

beforeEach(() => vi.clearAllMocks());

describe("logAudit", () => {
  it("does not throw when the DB write fails, and logs the lost entry", async () => {
    vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error("SQLITE_BUSY"));
    const { logAudit } = await import("@/lib/audit");

    await expect(
      logAudit("admin-1", "deny_request", { type: "request", id: "r1" }),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      "audit: failed to write audit log entry",
      expect.objectContaining({ action: "deny_request", target: { type: "request", id: "r1" } }),
    );
  });
});

describe("notify", () => {
  it("does not throw when loading channels fails, and logs it", async () => {
    vi.mocked(prisma.notificationChannel.findMany).mockRejectedValue(new Error("db down"));
    const { notify } = await import("@/lib/notifications");

    await expect(
      notify({ event: "available", title: "Dune", mediaType: "movie", status: "available", user: "alice" }),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith("notifications: dispatch failed", expect.anything());
  });
});
