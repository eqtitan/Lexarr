import { NextRequest, NextResponse } from "next/server";
import { handlers } from "@/lib/auth/config";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { pickPublicOrigin } from "@/lib/public-origin";

/**
 * Auth.js builds redirects and callback URLs from the request URL. Swap in
 * the public address this request actually used (LAN or Tailscale), chosen
 * from LEXARR_PUBLIC_URLS only (src/lib/public-origin.ts). NEXTAUTH_URL must
 * be unset when LEXARR_PUBLIC_URLS is used: next-auth would put its single
 * address back.
 */
function onPublicOrigin(req: NextRequest): NextRequest {
  const origin = pickPublicOrigin(req.headers);
  if (!origin || origin === req.nextUrl.origin) return req;
  return new NextRequest(req.nextUrl.href.replace(req.nextUrl.origin, origin), req);
}

export function GET(req: NextRequest) {
  return handlers.GET(onPublicOrigin(req));
}

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
  return handlers.POST(onPublicOrigin(req));
}
