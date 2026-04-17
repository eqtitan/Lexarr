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
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[bootstrap-admin] Failed: ${msg}`);
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

        try {
          const { checkAndUpdateStatuses, cleanDeadDownloads } =
            await import("./lib/status-checker");
          const result = await checkAndUpdateStatuses();
          if (consecutiveFailures >= MAX_FAILURES) {
            console.log("[status-checker] Recovered after backoff");
          }
          consecutiveFailures = 0;
          if (result.updated > 0 || result.stuckFlagged > 0 || result.autoRetried > 0 || result.autoFailed > 0) {
            console.log(
              `[status-checker] Updated: ${result.updated}, Stalled: ${result.stuckFlagged}, Retried: ${result.autoRetried}, Failed: ${result.autoFailed}`,
            );
          }

          // Clean dead downloads every 15th cycle (every 15 minutes)
          if (pollCycleCount % 15 === 0) {
            try {
              const cleaned = await cleanDeadDownloads();
              if (cleaned > 0) {
                console.log(`[status-checker] Cleaned ${cleaned} dead downloads`);
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[status-checker] cleanDeadDownloads error: ${msg}`);
            }
          }
        } catch (err) {
          consecutiveFailures++;
          console.error(
            `[status-checker] Error (${consecutiveFailures}/${MAX_FAILURES}):`,
            err,
          );
          if (consecutiveFailures === MAX_FAILURES) {
            console.error(
              "[status-checker] Too many failures, backing off to 5-minute interval",
            );
          }
        }
      }, 60_000);
    }, 10_000);
  }
}
