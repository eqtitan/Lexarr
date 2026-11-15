import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { retryRequest, retryAllFailed, RetryError } from "@/lib/services/retry";
import type { MediaType } from "@/types";

const MEDIA_TYPES: MediaType[] = ["movie", "tv", "music", "book"];

/**
 * POST — Retry a failed, stalled or stuck-approved request.
 *
 * Idempotency: state-guarded, NOT token-idempotent. The reset to
 * "approved" is a guarded write (409 if the request changed since it was
 * read), and a request that went through is now downloading/available,
 * so a replayed POST is refused. Not safe to retry a 500 client-side:
 * retryCount and the pipeline event have already been written.
 *
 * Rules live in src/lib/services/retry.ts.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const adminId = session?.user?.id;
  if (!session || session.user?.role !== "admin" || !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    requestId?: string;
    allFailed?: boolean;
    mediaType?: string;
  };
  const admin = { id: adminId, name: session.user?.name || "Admin" };

  // { allFailed: true, mediaType?: "book" } -- "Retry all failed".
  if (body.allFailed === true) {
    if (body.mediaType !== undefined && !MEDIA_TYPES.includes(body.mediaType as MediaType)) {
      return NextResponse.json({ error: "Unknown mediaType" }, { status: 400 });
    }
    const result = await retryAllFailed(admin, body.mediaType as MediaType | undefined);
    return NextResponse.json(result);
  }

  const { requestId } = body;
  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  try {
    await retryRequest(requestId, admin);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof RetryError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
