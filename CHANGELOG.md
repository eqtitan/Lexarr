# Changelog

All notable changes to Lexarr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Lexarr is in the **pre-1.0** phase — APIs, schemas, and configuration may
change between minor versions. See the README roadmap for what 1.0.0 requires.

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
