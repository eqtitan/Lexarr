/**
 * Tests for the orphan removal API logic.
 * Following the project's pattern of testing extracted logic rather than
 * the raw Next.js route handler.
 */
import { describe, it, expect } from "vitest";

// --- Auth check logic (mirrors route handler) ---

type Session = { user?: { role?: string; id?: string } } | null | undefined;

function isAdminWithId(session: Session): session is { user: { role: string; id: string } } {
  return session?.user?.role === "admin" && typeof session.user.id === "string";
}

// --- DELETE body validation ---

interface DeleteBody {
  hash?: unknown;
  deleteFiles?: unknown;
  folderName?: unknown;
}

function validateDeleteBody(body: unknown): body is { hash: string; deleteFiles: boolean; folderName?: string } {
  if (!body || typeof body !== "object") return false;
  const b = body as DeleteBody;
  return typeof b.hash === "string" && b.hash.length > 0;
}

// --- Safety model ---

type ArrHasFile = boolean | null;

function canDeleteFiles(qbHash: string | null, arrHasFile: ArrHasFile): boolean {
  return qbHash !== null && arrHasFile === true;
}

function canRemoveTorrent(qbHash: string | null): boolean {
  return qbHash !== null;
}

// ==================== Tests ====================

describe("orphan API auth guard", () => {
  it("accepts admin session with id", () => {
    expect(isAdminWithId({ user: { role: "admin", id: "abc123" } })).toBe(true);
  });

  it("rejects non-admin role", () => {
    expect(isAdminWithId({ user: { role: "user", id: "abc123" } })).toBe(false);
  });

  it("rejects admin without id", () => {
    expect(isAdminWithId({ user: { role: "admin" } })).toBe(false);
  });

  it("rejects null session", () => {
    expect(isAdminWithId(null)).toBe(false);
  });
});

describe("orphan DELETE body validation", () => {
  it("accepts valid body with hash", () => {
    expect(
      validateDeleteBody({ hash: "abc123", deleteFiles: true, folderName: "SomeFolder" }),
    ).toBe(true);
  });

  it("accepts body with just hash (deleteFiles optional)", () => {
    expect(validateDeleteBody({ hash: "abc123" })).toBe(true);
  });

  it("rejects body with missing hash", () => {
    expect(validateDeleteBody({ deleteFiles: true })).toBe(false);
  });

  it("rejects body with empty hash string", () => {
    expect(validateDeleteBody({ hash: "" })).toBe(false);
  });

  it("rejects null body", () => {
    expect(validateDeleteBody(null)).toBe(false);
  });

  it("rejects non-object body", () => {
    expect(validateDeleteBody("abc")).toBe(false);
    expect(validateDeleteBody(42)).toBe(false);
  });
});

describe("orphan safety model", () => {
  it("canRemoveTorrent requires a qbHash", () => {
    expect(canRemoveTorrent("abc123")).toBe(true);
    expect(canRemoveTorrent(null)).toBe(false);
  });

  it("canDeleteFiles requires qbHash AND arrHasFile=true", () => {
    expect(canDeleteFiles("abc123", true)).toBe(true);
    expect(canDeleteFiles("abc123", false)).toBe(false);
    expect(canDeleteFiles("abc123", null)).toBe(false);
    expect(canDeleteFiles(null, true)).toBe(false);
  });

  it("unconfirmed library status (null) blocks file deletion", () => {
    // Music/books can't confirm via arr — must use Remove only
    expect(canDeleteFiles("somehash", null)).toBe(false);
  });
});
