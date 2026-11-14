# Changelog

All notable changes to Lexarr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Lexarr is in the **pre-1.0** phase — APIs, schemas, and configuration may
change between minor versions. See the README roadmap for what 1.0.0 requires.

## [0.26.0] — 2026-11-13

### Added
- **Music and Books tabs have real lists.** With an empty search box, the Music chip shows **Popular new albums** (Apple Music's public US most-played albums chart, each album matched to its MusicBrainz release group, so the card requests exactly like a search hit; unmatched albums are dropped, never guessed) and **New from your artists** (albums and EPs by artists already in Lidarr from the last 60 days or due in the next 30). The Books chip shows **Trending books** (OpenLibrary's weekly trending works, same ids as book search). Titles already in the library or requested are hidden, like the movie/TV feed. `GET /api/discover?type=music|book`.
  - The lists are built in the background at startup and every 12 hours (matching the chart takes ~30s at MusicBrainz's 1 request/second limit), so opening a tab doesn't wait. MusicBrainz matches are cached for 7 days; a 503 is retried once and never cached as a miss; edition titles ("…: The Encore") fall back to the base title.
  - If a source is down or a list is empty, the tab shows the "what to search for" card as before.

### Fixed
- **Failed requests for titles that aren't out yet go back to waiting.** The late-arrival sweep moved a *stalled* unreleased title back to `approved`, but not a *failed* one, so a movie given up on before "in theaters" counted as unreleased stayed failed. Both now move to `approved` with the release date, and the *arr grabs them on release day. Pipeline event reason: `unreleased_from_failed` / `unreleased_from_stalled`.
- **An album by an artist already in Lidarr no longer shows as "monitored" when it isn't.** The library check marked any album by a known artist as monitored, though requests monitor one album, not the artist's catalog. It now checks the album itself, as it already did for singles and EPs. This affects search results too.

### Tests
- `discover.test.ts`: chart matching (wrong-artist same-title skipped, edition fallback, 503 retry, misses cached but outages not, 1 req/s pacing), Lidarr list, OpenLibrary list, the route's in-library filtering, empty-but-200 on outages, and the background refresh keeping old lists on failure. Chip tests now cover the lists and the fallback card. A test for failed→approved, and one for the per-album library check.
- e2e: the stub server serves the Apple chart, MusicBrainz and OpenLibrary under `DISCOVER_STUB_BASE`, and the chip smoke test checks both lists.

## [0.25.0] — 2026-11-13

### Fixed
- **Category chips on the home page now change what's shown.** With an empty search box every chip (All / Movies / TV / Music / Books) showed the same New Movies + New TV feed, because the chips only filtered search results. Now Movies shows only new movies, TV only new TV, All both, and Music / Books show a short "what to search for" card instead of the movie/TV lists (there's no new-releases source for them yet). Chips expose `aria-pressed`.

### Tests
- `category-tabs.test.tsx`: the first React component test, clicking the chips. Mutation-checked: dropping the chip → feed link fails 2.
- e2e: the stub TMDB server serves `/discover/movie|tv`, and a smoke test clicks every chip.

## [0.24.0] — 2026-11-13

