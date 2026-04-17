#!/bin/bash
# ============================================================
# migration-smoke-test.sh
#
# Verifies that every Prisma migration in prisma/migrations/ applies
# cleanly to an empty SQLite DB — the exact scenario a first-time
# deployer hits on install. Without this check, a migration that was
# never tested end-to-end would only fail for a stranger's first boot.
#
# Run locally:   ./scripts/migration-smoke-test.sh
# CI:            invoked as a job step in .github/workflows/ci.yml
# Exit code 0 = all migrations applied cleanly + schema is up to date.
# ============================================================
set -euo pipefail

# Create an isolated working directory so we don't touch the real DB.
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

DB_PATH="$TMPDIR/smoke.db"
export DATABASE_URL="file:$DB_PATH"

echo "▶ Migration smoke test"
echo "  Scratch DB: $DB_PATH"
echo

# Count migrations for the report
MIGRATION_COUNT=$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
echo "  Migrations to apply: $MIGRATION_COUNT"
echo

# Run migrations against the empty DB.
echo "▶ prisma migrate deploy"
npx prisma migrate deploy

echo
echo "▶ prisma migrate status"
# Capture status output; if any pending migrations remain, fail loud.
STATUS_OUTPUT=$(npx prisma migrate status 2>&1 || true)
echo "$STATUS_OUTPUT"

if echo "$STATUS_OUTPUT" | grep -qiE "database schema is up to date|no pending migrations"; then
  echo
  echo "✓ Migration smoke test passed — all $MIGRATION_COUNT migrations applied cleanly"
  exit 0
else
  echo
  echo "✗ Migration smoke test FAILED — schema is not up to date after deploy"
  echo "  Pending or failed migrations detected. Review the status output above."
  exit 1
fi
