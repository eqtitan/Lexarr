import type { SearchResult, MusicReleaseType } from "@/types";

const BASE = "https://musicbrainz.org/ws/2";
const UA = "Lexarr/1.0 (media-request-portal)";

/**
 * Optional filters applied to a music search.
 *   releaseType: restrict to Single / EP / Album (omit for all types).
 *     Used by the sub-filter chip on the Music tab.
 *   allowedRegions: ISO 3166-1 alpha-2 codes (e.g. ["US","GB"]). Empty
 *     or omitted = no region filter. Applied via MB's Lucene-style
 *     `country:` clause on text search only — the artist-matched
 *     discography path ignores region because you're browsing a known
 *     artist's catalog; filtering by where their releases were pressed
 *     would hide tracks confusingly.
 */
export interface MusicSearchOptions {
  releaseType?: "single" | "ep" | "album";
  allowedRegions?: string[];
}

// ── MB response types ────────────────────────────────────────────────

interface MbArtist {
  id: string;
  name: string;
  score?: number;
  disambiguation?: string;
}

interface MbReleaseGroup {
  id: string;
  title: string;
  "first-release-date"?: string;
  "primary-type"?: string;
  /**
   * MB secondary classifications. Common values: "Live", "Remix",
   * "Compilation", "Soundtrack", "Demo", "Spokenword", "Audiobook",
   * "DJ-mix". A release-group may have zero or many. Orthogonal to
   * primary-type: a "Live Album" is primary=Album + secondary=["Live"].
   */
  "secondary-types"?: string[];
  "artist-credit"?: { name: string; artist?: { id: string } }[];
  releases?: { id: string }[];
  score?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function normalizeType(mbType?: string): MusicReleaseType | undefined {
  if (!mbType) return undefined;
  const t = mbType.toLowerCase();
  if (t === "album") return "album";
  if (t === "single") return "single";
  if (t === "ep") return "ep";
  return "other";
}

/** Secondary types that are common enough to be worth surfacing in the UI. */
const SECONDARY_TYPE_WHITELIST = new Set([
  "Live",
  "Remix",
  "Compilation",
  "Soundtrack",
  "Demo",
  "Acoustic",
  "Mixtape/Street",
  "DJ-mix",
  "Interview",
  "Audiobook",
  "Audio drama",
  "Spokenword",
]);

function filterSecondaryTypes(st?: string[]): string[] | undefined {
  if (!st || st.length === 0) return undefined;
  const kept = st.filter((t) => SECONDARY_TYPE_WHITELIST.has(t));
  return kept.length > 0 ? kept : undefined;
}

function toResult(rg: MbReleaseGroup): SearchResult {
  const artistCredit = rg["artist-credit"]?.[0];
  const artist = artistCredit?.name || "Unknown Artist";
  const artistId = artistCredit?.artist?.id;
  const secondaryTypes = filterSecondaryTypes(rg["secondary-types"]);
  const primary = rg["primary-type"] || "Release";
  // Overview pulls in secondary-types so users see "Live Album by …"
  // instead of just "Album by …" when relevant.
  const typeLabel = secondaryTypes
    ? `${secondaryTypes.join(" ")} ${primary}`.trim()
    : primary;
  return {
    id: rg.id,
    mediaType: "music",
    title: rg.title || "Unknown",
    year: rg["first-release-date"]?.slice(0, 4),
    overview: `${typeLabel} by ${artist}`,
    posterUrl: `https://coverartarchive.org/release-group/${rg.id}/front-250`,
    artist,
    artistId,
    releaseType: normalizeType(rg["primary-type"]),
    secondaryTypes,
  };
}

async function mbGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) {
      // MusicBrainz rate-limits anonymous clients to 1 req/sec and returns
      // 503 when exceeded. Surface the status so ops can tell
      // "rate-limited" from "API down" from "query malformed" — without it,
      // every upstream failure degrades silently to an empty result set.
      console.warn(
        `[musicbrainz] ${path} → HTTP ${res.status} ${res.statusText}`,
      );
      return null;
    }
    return (await res.json()) as T;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[musicbrainz] ${path} → network error: ${msg}`);
    return null;
  }
}

// ── Primary-type ordering (albums first — tie-break only) ─────────────

const TYPE_WEIGHT: Record<string, number> = {
  album: 0,
  ep: 1,
  single: 2,
  other: 3,
};

function typeWeight(rg: MbReleaseGroup): number {
  const t = (rg["primary-type"] || "").toLowerCase();
  return TYPE_WEIGHT[t] ?? TYPE_WEIGHT.other;
}

function yearOf(rg: MbReleaseGroup): number {
  const d = rg["first-release-date"];
  return d ? parseInt(d.slice(0, 4), 10) || 0 : 0;
}

// ── Artist detection ────────────────────────────────────────────────

interface ArtistDetection {
  mbid: string;
  name: string;
  confidence: "strong" | "none";
}

/**
 * True if the top artist is a confident match for the query:
 *   - Top score >= 90
 *   - Top score is >= 10 points above the runner-up (or no runner-up)
 *   - Top artist name matches the query, modulo case + common punctuation
 */
async function detectArtist(query: string): Promise<ArtistDetection> {
  const data = await mbGet<{ artists?: MbArtist[] }>(
    `/artist?query=${encodeURIComponent(query)}&limit=5&fmt=json`,
  );
  const artists = data?.artists ?? [];
  if (artists.length === 0) return { mbid: "", name: "", confidence: "none" };

  const top = artists[0];
  const runnerUp = artists[1];

  const topScore = top.score ?? 0;
  const runnerScore = runnerUp?.score ?? 0;

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const nameMatches = normalize(top.name) === normalize(query);

  const confident =
    topScore >= 90 && (topScore - runnerScore >= 10 || !runnerUp) && nameMatches;

  return confident
    ? { mbid: top.id, name: top.name, confidence: "strong" }
    : { mbid: "", name: "", confidence: "none" };
}

// ── Discography fetch for a known artist ────────────────────────────

async function fetchDiscography(mbid: string): Promise<MbReleaseGroup[]> {
  // `inc=artist-credits` keeps artist info in the response (browsing by
  // artist strips it by default). `inc=releases` is rejected on the
  // browse endpoint — only available on text search.
  const data = await mbGet<{ "release-groups"?: MbReleaseGroup[] }>(
    `/release-group?artist=${mbid}&limit=100&inc=artist-credits&fmt=json`,
  );
  return data?.["release-groups"] ?? [];
}

/**
 * Distribute the top N slots across release types so a prolific artist's
 * singles and EPs aren't completely buried by albums. For Fall Out Boy
 * with 15+ albums, the naive "sort by year, take 15" returns 15 albums
 * and the user never sees any singles or EPs. This picker guarantees a
 * mix while preserving within-bucket year-descending order.
 *
 * Budget per 15 slots: 8 albums, 3 EPs, 3 singles, 1 other. If a bucket
 * has fewer entries than its budget, the leftover goes back to the album
 * pool — we never leave empty slots when more content exists.
 */
function pickDiscographyMix(
  groups: MbReleaseGroup[],
  limit: number,
): MbReleaseGroup[] {
  const byYear = (a: MbReleaseGroup, b: MbReleaseGroup) =>
    yearOf(b) - yearOf(a);

  const buckets = {
    album: groups.filter((g) => typeWeight(g) === 0).sort(byYear),
    ep: groups.filter((g) => typeWeight(g) === 1).sort(byYear),
    single: groups.filter((g) => typeWeight(g) === 2).sort(byYear),
    other: groups.filter((g) => typeWeight(g) === 3).sort(byYear),
  };

  const targets = [
    { name: "album" as const, want: Math.ceil(limit * 0.55) },
    { name: "ep" as const, want: Math.ceil(limit * 0.2) },
    { name: "single" as const, want: Math.ceil(limit * 0.2) },
    { name: "other" as const, want: Math.ceil(limit * 0.1) },
  ];

  const result: MbReleaseGroup[] = [];
  for (const t of targets) {
    result.push(...buckets[t.name].slice(0, t.want));
  }
  // Fill any shortfall from the leftover in any bucket (albums first,
  // since they're usually what users look for when a specific type runs
  // out).
  if (result.length < limit) {
    const taken = new Set(result.map((g) => g.id));
    const leftover = [
      ...buckets.album,
      ...buckets.ep,
      ...buckets.single,
      ...buckets.other,
    ].filter((g) => !taken.has(g.id));
    result.push(...leftover.slice(0, limit - result.length));
  }
  // Preserve the type-then-year order overall (albums first in the final
  // list so the grid isn't jarring).
  return result
    .sort((a, b) => {
      const tw = typeWeight(a) - typeWeight(b);
      if (tw !== 0) return tw;
      return byYear(a, b);
    })
    .slice(0, limit);
}

// ── Text-search ranking ─────────────────────────────────────────────

/**
 * Rank text-search results so exact-title matches beat partial matches.
 *
 * MB's `score` is the text-relevance signal — it's 100 for exact-title
 * matches, 85-ish for substring matches, lower for fuzzy. The previous
 * ranker ignored score entirely and put release-count first, which meant
 * a partial-title album (e.g. "Centuries of Sorrow") beat an exact-title
 * single (e.g. Fall Out Boy's "Centuries") because singles always have
 * fewer pressings than albums.
 *
 * New order:
 *   1. Score desc — exact-match always beats partial-match
 *   2. Release count desc — popular pressings within the same score tier
 *   3. Type weight — album > EP > single only within ties on 1+2
 *   4. Year desc — final tiebreaker
 */
function rankTextResults(groups: MbReleaseGroup[]): MbReleaseGroup[] {
  return [...groups].sort((a, b) => {
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    if (sa !== sb) return sb - sa;
    const ra = a.releases?.length ?? 0;
    const rb = b.releases?.length ?? 0;
    if (ra !== rb) return rb - ra;
    const tw = typeWeight(a) - typeWeight(b);
    if (tw !== 0) return tw;
    return yearOf(b) - yearOf(a);
  });
}

/**
 * Build a MusicBrainz Lucene query combining the user's search term
 * with the optional releaseType and region filters. Keeps the raw
 * search-term wrapping clean so clauses don't bleed into each other.
 */
export function buildTextSearchQuery(
  query: string,
  opts?: MusicSearchOptions,
): string {
  const term = query.trim();
  const clauses: string[] = [term];
  if (opts?.releaseType) {
    // MB's `primarytype` field is case-insensitive but accepts the
    // canonical capitalized form.
    const pt =
      opts.releaseType === "album"
        ? "Album"
        : opts.releaseType === "ep"
          ? "EP"
          : "Single";
    clauses.push(`primarytype:${pt}`);
  }
  if (opts?.allowedRegions && opts.allowedRegions.length > 0) {
    // MB `country` codes are lowercase in the Lucene index.
    const codes = opts.allowedRegions
      .map((r) => r.toLowerCase())
      .filter((r) => /^[a-z]{2}$/.test(r));
    if (codes.length === 1) {
      clauses.push(`country:${codes[0]}`);
    } else if (codes.length > 1) {
      clauses.push(`(${codes.map((c) => `country:${c}`).join(" OR ")})`);
    }
  }
  return clauses.length === 1 ? clauses[0] : clauses.join(" AND ");
}

async function fetchTextResults(
  query: string,
  opts?: MusicSearchOptions,
): Promise<MbReleaseGroup[]> {
  // Fetch a wide window (100) so the score-first ranker can surface
  // exact-title matches even when they sit at position 12+ in MB's
  // default order.
  const built = buildTextSearchQuery(query, opts);
  const data = await mbGet<{ "release-groups"?: MbReleaseGroup[] }>(
    `/release-group?query=${encodeURIComponent(built)}&limit=100&inc=releases&fmt=json`,
  );
  return rankTextResults(data?.["release-groups"] ?? []);
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Two-pass music search:
 *   1. Detect whether the query IS an artist name. If confident, return
 *      a distributed mix of the artist's discography (albums, EPs, and
 *      singles — not just albums).
 *   2. Otherwise fall back to text-search across all release-groups,
 *      ranked by MB's text-relevance score (exact-title match wins).
 *
 * Results carry `releaseType` (album / single / ep / other) and optional
 * `secondaryTypes` (Live / Remix / Acoustic / etc) so the UI can label
 * variants like "Live Album" or "Remix Single" distinctly.
 */
export async function search(
  query: string,
  opts?: MusicSearchOptions,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const detection = await detectArtist(trimmed);

  if (detection.confidence === "strong") {
    const discography = await fetchDiscography(detection.mbid);
    if (discography.length > 0) {
      // Artist-matched path: honor releaseType (user-selected chip)
      // but not region — the discography is from a known artist,
      // country-of-pressing filtering would hide tracks confusingly.
      let filtered = discography;
      if (opts?.releaseType) {
        const want =
          opts.releaseType === "album"
            ? 0
            : opts.releaseType === "ep"
              ? 1
              : 2;
        filtered = filtered.filter((g) => typeWeight(g) === want);
      }
      if (filtered.length === 0) {
        // Requested type doesn't exist in this artist's catalog — fall
        // through to text search so the user sees *something* rather
        // than a confusing empty state.
      } else if (opts?.releaseType) {
        // When a releaseType is specified, skip the mix distribution
        // (it assumes a 3-type budget) and just year-sort.
        const byYearDesc = (a: MbReleaseGroup, b: MbReleaseGroup) =>
          yearOf(b) - yearOf(a);
        return filtered.sort(byYearDesc).slice(0, 15).map(toResult);
      } else {
        return pickDiscographyMix(filtered, 15).map(toResult);
      }
    }
    // Artist found but no release-groups (rare) — fall through to text search
  }

  const textResults = await fetchTextResults(trimmed, opts);
  return textResults.slice(0, 15).map(toResult);
}

// ── Test exports — not part of the public runtime API ───────────────

export const __testing = {
  rankTextResults,
  pickDiscographyMix,
  filterSecondaryTypes,
  toResult,
  buildTextSearchQuery,
};
