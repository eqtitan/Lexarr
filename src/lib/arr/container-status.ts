/**
 * Container status (M2-01).
 *
 * Provides the data the Diagnose modal needs beyond circuit-breaker state:
 * `docker inspect`-style status + last 50 log lines + uptime.
 *
 * Two sources, hybrid (Option D in the M2 plan):
 *   1. Default — read `/stack-health/services/<name>.json`, written by the
 *      host stack-healthcheck cron every 4h. Zero new privileged surface
 *      in the Lexarr container — same read-only mount we already use for
 *      stack-health summary. Up to 4h stale.
 *   2. Opt-in — when STACK_HEALTH_SSH_HOST/USER/KEY_PATH are all set, a
 *      live refresh runs `ssh root@unraid 'docker logs ... && docker
 *      inspect ...'` and updates the JSON file. Operators who don't want
 *      SSH never set the env vars and live with staleness.
 *
 * SSH calls go through `child_process.execFile` with an arg array — no
 * shell, no string interpolation. The service-name arg is validated by the
 * caller against SERVICE_REGISTRY before reaching this module.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { log } from "@/lib/log";
import { env } from "@/lib/env";
import type { ContainerStatusDTO } from "@/types/dashboard";

const execFileP = promisify(execFile);

const HEALTH_DIR = process.env.STACK_HEALTH_DIR || "/stack-health";
const SERVICES_DIR = path.join(HEALTH_DIR, "services");

const SSH_TIMEOUT_MS = 5_000;
const LOG_LINE_LIMIT = 50;

/**
 * Defense-in-depth container-name validator. The API route checks against
 * SERVICE_REGISTRY first; this rejects malformed input even if a future
 * caller forgets to.
 */
function isSafeContainerName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(name);
}

/**
 * Compute "2d 3h" / "47m" / null from an ISO startedAt + status. Returns
 * null when the container isn't running or startedAt is missing.
 */
function uptimeFromStarted(
  startedAt: string | null,
  status: string,
): string | null {
  if (!startedAt || status !== "running") return null;
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Read the cron-written snapshot. Returns null if the file doesn't exist
 * (mount not configured / cron hasn't run yet / unknown service).
 */
async function readSnapshot(name: string): Promise<ContainerStatusDTO | null> {
  const file = path.join(SERVICES_DIR, `${name}.json`);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ContainerStatusDTO>;
    const status = parsed.status ?? null;
    const startedAt = parsed.startedAt ?? null;
    return {
      name: parsed.name ?? name,
      status,
      startedAt,
      uptime: parsed.uptime ?? uptimeFromStarted(startedAt, status ?? "unknown"),
      logs: Array.isArray(parsed.logs) ? parsed.logs.slice(-LOG_LINE_LIMIT) : [],
      asOf: parsed.asOf ?? new Date().toISOString(),
      source: "cron",
      refreshAvailable: isSshRefreshConfigured(),
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    log.warn("container-status: failed to read snapshot", { name, err });
    return null;
  }
}

/**
 * Whether the Diagnose modal should expose the "Refresh now" button.
 */
export function isSshRefreshConfigured(): boolean {
  return Boolean(
    env.STACK_HEALTH_SSH_HOST &&
      env.STACK_HEALTH_SSH_USER &&
      env.STACK_HEALTH_SSH_KEY_PATH,
  );
}

/**
 * Live refresh via SSH. The caller has already validated `name` against
 * SERVICE_REGISTRY — we still use execFile arg arrays so even a future
 * caller bug can't shell-inject. Updates the JSON file on success so the
 * next read serves the fresh data.
 */
async function refreshViaSsh(name: string): Promise<ContainerStatusDTO | null> {
  if (!isSshRefreshConfigured()) return null;
  if (!isSafeContainerName(name)) {
    log.warn("container-status: refusing ssh exec for unsafe name", { name });
    return null;
  }
  const sshTarget = `${env.STACK_HEALTH_SSH_USER}@${env.STACK_HEALTH_SSH_HOST}`;
  const sshKey = env.STACK_HEALTH_SSH_KEY_PATH!;

  // Single SSH call that prints both inspect and logs, separated by a
  // sentinel line so we can parse them out without two round-trips.
  // The remote command is a fixed string + the validated container name —
  // the host-side wrapper script (see docs/ops/stack-healthcheck.md) is
  // expected to allow only `docker inspect|logs` on registry containers.
  const sentinel = "----LEXARR-LOG-DIVIDER----";
  const remoteCmd = `docker inspect --format '{{.State.Status}}|{{.State.StartedAt}}' ${name} && echo ${sentinel} && docker logs --tail ${LOG_LINE_LIMIT} ${name} 2>&1`;

  try {
    const { stdout } = await execFileP(
      "ssh",
      [
        "-i",
        sshKey,
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "BatchMode=yes",
        "-o",
        `ConnectTimeout=${Math.floor(SSH_TIMEOUT_MS / 1000)}`,
        sshTarget,
        remoteCmd,
      ],
      { timeout: SSH_TIMEOUT_MS },
    );

    const [inspectPart, ...logParts] = stdout.split(sentinel);
    const [status, startedAt] = inspectPart
      .trim()
      .split("|")
      .map((s) => s.trim());
    const logs = logParts
      .join(sentinel)
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .slice(-LOG_LINE_LIMIT);

    const dto: ContainerStatusDTO = {
      name,
      status: status || null,
      startedAt: startedAt || null,
      uptime: uptimeFromStarted(startedAt || null, status || "unknown"),
      logs,
      asOf: new Date().toISOString(),
      source: "ssh",
      refreshAvailable: true,
    };

    // Best-effort write so subsequent reads serve fresh data without SSH.
    // Failure here doesn't fail the refresh — the caller still gets the DTO.
    try {
      await fs.mkdir(SERVICES_DIR, { recursive: true });
      await fs.writeFile(
        path.join(SERVICES_DIR, `${name}.json`),
        JSON.stringify(dto, null, 2),
      );
    } catch (err) {
      log.warn("container-status: failed to write snapshot after SSH refresh", {
        name,
        err,
      });
    }

    return dto;
  } catch (err: unknown) {
    log.warn("container-status: SSH refresh failed", { name, err });
    return null;
  }
}

/**
 * Get the current snapshot for a service. Defaults to the cron file;
 * with `{ refresh: true }` and SSH configured, fetches live and updates
 * the file. Returns null when neither path produces data — the modal
 * should render gracefully in that case.
 */
export async function getStatus(
  name: string,
  opts: { refresh?: boolean } = {},
): Promise<ContainerStatusDTO | null> {
  if (!isSafeContainerName(name)) return null;
  if (opts.refresh && isSshRefreshConfigured()) {
    const fresh = await refreshViaSsh(name);
    if (fresh) return fresh;
    // SSH failed — fall through to the cron snapshot rather than returning null.
  }
  return readSnapshot(name);
}

/** Exported for tests only. */
export const __testing = { isSafeContainerName, uptimeFromStarted };
