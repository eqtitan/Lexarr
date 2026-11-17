/**
 * Failover admin bootstrap.
 *
 * On server startup, ensure at least one admin account exists. If none does
 * AND the operator has set BOOTSTRAP_ADMIN_USERNAME + BOOTSTRAP_ADMIN_PASSWORD,
 * create that admin. This means:
 *   - Fresh installs get a guaranteed way in without a DB surgery step
 *   - A wiped DB recovers on next container start
 *   - External providers (Plex, Jellyfin) being down never locks you out
 *
 * Idempotent: if an admin already exists, this is a no-op.
 *
 * Rescue: with BOOTSTRAP_ADMIN_RESET=true as well, the matching admin's
 * password is set to BOOTSTRAP_ADMIN_PASSWORD on start. Until 0.28.4 that
 * happened on every start whenever the bootstrap password was set, so a
 * password changed in the UI silently reverted at the next restart or
 * deploy, and the env value (readable via `docker inspect` and in the .env
 * backups) stayed a working admin password forever.
 */
import { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";
import bcrypt from "bcryptjs";
import { log } from "@/lib/log";

export async function ensureBootstrapAdmin(prisma: PrismaClient): Promise<void> {
  const username = env().BOOTSTRAP_ADMIN_USERNAME?.trim();
  const password = env().BOOTSTRAP_ADMIN_PASSWORD;

  // Is there already an admin? If so, nothing to do.
  const adminCount = await prisma.user.count({ where: { role: "admin" } });

  if (adminCount > 0) {
    const reset = ["true", "1", "yes"].includes((env().BOOTSTRAP_ADMIN_RESET ?? "").trim().toLowerCase());
    if (password && !reset) {
      log.warn(
        "bootstrap-admin: BOOTSTRAP_ADMIN_PASSWORD is still set but an admin exists, so it is unused; remove it from the container environment",
      );
      return;
    }
    // Explicit rescue: reset the named admin's password, then the operator
    // should remove BOOTSTRAP_ADMIN_RESET (and the password) again.
    if (username && password) {
      const existing = await prisma.user.findFirst({
        where: { name: username, role: "admin" },
      });
      if (existing) {
        const matches = existing.password
          ? await bcrypt.compare(password, existing.password)
          : false;
        if (!matches) {
          const hash = await bcrypt.hash(password, 10);
          await prisma.user.update({
            where: { id: existing.id },
            data: { password: hash },
          });
          log.warn("bootstrap-admin: reset the admin password from BOOTSTRAP_ADMIN_PASSWORD; remove BOOTSTRAP_ADMIN_RESET now", { username });
        }
      }
    }
    return;
  }

  // No admin. We need bootstrap creds to create one.
  if (!username || !password) {
    log.warn(
      "bootstrap-admin: no admin exists and BOOTSTRAP_ADMIN_USERNAME/BOOTSTRAP_ADMIN_PASSWORD are not set; set both to auto-create a failover admin on startup",
    );
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      name: username,
      password: hash,
      role: "admin",
      autoApprove: true,
    },
  });
  log.info("bootstrap-admin: created failover admin (no admin previously existed)", { username });
}
