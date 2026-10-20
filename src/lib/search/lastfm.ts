/**
 * Thin Last.fm client for artist popularity ranking.
 *
 * We only need one signal — listener count — used to break ties
 * between exact-title music search matches. Without it, Fall Out Boy's
 * "Centuries" (5M+ Last.fm listeners) sorts alongside an obscure cover
 * band's "Centuries" (50 listeners) because MusicBrainz gives both a
 * score of 100.
 *
 * Opt-in via LASTFM_API_KEY env var. When the key is unset, every
 * call short-circuits to `null` — callers must treat null as "no
 * signal available" and fall back to their previous ranking order.
 * This keeps 0.13.0 backwards-compatible with existing deployments
 * that haven't set up a Last.fm key yet.
 *
 * API docs: https://www.last.fm/api/show/artist.getInfo
 * Rate limits are documented as "5 req/sec" for reasonable use — we
 * cache results for 24h per MBID, so at most ~15 calls per music
 * search, well under budget.
 */
import { log } from "@/lib/log";
import { env } from "@/lib/env";

const BASE = "https://ws.audioscrobbler.com/2.0/";
const FETCH_TIMEOUT_MS = 3_000;

interface LastfmArtistInfo {
  artist?: {
    name?: string;
    mbid?: string;
    stats?: {
      listeners?: string; // Last.fm returns these as strings
      playcount?: string;
    };
  };
  error?: number;
  message?: string;
}

/**
 * Fetch the number of unique Last.fm listeners for an artist by
 * MusicBrainz ID. Returns `null` on:
 *   - LASTFM_API_KEY env var unset (feature disabled)
 *   - Invalid MBID format (cheap pre-flight check)
 *   - Last.fm error code in response (e.g. artist not found)
 *   - Network failure / timeout
 *
 * Callers should treat null as "no popularity signal available" —
 * not as "zero listeners." The distinction matters for tiebreaking:
 * we don't want to rank a not-found artist as less popular than one
 * with 10 listeners.
 */
export async function getArtistListeners(
  mbid: string,
): Promise<number | null> {
  const apiKey = env().LASTFM_API_KEY;
  if (!apiKey) return null;

  // MusicBrainz UUIDs are 36 chars with dashes. Reject anything else
  // before firing a network request.
  if (!/^[0-9a-f-]{36}$/i.test(mbid)) return null;

  const url = `${BASE}?method=artist.getinfo&mbid=${encodeURIComponent(mbid)}&api_key=${encodeURIComponent(apiKey)}&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      log.warn("lastfm.artist.getinfo HTTP error", {
        mbid: mbid.slice(0, 8),
        status: res.status,
      });
      return null;
    }
    const data = (await res.json().catch((err: unknown) => {
      log.debug("lastfm: lookup failed", { err });
      return null;
    })) as LastfmArtistInfo | null;
    if (!data || data.error) {
      if (data?.error) {
        // error code 6 = "no entity found" — expected for obscure artists
        if (data.error !== 6) {
          log.warn("lastfm.artist.getinfo API error", {
            mbid: mbid.slice(0, 8),
            errorCode: data.error,
            message: data.message ?? "",
          });
        }
      }
      return null;
    }
    const raw = data.artist?.stats?.listeners;
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (err: unknown) {
    // AbortError when our timeout fires — fold into the null signal.
    log.warn("lastfm.artist.getinfo network error", {
      mbid: mbid.slice(0, 8),
      err,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True iff the feature is configured. Useful for skipping enrichment
 *  logic entirely when the key is absent (avoids N parallel no-op
 *  fetches on every music search). */
export function isLastfmEnabled(): boolean {
  return !!env().LASTFM_API_KEY;
}
