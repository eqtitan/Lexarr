/**
 * Readiness report checks. Real migrated SQLite DB for the pipeline group
 * (helpers/test-db.ts); services are mocked.
 */
import { useTestDb, testPrisma } from "./helpers/test-db";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

useTestDb();

const envVals: Record<string, string | undefined> = {};
vi.mock("@/lib/env", () => ({ env: () => envVals }));
const getSourceSettings = vi.fn();
const getAppSyncLevel = vi.fn();
vi.mock("@/lib/arr/lazylibrarian", () => ({ health: vi.fn(async () => true), getSourceSettings: () => getSourceSettings() }));
vi.mock("@/lib/arr/prowlarr", () => ({ health: vi.fn(async () => ({})), getAppSyncLevel: (n: string) => getAppSyncLevel(n) }));
vi.mock("@/lib/arr/radarr", () => ({ health: vi.fn(async () => ({})) }));
vi.mock("@/lib/arr/sonarr", () => ({ health: vi.fn(async () => { throw new Error("ECONNREFUSED"); }) }));
vi.mock("@/lib/arr/lidarr", () => ({ health: vi.fn(async () => ({})) }));
vi.mock("@/lib/arr/qbittorrent", () => ({ health: vi.fn(async () => false) }));
vi.mock("@/lib/arr/nzbget", () => ({ health: vi.fn(async () => true) }));
vi.mock("@/lib/stack-health", () => ({ readStackHealth: vi.fn(async () => null) }));

let prisma: PrismaClient;
let r: typeof import("@/lib/readiness");

beforeAll(async () => {
  prisma = await testPrisma();
  r = await import("@/lib/readiness");
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(envVals)) delete envVals[k];
});

const byId = (checks: { id: string }[], id: string) =>
  checks.find((c) => c.id === id) as unknown as { status: string; detail: string; fix?: string };

describe("security checks", () => {
  it("flags a leftover bootstrap password and a reset flag, never showing the value", () => {
    const leftover = r.securityChecks({ BOOTSTRAP_ADMIN_PASSWORD: "hunter2-secret" } as never);
    expect(byId(leftover, "bootstrap").status).toBe("warn");
    expect(JSON.stringify(leftover)).not.toContain("hunter2-secret");
    expect(byId(r.securityChecks({ BOOTSTRAP_ADMIN_PASSWORD: "x", BOOTSTRAP_ADMIN_RESET: "true" } as never), "bootstrap").status).toBe("fail");
    expect(byId(r.securityChecks({} as never), "bootstrap").status).toBe("ok");
  });

  it("checks secret lengths without exposing them", () => {
    const secret = "s".repeat(40);
    const c = r.securityChecks({ NEXTAUTH_SECRET: secret, LEXARR_WEBHOOK_SECRET: "w".repeat(20) } as never);
    expect(byId(c, "auth-secret")).toMatchObject({ status: "ok", detail: "NEXTAUTH_SECRET is 40 characters" });
    expect(byId(c, "webhook-secret").status).toBe("ok");
    expect(JSON.stringify(c)).not.toContain(secret);
    expect(byId(r.securityChecks({ NEXTAUTH_SECRET: "short" } as never), "auth-secret").status).toBe("fail");
    expect(byId(r.securityChecks({} as never), "webhook-secret").status).toBe("warn");
  });

  it("warns when sign-ups are open", () => {
    expect(byId(r.securityChecks({ REGISTRATION_OPEN: "true" } as never), "registration").status).toBe("warn");
    expect(byId(r.securityChecks({} as never), "registration").status).toBe("ok");
  });

  it("reads the policy our own server sends", async () => {
    const fake = (csp: string | null) =>
      (async () => new Response("", { headers: csp ? { "content-security-policy": csp } : {} })) as unknown as typeof fetch;
    expect((await r.cspCheck(fake("default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'"))).status).toBe("ok");
    expect((await r.cspCheck(fake("script-src 'self' 'unsafe-inline'"))).status).toBe("fail");
    expect((await r.cspCheck(fake(null))).status).toBe("fail");
    expect((await r.cspCheck((async () => { throw new Error("down"); }) as unknown as typeof fetch)).status).toBe("warn");
  });
});

