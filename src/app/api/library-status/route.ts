import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getLibraryStatuses, type StatusItem } from "@/lib/services/library-status";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/library-status
 * Checks whether search results already exist in the *arr services or Lexarr DB.
 * Returns a map of "mediaType:id" → LibraryStatusValue.
 *
 * Idempotency: read-only; trivially idempotent. Uses POST only to carry
 * a larger JSON body than a GET query string comfortably allows.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = await checkRateLimit(`search:${ip}`, RATE_LIMITS.search);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const items: StatusItem[] = body.items;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ statuses: {} });
  }
  // Cap at 40 items (search returns up to 10 per source × 4 sources)
  const cappedItems = items.slice(0, 40);

  const statuses = await getLibraryStatuses(cappedItems);
  return NextResponse.json({ statuses });
}
