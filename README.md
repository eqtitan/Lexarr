# Lexarr

Unified media request portal for movies, TV shows, music, and books covering all media types your *arr stack supports.

## What It Does

Lexarr provides a single search bar that searches across all your media sources, lets users request content with one click, and routes each request to the correct *arr app automatically:

| Media Type | Search Source | Routes To |
|-----------|--------------|-----------|
| Movies | TMDB | Radarr |
| TV Shows | TMDB | Sonarr |
| Music | MusicBrainz | Lidarr |
| Books | Open Library | LazyLibrarian |

## Features

- **Unified search** across movies, TV, music, and books with type filters
- **One-click requests** routed to the correct *arr app
- **Auth** via Plex SSO, Jellyfin, or standalone accounts
- **Per-user approval** - admin can set trusted users to auto-approve, others need manual approval
- **Admin dashboard** with live download queue, pipeline tracking, analytics, and bottleneck detection
- **Deep-drill service pages** for each *arr app (library stats, queue, wanted, history, system info)
- **Pipeline events** tracking every step from request to availability
- **Docker-ready** with SQLite (zero external dependencies)

## Quick Start (Docker)

```bash
# Clone the repo
git clone https://github.com/eqtitan/Lexarr.git
cd Lexarr

# Create your config
cp .env.example .env

# Generate a secure secret (required)
openssl rand -base64 32  # paste this as NEXTAUTH_SECRET in .env

# Edit .env with your server IP, API keys, etc.

# Build and run
docker build -t lexarr .
docker run -d \
  --name lexarr \
  --env-file .env \
  -p 5056:5056 \
  -v lexarr-data:/app/data \
  --restart unless-stopped \
  lexarr
```

Lexarr will be available at `http://your-server-ip:5056`.

The first user to sign in becomes admin.

## Configuration

Copy `.env.example` to `.env` and fill in your values:

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXTAUTH_SECRET` | Yes | Random string for session encryption. Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Yes | URL where Lexarr is accessible (e.g. `http://192.168.1.100:5056`) |
| `AUTH_TRUST_HOST` | Yes (Docker) | Set to `true` for non-localhost deployments |
| `ARR_HOST` | Yes | IP/hostname of your *arr server (e.g. `http://192.168.1.100`) |
| `RADARR_API_KEY` | Yes | Find in Radarr > Settings > General > API Key |
| `SONARR_API_KEY` | Yes | Find in Sonarr > Settings > General > API Key |
| `LIDARR_API_KEY` | Yes | Find in Lidarr > Settings > General > API Key |
| `TMDB_API_KEY` | Yes | Free key from [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) |
| `JELLYFIN_URL` | No | Enables Jellyfin login (e.g. `http://192.168.1.100:8096`) |
| `PLEX_CLIENT_ID` | No | Defaults to `lexarr`. Enables Plex SSO |
| `PROWLARR_API_KEY` | No | For future Prowlarr integration |
| `LAZYLIBRARIAN_API_KEY` | No | For book request routing |

## Development

```bash
# Install dependencies
npm install

# Set up the database
cp .env.example .env
# Edit .env with your values
npx prisma db push

# Start dev server
npm run dev
```

Open `http://localhost:3000`.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Database**: SQLite via Prisma
- **Auth**: NextAuth.js v5 (Plex SSO, Jellyfin, credentials)
- **UI**: Tailwind CSS v4, dark mode
- **Deployment**: Docker (Node 20 Alpine)

## Architecture

```
src/
  app/                    # Next.js pages and API routes
    admin/dashboard/      # Admin dashboard + deep-drill service pages
    api/                  # REST API (search, request, auth, status, admin)
    login/                # Plex/Jellyfin/credentials login
  components/             # React components
    dashboard/            # Dashboard-specific components
  lib/
    arr/                  # *arr API clients (Radarr, Sonarr, Lidarr, LazyLibrarian)
    auth/                 # Auth providers (Plex, Jellyfin)
    dashboard/            # Analytics and warning computation
    search/               # Search clients (TMDB, MusicBrainz, Open Library)
  types/                  # TypeScript type definitions
prisma/
  schema.prisma           # Database schema
```

