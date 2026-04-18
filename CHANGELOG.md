# Changelog

All notable changes to Lexarr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Lexarr is in the **pre-1.0** phase — APIs, schemas, and configuration may
change between minor versions. See the README roadmap for what 1.0.0 requires.

## [0.17.1] — 2026-04-18

### Fixed
- fix(books): prevent race + handle LL Open state for audiobooks (b1e8c8c)

## [0.17.0] — 2026-04-18

### Added
- feat(books): add audiobook support alongside ebooks (1b8be12)

## [0.16.2] — 2026-04-18

### Fixed
- fix(music): release-group requests no longer fail on status-check or cache (9ceaead)

## [0.16.1] — 2026-04-18

### Fixed
- fix(music): request the clicked release-group, not the whole artist (d5032db)

## [0.16.0] — 2026-04-18

### Added
- feat(dashboard): Blocklist action on Failed / Stalled download warnings (3826fee)

## [0.15.1] — 2026-04-18

### Fixed
- fix(ui): remove negative mb on chip row so full 12px vertical gap shows (ba8f086)

## [0.15.0] — 2026-04-18

### Added
- feat(dashboard): actionable Warnings panel — Retry / Approve / Deny (89b1ec6)
- feat(admin): password reset via PATCH /api/admin/users (6a6dafb)
- feat(ui): LivePill — hover-to-refresh, drop timestamp + refresh icon (6f1d658)

### Fixed
- fix(ui): bump chip row gaps from 8px to 12px for breathing room (16df472)

## [0.14.0] — 2026-04-18

### Added
- feat(admin): Users CRUD — add + delete + maxRequests in PATCH (0567c2f)

### Fixed
- fix(arr): prefer strict 'WEB 1080p' profile as default for new requests (aa52ea6)

## [0.13.6] — 2026-04-18

### Fixed
- fix(arr): never fall back to \"Any\" quality profile (bd4feb6)

## [0.13.5] — 2026-04-17

### Fixed
- fix(ui): re-anchor sub-chips centered under Music + match main padding (ca0ebb5)

## [0.13.4] — 2026-04-17

### Fixed
- fix(ui): music sub-chips adopt main-chip visual language (8f10645)

## [0.13.3] — 2026-04-17

### Fixed
- fix(ui): left-align music sub-chips to match main chip rhythm (dbbc6f5)

## [0.13.2] — 2026-04-17

### Fixed
- fix(ui): anchor music sub-chips under Music via transform centering (985c0ea)

## [0.13.1] — 2026-04-17

### Fixed
- fix(ui): match music sub-row gap to main chip gap (d287527)

## [0.13.0] — 2026-04-17

### Added
- feat(music): Last.fm artist-popularity tiebreak for exact-title matches (48c377a)

### Fixed
- fix(ui): center music sub-filter chips under Music button (fa16385)

## [0.12.3] — 2026-04-17

### Fixed
- fix: move force-dynamic to root layout (page.tsx export was a no-op) (48db163)

## [0.12.2] — 2026-04-17

### Fixed
- fix: force-dynamic home page + center music sub-filter chips (a2df07f)

## [0.12.1] — 2026-04-17

### Fixed
- fix(music): remove country: clause from MB query; region filter is a no-op (2e8c274)

## [0.12.0] — 2026-04-17

### Added
- feat(music): releaseType sub-filter + admin-configurable regions (d268920)

## [0.11.0] — 2026-04-17

### Added
- feat(music): 30-second preview snippets on music search results (1be2b6e)

### Chore
- ci: publish image to ghcr.io on every v* tag (ce4b959)

## [0.10.1] — 2026-04-17

### Fixed
- fix(docs): healthz endpoint path is /api/healthz (not /healthz) (017d3ca)

## [0.10.0] — 2026-04-17

### Added
- feat(security): baseline HTTP headers + operator security checklist (1de9409)
- feat(ci): migration smoke test — empty DB → current schema (e79e160)
- feat(search): rank music results by score; surface singles/EPs/live variants (b1467b4)
- feat: /healthz endpoint validating DB + at least one *arr (fc8a45c)

### Chore
- docs: check off 0.10.0 Release-readiness milestone (8a88299)
- docs: 0.10.0 release-readiness documentation block (9f4ac82)
- docs: add security-audit.md with dated CVE history (9d91381)
- docs: add SECURITY.md with private disclosure policy (9573ff5)

