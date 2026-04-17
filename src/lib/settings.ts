/**
 * Typed key/value store backed by the `AppSetting` table.
 *
 * Each setting has a well-known key (namespaced by feature, e.g.
 * `music.allowedRegions`), a default, and a validator. Callers get a
 * typed value or the default — never a raw DB read.
 *
 * Keep this file the single source of truth for setting keys + defaults.
 * Adding a new setting? Add an entry to SETTING_SPECS and export a
 * dedicated accessor.
 */
import { prisma } from "./db";

// ── Region codes (ISO 3166-1 alpha-2) ────────────────────────────────

/**
 * Regions Lexarr offers for music-release filtering. Order = display
 * order in the admin UI. First two (US, GB) are the default-selected
 * set when no setting has been written yet.
 */
export const SUPPORTED_REGIONS = [
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "IE", label: "Ireland" },
  { code: "NZ", label: "New Zealand" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "JP", label: "Japan" },
  { code: "IT", label: "Italy" },
  { code: "ES", label: "Spain" },
  { code: "NL", label: "Netherlands" },
  { code: "SE", label: "Sweden" },
  { code: "BR", label: "Brazil" },
  { code: "MX", label: "Mexico" },
  { code: "KR", label: "South Korea" },
] as const;

export type RegionCode = (typeof SUPPORTED_REGIONS)[number]["code"];

/**
 * Default is empty (no filter) because MusicBrainz's `release-group`
 * search index doesn't support a `country:` field. Any non-empty
 * value applied as a Lucene clause silently zeros the result set.
 * The admin UI still exposes the setting for forward-compatibility
 * with a post-fetch filter approach planned for 0.13.x. Until that
 * lands, the setting is a no-op.
 */
export const DEFAULT_ALLOWED_REGIONS: RegionCode[] = [];

const SUPPORTED_REGION_SET = new Set<string>(
  SUPPORTED_REGIONS.map((r) => r.code),
);

function sanitizeRegions(raw: unknown): RegionCode[] {
  if (!Array.isArray(raw)) return DEFAULT_ALLOWED_REGIONS;
  const filtered = raw.filter(
    (r): r is RegionCode => typeof r === "string" && SUPPORTED_REGION_SET.has(r),
  );
  // An empty array is *valid* and means "no region filter" — preserve it.
  // The default only kicks in for malformed / missing data.
  return filtered;
}

// ── Generic get/set ──────────────────────────────────────────────────

async function readRaw(key: string): Promise<unknown | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

async function writeRaw(key: string, value: unknown): Promise<void> {
  const encoded = JSON.stringify(value);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: encoded },
    update: { value: encoded },
  });
}

// ── Typed accessors (one per setting) ────────────────────────────────

/**
 * Read the admin-configured allowed-regions list. Empty array means
 * "no region filter" (show results from everywhere). Default when
 * unset: ["US", "GB"].
 */
export async function getAllowedRegions(): Promise<RegionCode[]> {
  const raw = await readRaw("music.allowedRegions");
  if (raw === null) return DEFAULT_ALLOWED_REGIONS;
  return sanitizeRegions(raw);
}

export async function setAllowedRegions(regions: RegionCode[]): Promise<void> {
  // Sanitize before persisting so the DB never holds malformed input.
  const clean = regions.filter((r) => SUPPORTED_REGION_SET.has(r));
  await writeRaw("music.allowedRegions", clean);
}

// ── Test-only helpers ────────────────────────────────────────────────

export const __testing = {
  sanitizeRegions,
};
