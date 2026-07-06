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

  // (M2-01) Optional SSH-to-Unraid path for fresh container logs / inspect.
  // When ALL THREE are set, the Diagnose modal exposes a "Refresh now" button
  // that runs `docker logs <name> --tail 50` and `docker inspect <name>` over
  // SSH. When unset, the modal falls back to the JSON snapshot that the host
  // stack-healthcheck cron writes to /stack-health/services/<name>.json.
  // See docs/ops/stack-healthcheck.md for the host-side script extension.
  STACK_HEALTH_SSH_HOST: z.string().optional(),
  STACK_HEALTH_SSH_USER: z.string().optional(),
  STACK_HEALTH_SSH_KEY_PATH: z.string().optional(),

  // (M2-02) Base URL for Unraid container deep links. Defaults to the LAN IP
  // documented in CLAUDE.md; operators on a different host override it.
  UNRAID_BASE_URL: z.string().optional(),

  // (P-06) AES-256 key for ServiceConnection secrets at rest.
  // Hex-encoded, exactly 32 bytes / 64 hex chars. When unset, the data key
  // is HKDF-derived from NEXTAUTH_SECRET — see src/lib/crypto.ts.
  // Generate one with: `openssl rand -hex 32`
  LEXARR_DATA_KEY: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || /^[0-9a-fA-F]{64}$/.test(v.trim()),
      {
        message:
          "LEXARR_DATA_KEY must be 64 hex chars (32 bytes). Generate one with: openssl rand -hex 32",
      },
    ),
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
  // Structured logger not imported here — env.ts is a module-load dependency
  // of @/lib/log indirectly, and pulling log.ts in here risks circulars in
  // the instrumentation hook. A plain console.warn at startup is fine for
  // this one specific warning. (Mojibake at this site also fixed — was `��`)
  console.warn(
    "[env] LEXARR_WEBHOOK_SECRET is not set -- webhook endpoints will reject all requests. " +
      "Set it in .env and configure matching tokens in Radarr/Sonarr/Lidarr.",
  );
}
