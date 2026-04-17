/**
 * Startup environment variable validation using Zod.
 * Imported by instrumentation.ts — runs once at server startup.
 * Fails fast with a clear error if required vars are missing or malformed.
 */
import { z } from "zod";

const envSchema = z.object({
  // Required
  NEXTAUTH_SECRET: z.string().min(1),
  ARR_HOST: z.string().url().or(z.string().startsWith("http")),
  RADARR_API_KEY: z.string().min(1),
  SONARR_API_KEY: z.string().min(1),
  LIDARR_API_KEY: z.string().min(1),
  TMDB_API_KEY: z.string().min(1),

  // Optional
  LEXARR_WEBHOOK_SECRET: z.string().optional(),
  PROWLARR_API_KEY: z.string().optional(),
  LAZYLIBRARIAN_API_KEY: z.string().optional(),
  LAZYLIBRARIAN_PORT: z.string().optional(),
  QBITTORRENT_URL: z.string().optional(),
  QBITTORRENT_USER: z.string().optional(),
  QBITTORRENT_PASS: z.string().optional(),
  NZBGET_URL: z.string().optional(),
  NZBGET_USER: z.string().optional(),
  NZBGET_PASS: z.string().optional(),
  BAZARR_URL: z.string().optional(),
  BAZARR_API_KEY: z.string().optional(),
  PLEX_CLIENT_ID: z.string().optional(),
  AUTH_PLEX_ENABLED: z.string().optional(), // "true" to show the Plex login button
  AUTH_JELLYFIN_ENABLED: z.string().optional(), // default on; "false" to hide
  JELLYFIN_URL: z.string().optional(),
  REGISTRATION_OPEN: z.string().optional(),
  DATABASE_URL: z.string().optional(),

  // Failover admin — ensures an admin always exists on fresh installs / DB wipes
  BOOTSTRAP_ADMIN_USERNAME: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(6).optional(),
});

export type Env = z.infer<typeof envSchema>;

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const issues = result.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Environment validation failed:\n${issues}\n\nCopy .env.example to .env and fill in the values.`,
  );
}

export const env = result.data;

// Warn about recommended optional vars
if (!env.LEXARR_WEBHOOK_SECRET) {
  console.warn(
    "[env] LEXARR_WEBHOOK_SECRET is not set �� webhook endpoints will reject all requests. " +
      "Set it in .env and configure matching tokens in Radarr/Sonarr/Lidarr.",
  );
}
