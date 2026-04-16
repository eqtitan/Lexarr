import { NextResponse } from "next/server";

/**
 * Public configuration endpoint.
 * Returns non-sensitive settings needed by the client.
 */
export async function GET() {
  return NextResponse.json({
    jellyfinUrl: process.env.JELLYFIN_URL || null,
  });
}
