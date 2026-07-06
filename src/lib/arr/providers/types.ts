/**
 * Provider contracts for 0.17.x pluggable services.
 *
 * These interfaces describe the minimum surface each kind of integration
 * must expose so the registry (./registry.ts) can treat them uniformly.
 * Existing concrete modules (nzbget, qbittorrent, jellyfin, ...) implement
 * the shape by exporting a `provider` object — tree-shakable, and the
 * existing named exports remain for backwards compatibility during the
 * 0.17.x transition.
 *
 * Nothing here reads configuration yet. ServiceConnection wiring lands in
 * 0.17.3. For now providers read their own env vars as they always have.
 */

/** Categories surfaced in the admin dashboard's stack-health view. */
export type ProviderCategory =
  | "arr"
  | "download"
  | "media"
  | "utility"
  | "auth";

/** A single form field description used to render admin config UI. */
export interface ProviderFieldSpec {
  /** Programmatic key stored on `ServiceConnection.config` (except apiKey). */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Input kind. `secret` is masked in UI and encrypted at rest. */
  type: "string" | "secret" | "url" | "boolean" | "number";
  required?: boolean;
  /** Placeholder / hint text. */
  placeholder?: string;
  /** Default value applied when the admin creates a fresh connection. */
  default?: string | number | boolean;
}

/**
 * Static metadata describing a provider. Drives the admin Integrations UI
 * and the docs links. Registered once per provider kind at module load.
 */
export interface ProviderManifest {
  /** Stable kind key — e.g. "nzbget", "sabnzbd", "qbittorrent". */
  kind: string;
  /** Display name shown in the UI. */
  displayName: string;
  /** Short one-liner describing what this provider is for. */
  description: string;
  /** Which family of provider it satisfies. */
  category: ProviderCategory;
  /** Optional URL to upstream docs for operators. */
  docsUrl?: string;
  /** Optional icon (emoji or short glyph) for the UI. */
  icon?: string;
  /** Connection form fields rendered by the admin. */
  fields: ProviderFieldSpec[];
}

/** Common shape — every provider exposes a health probe and a manifest. */
export interface BaseProvider {
  readonly manifest: ProviderManifest;
  /** Lightweight connectivity check. Resolves true/false — never throws. */
  health(): Promise<boolean>;
}

/* ── Download clients ─────────────────────────────────────────────────── */

/** Generic handle for a queued download, regardless of protocol. */
export interface DownloadHandle {
  /** Protocol-appropriate id: NZBGet numeric id, qBit info-hash, etc. */
  id: string;
  /** Protocol family, so callers can branch when needed. */
  protocol: "usenet" | "torrent";
}

export interface DownloadStatus {
  name: string;
  savePath: string;
  progress: number;
  /** True when the download has finished and files are moved/processed. */
  complete: boolean;
  /** Raw state string from the client (for display / debugging). */
  rawState: string;
}

export interface DownloadClientProvider extends BaseProvider {
  category: "download";
  /**
   * Add a new download by URL. `category` is the arr category / nzbget
   * category — routes the download into the right post-processing path.
   * Returns a handle that can be used to poll completion.
   */
  addFromUrl(url: string, category?: string): Promise<DownloadHandle>;
  /** Look up an existing download. Returns null if not found. */
  getStatus(handle: DownloadHandle): Promise<DownloadStatus | null>;
}

/* ── Indexer providers (reserved for 0.17.4+) ─────────────────────────── */

export interface IndexerProvider extends BaseProvider {
  category: "utility";
}

/* ── Library / media server providers ─────────────────────────────────── */

export interface LibraryProvider extends BaseProvider {
  category: "media";
  /** Deep-link URL to search the library for a given title. */
  searchUrl(title: string): string;
}

/* ── Auth providers ───────────────────────────────────────────────────── */

export interface AuthProvider extends BaseProvider {
  category: "auth";
  /**
   * Stable id of the login method exposed to the client. Must match
   * what `/api/config` surfaces and what the login page dispatches on.
   */
  readonly authMethod: "plex" | "jellyfin" | "credentials" | string;
}

export type AnyProvider =
  | DownloadClientProvider
  | IndexerProvider
  | LibraryProvider
  | AuthProvider;
