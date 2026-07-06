/**
 * Next.js instrumentation hook — runs once on server startup.
 * Starts a 60-second background interval to poll *arr apps
 * and update request statuses automatically.
 * Includes circuit breaker: backs off after repeated failures.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Validate required env vars at startup
    await import("./lib/env");

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

      setInterval(async () => {
        // Back off if too many failures — only try every 5th interval (5 minutes)
        if (
          consecutiveFailures >= MAX_FAILURES &&
          consecutiveFailures % 5 !== 0
        ) {
          consecutiveFailures++;
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
          if (result.updated > 0 || result.stuckFlagged > 0 || result.autoRetried > 0 || result.autoFailed > 0) {
            log.info("status-checker cycle completed", {
              updated: result.updated,
              stalled: result.stuckFlagged,
              retried: result.autoRetried,
              failed: result.autoFailed,
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
      }, 60_000);
    }, 10_000);
  }
}
