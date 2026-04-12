/**
 * Startup environment variable validation.
 * Imported by instrumentation.ts — runs once at server startup.
 * Fails fast with a clear error if required vars are missing.
 */

export {}; // make this a module

const required = [
  "NEXTAUTH_SECRET",
  "ARR_HOST",
  "RADARR_API_KEY",
  "SONARR_API_KEY",
  "LIDARR_API_KEY",
  "TMDB_API_KEY",
] as const;

const optional = [
  "LEXARR_WEBHOOK_SECRET",
  "PROWLARR_API_KEY",
  "LAZYLIBRARIAN_API_KEY",
  "QBITTORRENT_URL",
  "QBITTORRENT_USER",
  "QBITTORRENT_PASS",
  "NZBGET_USER",
  "NZBGET_PASS",
  "PLEX_CLIENT_ID",
  "JELLYFIN_URL",
] as const;

const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variable(s): ${missing.join(", ")}\n` +
      `Copy .env.example to .env and fill in the values.`
  );
}

// Warn about recommended optional vars
if (!process.env.LEXARR_WEBHOOK_SECRET) {
  console.warn(
    "[env] LEXARR_WEBHOOK_SECRET is not set — webhook endpoints will reject all requests. " +
      "Set it in .env and configure matching tokens in Radarr/Sonarr/Lidarr."
  );
}
