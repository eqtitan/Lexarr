# Security Policy

Lexarr is a self-hosted media request portal. It holds user credentials and
API keys for several services (Radarr, Sonarr, Lidarr, Jellyfin, Plex), so
security issues matter even though the typical deployment is a single user
on a LAN.

## Supported versions

Pre-1.0 (where we are today), only the **latest release** receives security
fixes. After 1.0.0 ships, this table will expand to cover one previous
minor.

| Version | Supported |
| ------- | --------- |
| latest release ([Releases](https://github.com/eqtitan/Lexarr/releases)) | ✅ |
| older | ❌ — upgrade first |

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security problem.** Public
issues make the vulnerability available to anyone watching the repo before
a fix exists.

Two private channels, in order of preference:

1. **GitHub's "Report a vulnerability" button** on the
   [Security tab](https://github.com/eqtitan/Lexarr/security/advisories/new).
   This is the preferred path — it gives us a private discussion thread
   and a native CVE workflow.
2. **Email** (if you can't use GitHub): open the Security tab and use the
   contact path listed there. For one-time reports where email is more
   convenient, you can also DM the repo owner on GitHub.

When you report, include:

- A description of what the vulnerability is
- Steps to reproduce (commands, example request bodies, etc.)
- Your assessment of impact (what can an attacker do?)
- Whether you've disclosed to anyone else
- How you'd like to be credited in the fix note (or "anonymous")

## What to expect

- **Triage** within **7 days.** You'll get a reply confirming we received
  the report and an initial severity assessment.
- **Patch cadence** scales with severity:
  - **Critical** (remote auth bypass, arbitrary code execution, credential
    leakage): aim for a fix within **7 days** of triage.
  - **High** (stored XSS, SSRF with meaningful reach, auth downgrade):
    aim for a fix within **30 days.**
  - **Medium / Low**: rolled into the next scheduled release.
- **Credit.** We name reporters in the CHANGELOG and, for the first CVE-
  eligible issue, work through the GitHub Advisory → CVE pipeline.
- **No legal threats.** Good-faith research on Lexarr is welcome. We won't
  pursue action against researchers who follow this policy.

## Scope

### In scope

- Authentication bypass (Plex SSO, Jellyfin, credentials)
- Authorization bypass (viewing/modifying other users' requests,
  privilege escalation to admin)
- Injection vulnerabilities (SQL, NoSQL-shaped through Prisma, command,
  path traversal)
- Cross-site scripting (stored, reflected, DOM) in any Lexarr-served page
- SSRF via webhook URLs, search callbacks, or any user-controlled URL
- Cross-site request forgery on state-changing endpoints
- Credential / secret leakage in logs, responses, or client-side code
- Session handling flaws (fixation, leak, insufficient expiry)
- Denial of service that's cheap for the attacker and expensive for the
  server (unbounded loops, quadratic parsers, etc.)

### Out of scope

- Self-hosted misconfiguration (exposing Lexarr directly to the public
  internet without a reverse proxy or authentication gateway)
- Rate-limiting bypass by an authenticated admin (admins are trusted)
- Social engineering or physical attacks
- Reports from automated scanners without a validated impact statement
- Issues in third-party *arr services themselves — those go to the
  respective projects
- Missing security headers on endpoints that aren't actually vulnerable
  (unless you've demonstrated exploitability)

## Non-security bugs

If you're not sure whether something is a security issue, report it
privately anyway — we'll route it. Genuine bugs go in the public issue
tracker.

## Known limitations (acknowledged, not vulnerabilities)

- **No CSRF tokens.** NextAuth's same-site session cookies plus same-
  origin browser policy cover this for supported browsers. A proper
  CSRF token is on the post-1.0 hardening list.
- **No 2FA.** Self-hosted deployments are expected to sit behind a
  reverse proxy / SSO (Authelia, Authentik, Cloudflare Access) if 2FA
  is required. Native 2FA is a post-1.0 item.
- **Plain HTTP on the LAN.** Lexarr itself speaks HTTP only. Put it
  behind an HTTPS reverse proxy (or `tailscale serve`) and list that
  address in `LEXARR_PUBLIC_URLS`: sign-ins there get `__Host-`/`__Secure-`
  cookies and HSTS. Sign-ins on a plain-HTTP address send the password
  unencrypted across that network.

If one of these becomes relevant to a real exploit, that's in scope.
Report it.
