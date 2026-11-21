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
#   rehearse <image> <port> [name] [keep] run <image> against a copy of the live
#                                        DB with dummy keys; never touches live.
#                                        With a name and keep=keep, the container
#                                        stays up under that name after it passes.
#                                        LEXARR_REHEARSE_URL (default
#                                        http://localhost:<port>) is the address
#                                        you open it at, so sign-in works there.
#   preflight <name> <port> <env-file> <network> <volume>
#                                        before a real deploy: find the existing
#                                        install (or confirm a fresh one can go in);
#                                        prints "update <image>" or "fresh"
#   retire-rehearsals                    remove every rehearsal container (kept
#                                        test ones too) and its /tmp copy
set -euo pipefail

BACKUP_DIR=${LEXARR_BACKUP_DIR:-/mnt/user/data/lexarr-backups}
KEEP_PRE_DEPLOY=5
# Globals, not locals: the rehearsal cleanup trap runs after cmd_rehearse returns.
REHEARSE_NAME=lexarr-rehearse
REHEARSE_DIR=/tmp/lexarr-rehearse
REHEARSE_KEEP=
# Same hardening deploy.ps1 gives the live container (keep in step), so a
# rehearsal fails if the new image needs a capability or more memory.
HARDENING="--cap-drop=ALL --security-opt=no-new-privileges --pids-limit=256 --memory=1g"

is_rehearsal() { [ "$(docker inspect -f '{{index .Config.Labels "lexarr.rehearsal"}}' "$1" 2>/dev/null)" = 1 ]; }

# Running containers that publish host port $1, one name per line.
port_holders() { docker ps --filter "publish=$1" --format '{{.Names}}'; }

