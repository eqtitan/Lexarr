import { NextRequest, NextResponse } from "next/server";
import { handlers } from "@/lib/auth/config";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

export const { GET } = handlers;

// NextAuth multiplexes sign-in, csrf, session, and callback (credential
// submission) through this one POST handler. Only the callback path is a
// login attempt worth throttling — gate it the same way register/route.ts
// already gates registration, so the `credentials`, `plex`, and `jellyfin`
// providers all get a real brute-force limit instead of none at all.
export async function POST(req: NextRequest) {
  if (req.nextUrl.pathname.includes("/callback/")) {
    const ip = getClientIp(req.headers);
    const rateCheck = await checkRateLimit(`auth:${ip}`, RATE_LIMITS.auth);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.ceil((rateCheck.resetAt - Date.now()) / 1000),
            ),
          },
        },
      );
    }
  }
  return handlers.POST(req);
}
