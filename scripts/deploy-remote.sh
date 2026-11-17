#!/usr/bin/env bash
# Server-side half of deploy.ps1. It ships inside the deployed commit and runs
# on the Unraid host as `bash <build dir>/scripts/deploy-remote.sh <command>`,
# so deploy.ps1 never has to quote multi-step shell logic through ssh.
#
#   migrations <volume>                  applied migration count of the live DB
#   backup <volume> <label> <env-file>   consistent copy of the DB (+ .env);
#                                        prints "<backup path> <migration count>"
#   restore <volume> <backup>            put a backup back as the live DB
#   wait-healthy <port> <secs> <name>    livez up, then healthz's DB check ok
#   rehearse <image> <port>              run <image> against a copy of the live
#                                        DB with dummy keys; never touches live
set -euo pipefail

BACKUP_DIR=${LEXARR_BACKUP_DIR:-/mnt/user/data/lexarr-backups}
KEEP_PRE_DEPLOY=5
# Globals, not locals: the rehearsal cleanup trap runs after cmd_rehearse returns.
REHEARSE_NAME=lexarr-rehearse
REHEARSE_DIR=/tmp/lexarr-rehearse

db_path() { echo "$(docker volume inspect "$1" -f '{{.Mountpoint}}')/lexarr.db"; }

# sqlite3 runs as root here. Keep lexarr.db and any -wal/-shm it leaves owned
# like the DB, or the container (uid 1001) can't write them on its next start.
fix_owner() {
  local owner
  owner=$(stat -c '%u:%g' "$1")
  chown "$owner" "$1"* 2>/dev/null || true
}

count_migrations() {
  sqlite3 "$1" "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;"
}

cmd_migrations() {
  local db
  db=$(db_path "$1")
  [ -f "$db" ] || { echo 0; return; }
  count_migrations "$db"
  fix_owner "$db"
}

cmd_backup() {
  local volume=$1 label=$2 env_file=$3 db dest
  db=$(db_path "$volume")
  if [ ! -f "$db" ]; then
    echo "none 0" # first install: nothing to back up
    return
  fi
  mkdir -p "$BACKUP_DIR"
  dest="$BACKUP_DIR/pre-deploy-$label-$(date +%Y%m%d-%H%M%S).db"
  sqlite3 "$db" ".backup '$dest'"
  # User accounts and password hashes: root-only, like the .env copy below.
  chmod 600 "$dest"
  fix_owner "$db"
  if [ "$(sqlite3 "$dest" 'PRAGMA integrity_check;')" != ok ]; then
    rm -f "$dest"
    echo "backup failed its integrity check" >&2
    return 1
  fi
  if [ -f "$env_file" ]; then
    cp "$env_file" "${dest%.db}.env"
    chmod 600 "${dest%.db}.env"
  fi
  # Keep the newest few automatic backups per container. Hand-pinned copies
  # (pre-0.20.0-deploy.*) and the nightly lexarr.db.* don't match this name.
  local prefix="pre-deploy-${label%-*}-"
  find "$BACKUP_DIR" -maxdepth 1 -name "$prefix*.db" -printf '%T@ %p\n' | sort -rn |
    tail -n +$((KEEP_PRE_DEPLOY + 1)) | cut -d' ' -f2- |
    while read -r old; do rm -f "$old" "${old%.db}.env"; done
  echo "$dest $(count_migrations "$dest")"
}

cmd_restore() {
  local db=$(db_path "$1") backup=$2 owner
  [ -f "$backup" ] || { echo "no such backup: $backup" >&2; return 1; }
  owner=$(stat -c '%u:%g' "$db")
  rm -f "$db-wal" "$db-shm"
  cp "$backup" "$db"
  chown "$owner" "$db"
  chmod 644 "$db"
  echo "restored $db from $backup ($(count_migrations "$db") migrations)"
  fix_owner "$db"
}

