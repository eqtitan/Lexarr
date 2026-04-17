import type { SearchResult, MusicReleaseType } from "@/types";

const BASE = "https://musicbrainz.org/ws/2";
const UA = "Lexarr/1.0 (media-request-portal)";

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

function toResult(rg: MbReleaseGroup): SearchResult {
  const artistCredit = rg["artist-credit"]?.[0];
  const artist = artistCredit?.name || "Unknown Artist";
  const artistId = artistCredit?.artist?.id;
  return {
    id: rg.id,
    mediaType: "music",
    title: rg.title || "Unknown",
    year: rg["first-release-date"]?.slice(0, 4),
    overview: `${rg["primary-type"] || "Release"} by ${artist}`,
    posterUrl: `https://coverartarchive.org/release-group/${rg.id}/front-250`,
    artist,
    artistId,
    releaseType: normalizeType(rg["primary-type"]),
  };
}

async function mbGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Primary-type ordering (albums first) ─────────────────────────────

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
 *   - Top score is >= 15 points above the runner-up (or no runner-up)
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

  // Gap of 10+ is enough: MB scores are in 5–15 pt increments at the top of
  // the distribution, so 10 reliably separates "it's them" from "close but no".
  const confident =
    topScore >= 90 && (topScore - runnerScore >= 10 || !runnerUp) && nameMatches;

  return confident
    ? { mbid: top.id, name: top.name, confidence: "strong" }
    : { mbid: "", name: "", confidence: "none" };
}

// ── Discography fetch for a known artist ────────────────────────────

async function fetchDiscography(mbid: string): Promise<MbReleaseGroup[]> {
  // When browsing release-groups BY artist, MB strips artist-credit info
  // unless we ask for `inc=artist-credits`. Without it every result would
  // come back with "Unknown Artist". Also note `inc=releases` is rejected
  // on this endpoint (text-search only).
  const data = await mbGet<{ "release-groups"?: MbReleaseGroup[] }>(
    `/release-group?artist=${mbid}&limit=100&inc=artist-credits&fmt=json`,
  );
  const groups = data?.["release-groups"] ?? [];
  // Sort: albums/EPs first, then singles. Within each bucket, newest first.
  return groups.sort((a, b) => {
    const tw = typeWeight(a) - typeWeight(b);
    if (tw !== 0) return tw;
    return yearOf(b) - yearOf(a);
  });
}

// ── Fallback text-search ranking ────────────────────────────────────

/**
 * Rank text-search results when we have no strong artist hit.
 * MB's score is ~useless (100 for any match), so we use structural signals:
 *   1. Release count (popular RGs have many pressings)
 *   2. Primary-type order (album > ep > single)
 *   3. Year desc tiebreaker
 */
function rankTextResults(groups: MbReleaseGroup[]): MbReleaseGroup[] {
  return [...groups].sort((a, b) => {
    const ra = a.releases?.length ?? 0;
    const rb = b.releases?.length ?? 0;
    if (ra !== rb) return rb - ra; // more releases first
    const tw = typeWeight(a) - typeWeight(b);
    if (tw !== 0) return tw;
    return yearOf(b) - yearOf(a);
  });
}

async function fetchTextResults(query: string): Promise<MbReleaseGroup[]> {
  // Fetch a wide window so the release-count ranking can find popular hits
  // even when MB's native scoring buries them. Example: Fleetwood Mac's
  // "Rumours" has 80 releases but MB puts it at position #24 for the query
  // "rumours". With limit=100 our ranking surfaces it to the top.
  const data = await mbGet<{ "release-groups"?: MbReleaseGroup[] }>(
    `/release-group?query=${encodeURIComponent(query)}&limit=100&inc=releases&fmt=json`,
  );
  return rankTextResults(data?.["release-groups"] ?? []);
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Two-pass music search:
 *   1. Try to detect whether the query IS an artist name. If confident,
 *      return that artist's discography (albums first, then EPs, then singles).
 *   2. Otherwise fall back to text-search across all release-groups, ranked
 *      by release count / primary-type / year (NOT by MB's useless `score`).
 */
export async function search(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const detection = await detectArtist(trimmed);

  if (detection.confidence === "strong") {
    const discography = await fetchDiscography(detection.mbid);
    if (discography.length > 0) return discography.slice(0, 15).map(toResult);
    // Artist found but no release-groups (rare) — fall through to text search
  }

  const textResults = await fetchTextResults(trimmed);
  return textResults.slice(0, 15).map(toResult);
}
