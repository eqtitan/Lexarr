import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const { name, email, password } = await req.json();

  if (!name || !password) {
    return NextResponse.json({ error: "Name and password required" }, { status: 400 });
  }

  if (typeof name !== "string" || name.length < 2 || name.length > 50) {
    return NextResponse.json({ error: "Name must be 2-50 characters" }, { status: 400 });
  }

  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  if (email && (typeof email !== "string" || !email.includes("@"))) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  if (email) {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }
  }

  const hashed = await bcrypt.hash(password, 10);

  // First user becomes admin
  const userCount = await prisma.user.count({
    where: { id: { not: "system" } },
  });

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
}
