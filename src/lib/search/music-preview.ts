import { log } from "@/lib/log";
/**
 * Music preview lookup — given an artist + release-group title, find a
 * 30-second sample URL from a third-party catalog.
 *
 * Primary: iTunes Search API (no auth, generous rate limits)
 * Fallback: Deezer public API (no auth, different catalog coverage)
 *
 * Called from /api/music-preview on-demand (not prefetched during
 * search) so the 15-item music result grid doesn't fan out into 30
 * extra upstream calls per keystroke. Cached per MBID so repeated
 * clicks on the same card don't re-hit the upstream.
 */

/** Timeout for the third-party preview lookup — short to keep the UI snappy. */
const PREVIEW_TIMEOUT_MS = 5_000;

export interface PreviewResult {
  /** Direct URL to a 30-second audio preview (MP3 or M4A) */
  url: string;
  /** Which provider the preview came from */
  source: "itunes" | "deezer";
  /** Track name as reported by the provider (for UI confirmation) */
  trackName: string;
  /** Artist name as reported by the provider */
  artistName: string;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number = PREVIEW_TIMEOUT_MS,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } catch (err) {
    log.debug("music-preview: lookup failed", { err });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── iTunes ──────────────────────────────────────────────────────────

interface ItunesSearchResult {
  resultCount?: number;
  results?: {
    previewUrl?: string;
    trackName?: string;
    artistName?: string;
    kind?: string;
  }[];
}

export async function fetchItunesPreview(
  artist: string,
  title: string,
): Promise<PreviewResult | null> {
  // iTunes' free-text search matches well for "artist track" queries.
  // `entity=song` filters out albums/music-videos/podcasts — we want
  // the specific track preview.
  const term = `${artist} ${title}`;
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    term,
  )}&entity=song&limit=5&media=music`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return null;
  const data = (await res.json().catch((err: unknown) => {
    log.debug("music-preview: iTunes lookup failed", { err });
    return null;
  })) as ItunesSearchResult | null;
  const results = data?.results ?? [];

  // iTunes sometimes returns results without previewUrl (e.g. tracks
  // not available in all regions). Walk the results and pick the first
  // one that actually has audio.
  for (const r of results) {
    if (r.kind === "song" && r.previewUrl) {
      return {
        url: r.previewUrl,
        source: "itunes",
        trackName: r.trackName || title,
        artistName: r.artistName || artist,
      };
    }
  }
  return null;
}

// ── Deezer ──────────────────────────────────────────────────────────

interface DeezerSearchResult {
  data?: {
    preview?: string;
    title?: string;
    artist?: { name?: string };
  }[];
}

export async function fetchDeezerPreview(
  artist: string,
  title: string,
): Promise<PreviewResult | null> {
  // Deezer supports a structured `artist:"X" track:"Y"` query that's
  // more precise than free-text. Empty preview URLs happen too (rare),
  // so we scan the first few results just like iTunes.
  const q = `artist:"${artist}" track:"${title}"`;
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return null;
  const data = (await res.json().catch((err: unknown) => {
    log.debug("music-preview: Deezer lookup failed", { err });
    return null;
  })) as DeezerSearchResult | null;
  const results = data?.data ?? [];
  for (const r of results) {
    if (r.preview) {
      return {
        url: r.preview,
        source: "deezer",
        trackName: r.title || title,
        artistName: r.artist?.name || artist,
      };
    }
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Try iTunes first, fall back to Deezer. Returns null when neither
 * has a matching preview (e.g. very obscure artists, region-locked
 * tracks). Callers should treat null as "preview unavailable, hide
 * the play button for this card."
 */
export async function findMusicPreview(
  artist: string,
  title: string,
): Promise<PreviewResult | null> {
  if (!artist || !title) return null;
  const itunes = await fetchItunesPreview(artist, title);
  if (itunes) return itunes;
  return fetchDeezerPreview(artist, title);
}
