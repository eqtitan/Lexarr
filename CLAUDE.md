# Lexarr — Claude Code Context

## Project Overview
Lexarr is a unified media request portal (Next.js 16 / React 19 / TypeScript / Prisma SQLite) that lets users search and request movies, TV shows, music, and books. Requests route to Radarr, Sonarr, Lidarr, and LazyLibrarian on an Unraid media server at 192.168.1.100.

## Architecture
```
src/
├── app/                    # Next.js App Router
│   ├── api/                # 25 API routes
│   │   ├── admin/          # Admin endpoints (requests, retry, users, notifications, dashboard, settings, audit)
│   │   ├── auth/           # NextAuth + register (rate limited: 5/min)
│   │   ├── webhooks/       # Radarr/Sonarr/Lidarr webhook receivers
│   │   ├── config/         # Public config (Jellyfin URL)
│   │   ├── library-status/ # Check if search results are already in *arr libraries
│   │   ├── notifications/  # User notification feed (available content)
│   │   ├── quality-profiles/ # Radarr/Sonarr quality profiles for picker UI
│   │   ├── detail/         # Media detail lookups (TMDB, MusicBrainz, OpenLibrary)
│   │   ├── search/         # Multi-source media search
│   │   ├── request/        # Request creation (thin handler → service layer)
│   │   ├── requests/       # Request listing
│   │   └── status/         # Status polling (delegates to lib/status-checker)
│   ├── admin/              # Admin pages (dashboard, settings, audit)
│   ├── login/              # Login page
│   ├── requests/           # User requests page (with Jellyfin deep links)
│   └── page.tsx            # Main search + request page
├── components/             # React components
│   ├── dashboard/          # Admin dashboard: DashboardKpis (stack health, approvals, active, queue), IndexerPerformancePanel, WarningsPanel, AnalyticsGrid, PipelineTable, QueueTable, PendingApprovalsCard, plus per-service detail panels
│   ├── ErrorBoundary.tsx   # React error boundary (wraps all pages)
│   ├── NotificationBell.tsx # User notification bell with dropdown
│   ├── Nav.tsx, SearchBar.tsx, MediaCard.tsx, DetailPanel.tsx, Toast.tsx
│   └── SessionProvider.tsx
├── lib/
│   ├── arr/                # *arr service integrations (radarr, sonarr, lidarr, lazylibrarian, qbittorrent, nzbget, bazarr, prowlarr, jellyfin, router)
│   ├── auth/               # NextAuth config (credentials, Plex SSO, Jellyfin auth)
│   ├── dashboard/          # Analytics + service health
│   ├── search/             # TMDB, MusicBrainz, OpenLibrary (with Google Books cover fallback)
│   ├── services/           # Business logic layer
│   │   ├── request.ts      # createRequest(), validateRequestInput(), sendToArrAndUpdateStatus()
│   │   └── admin.ts        # listPendingRequests(), approveRequest(), denyRequest()
│   ├── cache.ts            # TTLCache (search: 5min, detail: 15min, health: 30s, library: 60s)
│   ├── db.ts               # Prisma singleton
│   ├── env.ts              # Zod-based env validation (exports typed `env` object)
│   ├── notifications.ts    # Discord/Slack/generic webhook notifications
│   ├── rate-limit.ts       # In-memory rate limiter (search: 30/min, request: 10/min, auth: 5/min)
│   ├── status-checker.ts   # Background polling + webhook-triggered status updates
│   └── audit.ts            # Admin action audit logging
├── types/
│   ├── index.ts            # MediaType, SearchResult, LibraryStatusValue, etc.
│   ├── external-apis.ts    # TMDB, MusicBrainz, OpenLibrary, Arr response types (18+ interfaces)
│   ├── dashboard.ts        # Dashboard-specific types
│   └── next-auth.d.ts      # NextAuth session type extensions
├── __tests__/              # Vitest test suite (11 files)
│   ├── setup.ts
│   ├── auth.test.ts        # Registration validation + rate limiting
│   ├── rate-limit.test.ts  # Rate limiter unit tests
│   ├── admin.test.ts       # Admin auth + status transition tests
│   ├── request-validation.test.ts  # Request input validation
│   ├── library-status.test.ts      # Library status merge logic
│   ├── singles.test.ts             # Music singles: releaseType validation, MB normalization, routing branch
│   ├── indexer-aggregation.test.ts # Prowlarr-based indexer stats aggregation
│   ├── webhooks.test.ts    # Webhook token validation
│   ├── validation.test.ts  # Input validation + scoring formula
│   ├── cache.test.ts       # TTLCache tests
│   └── env.test.ts         # Env validation tests
└── instrumentation.ts      # Background status polling (60s interval, circuit breaker)
```

