# Stack-healthcheck integration with Lexarr

The Lexarr container reads two things from the host stack-healthcheck mount:

1. **Summary report** — `/stack-health/latest-report.txt` (already in use; surfaced as `StackHealthSummary` in the admin dashboard).
2. **Per-service container snapshots** — `/stack-health/services/<name>.json` (M2-01; surfaced as `ContainerStatusDTO` in the Diagnose modal).

This doc covers (2). The summary report is unchanged.

## What Lexarr expects

Each `services/<name>.json` file should match the `ContainerStatusDTO` shape from `src/types/dashboard.ts`:

```json
{
  "name": "radarr",
  "status": "running",
  "startedAt": "2026-04-25T03:14:22Z",
  "uptime": "2d 7h",
  "logs": [
    "[2026-04-25 03:14:22] Starting Radarr v6.2.7",
    "[2026-04-25 03:14:23] Listening on 0.0.0.0:7878"
  ],
  "asOf": "2026-04-25T03:14:25Z"
}
```

Lexarr will fill in `source: "cron"` and `refreshAvailable` itself when it reads the file. `uptime` is optional — if absent, Lexarr derives it from `startedAt`.

`<name>` matches the `unraidContainerName` field from `SERVICE_REGISTRY` (lower-cased service name on this stack: `radarr`, `sonarr`, `lidarr`, `prowlarr`, `bazarr`, `lazylibrarian`, `qbittorrent`, `nzbget`, `jellyfin`).

## Suggested host script extension

Add to the existing `/usr/local/bin/stack-healthcheck.sh` (or wherever the cron lives):

```bash
SERVICES_DIR="/mnt/user/data/stack-healthcheck/services"
mkdir -p "$SERVICES_DIR"

CONTAINERS="radarr sonarr lidarr prowlarr bazarr lazylibrarian qbittorrent nzbget jellyfin"

for c in $CONTAINERS; do
  if ! docker inspect "$c" >/dev/null 2>&1; then
    continue
  fi

  STATUS=$(docker inspect --format '{{.State.Status}}' "$c")
  STARTED=$(docker inspect --format '{{.State.StartedAt}}' "$c")
  LOGS_JSON=$(docker logs --tail 50 "$c" 2>&1 | jq -Rs 'split("\n") | map(select(length > 0))')
  NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  jq -n \
    --arg name "$c" \
    --arg status "$STATUS" \
    --arg startedAt "$STARTED" \
    --argjson logs "$LOGS_JSON" \
    --arg asOf "$NOW" \
    '{name: $name, status: $status, startedAt: $startedAt, logs: $logs, asOf: $asOf}' \
    > "$SERVICES_DIR/$c.json"
done
```

Add this block alongside the existing summary-report writer in the cron. Same 4-hour cadence is fine; staleness is clearly labelled in the Lexarr UI.

## Optional: live SSH refresh

Operators who want sub-4-hour data can opt in to live refresh by setting these env vars on the Lexarr container:

```
STACK_HEALTH_SSH_HOST=your-server-ip
STACK_HEALTH_SSH_USER=root
STACK_HEALTH_SSH_KEY_PATH=/app/data/.ssh/id_lexarr
```

When all three are set, the Diagnose modal exposes a "Refresh now" button that runs over SSH:

```
docker inspect --format '{{.State.Status}}|{{.State.StartedAt}}' <name>
docker logs --tail 50 <name>
```

The SSH key should be mounted into the Lexarr container as a docker volume, owned by the `nextjs` user (uid 1001). Generate it on the host with:

```bash
ssh-keygen -t ed25519 -f /mnt/user/appdata/lexarr/ssh/id_lexarr -N "" -C "lexarr-stack-health"
chown 1001:1001 /mnt/user/appdata/lexarr/ssh/id_lexarr*
cat /mnt/user/appdata/lexarr/ssh/id_lexarr.pub >> /root/.ssh/authorized_keys
```

…then mount `/mnt/user/appdata/lexarr/ssh:/app/data/.ssh:ro` in the Lexarr container.

### Hardening: restricted-command wrapper

The default setup gives Lexarr's SSH key full root shell. To limit blast radius, prepend a `command="..."` clause to the `authorized_keys` entry that restricts the key to a wrapper script:

```bash
# /root/.ssh/authorized_keys
command="/root/bin/lexarr-docker-wrapper",no-port-forwarding,no-x11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... lexarr-stack-health
```

```bash
# /root/bin/lexarr-docker-wrapper
#!/bin/sh
# Allow only `docker inspect` and `docker logs` for known container names.
set -eu
ALLOWED="radarr sonarr lidarr prowlarr bazarr lazylibrarian qbittorrent nzbget jellyfin"
case "$SSH_ORIGINAL_COMMAND" in
  *' && '* | *';'* | *'|'* | *'`'* | *'$('*) exit 1 ;;
esac
case "$SSH_ORIGINAL_COMMAND" in
  "docker inspect "*|"docker logs "*) ;;
  *) exit 1 ;;
esac
NAME=$(echo "$SSH_ORIGINAL_COMMAND" | awk '{print $NF}')
case " $ALLOWED " in
  *" $NAME "*) exec sh -c "$SSH_ORIGINAL_COMMAND" ;;
  *) exit 1 ;;
esac
```

The wrapper is the moral equivalent of a sudoers-style allowlist for the Lexarr key. Without it, the key has full root.

## Failure modes Lexarr handles gracefully

- **`/stack-health/services/` doesn't exist** — modal shows "No data — host stack-healthcheck cron hasn't written a snapshot yet."
- **JSON file exists but is malformed** — modal logs a warning and shows the empty state.
- **SSH timeout (>5s)** — modal falls back to the cron snapshot (or empty state). Logged at warn level.
- **Unknown container name** — wrapper script (if installed) rejects with exit 1; Lexarr logs and falls back to cron snapshot.

## Why no Docker socket mount?

Mounting `/var/run/docker.sock` into Lexarr would give the container effective root on the host (any container can be replaced or escaped via the socket). The cron-file + opt-in SSH path keeps Lexarr's privilege footprint small: read-only file mount by default, narrow SSH command via key + wrapper when operators want fresher data.