### Fixed
- **TV requests could add the wrong show to Sonarr.** Sonarr's `term=tmdb:<id>` lookup, when TheTVDB has no mapping for that TMDB id, returns the show whose *TVDB* id equals the number, and Lexarr added `lookup[0]` blindly. 5 of 33 production TV requests got a different show (e.g. "V: The Final Battle" → "Intervention", "The Mandalorian and Grogu" → "Outlander"). `addSeries` now resolves the TVDB id through TMDB (`/tv/{id}/external_ids`), looks up `tvdb:<id>`, reuses a series Sonarr already has under that TVDB id, and only falls back to `tmdb:` (when TMDB is unreachable) for a result whose tmdbId matches. If the show isn't on TheTVDB, the request fails with "Not on TheTVDB yet…" instead of adding a stranger.
- The TV identity check now also catches that signature (a Sonarr series with no tmdbId whose TVDB id equals the request's TMDB id), so such a request fails as tracker drift instead of tracking the wrong show.

## [0.23.0] — 2026-11-13

### Added
- **Activity tab on the admin dashboard:** a notification inbox listing new requests, available, failed, stalled, denied and cancelled events for every user (last 14 days; `GET /api/admin/activity?days=1..90`), with filters (All / Problems / Available / Requests), a "new" marker and a tab badge counting events since the admin last opened it. It works with no webhook channel configured.

### Fixed
- **Upcoming TV:** a show Sonarr marks `upcoming` (not premiered) is parked at `approved` as "Awaiting release: <premiere date>" instead of stalling at 12h and auto-failing (Blade Runner 2099 sat "stuck" for 107 days). It's never treated as available before it premieres. The late-arrival sweep also moves a `stalled` title that turns out not to be out yet back to `approved`, so Tier C doesn't fail it.

## [0.22.0] — 2026-11-13

### Fixed
- **Late arrivals:** a request Lexarr had marked `failed` or `stalled` now flips to `available` when Radarr/Sonarr/Lidarr import the title later. The *arr apps keep searching after Lexarr gives up, but `failed` used to be final, so titles that downloaded days later still showed as failed (21 of 51 failed requests in production were on disk). The status checker re-checks each one at most every 6 hours, for 120 days after the last update. It skips tracker drift and items deleted from the *arr, and leaves the row untouched (no `updatedAt` bump) until the title arrives. The requester is notified only if the request failed in the last 30 days. Lifecycle: `failed → available` and `stalled → available` are now allowed.
- **Movies in theaters** with no digital or physical release date are parked at `approved` with "In theaters — waiting for digital release" instead of stalling at 12h and auto-failing at about 60h (Toy Story 5, Supergirl, Avengers: Secret Wars).
- **SQLite lock timeouts:** writes now wait up to 15s for the database lock (`socket_timeout=15` added to a `file:` `DATABASE_URL` that doesn't set one) instead of Prisma's ~5s default. When the poller, a webhook and an admin retry wrote at once, the loser failed with "Operations timed out after `N/A`" (4 requests in production).

## [0.21.0] — 2026-11-13

### Fixed
- qBittorrent 5.x: login answers `204` with an empty body and names the session cookie per port (`QBT_SID_8080`), so every qBittorrent call failed with "qBittorrent login failed: ". Login now accepts any 2xx that isn't `Fails.` plus any `*SID*` cookie, and still works with 4.x (`200 "Ok."` + `SID`). Torrent add also accepts the newer JSON answer.

### Changed
- Frontend data layer: pages read the API through one SWR `useApi` hook and write through `apiSend`, which shows the server's own error message. The dashboard, requests page and notification bell poll via `refreshInterval` instead of hand-rolled timers.
- Admin users and settings pages split into feature components (`src/components/admin/`).
- Dashboard approve / deny / retry / status-check failures now show an error banner instead of failing silently.

### Deploy (`deploy.ps1`)
- Refuses to deploy unless HEAD is `master`, pushed, and green in CI (`-Force` to override).
- Backs up the DB with the old container stopped before every deploy; a rollback restores that backup if the failed image had migrated the schema.
- Health gate polls `/api/livez` for up to 90s and requires healthz's DB check; an unreachable *arr app warns instead of rolling back a good release.
- `-Rehearse`: runs the new image on port 5059 against a copy of the live DB (dummy keys, notifications off), then tears it down.
- Images are tagged `v<version>-<sha>`; each production deploy pushes a `deployed/<time>-<sha>` git tag.
- Fixed: `git archive` shipped CRLF line endings to the server on Windows (`core.autocrlf`); build-dir pruning only touches sha-named dirs.

### CI and tooling
- Dependabot: weekly grouped npm updates (core-stack majors excluded), monthly GitHub Actions and base-image updates; repo Dependabot alerts on.
- CI audits production dependencies (`npm audit --omit=dev --audit-level=high`) and builds the Docker image on every PR, then starts it against an empty DB and probes `/api/livez`.
- Lint now also covers `e2e/` and `scripts/`.
- `.dockerignore` keeps docs, tests, `e2e/` and scripts out of the build context.

### Removed
- `publish-image.yml` and `scripts/release.js` / `npm run release`: `deploy.ps1` is the one release path (see `.changelog-rules.md` → Cutting a release).
- `npm run db:push`, which bypassed migrations. Use `npx prisma migrate deploy`.

### Tests
- E2E: admin users (create, promote, reset password, delete) and settings (music regions, notification channel add/test/toggle/delete).

## [0.20.0] — 2026-10-20

From the 2026-10-20 senior code review (#23–#29).

### Breaking
- **P-06 removed** (#24): the unused `ServiceConnection` encrypted-config
  model, its provider registry and `LEXARR_DATA_KEY` are gone. Migration
  `drop_unused_service_tables` drops `ServiceConnection` and the legacy
  `ServiceConfig` table (both were never used). Config comes from the
  environment only.

### Added
- End-to-end smoke tests (Playwright) against a stub TMDB/*arr server,
  run in CI on every PR (#23)
- Webhooks accept the secret as the HTTP Basic auth password, keeping it
  out of URLs and logs; `?token=` still works (#29)
- `Content-Security-Policy-Report-Only` header; the e2e run fails on any
  violation (#29)

### Changed
- One validated config accessor (`env()`); reading `process.env`
  elsewhere is a lint error (#24)
- Request lifecycle has a single owner: an explicit status-transition
  table enforced on every write, and one per-media `getMediaState()`
  adapter (#25)
- User, registration and retry rules moved into services (#27)
- `GET /api/admin/dashboard` is read-only; force-refresh runs a status
  check (#27)
- Errors that used to be swallowed silently are logged; type-aware
  promise lint (#26)
- `deploy.ps1` ships the exact commit (`git archive`) to a fresh build
  directory and refuses a dirty working tree (#29)

### Fixed
- Auto-retry of approved requests never actually retried (failed on the
  first attempt); now up to 3 hourly attempts before failing (#25)
- Stall detection, the 48h auto-fail and auto-retry were skipped entirely
  when nothing was downloading (#25)
- Admin retry re-sent a single as a full album and an audiobook as an
  ebook (#27)
- `/api/auth/register` returned 500 on a malformed JSON body (#27)
- Request `posterUrl` must come from a known image host (#29)

### Chore
- Shared real-SQLite test fixture; six mocked-Prisma suites moved onto
  it (#28). Two time-dependent test flakes fixed (#25, #28)

## [0.19.0] — 2026-10-20

0.18.1 and 0.18.2 were hotfix builds deployed straight to the reference
Unraid host and never tagged; their one code change (below, under Fixed)
is now on master.

### Added
- `/api/livez` liveness endpoint (app + DB only), now used by the Docker
  and docker-compose `HEALTHCHECK` (#21)
- Session revocation: a password reset or role change signs that user out
  of every existing session (`User.sessionVersion`, new migration) (#21)

### Changed
- Docker base image and CI moved to **Node 22 LTS** (Node 20 is
  end-of-life); `engines.node` is `>=22` (#19)
- `/api/healthz` is now readiness only (DB + at least one *arr), cached for
  10s; `deploy.ps1` still gates on it (#21)

### Fixed
- Container no longer starts on a half-migrated schema when
  `prisma migrate deploy` fails — it exits instead (#21)
- Duplicate "available" notifications and admin cancels being overwritten
  when the poller, webhooks and admin actions raced; status writes are now
  guarded on the expected status (#18, #20)
- Titles that were denied or cancelled can be requested again (#20)
- Background status poller no longer overlaps itself on slow cycles
  (self-rescheduling timer; the 0.18.1/0.18.2 hotfix) and concurrent
  callers share one in-flight check (#20)
- *arr integration hardening: secret redaction in logs, Jellyfin timeout,
  qBittorrent/NZBGet circuit breaking, duplicate-add race, library-status
  cache invalidation (#17)
- Docker HEALTHCHECK binding and IPv6 localhost issues (#10, #11); build-time
  env validation crash and a `deploy.ps1` outage risk (#9)

### Security
- Plex PIN token theft, first-user-becomes-admin race, login brute-force
  and username-timing gaps closed; Plex pin creation rate-limited (#15)
- Rate limiter no longer trusts spoofable `X-Forwarded-For`, adds a
  per-route ceiling across clients, and covers `/api/detail` (#16)
- Last admin can no longer be demoted (#21)
- Dependency advisories patched: 3 critical, 4 high → 0 (`next` 16.4.2,
  `next-auth` beta.32, `postcss`, `sharp`, …) (#19)

### Chore
- API route coverage raised to 73% and remaining zero-coverage admin
  routes covered; coverage provider switched to istanbul (#8, #13, #14)

## [0.18.0] — 2026-07-06

### Added
- New Releases feed: rolling 6-month US Movies + TV discovery (#4, c83b14b)
- Stack Health hover-action (M2): Diagnose modal now shows live container
  status + log tail (451727c), an Unraid deep link straight to the
  container (0283541), and a `service_diagnose_opened` telemetry hook
  (d7f59ed)
- Orphan cleanup panel in the admin Warnings tab, with wiring for
  retry/pipeline actions (447be1b, e391447)
- DB-backed rate-limit buckets, replacing the in-memory limiter, so limits
  survive restarts and scale across instances (c2225cb)
- Structured JSON logger, migrated across 19 call sites for consistent,
  greppable log output (60568e8)
- `ServiceConnection` model + AES-256-GCM crypto scaffolding for
  encrypting secrets at rest ahead of BYO-service support (d5e9bf3)
- Docker image-level `HEALTHCHECK` (`/api/healthz`), so `docker run` users
  get liveness/readiness checks without relying on compose (e3d0fac)

### Changed
- `/api/request` gained route-level tests covering the full POST flow
  (2bcbd23)
- Removed `typescript.ignoreBuildErrors` from the Next.js build config —
  type errors now fail the build instead of being silently ignored
  (6ab5224)

### Fixed
- Login now uses `findUnique` against a unique `User.name` constraint,
  closing a race where duplicate usernames could be created concurrently
  (a2e87a1)
- Request creation race: dedupe now happens inside a transaction with a
  supporting index on `(externalId, mediaType)`, closing a residual
  concurrent-duplicate window (dc8ada6, faa4e95 — partial unique index)

### Security
- Replaced hardcoded LAN IP references with a `your-server-ip` placeholder
  throughout docs and config examples (bc60b79, fb4eeb1, 7b57dc3)

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
