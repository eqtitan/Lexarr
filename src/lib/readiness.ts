/**
 * Admin readiness report: is this Lexarr safe and working, and if not,
 * what to do about it. Read-only. Every check returns a status and a
 * one-line fix; none returns a secret value (only "set", a length, or a
 * count). Shown at /admin/readiness.
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { readStackHealth } from "@/lib/stack-health";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";
import * as lazylibrarian from "@/lib/arr/lazylibrarian";
import * as prowlarr from "@/lib/arr/prowlarr";
import * as qbittorrent from "@/lib/arr/qbittorrent";
import * as nzbget from "@/lib/arr/nzbget";

export type CheckStatus = "ok" | "warn" | "fail";
export type CheckGroup = "Security" | "Backups" | "Services" | "Pipeline" | "Books";

export interface ReadinessCheck {
  id: string;
  group: CheckGroup;
  label: string;
  status: CheckStatus;
  /** What was found, in plain words. Never a secret. */
  detail: string;
  /** What to do when it isn't ok. */
  fix?: string;
}

export interface ReadinessReport {
  status: CheckStatus;
  checks: ReadinessCheck[];
  generatedAt: string;
}

const HOUR = 3_600_000;
const SERVICE_TIMEOUT_MS = 4_000;
const CACHE_MS = 60_000;

const ok = (c: Omit<ReadinessCheck, "status">): ReadinessCheck => ({ ...c, status: "ok" });
const warn = (c: Omit<ReadinessCheck, "status">): ReadinessCheck => ({ ...c, status: "warn" });
const fail = (c: Omit<ReadinessCheck, "status">): ReadinessCheck => ({ ...c, status: "fail" });

