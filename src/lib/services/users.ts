/**
 * User management -- the business rules behind /api/admin/users.
 *
 * Rules that live here (not in the route):
 *   - name 2-50 chars, password 8+ chars, role "admin" | "user"
 *   - names are unique
 *   - the last admin can't be demoted (checked inside a transaction, so
 *     two admins demoting each other at once can't both pass)
 *   - an admin can't delete their own account
 *   - a password reset or role change signs that user out everywhere
 *     (User.sessionVersion; see the jwt callback in lib/auth/config.ts)
 *   - every change is audit-logged
 */
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/** A rule violation the route turns into an HTTP error response. */
export class UserServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "UserServiceError";
  }
}

// Shared projection -- keeps responses consistent across operations.
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

const ROLES = ["admin", "user"];

function assertRole(role: unknown): void {
  if (role !== undefined && !ROLES.includes(role as string)) {
    throw new UserServiceError(400, "Role must be 'admin' or 'user'");
  }
}

function assertPassword(password: unknown): void {
  if (typeof password !== "string" || password.length < 8) {
    throw new UserServiceError(400, "Password must be at least 8 characters");
  }
}

export interface RegisterInput {
  name?: unknown;
  email?: unknown;
  password?: unknown;
}

/**
 * Self-service registration. The first user ever becomes admin; after
 * that, registration is closed unless REGISTRATION_OPEN=true.
 */
export async function registerUser(input: RegisterInput, registrationOpen: boolean) {
  const { name, email, password } = input;
  if (!name || !password) throw new UserServiceError(400, "Name and password required");
  if (typeof name !== "string" || name.length < 2 || name.length > 50) {
    throw new UserServiceError(400, "Name must be 2-50 characters");
  }
  assertPassword(password);
  if (email && (typeof email !== "string" || !email.includes("@"))) {
    throw new UserServiceError(400, "Invalid email format");
  }

  // Friendly 409s; the unique constraints are the real arbiter (P2002 below).
  if (await prisma.user.findUnique({ where: { name } })) {
    throw new UserServiceError(409, "Username already taken");
  }
  if (email && (await prisma.user.findUnique({ where: { email: email as string } }))) {
    throw new UserServiceError(409, "Email already registered");
  }

  const adminExists = await prisma.user.findFirst({ where: { role: "admin" } });
  if (adminExists && !registrationOpen) {
    throw new UserServiceError(403, "Registration is closed. Contact an admin.");
  }

  const hashed = await bcrypt.hash(password as string, 10);
  try {
    // First user becomes admin: count() + create() in one transaction so
    // two concurrent first registrations can't both see count === 0 (same
    // as the Plex/Jellyfin providers in lib/auth/config.ts).
    return await prisma.$transaction(async (tx) => {
      const userCount = await tx.user.count({ where: { id: { not: "system" } } });
      return tx.user.create({
        data: {
          name,
          email: (email as string) || undefined,
          password: hashed,
          role: userCount === 0 ? "admin" : "user",
          autoApprove: userCount === 0, // admin auto-approves by default
        },
      });
    });
  } catch (err) {
    // Concurrent registrations that raced past the checks above.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined)?.join(",") ?? "";
      throw new UserServiceError(409, `${target.includes("email") ? "Email" : "Username"} already taken`);
    }
    throw err;
  }
}

export async function listUsers() {
  return prisma.user.findMany({
    where: { id: { not: "system" } },
    select: USER_PROJECTION,
    orderBy: { createdAt: "desc" },
  });
}

export interface CreateUserInput {
  name?: unknown;
  password?: unknown;
  role?: unknown;
  autoApprove?: unknown;
  maxRequests?: unknown;
}

export async function createUser(input: CreateUserInput, adminId: string) {
  const { name, password, role, autoApprove, maxRequests } = input;
  // Same constraints as /api/auth/register.
  if (typeof name !== "string" || name.length < 2 || name.length > 50) {
    throw new UserServiceError(400, "Name must be 2-50 characters");
  }
  assertPassword(password);
  if (role) assertRole(role);

  const existing = await prisma.user.findFirst({ where: { name: { equals: name } } });
  if (existing) {
    throw new UserServiceError(409, "A user with that name already exists");
  }

  const created = await prisma.user.create({
    data: {
      name,
      password: await bcrypt.hash(password as string, 10),
      role: (role as string) || "user",
      autoApprove: typeof autoApprove === "boolean" ? autoApprove : false,
      maxRequests: typeof maxRequests === "number" ? maxRequests : 0,
    },
    select: USER_PROJECTION,
  });

  void logAudit(
    adminId,
    "create_user",
    { type: "user", id: created.id },
    { name: created.name, role: created.role },
  );
  return created;
}

export interface UpdateUserInput {
  userId: string;
  role?: unknown;
  autoApprove?: unknown;
  maxRequests?: unknown;
  /** New plaintext password -- bcrypt-hashed before writing. */
  password?: unknown;
}

export async function updateUser(input: UpdateUserInput, adminId: string) {
  const { userId, role: newRole, autoApprove, maxRequests, password } = input;
  assertRole(newRole);
  if (password !== undefined) assertPassword(password);

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
    data.password = await bcrypt.hash(password as string, 10);
    auditChanges.push("password");
  }

  const user = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!target) throw new UserServiceError(404, "User not found");

    const roleChanging = newRole !== undefined && newRole !== target.role;
    if (roleChanging && target.role === "admin") {
      const admins = await tx.user.count({ where: { role: "admin" } });
      if (admins <= 1) {
        throw new UserServiceError(409, "Can't remove the last admin — promote someone else first");
      }
    }
    if (password !== undefined || roleChanging) {
      data.sessionVersion = { increment: 1 };
    }
    return tx.user.update({ where: { id: userId }, data, select: USER_PROJECTION });
  });

  void logAudit(adminId, "update_user", { type: "user", id: userId }, { changes: auditChanges });
  return user;
}

export async function deleteUser(userId: string, adminId: string) {
  // Deleting yourself is almost never intended, and with the last admin
  // gone only the BOOTSTRAP_ADMIN_* env vars can recover the app.
  if (userId === adminId) {
    throw new UserServiceError(400, "Cannot delete your own account");
  }

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!target) throw new UserServiceError(404, "User not found");

  // Clear their requests, anonymize (keep) their audit entries, delete.
  await prisma.$transaction([
    prisma.request.deleteMany({ where: { userId } }),
    prisma.auditLog.updateMany({ where: { userId }, data: { userId: null } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  void logAudit(adminId, "delete_user", { type: "user", id: userId }, { name: target.name });
}
