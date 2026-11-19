import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { isPlexEnabled } from "@/lib/auth/plex";

/**
 * Can someone create an account right now? Mirrors registerUser(): the
 * first user (no admin yet) always can; after that only with
 * REGISTRATION_OPEN=true. On a DB error the login page keeps the tab and
 * the register route still decides.
 */
async function registrationOpen(): Promise<boolean> {
  if (env().REGISTRATION_OPEN === "true") return true;
  try {
    return !(await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true } }));
  } catch {
    return true;
  }
}

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
    // The login page hides its Register tab when sign-ups are closed.
    registrationOpen: await registrationOpen(),
    // (M2-02) Base URL the Diagnose modal uses for Unraid container deep links.
    // No IP-shaped fallback — falls back to null like jellyfinUrl above when unset.
    unraidBaseUrl: env().UNRAID_BASE_URL || null,
  });
}
