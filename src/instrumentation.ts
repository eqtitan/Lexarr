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

    // Start background polling after a short delay to let the server fully initialize
    setTimeout(() => {
      let consecutiveFailures = 0;
      const MAX_FAILURES = 10;

      setInterval(async () => {
        // Back off if too many failures — only try every 5th interval (5 minutes)
        if (consecutiveFailures >= MAX_FAILURES && consecutiveFailures % 5 !== 0) {
          consecutiveFailures++;
          return;
        }

        try {
          const { checkAndUpdateStatuses } = await import("./lib/status-checker");
          const result = await checkAndUpdateStatuses();
          if (consecutiveFailures >= MAX_FAILURES) {
            console.log("[status-checker] Recovered after backoff");
          }
          consecutiveFailures = 0;
          if (result.updated > 0 || result.stuckFlagged > 0) {
            console.log(`[status-checker] Updated: ${result.updated}, Stalled: ${result.stuckFlagged}`);
          }
        } catch (err) {
          consecutiveFailures++;
          console.error(`[status-checker] Error (${consecutiveFailures}/${MAX_FAILURES}):`, err);
          if (consecutiveFailures === MAX_FAILURES) {
            console.error("[status-checker] Too many failures, backing off to 5-minute interval");
          }
        }
      }, 60_000);
    }, 10_000);
  }
}
