/**
 * Provider registry.
 *
 * In 0.17.2 this sits alongside the existing router/dashboard wiring
 * without replacing it — concrete modules self-register at import time,
 * but the rest of the app still reads the old named exports directly.
 * 0.17.6 flips callers to read from here so that DB-configured
 * ServiceConnections can take over from env vars.
 */

import type {
  AnyProvider,
  AuthProvider,
  DownloadClientProvider,
  IndexerProvider,
  LibraryProvider,
  ProviderCategory,
} from "./types";

const providers = new Map<string, AnyProvider>();

/** Register a provider by its manifest kind. Last-write-wins. */
export function registerProvider(provider: AnyProvider): void {
  providers.set(provider.manifest.kind, provider);
}

/** Look up a single provider by its kind key. */
export function getProvider(kind: string): AnyProvider | undefined {
  return providers.get(kind);
}

/** List every registered provider. */
export function listProviders(): AnyProvider[] {
  return Array.from(providers.values());
}

/** List providers in a given category, narrowed to the right union member. */
export function listProvidersByCategory(
  category: "download",
): DownloadClientProvider[];
export function listProvidersByCategory(category: "media"): LibraryProvider[];
export function listProvidersByCategory(category: "auth"): AuthProvider[];
export function listProvidersByCategory(
  category: "utility",
): IndexerProvider[];
export function listProvidersByCategory(category: "arr"): AnyProvider[];
export function listProvidersByCategory(
  category: ProviderCategory,
): AnyProvider[] {
  return Array.from(providers.values()).filter(
    (p) => p.manifest.category === category,
  );
}

/** Test-only: wipe all registrations. */
export function _resetRegistry(): void {
  providers.clear();
}

/**
 * Shape returned to callers — the decrypted view of a ServiceConnection row.
 *
 * This is the contract the 0.17.2+ roadmap (parked post-1.0.0) will consume
 * once concrete clients (radarr/sonarr/qbit/etc.) are refactored onto
 * DB-backed config. For now `loadServiceConnections()` proves the read
 * path compiles, runs, and no-ops cleanly on an empty table.
 */
export interface LoadedServiceConnection {
  id: string;
  category: string;
  kind: string;
  name: string;
  baseUrl: string;
  /** Decrypted plaintext secret. Never persisted in this shape. */
  secret: string;
  config: unknown;
  enabled: boolean;
}

/**
 * Load all enabled ServiceConnection rows from the DB, decrypting each
 * row's `encryptedSecret` eagerly so downstream consumers get a ready-to-use
 * value.
 *
 * No-op (returns []) if the table is empty — existing env-based clients
 * (radarr/sonarr/lidarr/lazylibrarian/qbittorrent/nzbget/bazarr/prowlarr/
 * jellyfin) continue to read `process.env.*` unchanged.
 *
 * This function does NOT call `registerProvider()` for concrete services.
 * Wiring the DB rows through to the existing clients is the 0.17.2+
 * roadmap (parked post-1.0.0 per the 2026-04-24 scope decision). When
 * that work resumes, the loader callers should be in
 * `src/instrumentation.ts` (startup) and/or inside each provider module's
 * factory.
 *
 * Imports of `@/lib/db` and `@/lib/crypto` are deferred (dynamic `await
 * import`) so this registry module stays cheap to import from test
 * harnesses and edge-runtime contexts that never call the loader.
 */
export async function loadServiceConnections(): Promise<
  LoadedServiceConnection[]
> {
  const { prisma } = await import("@/lib/db");
  const { decrypt } = await import("@/lib/crypto");

  const rows = await prisma.serviceConnection.findMany({
    where: { enabled: true },
  });
  if (rows.length === 0) return [];

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    kind: row.kind,
    name: row.name,
    baseUrl: row.baseUrl,
    secret: decrypt(row.encryptedSecret),
    // `config` is stored as a JSON-encoded string (sqlite connector
    // doesn't support Prisma's native Json type). Parse leniently —
    // a malformed row shouldn't crash the loader for every other row.
    config: safeJsonParse(row.config),
    enabled: row.enabled,
  }));
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
