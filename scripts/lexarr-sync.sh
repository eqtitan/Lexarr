#!/bin/bash
# ============================================================
# lexarr-sync.sh
# Polls *arr apps and LazyLibrarian to sync request statuses
# in the Lexarr SQLite database.
#
# Install: copy to /usr/local/bin/lexarr-sync.sh on Unraid
# Make executable: chmod +x /usr/local/bin/lexarr-sync.sh
# Register cron: add to /boot/config/go (see bottom of file)
# ============================================================
set -euo pipefail

DB=$(docker volume inspect lexarr-data --format '{{.Mountpoint}}')/lexarr.db
ENV=/mnt/user/appdata/lexarr/.env
LOG=/var/log/lexarr-sync.log
NOW=$(date '+%Y-%m-%d %H:%M:%S')
# Stuck threshold: flag anything downloading > 24 hours with no update
STUCK_HOURS=24

log()  { echo "$NOW $1" >> "$LOG"; }
logn() { echo "$NOW [NOTICE] $1" >> "$LOG"; }

# ── Load env vars ─────────────────────────────────────────────────────────────
RADARR_KEY=$(grep -E '^RADARR_API_KEY=' "$ENV" | cut -d= -f2- | tr -d '\r')
SONARR_KEY=$(grep -E '^SONARR_API_KEY=' "$ENV" | cut -d= -f2- | tr -d '\r')
LIDARR_KEY=$(grep -E '^LIDARR_API_KEY=' "$ENV" | cut -d= -f2- | tr -d '\r')
LL_KEY=$(grep -E '^LAZYLIBRARIAN_API_KEY=' "$ENV" | cut -d= -f2- | tr -d '\r')

HOST="http://192.168.1.100"
RADARR="${HOST}:7878"
SONARR="${HOST}:8989"
LIDARR="${HOST}:8686"
LL="${HOST}:5299"

update_status() {
  local id="$1" status="$2"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  sqlite3 "$DB" "UPDATE Request SET status='${status}', lastCheckedAt='${ts}', updatedAt='${ts}' WHERE id='${id}';"
  sqlite3 "$DB" "INSERT INTO PipelineEvent (id, requestId, event, createdAt) VALUES (lower(hex(randomblob(16))), '${id}', '${status}', '${ts}');"
}

mark_available() {
  local id="$1"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  sqlite3 "$DB" "UPDATE Request SET status='available', availableAt='${ts}', lastCheckedAt='${ts}', updatedAt='${ts}' WHERE id='${id}';"
  sqlite3 "$DB" "INSERT INTO PipelineEvent (id, requestId, event, createdAt) VALUES (lower(hex(randomblob(16))), '${id}', 'available', '${ts}');"
}

mark_lastchecked() {
  local id="$1"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  sqlite3 "$DB" "UPDATE Request SET lastCheckedAt='${ts}' WHERE id='${id}';"
}

# ── Movies (Radarr) ───────────────────────────────────────────────────────────
log "--- Sync start ---"

while IFS='|' read -r id arrId title; do
  [[ -z "$arrId" ]] && continue
  hasFile=$(curl -s "${RADARR}/api/v3/movie/${arrId}?apikey=${RADARR_KEY}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('hasFile','false'))" 2>/dev/null || echo "false")
  if [ "$hasFile" = "True" ] || [ "$hasFile" = "true" ]; then
    mark_available "$id"
    log "AVAILABLE movie: $title (arrId=$arrId)"
  else
    mark_lastchecked "$id"
  fi
done < <(sqlite3 "$DB" \
  "SELECT id, arrId, title FROM Request WHERE status IN ('downloading','approved') AND mediaType='movie' AND arrId IS NOT NULL;")