## Key Commands
```bash
npm run dev          # Start dev server with Turbopack
npm run build        # Build for production (prisma generate + next build)
npm run test         # Run vitest test suite (78 tests)
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage (@vitest/coverage-v8)
npm run lint         # Run ESLint
npx tsc --noEmit     # Type check
```

## Quality Metrics (as of 2026-04-12)
- **Score: 100/100** (up from 56 baseline → 93 → 100)
- Type errors: 0
- Lint errors: 0
- Lint warnings: 0 (all 105 `any` usages eliminated)
- Tests: 78 passing (9 test files)
- Coverage: @vitest/coverage-v8 installed
- Pre-commit hooks: husky + lint-staged (auto lint + related tests)
- Tracked in `quality-metrics.json`

## Key Features
- **Library availability detection**: Search results show "In Library" / "Monitored" / "Requested" badges via POST /api/library-status (checks Radarr, Sonarr, Lidarr in parallel; music singles/EPs check release-group level, not artist)
- **Music singles support**: MusicBrainz search accepts `releaseType` filter (album/single/ep). Singles/EPs route to a narrow Lidarr flow — artist is added `monitored: false`, only the requested release-group is monitored, targeted `AlbumSearch` is triggered. Implemented in `lidarr.addSingleReleaseGroup()`. `releaseType` is stored on the Request record so admin manual-approves preserve the narrow-monitor intent.
- **Quality profile picker**: Movie/TV requests include a quality profile dropdown (fetched from Radarr/Sonarr)
- **Jellyfin deep linking**: "Watch" button on available items links to Jellyfin search
- **User notifications**: Bell icon shows recently available content (polls every 60s)
- **Google Books fallback**: Book covers sourced from Google Books API when OpenLibrary lacks covers
- **Error boundaries**: Graceful error handling wrapping all pages
- **Admin dashboard tabs**: Overview (KPIs + Indexer Performance), Approvals (badge count), Pipeline (active + recent, badge), Analytics (requests, fulfillment, top requesters), Warnings (tab turns red when critical). Indexer stats pulled from Prowlarr's `/api/v1/indexerstats` — Radarr/Sonarr/Lidarr v6 dropped the equivalent endpoint.

## Security Hardening (completed 2026-04-11)
- Webhook token validation: rejects when secret undefined (`!SECRET || token !== SECRET`)
- Registration gate: blocks signups when admin exists (unless `REGISTRATION_OPEN=true`)
- Input validation on all POST routes (mediaType, title, externalId, year, posterUrl)
- Detail route ID format validation per media type (numeric/UUID/OpenLibrary format)
- Rate limiting on search (30/min), request (10/min), and auth (5/min) endpoints
- Session type safety: proper NextAuth type declarations, no `as any` casts
- Background status checker has circuit breaker (backs off after 10 failures)
- Zod-based startup env validation fails fast on missing/malformed vars

## Deployment
- **Container:** `lexarr:v5` on Unraid (port 5056)
- **Volume:** `lexarr-data:/app/data` (SQLite DB)
- **DB migrations:** `prisma migrate deploy` (runs on container start)
- **Build:** `docker build -t lexarr:v5 .` from `/mnt/user/appdata/lexarr/`
- **GitHub:** github.com/eqtitan/Lexarr (private)

## Service Layer Pattern
API routes are thin HTTP handlers. Business logic lives in `src/lib/services/`:
- `request.ts` — createRequest() returns discriminated union `{ ok, status, error?, request? }`
- `admin.ts` — approveRequest(), denyRequest(), listPendingRequests()
- Shared helper: `sendToArrAndUpdateStatus()` (used by both request creation and admin approval)

## Environment Variables (required)
```
NEXTAUTH_SECRET, ARR_HOST, RADARR_API_KEY, SONARR_API_KEY,
LIDARR_API_KEY, TMDB_API_KEY, LEXARR_WEBHOOK_SECRET
```

## Conventions
- Use typed imports from `@/types/external-apis` for all external API responses
- Use `session?.user?.role` (never `as any`) — types are extended in `next-auth.d.ts`
- Use `err: unknown` with `instanceof Error` checks (never `err: any`)
- Route handlers should be thin — delegate to `@/lib/services/` for business logic
- Rate limit all public-facing endpoints using `@/lib/rate-limit`
- Log admin actions via `logAudit()` from `@/lib/audit`
- Fire-and-forget notifications via `notify()` from `@/lib/notifications`
- Use Zod `env` object from `@/lib/env` for validated env access
- Cached arr library lookups via `sonarr.getAllSeriesCached()`, `lidarr.getAllArtistsCached()`
