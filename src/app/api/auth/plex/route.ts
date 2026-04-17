import { NextRequest, NextResponse } from "next/server";
import { createPlexPin, checkPlexPin } from "@/lib/auth/plex";

/**
 * POST — Create a new Plex PIN for authentication.
 *
 * Idempotency: NOT idempotent by design. Each call mints a fresh PIN
 * with its own ID and expiry; retrying is safe (cheap) but allocates a
 * new PIN. PINs auto-expire at Plex's side, so duplicates have no
 * long-term side effect.
 */
export async function POST() {
  try {
    const pin = await createPlexPin();
    const plexAuthUrl = `https://app.plex.tv/auth#?clientID=${process.env.PLEX_CLIENT_ID || "lexarr"}&code=${pin.code}&context%5Bdevice%5D%5Bproduct%5D=Lexarr`;
    return NextResponse.json({
      pinId: pin.id,
      code: pin.code,
      authUrl: plexAuthUrl,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to create Plex pin" },
      { status: 500 },
    );
  }
}

// GET: Check if a Plex pin has been authorized
export async function GET(req: NextRequest) {
  const pinId = req.nextUrl.searchParams.get("pinId");
  if (!pinId)
    return NextResponse.json({ error: "Missing pinId" }, { status: 400 });

  const authToken = await checkPlexPin(Number(pinId));
  if (!authToken) return NextResponse.json({ authenticated: false });

  // Return the token so the client can sign in via NextAuth
  return NextResponse.json({ authenticated: true, plexToken: authToken });
}
