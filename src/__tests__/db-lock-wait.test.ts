import { describe, it, expect } from "vitest";
import { withSqliteLockWait, SQLITE_LOCK_WAIT_SECONDS } from "@/lib/db";

describe("withSqliteLockWait", () => {
  it("adds socket_timeout to a plain SQLite file URL", () => {
    expect(withSqliteLockWait("file:/app/data/lexarr.db")).toBe(
      `file:/app/data/lexarr.db?socket_timeout=${SQLITE_LOCK_WAIT_SECONDS}`,
    );
  });

  it("appends to an existing query string", () => {
    expect(withSqliteLockWait("file:./dev.db?connection_limit=1")).toBe(
      `file:./dev.db?connection_limit=1&socket_timeout=${SQLITE_LOCK_WAIT_SECONDS}`,
    );
  });

  it("keeps an operator's own socket_timeout", () => {
    expect(withSqliteLockWait("file:./dev.db?socket_timeout=30")).toBe("file:./dev.db?socket_timeout=30");
  });

  it("leaves non-file URLs and a missing URL alone", () => {
    expect(withSqliteLockWait("postgresql://x/y")).toBe("postgresql://x/y");
    expect(withSqliteLockWait(undefined)).toBeUndefined();
  });

  it("waits at least 3x Prisma's ~5s default", () => {
    expect(SQLITE_LOCK_WAIT_SECONDS).toBeGreaterThanOrEqual(15);
  });
});
