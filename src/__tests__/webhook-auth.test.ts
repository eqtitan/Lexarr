import { describe, it, expect } from "vitest";
import { verifyWebhookToken } from "@/lib/webhook-auth";

describe("verifyWebhookToken", () => {
  it("returns true for a matching token", () => {
    expect(verifyWebhookToken("my-secret", "my-secret")).toBe(true);
  });

  it("returns false for a wrong token", () => {
    expect(verifyWebhookToken("my-secret", "wrong")).toBe(false);
  });

  it("returns false when the secret is unset (fail closed)", () => {
    expect(verifyWebhookToken(undefined, "anything")).toBe(false);
  });

  it("returns false when no token is provided", () => {
    expect(verifyWebhookToken("my-secret", null)).toBe(false);
  });

  it("does not throw on inputs of very different lengths (no timingSafeEqual length-mismatch crash)", () => {
    expect(() => verifyWebhookToken("a", "a-much-longer-wrong-token-value")).not.toThrow();
    expect(verifyWebhookToken("a", "a-much-longer-wrong-token-value")).toBe(false);
  });
});