db_path() { echo "$(docker volume inspect "$1" -f '{{.Mountpoint}}' 2>/dev/null)/lexarr.db"; }

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
  local image=$1 port=$2 name=${3:-$REHEARSE_NAME} keep=${4:-} live before after errors holder providers
  local dir=$REHEARSE_DIR url=${LEXARR_REHEARSE_URL:-http://localhost:$2} source="a copy of the live DB"
  live=$(db_path lexarr-data)
  [[ "$url" =~ ^https?://[A-Za-z0-9._:-]+$ ]] || { echo "invalid LEXARR_REHEARSE_URL '$url'" >&2; return 1; }

  if [ "$name" != "$REHEARSE_NAME" ]; then
    # A custom name must never be able to reach the live container or a
    # container this script did not create.
    case "$name" in
      lexarr | lexarr-*) echo "refusing container name '$name' (reserved for the live container)" >&2; return 1 ;;
    esac
    [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo "invalid container name '$name'" >&2; return 1; }
    if docker inspect "$name" >/dev/null 2>&1 && ! is_rehearsal "$name"; then
      echo "a container named '$name' already exists and is not a Lexarr rehearsal; not touching it" >&2
      return 1
    fi
    dir=/tmp/$name
  fi
  REHEARSE_NAME=$name
  REHEARSE_DIR=$dir
  REHEARSE_KEEP=$keep

  cleanup() { docker rm -f "$REHEARSE_NAME" >/dev/null 2>&1 || true; rm -rf "$REHEARSE_DIR"; }
  # Tear down on exit, except a passing rehearsal the caller asked to keep.
  on_exit() {
    local rc=$?
    if [ "$REHEARSE_KEEP" = keep ] && [ "$rc" = 0 ]; then return; fi
    cleanup
  }
  trap on_exit EXIT
  cleanup

  # Another container on the port (a test rehearsal kept from earlier, or
  # anything else) would make docker run fail halfway; say which one instead.
  holder=$(port_holders "$port" | head -n 1)
  if [ -n "$holder" ]; then
    if is_rehearsal "$holder"; then
      echo "port $port is held by the kept rehearsal '$holder'. Remove it first:" >&2
      echo "  docker rm -f $holder && rm -rf /tmp/$holder" >&2
      echo "or rehearse on another port (deploy.ps1 -RehearsePort <port>)." >&2
    else
      echo "port $port is already used by container '$holder'; rehearse on another port (deploy.ps1 -RehearsePort <port>)." >&2
    fi
    return 1
  fi
  mkdir -p "$dir/data"

  if [ -f "$live" ]; then
    sqlite3 "$live" ".backup '$dir/data/lexarr.db'"
    fix_owner "$live"
    # Notifications off: a rehearsal must never message anyone.
    sqlite3 "$dir/data/lexarr.db" "UPDATE NotificationChannel SET enabled = 0;"
    before=$(sqlite3 "$dir/data/lexarr.db" "SELECT (SELECT count(*) FROM Request) || ' requests, ' || (SELECT count(*) FROM User) || ' users';")
    chown -R "$(stat -c '%u:%g' "$live")" "$dir/data"
  else
    # No install yet: rehearse what a fresh install does, from an empty DB.
    source="an empty DB (no live install yet)"
    before="0 requests, 0 users"
    chown -R 1001:1001 "$dir/data" # the image's nextjs user
  fi

  # Dummy keys and an *arr host with nothing listening: the app must start
  # and migrate without reaching any real service. LEXARR_PUBLIC_URLS is the
  # address you open the rehearsal at; without it, sign-in redirects go to
  # the container's own http://0.0.0.0:5056 and logging in there fails.
  printf '%s\n' "NEXTAUTH_SECRET=$(head -c 24 /dev/urandom | base64)" AUTH_TRUST_HOST=true \
    "LEXARR_PUBLIC_URLS=$url" \
    ARR_HOST=http://127.0.0.1 RADARR_API_KEY=dummy SONARR_API_KEY=dummy \
    LIDARR_API_KEY=dummy TMDB_API_KEY=dummy >"$dir/env"

  echo "Rehearsing $image on port $port against $source ($before)..."
  # shellcheck disable=SC2086 # HARDENING is a list of flags
  docker run -d --name "$name" --label lexarr.rehearsal=1 -p "$port:5056" --env-file "$dir/env" -v "$dir/data:/app/data" $HARDENING "$image" >/dev/null
  cmd_wait_healthy "$port" 90 "$name"

  # Sign-in must send the browser back to the address the rehearsal is
  # opened at, not the container's own.
  providers=$(curl -s "http://localhost:$port/api/auth/providers")
  if ! grep -qF "\"callbackUrl\":\"$url/api/auth/callback/" <<<"$providers"; then
    echo "sign-in would not return to $url: $providers" >&2
    return 1
  fi

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
  echo "Rehearsal passed: $after intact, 0 errors, sign-in returns to $url."
  if [ "$keep" = keep ]; then
    echo "Kept running as '$name' at $url (dummy keys, notifications off, $source)."
    echo "It is for testing before the release only: the real deploy removes it."
    echo "Remove it sooner with: docker rm -f $name && rm -rf $dir"
  fi
}

# Before a real deploy, nothing has been stopped yet. Work out whether this
# updates an existing install or puts in a fresh one, and refuse anything
# that would leave two Lexarrs, a rehearsal in the live slot, or a container
# that can't start. The live container is always <name> (lexarr), never a
# rehearsal name such as TEST4LexArr.
cmd_preflight() {
  local name=$1 port=$2 env_file=$3 network=$4 volume=$5 existing="" others holder data
  if docker inspect "$name" >/dev/null 2>&1; then
    if is_rehearsal "$name"; then
      echo "'$name' is a rehearsal container, not a Lexarr install; refusing to deploy over it" >&2
      return 1
    fi
    existing=$(docker inspect -f '{{.Config.Image}}' "$name")
    # The new container mounts $volume. If this install keeps its database
    # anywhere else, the update would start on an empty one.
    data=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{if .Name}}volume {{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' "$name")
    if [ "$data" != "volume $volume" ]; then
      echo "'$name' keeps its data in ${data:-no mount at /app/data}, not the $volume volume." >&2
      echo "Updating it would start Lexarr on an empty database. Copy lexarr.db into the" >&2
      echo "$volume volume first (or deploy with -DataVolume), then deploy again." >&2
      return 1
    fi
  fi

  # A Lexarr installed some other way (an Unraid template, a hand-run
  # container) under another name. Rehearsals and our own -previous don't
  # count. Only for the live name: a throwaway -ContainerName used to test
  # the rollback path sits next to the real lexarr on purpose.
  others=""
  [ "$name" = lexarr ] && others=$(docker ps -a --format '{{.Names}} {{.Image}} {{.Label "lexarr.rehearsal"}}' |
    awk -v n="$name" '$1 != n && $1 != n "-previous" && $3 != "1" &&
      (tolower($1) == "lexarr" || $2 ~ /^(ghcr\.io\/eqtitan\/)?lexarr(:|@|$)/) { print $1 " (" $2 ")" }')
  if [ -n "$others" ]; then
    if [ -z "$existing" ]; then
      echo "found an existing Lexarr install under another name:" >&2
      echo "$others" | sed 's/^/  /' >&2
      echo "deploy.ps1 manages the container named '$name'. Rename that one to '$name'" >&2
      echo "(docker rename <old> $name) to update it in place, or remove it, then deploy again." >&2
      return 1
    fi
    echo "WARNING: another Lexarr container exists besides '$name':" >&2
    echo "$others" | sed 's/^/  /' >&2
  fi

  holder=$(port_holders "$port" | grep -vxF "$name" | head -n 1 || true)
  if [ -n "$holder" ]; then
    echo "port $port is already used by container '$holder'; free it before deploying" >&2
    is_rehearsal "$holder" && echo "  (a kept rehearsal: docker rm -f $holder && rm -rf /tmp/$holder)" >&2
    return 1
  fi

  if [ ! -f "$env_file" ]; then
    echo "$env_file not found. A fresh install needs it: copy the template and fill it in," >&2
    echo "  cp $(cd "$(dirname "$0")/.." && pwd)/.env.example $env_file" >&2
    echo "then deploy again (README: Configuration)." >&2
    return 1
  fi

  if ! docker network inspect "$network" >/dev/null 2>&1; then
    docker network create "$network" >/dev/null
    echo "created docker network $network"
  fi

  if [ -n "$existing" ]; then echo "update $existing"; else echo "fresh"; fi
}

# Rehearsal containers are for testing before a release. Once the release is
# live, remove them all (kept ones such as TEST4LexArr included) and their DB
# copies. Only containers carrying our rehearsal label are touched.
cmd_retire_rehearsals() {
  local name
  for name in $(docker ps -a --filter label=lexarr.rehearsal=1 --format '{{.Names}}'); do
    [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || continue
    docker rm -f "$name" >/dev/null 2>&1 || true
    rm -rf "/tmp/$name"
    echo "removed rehearsal container $name"
  done
}

case "${1:-}" in
  migrations) cmd_migrations "$2" ;;
  backup) cmd_backup "$2" "$3" "$4" ;;
  restore) cmd_restore "$2" "$3" ;;
  wait-healthy) cmd_wait_healthy "$2" "$3" "$4" ;;
  rehearse) cmd_rehearse "$2" "$3" "${4:-}" "${5:-}" ;;
  preflight) cmd_preflight "$2" "$3" "$4" "$5" "$6" ;;
  retire-rehearsals) cmd_retire_rehearsals ;;
  *)
    echo "usage: $0 migrations|backup|restore|wait-healthy|rehearse|preflight|retire-rehearsals ..." >&2
    exit 2
    ;;
esac
