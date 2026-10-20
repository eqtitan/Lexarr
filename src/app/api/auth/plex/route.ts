import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/log";
import { env } from "@/lib/env";
import { randomBytes } from "node:crypto";
import { createPlexPin, checkPlexPin, isPlexEnabled } from "@/lib/auth/plex";
import { plexPinSessionCache } from "@/lib/cache";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

const PIN_SESSION_COOKIE = "lexarr_plex_pin";
const PIN_SESSION_TTL_MS = 10 * 60 * 1000; // matches Plex's own pin expiry

/**
 * POST — Create a new Plex PIN for authentication.
 *
 * Idempotency: NOT idempotent by design. Each call mints a fresh PIN
 * with its own ID and expiry; retrying is safe (cheap) but allocates a
 * new PIN. PINs auto-expire at Plex's side, so duplicates have no
 * long-term side effect.
 *
 * The pin id is never returned to the client — see GET below for why.
 */
export async function POST(req: NextRequest) {
  if (!isPlexEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Unauthenticated and each call creates a real pin at plex.tv under our
  // client id — without a cap, a flood both risks Plex throttling us and
  // FIFO-evicts other users' in-flight sessions out of plexPinSessionCache.
  // A user only needs one pin per sign-in attempt, so the auth limit fits.
  const ip = getClientIp(req.headers);
  const rateCheck = await checkRateLimit(`plex-pin-create:${ip}`, RATE_LIMITS.auth);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again shortly." },
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

  try {
    const pin = await createPlexPin();
    const sessionToken = randomBytes(32).toString("hex");
    plexPinSessionCache.set(sessionToken, pin.id, PIN_SESSION_TTL_MS);

    const plexAuthUrl = `https://app.plex.tv/auth#?clientID=${env().PLEX_CLIENT_ID || "lexarr"}&code=${pin.code}&context%5Bdevice%5D%5Bproduct%5D=Lexarr`;
    const res = NextResponse.json({
      code: pin.code,
      authUrl: plexAuthUrl,
    });
    res.cookies.set(PIN_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      // Mark Secure only when this request is itself HTTPS, or the
      // configured public URL is (an operator terminating TLS at their
      // own reverse proxy, where the request reaching this container is
      // plain HTTP). A NODE_ENV-based check would mark this Secure even
      // for Lexarr's typical plain-HTTP-on-LAN deployment, where browsers
      // would silently refuse to store the cookie and the Plex sign-in
      // flow would never complete.
      secure:
        req.nextUrl.protocol === "https:" ||
        env().NEXTAUTH_URL?.startsWith("https://") === true,
      sameSite: "lax",
      maxAge: PIN_SESSION_TTL_MS / 1000,
      path: "/api/auth/plex",
    });
    return res;
  } catch (err) {
    log.warn("plex: creating sign-in pin failed", { err });
    return NextResponse.json(
      { error: "Failed to create Plex pin" },
      { status: 500 },
    );
  }
}

/**
 * GET — Check if a Plex pin has been authorized.
 *
 * The pin id is looked up server-side from the session token the POST
 * above set as an httpOnly cookie — it is never accepted from the
 * client. Plex pin ids are small sequential integers; a prior version of
 * this endpoint accepted `?pinId=` directly, which let anyone poll a
 * range of ids and steal whichever other user's pin resolved next (their
 * Plex auth token came back in the response). Binding resolution to an
 * unguessable, httpOnly session token closes that off.
 */
export async function GET(req: NextRequest) {
  if (!isPlexEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ip = getClientIp(req.headers);
  // RATE_LIMITS.general, not .auth: the frontend polls this every 1-2s
  // while the user finishes linking in another tab, so the tight 5/min
  // auth cap would break normal use.
  const rateCheck = await checkRateLimit(
    `plex-pin:${ip}`,
    RATE_LIMITS.general,
  );
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
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

  const sessionToken = req.cookies.get(PIN_SESSION_COOKIE)?.value;
  if (!sessionToken) return NextResponse.json({ authenticated: false });

  const pinId = plexPinSessionCache.get(sessionToken);
  if (pinId === undefined) return NextResponse.json({ authenticated: false });

  const authToken = await checkPlexPin(pinId);
  if (!authToken) return NextResponse.json({ authenticated: false });

  // One-shot: don't let a stolen/replayed session token resolve twice.
  plexPinSessionCache.delete(sessionToken);

  // Return the token so the client can sign in via NextAuth
  return NextResponse.json({ authenticated: true, plexToken: authToken });
}
