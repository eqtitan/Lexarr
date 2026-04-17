import { NextResponse } from "next/server";

/**
 * Public configuration endpoint.
 * Returns non-sensitive settings needed by the client.
 */
export async function GET() {
  return NextResponse.json({
    jellyfinUrl: process.env.JELLYFIN_URL || null,
    // Feature flags — control optional login methods without a rebuild
    plexEnabled: process.env.AUTH_PLEX_ENABLED === "true",
    jellyfinEnabled: process.env.AUTH_JELLYFIN_ENABLED !== "false", // default on
  });
}
