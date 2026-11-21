/**
 * First-run setup guide: when it opens by itself, and what it needs to know.
 *
 * It opens by itself only on what looks like a new or reset install: the
 * guide was never finished or skipped AND no one has made a request yet. An
 * existing install that upgrades (it has requests) is never interrupted; its
 * admins can still open the guide from Admin → Settings.
 */
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { isPlexEnabled } from "@/lib/auth/plex";
import { getSetupStatus, type SetupStatus } from "@/lib/settings";

export interface SetupInfo {
  status: SetupStatus;
  /** True when the guide should open on its own for this admin. */
  autoLaunch: boolean;
  /** LEXARR_WEBHOOK_SECRET is set (the value itself is never returned). */
  webhookSecretSet: boolean;
  registrationOpen: boolean;
  plexEnabled: boolean;
  jellyfinEnabled: boolean;
}

export async function getSetupInfo(): Promise<SetupInfo> {
  const status = await getSetupStatus();
  const autoLaunch = status === "pending" && (await prisma.request.count()) === 0;
  const e = env();
  return {
    status,
    autoLaunch,
    webhookSecretSet: !!e.LEXARR_WEBHOOK_SECRET,
    registrationOpen: e.REGISTRATION_OPEN === "true",
    plexEnabled: isPlexEnabled(),
    jellyfinEnabled: e.AUTH_JELLYFIN_ENABLED !== "false",
  };
}
