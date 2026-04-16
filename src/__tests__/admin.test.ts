import { describe, it, expect } from "vitest";

// --- Pure authorization logic matching admin route pattern ---

type Session = { user?: { role?: string } } | null | undefined;

function isAdmin(session: Session): boolean {
  return session?.user?.role === "admin";
}

// --- Request status transition logic ---

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ["approved", "denied"],
  approved: ["downloading"],
  downloading: ["available", "failed"],
  failed: ["approved"], // retry
};

function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// --- Audit action types ---

const AUDIT_ACTIONS = [
  "request.approve",
  "request.deny",
  "request.retry",
  "user.role_change",
  "settings.update",
  "notification.create",
  "notification.delete",
] as const;

// --- Notification webhook URL validation ---

function isValidWebhookUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

// ==================== Tests ====================

describe("Admin authorization", () => {
  it("allows admin role", () => {
    expect(isAdmin({ user: { role: "admin" } })).toBe(true);
  });

  it("rejects user role", () => {
    expect(isAdmin({ user: { role: "user" } })).toBe(false);
  });

  it("rejects null session", () => {
    expect(isAdmin(null)).toBe(false);
  });

  it("rejects undefined session", () => {
    expect(isAdmin(undefined)).toBe(false);
  });

  it("rejects session with missing role", () => {
    expect(isAdmin({ user: {} })).toBe(false);
    expect(isAdmin({ user: undefined })).toBe(false);
  });
});

describe("Audit action types", () => {
  it("all actions are non-empty dot-separated strings", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });
});

describe("Webhook URL validation", () => {
  it("accepts http and https URLs", () => {
    expect(isValidWebhookUrl("https://discord.com/api/webhooks/123")).toBe(true);
    expect(isValidWebhookUrl("http://slack.example.com/hook")).toBe(true);
  });

  it("rejects non-http URLs", () => {
    expect(isValidWebhookUrl("ftp://example.com")).toBe(false);
    expect(isValidWebhookUrl("javascript:alert(1)")).toBe(false);
    expect(isValidWebhookUrl("")).toBe(false);
  });
});

describe("Request status transitions", () => {
  it("allows valid forward transitions", () => {
    expect(canTransition("pending", "approved")).toBe(true);
    expect(canTransition("approved", "downloading")).toBe(true);
    expect(canTransition("downloading", "available")).toBe(true);
  });

  it("allows deny from pending", () => {
    expect(canTransition("pending", "denied")).toBe(true);
  });

  it("allows retry from failed", () => {
    expect(canTransition("failed", "approved")).toBe(true);
  });

  it("rejects invalid backward transitions", () => {
    expect(canTransition("available", "pending")).toBe(false);
    expect(canTransition("downloading", "pending")).toBe(false);
    expect(canTransition("denied", "pending")).toBe(false);
  });
});
