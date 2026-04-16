/**
 * Stack health integration — reads the latest report from stack-healthcheck.sh.
 *
 * The host-side cron writes to /mnt/user/data/stack-healthcheck/latest-report.txt
 * every 4 hours. Container must mount that directory:
 *   -v /mnt/user/data/stack-healthcheck:/stack-health:ro
 */
import { promises as fs } from "node:fs";
import { statSync } from "node:fs";
import { join } from "node:path";

const HEALTH_DIR = process.env.STACK_HEALTH_DIR || "/stack-health";
const REPORT_FILE = join(HEALTH_DIR, "latest-report.txt");

export interface StackHealthReport {
  /** File mtime — when the script last ran */
  lastRunAt: string;
  /** Parsed from report header: when the check started */
  timestamp: string | null;
  /** Total issues found this run */
  issueCount: number;
  /** Items auto-cleaned this run (stuck downloads, etc.) */
  cleanedCount: number;
  /** Whether auto-cleanup is enabled */
  autoCleanup: boolean;
  /** Minutes since the last run (convenience) */
  staleMinutes: number;
  /** Full human-readable body (what the script prints after the header) */
  body: string;
}

export async function readStackHealth(): Promise<StackHealthReport | null> {
  try {
    const stat = statSync(REPORT_FILE);
    const raw = await fs.readFile(REPORT_FILE, "utf-8");

    // Header is `KEY=value` lines ending with a `---` delimiter
    const header: Record<string, string> = {};
    const lines = raw.split("\n");
    let bodyStart = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "---") {
        bodyStart = i + 1;
        break;
      }
      const eq = line.indexOf("=");
      if (eq > 0) {
        header[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }

    const body = lines.slice(bodyStart).join("\n").trim();
    const staleMinutes = Math.round(
      (Date.now() - stat.mtimeMs) / 60000,
    );

    return {
      lastRunAt: stat.mtime.toISOString(),
      timestamp: header.TIMESTAMP || null,
      issueCount: parseInt(header.ISSUES || "0", 10),
      cleanedCount: parseInt(header.CLEANED || "0", 10),
      autoCleanup: header.AUTO_CLEANUP === "1",
      staleMinutes,
      body,
    };
  } catch (err: unknown) {
    // File missing, volume not mounted, permissions — all collapse to null
    // so the dashboard just hides the tile instead of crashing.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "EACCES") return null;
    throw err;
  }
}