function ageText(ms: number): string {
  const h = Math.floor(ms / HOUR);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// ── Security ─────────────────────────────────────────────────────────────

export function securityChecks(e = env()): ReadinessCheck[] {
  const g = "Security" as const;
  const out: ReadinessCheck[] = [];

  const reset = ["true", "1", "yes"].includes((e.BOOTSTRAP_ADMIN_RESET ?? "").trim().toLowerCase());
  if (reset) {
    out.push(fail({ id: "bootstrap", group: g, label: "Bootstrap admin", detail: "BOOTSTRAP_ADMIN_RESET is on: the admin password is reset on every start", fix: "Remove BOOTSTRAP_ADMIN_RESET (and the bootstrap password) from the container and restart." }));
  } else if (e.BOOTSTRAP_ADMIN_PASSWORD) {
    out.push(warn({ id: "bootstrap", group: g, label: "Bootstrap admin", detail: "BOOTSTRAP_ADMIN_PASSWORD is still set (unused while an admin exists)", fix: "Remove BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD from the container environment." }));
  } else {
    out.push(ok({ id: "bootstrap", group: g, label: "Bootstrap admin", detail: "No bootstrap credentials in the environment" }));
  }

  const secretLen = (e.NEXTAUTH_SECRET ?? "").length;
  out.push(
    secretLen >= 32
      ? ok({ id: "auth-secret", group: g, label: "Session signing secret", detail: `NEXTAUTH_SECRET is ${secretLen} characters` })
      : fail({ id: "auth-secret", group: g, label: "Session signing secret", detail: `NEXTAUTH_SECRET is ${secretLen} characters`, fix: "Set NEXTAUTH_SECRET to 32+ random characters (openssl rand -base64 32). Everyone will be signed out." }),
  );

  const hookLen = (e.LEXARR_WEBHOOK_SECRET ?? "").length;
  out.push(
    hookLen >= 16
      ? ok({ id: "webhook-secret", group: g, label: "Webhook secret", detail: `Set, ${hookLen} characters` })
      : hookLen === 0
        ? warn({ id: "webhook-secret", group: g, label: "Webhook secret", detail: "Not set: *arr webhooks are rejected", fix: "Set LEXARR_WEBHOOK_SECRET (16+ characters) and the matching token in Radarr/Sonarr/Lidarr." })
        : fail({ id: "webhook-secret", group: g, label: "Webhook secret", detail: `Only ${hookLen} characters`, fix: "Use 16+ random characters for LEXARR_WEBHOOK_SECRET." }),
  );

  out.push(
    e.REGISTRATION_OPEN === "true"
      ? warn({ id: "registration", group: g, label: "Sign-ups", detail: "Open: anyone who can reach Lexarr can create an account", fix: "Unset REGISTRATION_OPEN unless you mean to allow self sign-up." })
      : ok({ id: "registration", group: g, label: "Sign-ups", detail: "Closed; admins add users" }),
  );
  return out;
}

/** Ask our own server for a page and read the policy it actually sends. */
export async function cspCheck(fetchImpl: typeof fetch = fetch): Promise<ReadinessCheck> {
  const base = { id: "csp", group: "Security" as const, label: "Content-Security-Policy" };
  try {
    const res = await fetchImpl(`http://127.0.0.1:${env().PORT || 5056}/login`, {
      redirect: "manual",
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    const csp = res.headers.get("content-security-policy") ?? "";
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
    if (!csp) return fail({ ...base, detail: "No policy on pages", fix: "src/proxy.ts isn't running; check the build includes it." });
    if (scriptSrc.includes("'unsafe-inline'") || !scriptSrc.includes("'nonce-"))
      return fail({ ...base, detail: "Scripts aren't nonce-only", fix: "script-src must use a nonce without 'unsafe-inline' (src/lib/csp.ts)." });
    return ok({ ...base, detail: "Enforced; scripts need a per-request nonce" });
  } catch (err) {
    return warn({ ...base, detail: `Couldn't fetch our own page: ${err instanceof Error ? err.message : String(err)}` });
  }
}

// ── Backups ──────────────────────────────────────────────────────────────

/** Written by the host's nightly lexarr-db-backup.sh into the stack-health dir. */
interface BackupStatus {
  at: string;
  mode: string;
  secondary: boolean;
  nas: boolean;
}

export async function backupChecks(now = Date.now()): Promise<ReadinessCheck[]> {
  const g = "Backups" as const;
  const file = join(env().STACK_HEALTH_DIR || "/stack-health", "backup-status.json");
  let s: BackupStatus;
  try {
    s = JSON.parse(await fs.readFile(file, "utf8")) as BackupStatus;
  } catch {
    return [warn({ id: "backup-age", group: g, label: "Nightly backup", detail: "No backup status file", fix: "The host's nightly lexarr-db-backup.sh writes backup-status.json into the stack-health folder; check the cron job runs." })];
  }
  const age = now - new Date(s.at).getTime();
  const out: ReadinessCheck[] = [];
  out.push(
    !Number.isFinite(age)
      ? fail({ id: "backup-age", group: g, label: "Nightly backup", detail: "Status file has no valid date", fix: "Run /usr/local/bin/lexarr-db-backup.sh by hand and check its log." })
      : age < 26 * HOUR
        ? ok({ id: "backup-age", group: g, label: "Nightly backup", detail: `Last backup ${ageText(age)} ago` })
        : age < 50 * HOUR
          ? warn({ id: "backup-age", group: g, label: "Nightly backup", detail: `Last backup ${ageText(age)} ago (one run missed)`, fix: "Check lexarr-backups/logs/lexarr-backup.log on the Docker host." })
          : fail({ id: "backup-age", group: g, label: "Nightly backup", detail: `Last backup ${ageText(age)} ago`, fix: "The nightly backup isn't running: check the cron entry and lexarr-backups/logs/lexarr-backup.log." }),
  );
  out.push(
    s.mode === "600"
      ? ok({ id: "backup-perms", group: g, label: "Backup permissions", detail: "Owner-only (600)" })
      : fail({ id: "backup-perms", group: g, label: "Backup permissions", detail: `Mode ${s.mode}: backups hold password hashes`, fix: "chmod 600 the backups and keep `umask 077` in lexarr-db-backup.sh." }),
  );
  out.push(
    s.nas && s.secondary
      ? ok({ id: "backup-copies", group: g, label: "Backup copies", detail: "Cache-pool and NAS copies made" })
      : warn({ id: "backup-copies", group: g, label: "Backup copies", detail: `${s.secondary ? "" : "Cache-pool copy failed. "}${s.nas ? "" : "NAS copy failed."}`.trim(), fix: "See lexarr-backups/logs/lexarr-backup.log; the NAS copy needs the NAS reachable over SSH." }),
  );
  return out;
}

// ── Services ─────────────────────────────────────────────────────────────

async function reachable(name: string, fn: () => Promise<unknown>, optional: boolean): Promise<ReadinessCheck> {
  const base = { id: `svc-${name.toLowerCase()}`, group: "Services" as const, label: name };
  try {
    const r = await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), SERVICE_TIMEOUT_MS)),
    ]);
    if (r === false) throw new Error("health check failed");
    return ok({ ...base, detail: "Reachable" });
  } catch (err) {
    const c = { ...base, detail: `Not reachable: ${err instanceof Error ? err.message : String(err)}`, fix: `Check the ${name} container is running and its URL/API key in Lexarr's environment.` };
    return optional ? warn(c) : fail(c);
  }
}