## Roadmap to 1.0.0

Lexarr is currently **pre-1.0** (`0.9.0` as of 2026-04-17). Pre-1.0
releases may contain backwards-incompatible changes between minor versions.
Each milestone has explicit **exit criteria** — a version ships when every
box is checked, not when a feature list is complete.

### Shipped

#### `0.6.0` — UX polish *(2026-04-16)*
- [x] Every button has loading / success / error state
- [x] Every API error → user-visible, actionable message (no silent failures)
- [x] Mobile layout audited (dashboard works on phone)
- [x] Empty states for every list (no results, no queue, no warnings)
- [x] Toasts consistent (color, duration, position, dismissal)

#### `0.7.0` — Reliability *(2026-04-16, partial scope)*
- [x] No `catch {}` silently swallowing errors without logging
- [x] Retry logic reviewed — nothing loops forever
- [ ] Circuit breakers on every *arr call *(deferred to 0.9.0 — timeouts
      + typed errors landed via `arrFetch`, but per-call breakers still TODO)*
- [ ] All POST routes either idempotent or documented non-idempotent
      *(deferred to 0.9.0)*

#### `0.7.1` — Stuck-download detection *(2026-04-17, patch)*
- Surfaces *arr errors to `Request.lastError` for user-visible diagnostics
- Book stall detection (was missing from 0.7.0)
- arrId-drift handling — detects when an *arr ID has been reused for a
  different title and marks the request failed with a clear reason

#### `0.8.0` — Version visibility *(2026-04-17)*
- [x] Inline version + channel label in nav (`Lexarr v0.8.0 beta`) —
      derived from `package.json` at build time, channel (`alpha` / `beta` /
      `rc` / `stable`) derived from the SemVer string
- [x] CI workflow — typecheck, lint, test on every push and PR

#### `0.9.0` — Observability *(2026-04-17)*
- [x] "Diagnose" action on down-service pills (log tail + last error,
      read-only, no container control)
- [x] Request lifecycle visible end-to-end: submitted → approved → sent →
      downloading → completed/failed, each step timestamped
- [x] Audit log readable without scrolling for common actions
- [x] Stack-health tile deep-links to the healthcheck report body
- [x] Per-*arr circuit breakers *(rolled from 0.7.0)*
- [x] POST route idempotency audit *(rolled from 0.7.0 — see
      [`docs/POST-idempotency.md`](docs/POST-idempotency.md))*

### Planned

#### `0.10.0` — Release readiness
- [ ] README explains setup in ≤ 10 min for someone with an existing *arr
      stack
- [ ] `.env.example` documents every variable with inline comments
- [ ] `docker-compose.yml` is a complete working example
- [ ] Migration path docs (upgrading from 0.x to 0.y)
- [ ] Security checklist (secrets rotation, headers, CORS)

#### `1.0.0` — Public launch
- [ ] 0.10.0 ran in prod for a week with no new bug-fix releases needed
- [ ] README is clear enough for a stranger to deploy successfully
- [ ] GitHub Release notes written manually (1.0.0 matters)
- [ ] Repo flipped to public
- [ ] GitHub branch protection enabled on master *(requires public repo
      or Pro — both blocked on free private tier)*

## Versioning

Lexarr follows [Semantic Versioning](https://semver.org). See
[`CHANGELOG.md`](CHANGELOG.md) for release history and
[`.changelog-rules.md`](.changelog-rules.md) for the commit prefix
conventions that drive automated CHANGELOG generation.

Release a new version with:

```bash
npm run release -- patch    # bug fix:      0.9.0 → 0.9.1
npm run release -- minor    # new feature:  0.9.0 → 0.10.0
npm run release -- major    # breaking:     0.9.0 → 1.0.0 (only when 1.0 criteria met)
npm run release -- --dry    # preview without writing
```

## License

[MIT](LICENSE)