## [0.9.1] — 2026-04-17

### Fixed
- fix(search): don't cache empty results — fixes music cache poisoning (83a3320)

### Chore
- docs: tighten 0.10.0 and 1.0.0 exit criteria (219c881)
- docs: check off 0.7.0 items now that 0.9.0 completed them (f2cd80d)

## [0.9.0] — 2026-04-17

### Added
- feat: audit every POST route for idempotency + dedupe notification channels (9408c33)
- feat(dashboard): Diagnose action on down-service pills (3bd1674)
- feat(arr): per-service circuit breakers on every *arr call (68a01be)
- feat(audit): date buckets + collapse runs of repeat events (7391c63)
- feat(dashboard): Stack Health tile deep-links to full report (4708a58)
- feat(requests): expandable lifecycle timeline per row (36e344d)

### Chore
- docs: check off 0.9.0 Observability milestone in roadmap (7161a88)
- docs: update Roadmap to 1.0.0 to reflect shipped milestones (ef5ae29)
- ci: add GitHub Actions workflow for typecheck, lint, and test (d1042d9)

## [0.8.0] — 2026-04-17

### Added
- feat: inline version label in nav (v0.x.y [channel]) (6a72d27)

## [0.7.1] — 2026-04-17

### Fixed
- fix(status-checker): automate stuck-download detection + surface reasons (19d589f)

## [0.7.0] — 2026-04-17

### Fixed
- fix: Lidarr single-release-group retry bails immediately on network error (4e82374)
- fix: dashboard fire-and-forget status-check logs errors instead of swallowing (2cd6844)
- fix: status-checker logs per-request failures instead of silent skip (6d58134)
- fix: LazyLibrarian post-add errors bubble instead of silently nulling (163ebc4)

### Changed
- refactor: extract shared arrFetch() helper for all *arr integrations (056a2a3)

### Chore
- test: arrFetch helper — timeout, error shape, content-type handling (b37106c)

## [0.6.0] — 2026-04-17

### Fixed
- fix: dashboard tab row doesn't cut off tabs on mobile (fbf0189)
- fix: NotificationBell shows stale indicator when polling fails (aca9249)
- fix: approve/deny buttons block spam-clicks during in-flight requests (dd8ba7f)
- fix: audit log page shows error state instead of infinite spinner (ec668bd)
- fix: admin settings resilience (surface errors, per-row loading) (648d2e8)
- fix: DetailPanel surfaces detail-fetch errors instead of silent failure (1c853d4)

## [0.5.0] — 2026-04-16

Adoption of Semantic Versioning. From here forward every change gets a version
bump and CHANGELOG entry per [Conventional Commits](.changelog-rules.md)
conventions. Earlier history is back-filled from Docker-tag-only releases.

### Added
- Semantic versioning — `MAJOR.MINOR.PATCH` from `package.json`
- `CHANGELOG.md` — this file, with full history back to initial release
- `scripts/release.js` — CLI that bumps version, updates CHANGELOG, git-tags,
  builds Docker image, reminds to push
- `.changelog-rules.md` — how commit prefixes map to semver bumps
- Roadmap to 1.0.0 in README with exit-criteria milestones (0.6, 0.7, 0.8, 0.9)

### Changed
- Docker tag scheme: `lexarr:0.X.Y` (immutable) + `lexarr:0.X` (latest patch)
  + `lexarr:latest` (most recent stable). Dropping sequential `vN` tags.
- Unraid template `Repository` field updated to `lexarr:0.5.0`

## [0.4.8] — 2026-04-16 (was `v17`)

### Fixed
- TV/Movies filter chips actually filter by type. TMDB returns both movies
  and TV in one response; route now post-filters by `mediaType` when
  either chip is active. Music and Books were unaffected (separate APIs).
  Reported via "Dinosaurs" TV search showing movie results.

## [0.4.7] — 2026-04-16 (was `v16`)

### Fixed
- Request button now updates to "Already Requested" without a page refresh.
  `MediaCard` gained an `onRequested` callback; page maintains authoritative
  `libraryStatuses` map; both the inline button path and DetailPanel path
  call it on success / 409.

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
