import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST — Register a new user account.
 *
 * Idempotency: idempotent on `name` — retrying a POST that succeeded
 * returns 409 "User exists" instead of creating a duplicate. Lexarr's
 * first user becomes admin; subsequent POSTs with the same name hit
 * the uniqueness check and are safe to retry.
 *
 * Rate-limited (5/min per IP) so the existence check isn't usable as
 * a username oracle.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = await checkRateLimit(`auth:${ip}`, RATE_LIMITS.auth);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429 },
    );
  }

  const { name, email, password } = await req.json();

  if (!name || !password) {
    return NextResponse.json(
      { error: "Name and password required" },
      { status: 400 },
    );
  }

  if (typeof name !== "string" || name.length < 2 || name.length > 50) {
    return NextResponse.json(
      { error: "Name must be 2-50 characters" },
      { status: 400 },
    );
  }

  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  if (email && (typeof email !== "string" || !email.includes("@"))) {
    return NextResponse.json(
      { error: "Invalid email format" },
      { status: 400 },
    );
  }

  // P-01: name is @unique — check before create to return a friendly 409
  // rather than a raw P2002. The create() below still relies on the unique
  // constraint for race safety between the check and the insert.
  const nameExists = await prisma.user.findUnique({ where: { name } });
  if (nameExists) {
    return NextResponse.json(
      { error: "Username already taken" },
      { status: 409 },
    );
  }

  if (email) {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 },
      );
    }
  }

  // Block registration if an admin already exists and REGISTRATION_OPEN is not set
  const adminExists = await prisma.user.findFirst({ where: { role: "admin" } });
  if (adminExists && process.env.REGISTRATION_OPEN !== "true") {
    return NextResponse.json(
      { error: "Registration is closed. Contact an admin." },
      { status: 403 },
    );
  }

  const hashed = await bcrypt.hash(password, 10);

  // First user becomes admin
  const userCount = await prisma.user.count({
    where: { id: { not: "system" } },
  });

  // P-01: handle P2002 from concurrent registrations that raced past the
  // findUnique checks above. The unique constraint on name/email is the
  // final arbiter — the checks are just for friendlier error messages.
  try {
    const user = await prisma.user.create({
      data: {
        name,
        email: email || undefined,
        password: hashed,
        role: userCount === 0 ? "admin" : "user",
        autoApprove: userCount === 0, // admin auto-approves by default
      },
    });

    return NextResponse.json({
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const target = (err.meta?.target as string[] | undefined)?.join(",") ?? "";
      const field = target.includes("email") ? "Email" : "Username";
      return NextResponse.json(
        { error: `${field} already taken` },
        { status: 409 },
      );
    }
    throw err;
  }
}
