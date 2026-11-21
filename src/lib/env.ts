/**
 * The one place Lexarr reads its configuration.
 *
 * - `env()` returns the validated config, read from process.env at call
 *   time (not at import), so clients pick up the current values and tests
 *   can change variables between cases without import-order tricks. It
 *   never throws: if validation fails it returns the raw values, exactly as
 *   reading process.env directly used to.
 * - `validateEnvOrThrow()` is the fail-fast check. instrumentation.ts calls
 *   it once at server startup.
 *
 * Reading `process.env` anywhere else in src/ is a lint error (see
 * eslint.config.mjs) -- add the variable to the schema below instead.
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
  NEXTAUTH_URL: z.string().optional(),
  // Every address Lexarr is served at, comma-separated, primary first
  // (src/lib/public-origin.ts). Replaces NEXTAUTH_URL when set.
  LEXARR_PUBLIC_URLS: z.string().optional(),
  LEXARR_WEBHOOK_SECRET: z.string().optional(),
  PROWLARR_API_KEY: z.string().optional(),
  LAZYLIBRARIAN_API_KEY: z.string().optional(),
  LAZYLIBRARIAN_PORT: z.string().optional(),
  PORT: z.string().optional(), // port Lexarr listens on (readiness self-check)
  QBITTORRENT_URL: z.string().optional(),
  QBITTORRENT_USER: z.string().optional(),
  QBITTORRENT_PASS: z.string().optional(),
  NZBGET_URL: z.string().optional(),
  NZBGET_USER: z.string().optional(),
  NZBGET_PASS: z.string().optional(),
  BAZARR_URL: z.string().optional(),
  BAZARR_API_KEY: z.string().optional(),
  LASTFM_API_KEY: z.string().optional(),
  PLEX_CLIENT_ID: z.string().optional(),
  AUTH_PLEX_ENABLED: z.string().optional(), // "true" to show the Plex login button
  AUTH_JELLYFIN_ENABLED: z.string().optional(), // default on; "false" to hide
  JELLYFIN_URL: z.string().optional(),
  REGISTRATION_OPEN: z.string().optional(),
  // "false" turns off the admin-only "update available" check, which asks
  // GitHub for the latest release once a day (src/lib/update-check.ts).
  LEXARR_UPDATE_CHECK: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  // Build provenance baked in by the Dockerfile (see /api/version).
  GIT_SHA: z.string().optional(),
  BUILD_TIME: z.string().optional(),
  // Test-only: points TMDB calls at the e2e stub server (e2e/stub-server.mjs).
  TMDB_API_BASE: z.string().url().optional(),
  // Test-only: points the Music/Books discovery sources (Apple chart,
  // MusicBrainz, OpenLibrary) at the same stub, under /apple, /musicbrainz
  // and /openlibrary.
  DISCOVER_STUB_BASE: z.string().url().optional(),

  // Number of reverse-proxy hops to trust for rate-limiting's
  // X-Forwarded-For lookup. See src/lib/rate-limit.ts and .env.example.
  TRUSTED_PROXY_HOPS: z.string().optional(),
  // Comma-separated TCP peer addresses whose X-Forwarded-For is believed
  // (e.g. the Docker gateway when `tailscale serve` runs on the host).
  LEXARR_TRUSTED_PROXIES: z.string().optional(),
  // Strict-Transport-Security max-age (seconds) on HTTPS responses through
  // a trusted proxy. Default 86400; 0 tells browsers to forget it. See hsts.ts.
  LEXARR_HSTS_MAX_AGE: z.string().optional(),
  // Set to "1" by the Dockerfile, which preloads scripts/client-ip-preload.cjs
  // to stamp the real TCP peer address on each request. See rate-limit.ts.
  LEXARR_CLIENT_IP_HEADER: z.string().optional(),
  // Per-route ceiling across all clients (multiple of the per-client
  // limit) when TRUSTED_PROXY_HOPS is 0. See src/lib/rate-limit.ts.
  RATE_LIMIT_CEILING_MULTIPLIER: z.string().optional(),

  // Failover admin — ensures an admin always exists on fresh installs / DB wipes
  BOOTSTRAP_ADMIN_USERNAME: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(6).optional(),
  BOOTSTRAP_ADMIN_RESET: z.string().optional(), // "true" to reset that admin's password on start (rescue only)

  // Where the host-side stack-healthcheck cron's JSON snapshots are mounted
  // (docker run -v .../stack-healthcheck:/stack-health:ro).
  STACK_HEALTH_DIR: z.string().optional(),

  // (M2-01) Optional SSH-to-Unraid path for fresh container logs / inspect.
  // When ALL THREE are set, the Diagnose modal exposes a "Refresh now" button
  // that runs `docker logs <name> --tail 50` and `docker inspect <name>` over
  // SSH. When unset, the modal falls back to the JSON snapshot that the host
  // stack-healthcheck cron writes to /stack-health/services/<name>.json.
  // See docs/ops/stack-healthcheck.md for the host-side script extension.
  STACK_HEALTH_SSH_HOST: z.string().optional(),
  STACK_HEALTH_SSH_USER: z.string().optional(),
  STACK_HEALTH_SSH_KEY_PATH: z.string().optional(),

  // Base URL of the Unraid web UI, for container deep links from the admin
  // dashboard (e.g. http://192.168.1.100). Unset: no deep links.
  UNRAID_BASE_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * process.env without empty values. .env.example lists every variable as
 * `KEY=`, and Docker's --env-file passes those through as "", so an
 * untouched line must count as unset, not as an (invalid) empty value.
 */
function setVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v.trim() !== "") out[k] = v;
  return out;
}

/** The six variables Lexarr cannot start without. */
export const REQUIRED_ENV = [
  "NEXTAUTH_SECRET",
  "ARR_HOST",
  "RADARR_API_KEY",
  "SONARR_API_KEY",
  "LIDARR_API_KEY",
  "TMDB_API_KEY",
] as const;

export interface EnvIssue {
  /** Variable name. Never its value: this list is shown to signed-out visitors. */
  name: string;
  problem: "missing" | "invalid";
}

/**
 * Every configuration problem right now, empty when the config is usable.
 * Names only, never values. Unlike validateEnvOrThrow() it does not throw,
 * so the server can start in "setup needed" mode and say what is wrong
 * (src/proxy.ts, src/app/setup-needed).
 */
export function envIssues(): EnvIssue[] {
  const raw = setVars();
  const result = envSchema.safeParse(raw);
  if (result.success) return [];
  const seen = new Set<string>();
  const out: EnvIssue[] = [];
  for (const i of result.error.issues) {
    const name = String(i.path[0] ?? "");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, problem: raw[name] === undefined ? "missing" : "invalid" });
  }
  return out;
}

/** The validated config, read now. Never throws (see file comment). */
export function env(): Env {
  const raw = setVars();
  const result = envSchema.safeParse(raw);
  return result.success ? result.data : (raw as unknown as Env);
}

/**
 * Fail fast on missing or malformed configuration. Called once at server
 * startup from instrumentation.ts -- not at import, because Next.js's build
 * step imports route modules without the runtime env present (that only
 * arrives via `docker run --env-file`).
 */
export function validateEnvOrThrow(): void {
  const result = envSchema.safeParse(setVars());
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Environment validation failed:\n${issues}\n\nCopy .env.example to .env and fill in the values.`,
    );
  }

  if (!result.data.LEXARR_WEBHOOK_SECRET) {
    // Plain console.warn: this runs before the structured logger is
    // imported in instrumentation.ts.
    console.warn(
      "[env] LEXARR_WEBHOOK_SECRET is not set -- webhook endpoints will reject all requests. " +
        "Set it in .env and configure matching tokens in Radarr/Sonarr/Lidarr.",
    );
  }
}
