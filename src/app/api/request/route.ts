import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { createRequest } from "@/lib/services/request";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import type { MediaType, MusicReleaseType, BookFormat } from "@/types";

const VALID_RELEASE_TYPES: MusicReleaseType[] = ["album", "single", "ep", "other"];
const VALID_BOOK_FORMATS: BookFormat[] = ["ebook", "audiobook"];

/**
 * POST — Create a media request.
 *
 * Idempotency: idempotent on the tuple (userId, mediaType, externalId,
 * externalId2). See `createRequest()` in src/lib/services/request.ts —
 * a duplicate POST returns the existing request with a 200 response
 * instead of creating another row. Safe to retry on network failure.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = checkRateLimit(`request:${ip}`, RATE_LIMITS.request);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429 },
    );
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!session || !userId) {
    return NextResponse.json(
      { error: "Sign in to make requests" },
      { status: 401 },
    );
  }

  const body = await req.json();

  const { mediaType, externalId, title, year, posterUrl, artistId, qualityProfileId, releaseType, bookFormat } = body as {
    mediaType: MediaType;
    externalId: string;
    title: string;
    year?: string;
    posterUrl?: string;
    artist?: string;
    artistId?: string;
    qualityProfileId?: number;
    releaseType?: string;
    bookFormat?: string;
  };

  const validReleaseType = VALID_RELEASE_TYPES.includes(releaseType as MusicReleaseType)
    ? (releaseType as MusicReleaseType)
    : undefined;
  // Anything the client sends that isn't one of our known formats is
  // dropped silently — keeps the API forward-compat with future values
  // without forcing a 400.
  const validBookFormat = VALID_BOOK_FORMATS.includes(bookFormat as BookFormat)
    ? (bookFormat as BookFormat)
    : undefined;

  const result = await createRequest({
    userId,
    mediaType,
    externalId,
    title,
    year,
    posterUrl,
    artistId,
    qualityProfileId,
    releaseType: validReleaseType,
    bookFormat: validBookFormat,
  });

  if (!result.ok) {
    if (result.status === 409) {
      return NextResponse.json(
        { error: result.error, request: result.request },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({
    request: result.request,
    arrError: result.arrError,
  });
}