# ── TV (Sonarr) ───────────────────────────────────────────────────────────────
while IFS='|' read -r id arrId title; do
  [[ -z "$arrId" ]] && continue
  pct=$(curl -s "${SONARR}/api/v3/series/${arrId}?apikey=${SONARR_KEY}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('statistics',{}).get('percentOfEpisodes',0))" 2>/dev/null || echo "0")
  if python3 -c "exit(0 if float('${pct}') == 100 else 1)" 2>/dev/null; then
    mark_available "$id"
    log "AVAILABLE tv: $title (arrId=$arrId)"
  else
    mark_lastchecked "$id"
  fi
done < <(sqlite3 "$DB" \
  "SELECT id, arrId, title FROM Request WHERE status IN ('downloading','approved') AND mediaType='tv' AND arrId IS NOT NULL;")

# ── Music (Lidarr) ────────────────────────────────────────────────────────────
while IFS='|' read -r id arrId title; do
  [[ -z "$arrId" ]] && continue
  pct=$(curl -s "${LIDARR}/api/v1/artist/${arrId}?apikey=${LIDARR_KEY}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('statistics',{}).get('percentOfTracks',0))" 2>/dev/null || echo "0")
  albumCount=$(curl -s "${LIDARR}/api/v1/artist/${arrId}?apikey=${LIDARR_KEY}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('statistics',{}).get('albumCount',0))" 2>/dev/null || echo "0")
  if [ "$albumCount" -gt 0 ] && python3 -c "exit(0 if float('${pct}') == 100 else 1)" 2>/dev/null; then
    mark_available "$id"
    log "AVAILABLE music: $title (arrId=$arrId)"
  else
    mark_lastchecked "$id"
  fi
done < <(sqlite3 "$DB" \
  "SELECT id, arrId, title FROM Request WHERE status IN ('downloading','approved') AND mediaType='music' AND arrId IS NOT NULL;")

# ── Books (LazyLibrarian) ─────────────────────────────────────────────────────
while IFS='|' read -r id llId title; do
  [[ -z "$llId" ]] && continue
  bookStatus=$(curl -s "${LL}/api?cmd=getBook&id=${llId}&apikey=${LL_KEY}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('Status','unknown') if isinstance(d.get('data'),dict) else 'unknown')" 2>/dev/null || echo "unknown")
  if [ "$bookStatus" = "Have" ]; then
    mark_available "$id"
    log "AVAILABLE book: $title (llId=$llId)"
  else
    mark_lastchecked "$id"
  fi
done < <(sqlite3 "$DB" \
  "SELECT id, externalId2, title FROM Request WHERE status IN ('downloading','approved') AND mediaType='book' AND externalId2 IS NOT NULL;")

# ── Stuck detection ───────────────────────────────────────────────────────────
# Flag anything in 'downloading' with no status update in STUCK_HOURS hours
STUCK_TS=$(date -u -d "-${STUCK_HOURS} hours" +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null \
  || date -u -v "-${STUCK_HOURS}H" +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null \
  || echo "")

if [ -n "$STUCK_TS" ]; then
  while IFS='|' read -r id title updatedAt; do
    # Only flag once — skip if stalled event already exists
    alreadyFlagged=$(sqlite3 "$DB" \
      "SELECT COUNT(*) FROM PipelineEvent WHERE requestId='${id}' AND event='stalled';")
    if [ "$alreadyFlagged" -eq 0 ]; then
      ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
      detail="{\"reason\":\"No progress in ${STUCK_HOURS} hours\",\"stuckSince\":\"${updatedAt}\"}"
      sqlite3 "$DB" "INSERT INTO PipelineEvent (id, requestId, event, detail, createdAt) \
        VALUES (lower(hex(randomblob(16))), '${id}', 'stalled', '${detail}', '${ts}');"
      log "STALLED: $title (id=${id}) — no update since ${updatedAt}"
    fi
  done < <(sqlite3 "$DB" \
    "SELECT id, title, updatedAt FROM Request WHERE status='downloading' AND updatedAt < '${STUCK_TS}';")
fi

log "--- Sync complete ---"
