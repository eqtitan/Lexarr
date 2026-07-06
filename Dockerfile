FROM node:20-alpine AS base
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

USER nextjs

EXPOSE 5056

# HEALTHCHECK (P-08): /api/healthz validates DB reachability + at least one
# arr accessible. 30s start-period gives the app time to boot + run
# `prisma migrate deploy` on first start. Three retries before marking
# unhealthy. Image-level so `docker run` users get this, not just compose.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:5056/api/healthz >/dev/null || exit 1

# Initialize DB on first run, then start
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy || echo 'DB migration skipped'; node server.js"]
