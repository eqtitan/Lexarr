import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/log";
import { getDiscoverPool, type DiscoverSection } from "@/lib/services/discover";
import { getLibraryStatuses } from "@/lib/services/library-status";
import { discoverFilteredCache } from "@/lib/cache";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import type { LibraryStatusValue } from "@/types";

const DISPLAY_LIMIT = 24;

/** GET /api/discover?type=music|book — the Music / Books tab lists, minus
 *  anything already in the library or requested (same rule as
 *  /api/releases). */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = await checkRateLimit(`discover:${ip}`, RATE_LIMITS.general);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)) } },
    );
  }

  const type = req.nextUrl.searchParams.get("type");
  if (type !== "music" && type !== "book") {
    return NextResponse.json({ error: "type must be music or book" }, { status: 400 });
  }

  const cached = discoverFilteredCache.get(type) as DiscoverSection[] | undefined;
  if (cached) return NextResponse.json({ sections: cached, cached: true });

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
    items: s.items.filter((r) => notInLibrary(r.id, r.mediaType)).slice(0, DISPLAY_LIMIT),
  }));
  // Only remember a result that has something in it, so an outage isn't
  // served from cache.
  if (sections.some((s) => s.items.length > 0)) discoverFilteredCache.set(type, sections);
  return NextResponse.json({ sections });
}
