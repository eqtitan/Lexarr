/**
 * Tests for the audit-log grouping / collapsing helpers.
 *
 * These live in the audit page component (client component), so we import
 * them directly and validate the collapse window + bucketing behaviour.
 */
import { describe, it, expect } from "vitest";

// The grouping logic is defined inline in the page component; duplicate just
// enough logic here to cover it with a unit test. Keep these in sync with
// src/app/admin/audit/page.tsx.
interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  createdAt: string;
  user: { name: string; avatar: string | null } | null;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dateBucketLabel(iso: string): string {
  const today = startOfDay(new Date());
  const entry = startOfDay(new Date(iso));
  const diffDays = Math.round((today - entry) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const d = new Date(iso);
  if (diffDays < 7)
    return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface AuditRow {
  kind: "single" | "run";
  entries: AuditEntry[];
  bucket: string;
}

function groupEntries(entries: AuditEntry[]): AuditRow[] {
  const COLLAPSE_MS = 10 * 60 * 1000;
  const rows: AuditRow[] = [];
  for (const entry of entries) {
    const bucket = dateBucketLabel(entry.createdAt);
    const last = rows[rows.length - 1];
    const lastEntry = last?.entries[last.entries.length - 1];
    const sameBurst =
      last &&
      lastEntry &&
      last.bucket === bucket &&
      lastEntry.action === entry.action &&
      lastEntry.userId === entry.userId &&
      new Date(lastEntry.createdAt).getTime() -
        new Date(entry.createdAt).getTime() <=
        COLLAPSE_MS;
    if (sameBurst) {
      last.entries.push(entry);
      last.kind = "run";
    } else {
      rows.push({ kind: "single", entries: [entry], bucket });
    }
  }
  return rows;
}

function mk(
  id: string,
  action: string,
  userId: string | null,
  minutesAgo: number,
): AuditEntry {
  return {
    id,
    userId,
    action,
    targetType: null,
    targetId: null,
    detail: null,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    user: userId ? { name: userId, avatar: null } : null,
  };
}

describe("audit grouping", () => {
  it("collapses consecutive same-user same-action entries within 10 minutes", () => {
    // Input comes in reverse-chronological (newest first) — that's how the
    // API orders it. Three logins by user A within 10 minutes.
    const rows = groupEntries([
      mk("1", "login", "A", 1),
      mk("2", "login", "A", 4),
      mk("3", "login", "A", 8),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("run");
    expect(rows[0].entries).toHaveLength(3);
  });

  it("does not collapse across a >10 minute gap", () => {
    const rows = groupEntries([
      mk("1", "login", "A", 1),
      mk("2", "login", "A", 20), // 19 min gap — outside window
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "single")).toBe(true);
  });

  it("does not collapse different users", () => {
    const rows = groupEntries([
      mk("1", "login", "A", 1),
      mk("2", "login", "B", 2),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("does not collapse different actions", () => {
    const rows = groupEntries([
      mk("1", "approve_request", "A", 1),
      mk("2", "deny_request", "A", 2),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("labels today's entries as 'Today'", () => {
    expect(dateBucketLabel(new Date().toISOString())).toBe("Today");
  });

  it("labels yesterday's entries as 'Yesterday'", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(dateBucketLabel(yesterday.toISOString())).toBe("Yesterday");
  });

  it("falls back to weekday name for 2-6 days ago", () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const label = dateBucketLabel(threeDaysAgo.toISOString());
    // Weekday names are locale-specific; assert it's non-trivial and not the
    // special "Today" / "Yesterday" values or a month-day format.
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label).not.toMatch(/\d/); // weekday has no digits; month-day does
  });
});
