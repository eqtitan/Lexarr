FROM node:22-alpine AS base
RUN apk add --no-cache openssl

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate

# Build the application
FROM base AS builder
WORKDIR /app

# Build provenance — passed via `docker build --build-arg GIT_SHA=... \
# --build-arg BUILD_TIME=...`. Not required: if omitted, both default to
# "unknown" and /api/version falls back gracefully rather than failing the
# build. See deploy.ps1 / CLAUDE.md "Deployment" for the exact flags to pass.
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

# ARGs do not carry across stages — redeclare + re-export as ENV here too.
# /api/version reads these via process.env at request time in the Node
# runtime, so what matters is that they're set in THIS stage (the one that
# actually runs `node server.js`), not just in `builder`.
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME

ENV NODE_ENV=production
ENV PORT=5056
# Next.js standalone's server.js binds only to this address. Without it,
# it binds to the container's bridge-network IP but not 127.0.0.1, so the
# in-container HEALTHCHECK (wget http://localhost:5056/...) gets connection
# refused even though the app is reachable fine from outside via Docker's
# port mapping. Found 2026-07-06: HEALTHCHECK (P-08) was new, so this bind
# gap was never exercised by a real deploy before.
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL=file:/app/data/lexarr.db

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Create data directory for SQLite DB (mountable volume)
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
RUN mkdir -p /app/public

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# public/ holds static assets (e.g. lexarr-icon.png) served at the root URL.
# Next.js standalone mode does NOT include public/ in the standalone output, so we copy it explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Stamps the real TCP peer address on every request (x-lexarr-client-ip)
# so rate limiting can't be dodged by changing headers; see the script.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/client-ip-preload.cjs ./client-ip-preload.cjs
ENV NODE_OPTIONS="--require /app/client-ip-preload.cjs"
ENV LEXARR_CLIENT_IP_HEADER=1

USER nextjs

EXPOSE 5056

# HEALTHCHECK (P-08): /api/livez -- liveness only (the app is up and its DB
# answers). It deliberately does NOT check the *arr apps: when Radarr/
# Sonarr/Lidarr are down Lexarr itself is fine, and probing them from here
# every 30s marked the container unhealthy and hammered them. Readiness
# ("can this deploy actually route requests?") stays at /api/healthz,
# which deploy.ps1 checks after a deploy. 30s start-period gives the app
# time to boot + run `prisma migrate deploy` on first start. Three retries
# before marking unhealthy. Image-level so `docker run` users get this,
# not just compose.
# Uses 127.0.0.1, not localhost: Alpine/musl resolves "localhost" to the
# IPv6 loopback (::1) first, but the app (even with HOSTNAME=0.0.0.0) only
# actually gets probed successfully over IPv4 in practice here -- confirmed
# 2026-07-07 that `wget http://localhost:...` got connection-refused while
# `wget http://127.0.0.1:...` succeeded, in the same running container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5056/api/livez >/dev/null || exit 1

# Apply pending migrations, then start. If a migration fails the container
# exits non-zero instead of starting on a half-migrated schema (it used to
# `|| echo 'DB migration skipped'` and carry on). `exec` makes node the
# main process so `docker stop` signals reach it directly.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && exec node server.js"]