export async function serviceChecks(now = Date.now()): Promise<ReadinessCheck[]> {
  const e = env();
  const jobs: Promise<ReadinessCheck>[] = [
    reachable("Radarr", radarr.health, false),
    reachable("Sonarr", sonarr.health, false),
    reachable("Lidarr", lidarr.health, true),
  ];
  if (e.LAZYLIBRARIAN_API_KEY) jobs.push(reachable("LazyLibrarian", lazylibrarian.health, true));
  if (e.PROWLARR_API_KEY) jobs.push(reachable("Prowlarr", prowlarr.health, true));
  if (e.QBITTORRENT_URL) jobs.push(reachable("qBittorrent", qbittorrent.health, true));
  if (e.NZBGET_URL) jobs.push(reachable("NZBGet", nzbget.health, true));
  const out = await Promise.all(jobs);

  const report = await readStackHealth().catch(() => null);
  const g = "Services" as const;
  if (!report) {
    out.push(warn({ id: "stack-health", group: g, label: "Stack health report", detail: "No report found", fix: "The host's stack-healthcheck.sh writes it; check its cron entry." }));
  } else {
    const staleMs = now - new Date(report.lastRunAt).getTime();
    out.push(
      staleMs > 12 * HOUR
        ? warn({ id: "stack-health", group: g, label: "Stack health report", detail: `Last run ${ageText(staleMs)} ago`, fix: "Check the stack-healthcheck cron job on the Docker host." })
        : report.issueCount > 0
          ? warn({ id: "stack-health", group: g, label: "Stack health report", detail: `${report.issueCount} issue(s) in the last run`, fix: "Open the dashboard's stack health panel for details." })
          : ok({ id: "stack-health", group: g, label: "Stack health report", detail: `Clean, ${ageText(staleMs)} ago` }),
    );
  }
  return out;
}

// ── Pipeline ─────────────────────────────────────────────────────────────

export async function pipelineChecks(now = Date.now()): Promise<ReadinessCheck[]> {
  const g = "Pipeline" as const;
  const [stalled, failedRecent, oldestStalled, failingChecks] = await Promise.all([
    prisma.request.groupBy({ by: ["mediaType"], where: { status: "stalled" }, _count: true }),
    prisma.request.count({ where: { status: "failed", updatedAt: { gt: new Date(now - 7 * 24 * HOUR) } } }),
    prisma.request.findFirst({ where: { status: "stalled" }, orderBy: { updatedAt: "asc" }, select: { title: true, updatedAt: true } }),
    prisma.request.count({ where: { checkFailingSince: { lt: new Date(now - 2 * HOUR) } } }),
  ]);
  const stalledTotal = stalled.reduce((n, s) => n + s._count, 0);
  const by = stalled.map((s) => `${s._count} ${s.mediaType}`).join(", ");
  return [
    stalledTotal === 0
      ? ok({ id: "stalled", group: g, label: "Stalled requests", detail: "None" })
      : warn({ id: "stalled", group: g, label: "Stalled requests", detail: `${stalledTotal} (${by}); oldest: ${oldestStalled?.title} since ${ageText(now - (oldestStalled?.updatedAt.getTime() ?? now))}`, fix: "Open the dashboard's Stalled tab; each shows why." }),
    failedRecent === 0
      ? ok({ id: "failed", group: g, label: "Failed in the last 7 days", detail: "None" })
      : warn({ id: "failed", group: g, label: "Failed in the last 7 days", detail: `${failedRecent}`, fix: "Dashboard → Failed: retry, or tell the requester." }),
    failingChecks === 0
      ? ok({ id: "check-failing", group: g, label: "Status checks", detail: "Every tracked request checks cleanly" })
      : warn({ id: "check-failing", group: g, label: "Status checks", detail: `${failingChecks} request(s) failing their status check for 2h+`, fix: "Usually an *arr is down or an item was removed there; see the dashboard's warnings." }),
  ];
}

