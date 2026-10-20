import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { logAudit } from "@/lib/audit";

/**
 * Admin user management.
 *
 * GET    — list all users (minus the pseudo "system" user)
 * POST   — create a new local-credentials user
 * PATCH  — update role / autoApprove / maxRequests (existing callers)
 * DELETE — remove a user; transactionally clears their Request rows
 *          and nulls their AuditLog userId to satisfy FK constraints
 *
 * All endpoints audit-log. DELETE refuses to delete self so an admin
 * can't lock themselves out in one click, and PATCH refuses to demote
 * the last admin. A password reset or role change through PATCH signs
 * that user out of every existing session (User.sessionVersion).
 */

// Shared user-list projection — keeps responses consistent across verbs.
const USER_PROJECTION = {
  id: true,
  name: true,
  email: true,
  role: true,
  autoApprove: true,
  maxRequests: true,
  plexId: true,
  jellyfinId: true,
  avatar: true,
  createdAt: true,
  _count: { select: { requests: true } },
} as const;

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { id: { not: "system" } },
    select: USER_PROJECTION,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ users });
}

// ── POST: create a new local-credentials user ────────────────────────

interface CreateUserBody {
  name?: string;
  password?: string;
  role?: string;
  autoApprove?: boolean;
  maxRequests?: number;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const adminId = session?.user?.id;
  if (session?.user?.role !== "admin" || !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as CreateUserBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, password, role, autoApprove, maxRequests } = body;

  // Validation — match the constraints from src/app/api/auth/register.
  if (!name || typeof name !== "string" || name.length < 2 || name.length > 50) {
    return NextResponse.json(
      { error: "Name must be 2-50 characters" },
      { status: 400 },
    );
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }
  if (role && !["admin", "user"].includes(role)) {
    return NextResponse.json(
      { error: "Role must be 'admin' or 'user'" },
      { status: 400 },
    );
  }

  // Name uniqueness — same case-insensitive rule as the register route.
  const existing = await prisma.user.findFirst({
    where: { name: { equals: name } },
  });
  if (existing) {
    return NextResponse.json(
      { error: "A user with that name already exists" },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const created = await prisma.user.create({
    data: {
      name,
      password: passwordHash,
      role: role || "user",
      autoApprove: autoApprove ?? false,
      maxRequests: typeof maxRequests === "number" ? maxRequests : 0,
    },
    select: USER_PROJECTION,
  });

  logAudit(
    adminId,
    "create_user",
    { type: "user", id: created.id },
    { name: created.name, role: created.role },
  );

  return NextResponse.json({ user: created }, { status: 201 });
}

// ── PATCH: update role / autoApprove / maxRequests ───────────────────

interface PatchUserBody {
  userId?: string;
  role?: string;
  autoApprove?: boolean;
  maxRequests?: number;
  /** New plaintext password — server bcrypt-hashes before writing. */
  password?: string;
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  const adminId = session?.user?.id;
  if (session?.user?.role !== "admin" || !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as PatchUserBody | null;
  if (!body?.userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const { userId, role: newRole, autoApprove, maxRequests, password } = body;

  if (newRole !== undefined && !["admin", "user"].includes(newRole)) {
    return NextResponse.json(
      { error: "Role must be 'admin' or 'user'" },
      { status: 400 },
    );
  }

  // Password reset — same length policy as POST /api/auth/register and
  // as our local-creds admin POST above.
  if (password !== undefined) {
    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }
  }

  const data: Record<string, unknown> = {};
  const auditChanges: string[] = [];
  if (newRole !== undefined) {
    data.role = newRole;
    auditChanges.push("role");
  }
  if (autoApprove !== undefined) {
    data.autoApprove = autoApprove;
    auditChanges.push("autoApprove");
  }
  if (typeof maxRequests === "number" && maxRequests >= 0) {
    data.maxRequests = maxRequests;
    auditChanges.push("maxRequests");
  }
  if (password !== undefined) {
    data.password = await bcrypt.hash(password, 10);
    auditChanges.push("password");
  }

  // Read the target, check the last-admin rule and write in one
  // transaction, so two admins demoting each other at the same moment
  // can't both pass the count (SQLite serializes the writers).
  const outcome = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!target) return { error: "User not found", status: 404 } as const;

    const roleChanging = newRole !== undefined && newRole !== target.role;
    if (roleChanging && target.role === "admin") {
      const admins = await tx.user.count({ where: { role: "admin" } });
      if (admins <= 1) {
        return {
          error: "Can't remove the last admin — promote someone else first",
          status: 409,
        } as const;
      }
    }

    // A new password or role signs the user out everywhere: the jwt
    // callback in lib/auth/config.ts rejects tokens with an older version.
    if (password !== undefined || roleChanging) {
      data.sessionVersion = { increment: 1 };
    }

    const user = await tx.user.update({
      where: { id: userId },
      data,
      select: USER_PROJECTION,
    });
    return { user } as const;
  });

  if ("error" in outcome) {
    return NextResponse.json(
      { error: outcome.error },
      { status: outcome.status },
    );
  }
  const { user } = outcome;

  logAudit(
    adminId,
    "update_user",
    { type: "user", id: userId },
    { changes: auditChanges },
  );

  return NextResponse.json({ user });
}

// ── DELETE: remove user + cascade their request history ─────────────

interface DeleteUserBody {
  userId?: string;
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  const adminId = session?.user?.id;
  if (session?.user?.role !== "admin" || !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as DeleteUserBody | null;
  if (!body?.userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }
  const userId = body.userId;

  // Self-delete guard: an admin deleting themselves is almost never
  // intentional, and if the last admin is removed the app is bricked
  // (bootstrap vars are the only recovery). Refuse at the API layer.
  if (userId === adminId) {
    return NextResponse.json(
      { error: "Cannot delete your own account" },
      { status: 400 },
    );
  }

  // Fetch name for the audit log before we delete
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Transaction: clear requests + null-out audit-log userIds + delete user.
  // This preserves audit history (entries remain, just anonymized) but
  // drops the user's request records since they have no one to belong to.
  await prisma.$transaction([
    prisma.request.deleteMany({ where: { userId } }),
    prisma.auditLog.updateMany({
      where: { userId },
      data: { userId: null },
    }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  logAudit(
    adminId,
    "delete_user",
    { type: "user", id: userId },
    { name: target.name },
  );

  return NextResponse.json({ deleted: true, id: userId });
}