describe("backup checks", () => {
  const dirWith = (status: object | null) => {
    const d = mkdtempSync(join(tmpdir(), "readiness-"));
    if (status) writeFileSync(join(d, "backup-status.json"), JSON.stringify(status));
    envVals.STACK_HEALTH_DIR = d;
  };
  const NOW = Date.parse("2026-11-17T12:00:00Z");

  it("passes a fresh, 600, fully copied backup", async () => {
    dirWith({ at: "2026-11-17T08:30:00Z", mode: "600", secondary: true, nas: true });
    expect((await r.backupChecks(NOW)).map((c) => c.status)).toEqual(["ok", "ok", "ok"]);
  });

  it("warns at one missed night, fails at two, fails on readable backups", async () => {
    dirWith({ at: "2026-11-16T03:30:00Z", mode: "644", secondary: true, nas: false });
    const c = await r.backupChecks(NOW);
    expect(byId(c, "backup-age").status).toBe("warn");
    expect(byId(c, "backup-perms").status).toBe("fail");
    expect(byId(c, "backup-copies")).toMatchObject({ status: "warn", detail: "NAS copy failed." });
    dirWith({ at: "2026-11-14T03:30:00Z", mode: "600", secondary: true, nas: true });
    expect(byId(await r.backupChecks(NOW), "backup-age").status).toBe("fail");
  });

  it("warns when there is no status file", async () => {
    dirWith(null);
    expect((await r.backupChecks(NOW))[0]).toMatchObject({ id: "backup-age", status: "warn" });
  });
});

describe("service checks", () => {
  it("fails a required *arr, warns on an optional one, and skips unconfigured ones", async () => {
    envVals.QBITTORRENT_URL = "http://qb";
    const c = await r.serviceChecks();
    expect(byId(c, "svc-radarr").status).toBe("ok");
    expect(byId(c, "svc-sonarr")).toMatchObject({ status: "fail" });
    expect(byId(c, "svc-sonarr").detail).toContain("ECONNREFUSED");
    expect(byId(c, "svc-qbittorrent").status).toBe("warn"); // health() === false
    expect(byId(c, "svc-nzbget")).toBeUndefined();
    expect(byId(c, "stack-health").status).toBe("warn");
  });
});

describe("pipeline checks", () => {
  it("counts stalled requests by type and names the oldest", async () => {
    const user = await prisma.user.create({ data: { name: "readiness-u" } });
    const mk = (title: string, mediaType: string, updatedAt: Date) =>
      prisma.request.create({ data: { userId: user.id, title, mediaType, externalId: title, status: "stalled", updatedAt } });
    await mk("Old Book", "book", new Date(Date.now() - 3 * 24 * 3_600_000));
    await mk("New Show", "tv", new Date());
    const c = await r.pipelineChecks();
    expect(byId(c, "stalled").status).toBe("warn");
    expect(byId(c, "stalled").detail).toMatch(/^2 \(.*1 book.*\); oldest: Old Book since 3d$/);
  });
});

describe("book checks", () => {
  const src = (name: string, kind: string, priority: number, seeders = 0, enabled = true) => ({ name, kind, priority, seeders, enabled });

  it("passes today's ranking", async () => {
    envVals.LAZYLIBRARIAN_API_KEY = "k";
    envVals.PROWLARR_API_KEY = "k";
    getSourceSettings.mockResolvedValue({
      priorityWeight: 20,
      sources: [src("altHUB", "usenet", 90), src("NZBgeek", "usenet", 90), src("TPB", "torrent", 10, 5), src("Libgen", "direct", 80)],
    });
    getAppSyncLevel.mockResolvedValue("addOnly");
    expect((await r.bookChecks()).map((c) => c.status)).toEqual(["ok", "ok"]);
  });

  it("names a Usenet source ranked under torrents, low seeders, zero weight, and a full sync", async () => {
    envVals.LAZYLIBRARIAN_API_KEY = "k";
    envVals.PROWLARR_API_KEY = "k";
    getSourceSettings.mockResolvedValue({
      priorityWeight: 0,
      sources: [src("Newznab_0", "usenet", 0), src("altHUB", "usenet", 90), src("TPB", "torrent", 10, 1), src("Off", "torrent", 99, 0, false)],
    });
    getAppSyncLevel.mockResolvedValue("fullSync");
    const [sources, sync] = await r.bookChecks();
    expect(sources.status).toBe("warn");
    expect(sources.detail).toContain("priority weight is 0");
    expect(sources.detail).toContain("(Newznab_0) ranks at or below torrents");
    expect(sources.detail).toContain("minimum seeders under 5 on TPB");
    expect(sources.detail).not.toContain("Off"); // disabled sources don't count
    expect(sync.status).toBe("warn");
  });

  it("is empty when LazyLibrarian isn't configured", async () => {
    expect(await r.bookChecks()).toEqual([]);
  });
});
