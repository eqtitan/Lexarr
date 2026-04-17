# POST Route Idempotency Audit

One of the 0.9.0 exit criteria (rolled from 0.7.0 Reliability) is that every
POST route in Lexarr must either be idempotent or explicitly document why
it isn't. This page is the authoritative table — when you add a new POST
route, update it here and add the matching docstring to the handler.

A route is **idempotent** when: *"the Nth retry, for N ≥ 1, produces the
same server state as the 1st."* A duplicate POST might return a different
status code (e.g. 200 "already exists" vs 201 "created") but must not
create a second row, fire a second webhook, or increment a counter twice.

## Summary

| Route | Idempotent? | Key |
|---|---|---|
| `POST /api/auth/register` | ✅ yes | `name` |
| `POST /api/auth/plex` | ❌ no — by design | — |
| `POST /api/request` | ✅ yes | `(userId, mediaType, externalId, externalId2)` |
| `POST /api/library-status` | ✅ yes (read-only) | — |
| `POST /api/status` | ✅ yes (state-reconciling) | — |
| `POST /api/admin/notifications` | ✅ yes | `webhookUrl` |
| `POST /api/admin/notifications/test` | ❌ no — by design | — |
| `POST /api/admin/retry` | ⚠️ state-guarded, small race | — |
| `POST /api/webhooks/radarr` | ✅ yes (state-reconciling) | — |
| `POST /api/webhooks/sonarr` | ✅ yes (state-reconciling) | — |
| `POST /api/webhooks/lidarr` | ✅ yes (state-reconciling) | — |

## Notes on the non-trivial cases

### `/api/request` — idempotent via service layer

`createRequest()` in `src/lib/services/request.ts` checks for an existing
row matching `(userId, mediaType, externalId, externalId2)` before creating
a new one. A duplicate POST returns the existing request with status 200
plus an `alreadyRequested: true` flag, instead of a 201 + new row.

For music, `externalId2` carries the release-group MBID so an artist-level
request and a release-group request don't collide.

### `/api/admin/notifications` — dedupe by `webhookUrl`

Before 0.9.0 a rapid double-click in the "Add notification channel" UI
would create two rows pointing at the same webhook URL — every future
notification would fire twice. The POST now checks `findFirst({ webhookUrl })`
first and returns the existing channel on match (status 200 + `alreadyExists: true`).

`name` isn't the key because it's cosmetic; `webhookUrl` is what actually
receives traffic.

### `/api/admin/retry` — state-guarded, small race window

Retry is guarded by the `canRetry` check (status must be `failed`,
`stalled`, or `approved` with no `arrId`). A replayed POST after a
successful retry hits the guard and 400s, so accidental repeats from
network flakes are safe.

The small window: two concurrent POSTs can both pass the `canRetry` check
before either update commits, bumping `retryCount` twice. This is
acceptable today — retry is admin-only and the UI serializes clicks — but
worth revisiting if we ever automate retries from multiple sources.

### `/api/auth/plex` — intentionally non-idempotent

Each call mints a fresh PIN with its own ID and expiry at Plex's side.
Retry is cheap; duplicates auto-expire. No deduplication is needed or
wanted — PIN creation is meant to be ephemeral.

### `/api/admin/notifications/test` — intentionally non-idempotent

Each POST sends one webhook message, by design. The button exists
precisely so admins can manually verify delivery. A duplicate click
produces two "test notification" messages — one extra line in a Discord
channel, which is the intended cost.

### Webhooks from *arr apps — converging reconciliation

Radarr/Sonarr/Lidarr sometimes retry their own webhooks on transient
failures. Each POST delegates to `checkSingleRequest()`, which reads
current *arr state and writes the corresponding Lexarr row state. A
duplicate POST converges on the same end state; it may emit a
pipeline event for a real transition (downloading → available) but
not a spurious duplicate.

## Adding a new POST route

1. Write the handler.
2. Decide: idempotent, or not? If idempotent, what's the natural key?
3. Add a JSDoc block on the `export async function POST` line documenting
   the answer. The format:

   ```ts
   /**
    * POST — <one-line purpose>.
    *
    * Idempotency: <yes / no / state-guarded / read-only>. <Why / what key>.
    */
   ```

4. Add a row to the table above.

Routes that fail this audit should either be converted (natural key +
pre-check), or explicitly marked as non-idempotent with a rationale.
