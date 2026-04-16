import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { searchCache } from "@/lib/cache";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";

interface QualityProfile {
  id: number;
  name: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = checkRateLimit(`quality-profiles:${ip}`, RATE_LIMITS.general);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Sign in to view quality profiles" },
      { status: 401 },
    );
  }

  const type = req.nextUrl.searchParams.get("type");
  if (type !== "movie" && type !== "tv") {
    return NextResponse.json(
      { error: "type must be 'movie' or 'tv'" },
      { status: 400 },
    );
  }

  const cacheKey = `quality-profiles:${type}`;
  const cached = searchCache.get(cacheKey) as QualityProfile[] | undefined;
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const profiles: QualityProfile[] =
      type === "movie"
        ? await radarr.getQualityProfiles()
        : await sonarr.getQualityProfiles();

    const slim = profiles.map((p) => ({ id: p.id, name: p.name }));
    searchCache.set(cacheKey, slim, CACHE_TTL_MS);
    return NextResponse.json(slim);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to fetch quality profiles (${type}): ${message}`);
    return NextResponse.json(
      { error: "Failed to fetch quality profiles" },
      { status: 502 },
    );
  }
}
