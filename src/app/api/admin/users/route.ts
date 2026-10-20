import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  UserServiceError,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/lib/services/users";

/**
 * Admin user management. Auth, parsing and HTTP mapping only -- the rules
 * (validation, last-admin guard, session revocation, auditing) live in
 * src/lib/services/users.ts.
 *
 * GET    — list all users (minus the pseudo "system" user)
 * POST   — create a new local-credentials user
 * PATCH  — update role / autoApprove / maxRequests / password
 * DELETE — remove a user (their requests too; audit entries anonymized)
 */

async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  const adminId = session?.user?.id;
  return session?.user?.role === "admin" && adminId ? adminId : null;
}

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 403 });

function serviceError(err: unknown): NextResponse {
  if (err instanceof UserServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  throw err;
}

export async function GET() {
  if (!(await requireAdmin())) return unauthorized();
  return NextResponse.json({ users: await listUsers() });
}

export async function POST(req: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return unauthorized();

  const body = (await req.json().catch(() => null)) as CreateUserInput | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    return NextResponse.json({ user: await createUser(body, adminId) }, { status: 201 });
  } catch (err) {
    return serviceError(err);
  }
}

export async function PATCH(req: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return unauthorized();

  const body = (await req.json().catch(() => null)) as Partial<UpdateUserInput> | null;
  if (!body?.userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }
  try {
    return NextResponse.json({ user: await updateUser({ ...body, userId: body.userId }, adminId) });
  } catch (err) {
    return serviceError(err);
  }
}

export async function DELETE(req: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return unauthorized();

  const body = (await req.json().catch(() => null)) as { userId?: string } | null;
  if (!body?.userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }
  try {
    await deleteUser(body.userId, adminId);
    return NextResponse.json({ deleted: true, id: body.userId });
  } catch (err) {
    return serviceError(err);
  }
}
