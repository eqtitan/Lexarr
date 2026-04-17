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
 * Password is upgraded in place if the bootstrap password changes and the
 * bootstrap username matches an existing admin — gives operators a rescue
 * path if they forget credentials.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export async function ensureBootstrapAdmin(prisma: PrismaClient): Promise<void> {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  // Is there already an admin? If so, nothing to do.
  const adminCount = await prisma.user.count({ where: { role: "admin" } });

  if (adminCount > 0) {
    // If operator also set bootstrap creds AND a user with that name exists
    // AND it's an admin, refresh the password hash (rescue path).
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
          console.log(
            `[bootstrap-admin] Refreshed password for existing admin "${username}" from BOOTSTRAP_ADMIN_PASSWORD`,
          );
        }
      }
    }
    return;
  }

  // No admin. We need bootstrap creds to create one.
  if (!username || !password) {
    console.warn(
      "[bootstrap-admin] No admin exists and BOOTSTRAP_ADMIN_USERNAME / " +
        "BOOTSTRAP_ADMIN_PASSWORD are not set. Set both in your env to " +
        "auto-create a failover admin on startup.",
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
  console.log(
    `[bootstrap-admin] Created failover admin "${username}" (no admin previously existed)`,
  );
}