cmd_wait_healthy() {
  local port=$1 timeout=$2 name=$3 waited=0 body
  until [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/api/livez")" = 200 ]; do
    if [ "$waited" -ge "$timeout" ]; then
      echo "/api/livez not up after ${timeout}s" >&2
      docker logs "$name" --tail 20 >&2 2>&1 || true
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  # The DB check must pass. An unreachable *arr app is the *arr's problem,
  # not this deploy's -- warn instead of rolling back a good release.
  body=$(curl -s "http://localhost:$port/api/healthz")
  if ! grep -q '"db":{[^}]*"ok":true' <<<"$body"; then
    echo "/api/healthz database check failed: $body" >&2
    return 1
  fi
  grep -q '^{"ok":true' <<<"$body" ||
    echo "WARNING: an *arr app is unreachable (deploy continues): $body"
  echo "healthy after ${waited}s"
}

cmd_rehearse() {
  local image=$1 port=$2 name=$REHEARSE_NAME dir=$REHEARSE_DIR live before after errors
  live=$(db_path lexarr-data)
  cleanup() { docker rm -f "$REHEARSE_NAME" >/dev/null 2>&1 || true; rm -rf "$REHEARSE_DIR"; }
  trap cleanup EXIT
  cleanup
  mkdir -p "$dir/data"

  sqlite3 "$live" ".backup '$dir/data/lexarr.db'"
  fix_owner "$live"
  # Notifications off: a rehearsal must never message anyone.
  sqlite3 "$dir/data/lexarr.db" "UPDATE NotificationChannel SET enabled = 0;"
  before=$(sqlite3 "$dir/data/lexarr.db" "SELECT (SELECT count(*) FROM Request) || ' requests, ' || (SELECT count(*) FROM User) || ' users';")
  chown -R "$(stat -c '%u:%g' "$live")" "$dir/data"

  # Dummy keys and an *arr host with nothing listening: the app must start
  # and migrate without reaching any real service.
  printf '%s\n' "NEXTAUTH_SECRET=$(head -c 24 /dev/urandom | base64)" AUTH_TRUST_HOST=true \
    ARR_HOST=http://127.0.0.1 RADARR_API_KEY=dummy SONARR_API_KEY=dummy \
    LIDARR_API_KEY=dummy TMDB_API_KEY=dummy >"$dir/env"

  echo "Rehearsing $image on port $port against a copy of the live DB ($before)..."
  docker run -d --name "$name" -p "$port:5056" --env-file "$dir/env" -v "$dir/data:/app/data" "$image" >/dev/null
  cmd_wait_healthy "$port" 90 "$name"

  docker logs "$name" 2>&1 | grep -E "^Applying migration|successfully applied|No pending migrations" || {
    echo "no migration result in the container log" >&2
    return 1
  }
  after=$(sqlite3 "$dir/data/lexarr.db" "SELECT (SELECT count(*) FROM Request) || ' requests, ' || (SELECT count(*) FROM User) || ' users';")
  if [ "$before" != "$after" ]; then
    echo "row counts changed: $before -> $after" >&2
    return 1
  fi
  sleep 10 # let the first background status cycle run before reading the log
  errors=$(docker logs "$name" 2>&1 | grep -ciE '"level":"(error|fatal)"|unhandled|TypeError' || true)
  if [ "$errors" != 0 ]; then
    docker logs "$name" 2>&1 | grep -iE '"level":"(error|fatal)"|unhandled|TypeError' | head -5 >&2
    echo "$errors error line(s) in the container log" >&2
    return 1
  fi
  echo "Rehearsal passed: $after intact, 0 errors."
}

case "${1:-}" in
  migrations) cmd_migrations "$2" ;;
  backup) cmd_backup "$2" "$3" "$4" ;;
  restore) cmd_restore "$2" "$3" ;;
  wait-healthy) cmd_wait_healthy "$2" "$3" "$4" ;;
  rehearse) cmd_rehearse "$2" "$3" ;;
  *)
    echo "usage: $0 migrations|backup|restore|wait-healthy|rehearse ..." >&2
    exit 2
    ;;
esac
