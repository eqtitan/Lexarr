import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/log";
import { auth } from "@/lib/auth/config";
import {
  discoverBuiltAt,
  getDiscoverPool,
  refreshDiscoverPools,
  type DiscoverSection,
} from "@/lib/services/discover";
import { getLibraryStatuses } from "@/lib/services/library-status";
import { discoverFilteredCache } from "@/lib/cache";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import type { LibraryStatusValue } from "@/types";

const DISPLAY_LIMIT = 24;

interface DiscoverResponse {
  sections: DiscoverSection[];
  /** When the lists were last built (ISO), for the "Updated …" label. */
  builtAt: string | null;
}

/** GET /api/discover?type=music|book — the Music / Books tab lists, minus
 *  anything already in the library or requested (same rule as
 *  /api/releases), except sections marked keepOwned (the "coming soon"
 *  calendar, where monitored albums are the point). */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = await checkRateLimit(`discover:${ip}`, RATE_LIMITS.general);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)) } },
    );
  }

  // Signed-in users only: these call TMDB/MusicBrainz/OpenLibrary with
  // the server's keys and hint at what is in the library.
  if (!(await auth())?.user?.id) {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }

  const type = req.nextUrl.searchParams.get("type");
  if (type !== "music" && type !== "book") {
    return NextResponse.json({ error: "type must be music or book" }, { status: 400 });
  }

  const cached = discoverFilteredCache.get(type) as DiscoverResponse | undefined;
  if (cached) return NextResponse.json({ ...cached, cached: true });

  const pool = await getDiscoverPool(type);
  const all = pool.flatMap((s) => s.items);
  const statuses = await getLibraryStatuses(
    all.map((r) => ({ id: r.id, mediaType: r.mediaType, artistId: r.artistId, releaseType: r.releaseType })),
  ).catch((err: unknown) => {
    log.debug("discover: library status lookup failed", { err });
    return {} as Record<string, LibraryStatusValue>;
  });
  const notInLibrary = (id: string, mediaType: string) => !statuses[`${mediaType}:${id}`];

  const sections: DiscoverSection[] = pool.map((s) => ({
    ...s,
    items: (s.keepOwned ? s.items : s.items.filter((r) => notInLibrary(r.id, r.mediaType))).slice(0, DISPLAY_LIMIT),
  }));
  const body: DiscoverResponse = { sections, builtAt: discoverBuiltAt(type) };
  // Only remember a result that has something in it, so an outage isn't
  // served from cache.
  if (sections.some((s) => s.items.length > 0)) discoverFilteredCache.set(type, body);
  return NextResponse.json(body);
}

/** POST /api/discover — admin only: rebuild both lists now instead of
 *  waiting for the 12-hour refresh. Answers once the rebuild is done
 *  (seconds, as MusicBrainz matches are cached for a week). */
export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const complete = await refreshDiscoverPools();
  discoverFilteredCache.clear();
  return NextResponse.json({ complete, builtAt: { music: discoverBuiltAt("music"), book: discoverBuiltAt("book") } });
}
