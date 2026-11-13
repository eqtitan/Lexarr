# Upgrading Lexarr

Pre-1.0 (`0.x`) releases may include backwards-incompatible schema
changes between **minor** versions. Patch versions (`0.x.y` where only
`y` changes) are always safe to apply in place. Follow the steps below
for any minor-version bump. Post-1.0 will follow strict SemVer, so a
minor upgrade will be safe by contract.

## TL;DR

```bash
# 1. Back up the DB (hot — no downtime required)
docker exec lexarr sh -c 'sqlite3 /app/data/lexarr.db ".backup /app/data/lexarr.db.bak"'
docker cp lexarr:/app/data/lexarr.db.bak ./lexarr-$(date +%F).db.bak

# 2. Pull the new version (docker-compose example)
docker compose pull              # when using an image tag
# -- OR --
git pull && docker compose build # when building from source

# 3. Restart — Prisma migrations run automatically on boot
docker compose up -d

# 4. Verify
curl http://localhost:5056/api/healthz | jq
docker compose logs --tail 50 lexarr | grep -E 'migrations|Ready'
```

Expected log output after a successful upgrade:

```
Prisma schema loaded from prisma/schema.prisma
N migrations found in prisma/migrations
Applying migration `YYYYMMDDHHMMSS_add_whatever`
No pending migrations to apply.
✓ Ready in ...
```

## Backup strategy

### Before every minor upgrade

Manual `.backup` is the minimum safe step:

```bash
# Produces a consistent snapshot without stopping the container
docker exec lexarr sh -c \
  'sqlite3 /app/data/lexarr.db ".backup /app/data/lexarr.db.bak"'

# Copy it out of the container so the next restart can't clobber it
docker cp lexarr:/app/data/lexarr.db.bak ./lexarr-$(date +%F).db.bak
```

### Nightly on Unraid

If you're on the reference Unraid setup, `scripts/lexarr-db-backup.sh`
is installed to `/usr/local/bin/` and runs via cron. It keeps the last
7 daily backups under `/mnt/user/appdata/lexarr-backups/`. Restoration:

```bash
docker stop lexarr
cp /mnt/user/appdata/lexarr-backups/lexarr-2026-04-17.db.bak \
   /var/lib/docker/volumes/lexarr-data/_data/lexarr.db
docker start lexarr
```

## What happens on boot

1. Docker starts the container. Entrypoint runs `npx prisma migrate deploy`
   against `DATABASE_URL`.
2. Prisma compares migrations on disk to rows in `_prisma_migrations`:
   - **Applied but not on disk** → fails loud (shouldn't happen; means
     you've downgraded. Roll the DB back from the backup.)
   - **On disk but not applied** → runs them in order.
   - **All match** → no-op; continues.
3. Next.js starts. `/api/livez` (Docker's HEALTHCHECK) returns 200 once
   the app and its DB answer; `/api/healthz` (readiness) returns 200 once
   DB + at least one *arr respond.

If step 2 fails, the container exits without starting the app (since
0.18.x — earlier images logged "DB migration skipped" and started anyway
on a half-migrated schema), and Docker keeps restarting it depending on
the `restart` policy. Inspect via `docker compose logs lexarr` (or
`docker logs lexarr`) — the Prisma error message names the failing
migration. `deploy.ps1` treats this as a failed deploy and rolls back to
the previous container. It backs up the DB (with the old container
stopped) before every deploy, and if the failed image had already applied
a migration, it restores that backup before restarting the old
container — so the invariant below holds without manual steps.

## Rolling back

Lexarr's SemVer contract doesn't guarantee that a newer migration can
be reverted against an older app version. Rollback procedure:

```bash
# 1. Stop the new version
docker compose stop lexarr

# 2. Restore the DB from the pre-upgrade backup
docker run --rm -v lexarr-data:/data alpine \
  sh -c 'cp /backup/lexarr-*.db.bak /data/lexarr.db'
# (adjust the -v mount to point at your backup directory)

# 3. Check out the old version (source install) or re-pull the old image
git checkout v0.X.Y    # OR: docker compose pull lexarr:0.X.Y

# 4. Start
docker compose up -d
```

The key invariant: **never start an older Lexarr against a DB that has
newer migrations applied**. Prisma will detect the mismatch and refuse
to boot (loud failure, your data is safe). But that's why the backup
goes first.

## Version-specific upgrade notes

Additive migrations only so far. Specific notes will be appended here
when a release needs extra attention.

### 0.8.0 → 0.9.0 (2026-04-17)

- Added circuit breakers and Observability features. No schema change.
  Safe in-place upgrade.

### 0.7.0 → 0.8.0 (2026-04-17)

- Added inline version badge + CI. No schema change.

### 0.6.0 → 0.7.0 (2026-04-16)

- Reliability hardening (arrFetch timeouts, stuck-download detection in
  the 0.7.1 patch). No schema change.

### 0.5.0 → 0.6.0 (2026-04-16)

- UX polish. No schema change.

### 0.4.0 → 0.5.0

- `Request.releaseType` column added (migration
  `20260416163826_add_release_type`) to support music singles/EPs
  being requested at the release-group level. Prisma applies this
  automatically; no manual step needed.

### 0.1.0 → 0.4.0

- Initial schema + incremental additions via the `0001_initial`
  migration. Tested end-to-end from an empty DB by the CI
  migration-smoke-test job.

## Getting help

If an upgrade fails and `docker compose logs` doesn't make the reason
obvious:

1. Grab the failing migration name from the Prisma error.
2. Check your backup from "Before every minor upgrade" is safe.
3. Open a [GitHub issue](https://github.com/eqtitan/Lexarr/issues)
   with: Lexarr version (before and after), the Prisma error, and
   whether the backup restore worked.
