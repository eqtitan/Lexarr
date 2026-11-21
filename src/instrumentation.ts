/**
 * Next.js instrumentation hook — runs once on server startup.
 * Starts a 60-second background interval to poll *arr apps
 * and update request statuses automatically.
 * Includes circuit breaker: backs off after repeated failures.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Validate required env vars at startup. If any are missing or malformed
    // the server still starts, in "setup needed" mode: src/proxy.ts sends
    // pages to /setup-needed and answers APIs with 503, and nothing below
    // (admin bootstrap, background polling) runs. A restart with the
    // variables fixed brings the app up normally.
    const { envIssues, validateEnvOrThrow } = await import("./lib/env");
    const issues = envIssues();
    if (issues.length > 0) {
      console.error(
        "[env] Lexarr is not configured. Showing the setup page instead of starting.\n" +
          issues.map((i) => `  ${i.name}: ${i.problem}`).join("\n") +
          "\nCopy .env.example to .env, fill in the values and restart the container.",
      );
      return;
    }
    validateEnvOrThrow();

    // Failover admin bootstrap — ensure at least one admin always exists
    try {
      const { ensureBootstrapAdmin } = await import("./lib/bootstrap-admin");
      const { prisma } = await import("./lib/db");
      await ensureBootstrapAdmin(prisma);
    } catch (err: unknown) {
      const { log } = await import("./lib/log");
      log.error("bootstrap-admin failed", { err });
    }

    // Start background polling after a short delay to let the server fully initialize
    setTimeout(() => {
      let consecutiveFailures = 0;
      const MAX_FAILURES = 10;
      let pollCycleCount = 0;

      // Self-rescheduling setTimeout, not setInterval: setInterval fires on a
      // fixed clock regardless of whether the previous async callback has
      // finished, so a single slow cycle causes overlapping concurrent runs
      // that race each other's writes to the same SQLite rows (observed
      // 2026-07-12 as persistent "Operations timed out" Prisma errors on
      // every poll for the same set of active requests, which a container
      // restart did not clear — a structural bug, not stuck state).
      // Scheduling the next run only after the current one resolves
      // guarantees at most one cycle in flight at a time. (Ported from the
      // 0.18.1/0.18.2 hotfix that was deployed to the server but never pushed;
      // checkAndUpdateStatuses() also joins an in-flight cycle, for the
      // other callers.)
      const runCycle = async () => {
        // Back off if too many failures — only try every 5th interval (5 minutes)
        if (
          consecutiveFailures >= MAX_FAILURES &&
          consecutiveFailures % 5 !== 0
        ) {
          consecutiveFailures++;
          setTimeout(() => void runCycle(), 60_000);
          return;
        }

        pollCycleCount++;

        const { log } = await import("./lib/log");
        try {
          const { checkAndUpdateStatuses, cleanDeadDownloads } =
            await import("./lib/status-checker");
          const result = await checkAndUpdateStatuses();
          if (consecutiveFailures >= MAX_FAILURES) {
            log.info("status-checker recovered after backoff");
          }
          consecutiveFailures = 0;
          if (result.updated > 0 || result.autoRetried > 0 || result.autoFailed > 0 || result.lateArrivals > 0) {
            log.info("status-checker cycle completed", {
              updated: result.updated,
              retried: result.autoRetried,
              failed: result.autoFailed,
              lateArrivals: result.lateArrivals,
            });
          }

          // Clean dead downloads every 15th cycle (every 15 minutes)
          if (pollCycleCount % 15 === 0) {
            try {
              const cleaned = await cleanDeadDownloads();
              if (cleaned > 0) {
                log.info("status-checker cleaned dead downloads", { cleaned });
              }
            } catch (err: unknown) {
              log.error("status-checker cleanDeadDownloads error", { err });
            }
          }
        } catch (err) {
          consecutiveFailures++;
          log.error("status-checker cycle error", {
            consecutiveFailures,
            maxFailures: MAX_FAILURES,
            err,
          });
          if (consecutiveFailures === MAX_FAILURES) {
            log.error("status-checker too many failures, backing off to 5-minute interval");
          }
        }

        setTimeout(() => void runCycle(), 60_000);
      };

      void runCycle();
    }, 10_000);

    // Fill the Music / Books discovery lists in the background (matching the
    // album chart to MusicBrainz takes ~30s at its 1 request/second limit),
    // then refresh them twice a day, so opening the tab never waits on it.
    // If a source was down, try again in 15 minutes instead.
    const DISCOVER_REFRESH_MS = 12 * 60 * 60 * 1000;
    const DISCOVER_RETRY_MS = 15 * 60 * 1000;
    const refreshDiscover = async () => {
      let complete = false;
      try {
        const { refreshDiscoverPools } = await import("./lib/services/discover");
        complete = await refreshDiscoverPools();
      } catch (err: unknown) {
        const { log } = await import("./lib/log");
        log.warn("discover refresh error", { err });
      }
      setTimeout(() => void refreshDiscover(), complete ? DISCOVER_REFRESH_MS : DISCOVER_RETRY_MS);
    };
    setTimeout(() => void refreshDiscover(), 30_000);
  }
}
