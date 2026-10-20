import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { registerUser, UserServiceError } from "@/lib/services/users";

/**
 * POST — Register a new user account.
 *
 * Idempotency: idempotent on `name` — retrying a POST that succeeded
 * returns 409 instead of creating a duplicate. Lexarr's first user becomes
 * admin; after that registration is closed unless REGISTRATION_OPEN=true.
 * The rules live in registerUser() (src/lib/services/users.ts).
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

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const user = await registerUser(body, env().REGISTRATION_OPEN === "true");
    return NextResponse.json({
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    if (err instanceof UserServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
