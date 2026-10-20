import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isPlexEnabled } from "@/lib/auth/plex";

/**
 * Public configuration endpoint.
 * Returns non-sensitive settings needed by the client.
 */
export async function GET() {
  return NextResponse.json({
    jellyfinUrl: env().JELLYFIN_URL || null,
    // Feature flags — control optional login methods without a rebuild
    plexEnabled: isPlexEnabled(),
    jellyfinEnabled: env().AUTH_JELLYFIN_ENABLED !== "false", // default on
    // (M2-02) Base URL the Diagnose modal uses for Unraid container deep links.
    // No IP-shaped fallback — falls back to null like jellyfinUrl above when unset.
    unraidBaseUrl: env().UNRAID_BASE_URL || null,
  });
}
