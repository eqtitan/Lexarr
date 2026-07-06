import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { findMusicPreview } from "@/lib/search/music-preview";
import { libraryCache } from "@/lib/cache";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/music-preview?mbid=<id>&artist=<name>&title=<title>
 *
 * Returns `{ preview: { url, source, trackName, artistName } }` or
 * `{ preview: null }` if no third-party catalog has a match.
 *
 * Auth-gated — only signed-in users can trigger preview lookups, so
 * an anonymous crawler can't ramp our outbound traffic to iTunes /
 * Deezer for free. Rate-limited on the same bucket as search.
 *
 * Cached per MBID for 15 min in the shared libraryCache. MBID is
 * required because it's the only stable key — `artist + title` can
 * collide across release-groups.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(req.headers);
  const rateCheck = await checkRateLimit(`search:${ip}`, RATE_LIMITS.search);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429 },
    );
  }

  const mbid = req.nextUrl.searchParams.get("mbid");
  const artist = req.nextUrl.searchParams.get("artist");
  const title = req.nextUrl.searchParams.get("title");

  if (!mbid || !artist || !title) {
    return NextResponse.json(
      { error: "Missing mbid, artist, or title" },
      { status: 400 },
    );
  }

  // MBID format sanity-check — MusicBrainz uses UUIDs
  if (!/^[0-9a-f-]{36}$/i.test(mbid)) {
    return NextResponse.json({ error: "Invalid mbid" }, { status: 400 });
  }

  const cacheKey = `preview:${mbid}`;
  const cached = libraryCache.get(cacheKey);
  if (cached !== undefined) {
    return NextResponse.json({ preview: cached, cached: true });
  }

  const preview = await findMusicPreview(artist, title);

  // Cache both hits AND misses — a miss for an obscure artist is
  // deterministic over short windows, no reason to re-hit the
  // upstreams every click. libraryCache defaults to 60s TTL which
  // is long enough for repeat clicks, short enough to retry if the
  // upstreams were temporarily broken.
  libraryCache.set(cacheKey, preview);

  return NextResponse.json({ preview });
}
