# Changelog

All notable changes to Lexarr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Lexarr is in the **pre-1.0** phase — APIs, schemas, and configuration may
change between minor versions. See the README roadmap for what 1.0.0 requires.

## [0.4.6] — 2026-04-16 (was `v15`)

### Fixed
- Dockerfile copies `public/` into the runner stage (Next.js standalone
  output doesn't include it by default). `/icon.svg` and `/lexarr-icon.png`
  now serve HTTP 200; browser favicon picks up the P3 icon automatically.

## [0.4.5] — 2026-04-16

### Added
- Lexarr brand identity — "gold-entry" P3 icon (L built from stacked catalog
  rows, emerging from darkness, one gold row marking the found entry).
  `src/app/icon.svg` drives the favicon; `public/lexarr-icon.png` is the
  256×256 render used by the Unraid Docker tab.

## [0.4.4] — 2026-04-16 (was `v14`)

### Added
- `AUTH_PLEX_ENABLED` / `AUTH_JELLYFIN_ENABLED` feature flags — Plex SSO
  button is opt-in. Defaults: Plex off, Jellyfin on.
- `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` env vars — failover
  admin auto-created on startup if none exists. Also refreshes an existing
  matching admin's password as a rescue path.
- `src/lib/bootstrap-admin.ts` + Next.js instrumentation hook

### Fixed
- Plex error message differentiates 502/503 (their outage) from generic
  failure — more honest than "Failed to start Plex login" for every case.

## [0.4.3] — 2026-04-16 (was `v13`)

### Added
- `LivePill` component — compact pulsing-dot status indicator replacing the
  H1 + timestamp + auto-refresh checkbox + Refresh button
- Adaptive dashboard polling: 10s when downloads active, 60s when idle,
  paused when browser tab is hidden; immediate fetch on tab refocus

### Removed
- Dashboard H1 heading (redundant with nav)

## [0.4.2] — 2026-04-16 (was `v12`)

### Added
- Smart music search — two-pass strategy:
  - **Pass A** — artist detection via MusicBrainz `/artist?query=`; strong
    match requires score ≥ 90, ≥ 10-pt gap to runner-up, name-normalized
    exact match. On strong hit: fetch `/release-group?artist=<mbid>` (with
    `inc=artist-credits`) → that artist's discography, Albums first then
    EPs then Singles, newest first.
  - **Pass B** — text fallback `/release-group?query=<q>&limit=100&inc=releases`,
    ranked by release count desc → primary-type (Album > EP > Single) →
    year desc. `limit=100` matters: Fleetwood Mac's "Rumours" has 80
    releases but sits at MB position #24 for the query.

### Removed
- Music sub-filter row (All / Albums / Singles / EPs) — the filter was a
  crutch for MusicBrainz's near-useless text-relevance `score`. Smart search
  returns the right results without filtering.

## [0.4.1] — 2026-04-16 (was `v11`)

### Added
- Stack-healthcheck KPI — dashboard Stack Health tile shows last-run
  timestamp and issue count from the host cron's report
  (`/mnt/user/data/stack-healthcheck/latest-report.txt`, mounted read-only
  at `/stack-health`). `src/lib/stack-health.ts` parses the header;
  `/api/admin/stack-health` exposes the body.
- Indexer Performance "% grab" column (grabs ÷ queries — the operationally
  useful metric)
- Renamed "% fail" → "% errors" with tooltip showing raw counts

### Fixed
- Indexer stats source: Radarr/Sonarr/Lidarr v6 dropped `/api/v3/indexerstats`;
  switched to Prowlarr's `/api/v1/indexerstats` which is the actual source
  of truth. Aggregation handles direct + RSS query/failure counts.

## [0.4.0] — 2026-04-16 (was `v4`–`v10` batch)

### Added
- Admin dashboard refactor — tabbed layout: Overview / Approvals (with
  badge) / Pipeline (active + recent, with badge) / Analytics / Warnings
  (turns red on critical)
- KPI strip: Stack Health (with down-service chips), Pending Approvals,
  Active Downloads, Download Queue (with progress bar)
- Music singles support (Phase 1–3):
  - MusicBrainz `releaseType` filter (album / single / ep)
  - UI sub-filter chips with SINGLE / EP / ALBUM badges on cards
  - Lidarr narrow-monitor flow via `addSingleReleaseGroup()`: adds artist
    `monitored: false`, enables monitoring on just the requested release
    group, triggers scoped `AlbumSearch`
  - Library-status checks release-group level for singles (not just artist)
  - `releaseType` persisted on `Request` row → admin manual-approves
    preserve narrow-monitor intent
- Service layer extracted: `src/lib/services/{request,admin}.ts`
- Vitest + lint-staged + husky pre-commit; 96 → 106 tests
- Rate limiting (search 30/min, request 10/min, auth 5/min)
- ErrorBoundary wrapping pages; Zod env validation; TTLCache
- `NotificationBell` with 60s poll
- `/api/library-status` merging *arr state into search results
- `/api/quality-profiles` for the request picker
- Prisma migration `20260416163826_add_release_type`

### Fixed
- Admin manual-approve was dropping `releaseType` → singles fell back to
  full-artist monitoring. Now carried end-to-end.

## [0.3.0] — 2026-04-11 (was `v3`)

### Added
- Webhook receivers for Radarr / Sonarr / Lidarr (instant status updates)
- Background status checker with 60s polling + circuit breaker
- Input validation on all POST routes
- NextAuth type declarations (zero `as any` session casts)
- Startup env validation via Zod

### Security
- Webhook token validation: reject when secret undefined (not just
  mismatched)
- Registration gate: block new signups when an admin already exists
- ID format validation on `/api/detail`
- Prisma singleton pattern for production

### Removed
- Whisparr integration (service removed from the stack)

## [0.2.0] — 2026-04-02 → 04 (was `v2`)

### Added
- Notifications (Discord / Slack / generic webhook)
- Audit log for admin actions
- Retry button for stuck approved requests with no `arrId`
- Caching layer (TTLCache — search 5m, detail 15m, health 30s, library 60s)
- Admin UI — pending approvals, live queue, pipeline tracking, analytics

### Fixed
- LazyLibrarian API: plain-text responses on write ops (not JSON)
- LazyLibrarian: books were added as `Skipped` → now explicitly set
  `Wanted` via `queueBook` after `addBook`
- Search UX: faster debounce (350ms → 250ms), shimmer skeletons, "Already
  Requested" shows amber not red

## [0.1.1] — 2026-03-29

### Added
- Whisparr integration (later removed in 0.3.0)
- Detail drawer for search results
- Full service health dashboard

### Fixed
- Docker production build: TS/ESLint errors no longer block builds

## [0.1.0] — 2026-03-27

### Added
- Initial release — unified media request portal
- Next.js 16 + React 19 + TypeScript + Prisma SQLite
- Radarr / Sonarr / Lidarr / LazyLibrarian request routing
- TMDB / MusicBrainz / OpenLibrary search
- Plex SSO + Jellyfin + standalone credential auth
- Docker build + MIT license + README
