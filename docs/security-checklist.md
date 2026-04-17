# Security Checklist

Applies to operators running a Lexarr instance. If you find something on
this list that's not true for your deployment, it's a gap to close. If
you find a gap in the Lexarr codebase itself, see
[`SECURITY.md`](../SECURITY.md) for how to report it privately.

## Secrets

- [ ] `NEXTAUTH_SECRET` is a unique 32+ byte random string. Generate with
      `openssl rand -base64 32`. Never reuse across deployments.
- [ ] `LEXARR_WEBHOOK_SECRET` is set and long (16+ chars). Webhooks are
      rejected when this env var is unset — not the other way around — so
      an unset secret is fail-safe, but a guessable secret lets anyone
      poke the webhook endpoints.
- [ ] *arr API keys (`RADARR_API_KEY`, `SONARR_API_KEY`, `LIDARR_API_KEY`)
      are copied directly from each app's Settings → General → API Key.
      Don't share a "combined" key across services.
- [ ] `.env` is in `.gitignore` (it is — confirmed for this repo).
- [ ] No secrets in git history — check with
      `git log -p | grep -iE 'api.?key|secret|password' | grep -v example`.

### Rotating a secret

1. Generate a new value (`openssl rand -base64 32` for NextAuth, a new
   API key in the source app for *arr keys).
2. Update `.env` on the host.
3. `docker restart lexarr` — NextAuth rotation invalidates every
   existing session; *arr rotations require a matching update in the
   source app's Settings → General.
4. Confirm via `/healthz` that at least one *arr still responds.

## HTTP security headers

Applied automatically by `next.config.ts` on every response:

| Header | Value | Why |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Stops MIME-sniffing attacks |
| `X-Frame-Options` | `DENY` | Clickjacking protection — Lexarr shouldn't be framed |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits Referer leakage on outbound links |
| `Permissions-Policy` | `camera=() microphone=() geolocation=() interest-cohort=() payment=() usb=()` | Disables unused browser APIs |

### Not yet applied (tracked for post-1.0)

- **Strict-Transport-Security (HSTS)** — deliberate. Most Lexarr
  deployments are LAN-only over plain HTTP, where HSTS would break
  direct-IP access. If you front Lexarr with a reverse proxy that
  terminates TLS, configure HSTS there, not in Lexarr.
- **Content-Security-Policy (CSP)** — deliberate for now. Next.js emits
  inline styles + NextAuth's OAuth flows use redirects that need careful
  CSP tuning. A too-strict policy breaks the login page. Post-1.0 work
  item: ship a validated CSP with `script-src 'self' 'nonce-…'` and the
  TMDB/OpenLibrary/coverartarchive hosts whitelisted for `img-src`.

## CORS

Lexarr doesn't explicitly set CORS headers. Next.js's same-origin defaults
apply: API routes only accept requests from the same origin as the
frontend. This is correct for the single-origin-deployment model.

**If you expose Lexarr's API to another origin** (e.g. a separate
dashboard), you'll need to add explicit CORS headers — don't just enable
`cors(*)`, scope the allowed origins.

## Authentication

- [ ] First user becomes admin automatically. Make sure *you* register
      first; subsequent users are regular accounts unless promoted via
      the admin UI.
- [ ] Registration is gated — once an admin exists, new signups are
      blocked unless `REGISTRATION_OPEN=true` is set.
- [ ] The Plex SSO and Jellyfin auth providers are opt-in (env-gated).
      If you're not using them, don't set the related env vars —
      disabling them reduces attack surface.
- [ ] Rate limits applied on auth (5/min), search (30/min), request
      (10/min). Tuneable in `src/lib/rate-limit.ts`.

## Network exposure

- [ ] **Don't expose Lexarr directly to the public internet.** The app
      is designed for LAN or VPN-fronted deployments. Port-forwarding
      5056 to the public internet is out of scope for the support model.
- [ ] If remote access is needed, front Lexarr with a reverse proxy
      (nginx, Caddy, Traefik) that terminates TLS + adds an auth gate
      (Authelia, Authentik, Cloudflare Access).
- [ ] Tailscale is a simple middle-ground — Lexarr listens on the LAN,
      clients connect via the Tailscale mesh. Already documented in the
      stack overview.

## Webhook endpoints

- [ ] `/api/webhooks/{radarr,sonarr,lidarr}` require a `?token=` query
      param matching `LEXARR_WEBHOOK_SECRET`. Mis-matches return 401.
- [ ] An unset `LEXARR_WEBHOOK_SECRET` causes ALL webhook requests to
      return 401 — fail-safe. Configure the secret in each *arr's
      Settings → Connect → Webhook URL, e.g.
      `http://lexarr:5056/api/webhooks/radarr?token=…`.

## Data at rest

- [ ] SQLite DB lives in the `lexarr-data` Docker volume. Contains user
      credentials (bcrypt hashed), session tokens, request history, and
      audit logs. Back it up (`scripts/lexarr-db-backup.sh` on the
      Unraid host).
- [ ] No credential is stored in plaintext. `User.passwordHash` is
      bcrypt (cost 10). Session cookies are signed by NextAuth with
      `NEXTAUTH_SECRET`.

## Dependency + CVE hygiene

- [ ] `npm audit` run before every minor release (see
      [`docs/security-audit.md`](security-audit.md) for the log).
- [ ] High or critical CVEs are release-blockers.
- [ ] Docker base image (`node:20-alpine`) rebuilds pick up upstream
      Alpine patches automatically on each Lexarr build.

## Incident response

If you suspect a compromise:

1. Stop the container: `docker stop lexarr`.
2. Rotate `NEXTAUTH_SECRET` — invalidates every active session.
3. Rotate *arr API keys in each source app.
4. Back up `lexarr-data` for forensics before any rebuild.
5. If the issue appears to be in Lexarr itself, report it privately —
   see [`SECURITY.md`](../SECURITY.md).

## What this checklist is not

- **Not a compliance framework.** Lexarr isn't SOC2 / HIPAA / PCI. This
  list covers the security hygiene appropriate for a self-hosted media
  request portal on a home LAN.
- **Not exhaustive.** Ongoing hardening items are tracked in the
  [roadmap](../README.md#roadmap-to-100). Known gaps (CSP, native 2FA,
  CSRF tokens) are documented in `SECURITY.md` under "Acknowledged
  limitations."