// ── Books ────────────────────────────────────────────────────────────────

export async function bookChecks(): Promise<ReadinessCheck[]> {
  const g = "Books" as const;
  if (!env().LAZYLIBRARIAN_API_KEY) return [];
  const out: ReadinessCheck[] = [];
  try {
    const s = await lazylibrarian.getSourceSettings();
    const on = s.sources.filter((x) => x.enabled);
    const usenet = on.filter((x) => x.kind === "usenet");
    const torrent = on.filter((x) => x.kind === "torrent");
    const minUsenet = Math.min(...usenet.map((x) => x.priority));
    const maxTorrent = Math.max(...torrent.map((x) => x.priority));
    const lowSeeders = torrent.filter((x) => x.seeders < 5).map((x) => x.name);
    const problems: string[] = [];
    if (s.priorityWeight <= 0) problems.push("priority weight is 0, so priorities only break ties");
    if (usenet.length && torrent.length && minUsenet <= maxTorrent)
      problems.push(`a Usenet source (${usenet.filter((x) => x.priority <= maxTorrent).map((x) => x.name).join(", ")}) ranks at or below torrents`);
    if (lowSeeders.length) problems.push(`minimum seeders under 5 on ${lowSeeders.join(", ")}`);
    out.push(
      problems.length
        ? warn({ id: "ll-sources", group: g, label: "LazyLibrarian source order", detail: problems.join("; "), fix: "Usenet ~90, Libgen ~80, torrents ~10, PRIORITY_WEIGHT 20, torrent seeders 5 (public torrents rarely complete)." })
        : ok({ id: "ll-sources", group: g, label: "LazyLibrarian source order", detail: `${usenet.length} Usenet above ${torrent.length} torrent source(s); weight ${s.priorityWeight}` }),
    );
  } catch (err) {
    out.push(warn({ id: "ll-sources", group: g, label: "LazyLibrarian source order", detail: `Couldn't read: ${err instanceof Error ? err.message : String(err)}` }));
  }
  if (env().PROWLARR_API_KEY) {
    try {
      const level = await prowlarr.getAppSyncLevel("LazyLibrarian");
      out.push(
        level === "addOnly" || level === "disabled" || level === null
          ? ok({ id: "prowlarr-ll-sync", group: g, label: "Prowlarr → LazyLibrarian sync", detail: level ? `"${level}": LazyLibrarian's own priorities are kept` : "No LazyLibrarian app in Prowlarr" })
          : warn({ id: "prowlarr-ll-sync", group: g, label: "Prowlarr → LazyLibrarian sync", detail: `"${level}": every sync resets LazyLibrarian's priorities and seeder minimums`, fix: "Prowlarr → Settings → Apps → LazyLibrarian → Sync Level: Add and Remove Only." }),
      );
    } catch (err) {
      out.push(warn({ id: "prowlarr-ll-sync", group: g, label: "Prowlarr → LazyLibrarian sync", detail: `Couldn't read: ${err instanceof Error ? err.message : String(err)}` }));
    }
  }
  return out;
}

// ── Report ───────────────────────────────────────────────────────────────

let cached: { at: number; report: Promise<ReadinessReport> } | null = null;

/** Test hook. */
export function _resetReadinessReportCache(): void {
  cached = null;
}

export function getReadinessReport(): Promise<ReadinessReport> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.report;
  const report = (async (): Promise<ReadinessReport> => {
    const groups = await Promise.all([
      Promise.resolve(securityChecks()),
      cspCheck().then((c) => [c]),
      backupChecks(now),
      serviceChecks(now),
      pipelineChecks(now),
      bookChecks(),
    ]);
    const checks = groups.flat();
    const status: CheckStatus = checks.some((c) => c.status === "fail")
      ? "fail"
      : checks.some((c) => c.status === "warn")
        ? "warn"
        : "ok";
    return { status, checks, generatedAt: new Date(now).toISOString() };
  })();
  cached = { at: now, report };
  report.catch(() => (cached = null));
  return report;
}
