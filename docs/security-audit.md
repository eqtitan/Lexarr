# Security Audit Log

One of the 0.10.0 release-readiness criteria is that `npm audit` comes back
clean and the Docker base image is free of known critical/high CVEs. This
page is the audit log — a dated table so period-over-period comparison is
easy the next time we repeat the check.

## How to repeat the audit

```bash
# Dependency CVE scan
npm audit --audit-level=low

# If anything actionable surfaces, prefer patching in version range
npm audit fix

# Base-image CVE scan (Unraid host; Docker Scout built into Docker Desktop)
docker scout cves node:20-alpine
# or — where scout isn't available
trivy image node:20-alpine
```

Run the above against the **current** master, record the result in the
table below, and open a fix PR if any `critical` or `high` CVEs appear.

## Audit history

| Date | Trigger | npm audit | Docker base image | Actions taken |
|------|---------|-----------|-------------------|---------------|
| 2026-04-17 | 0.10.0 release-readiness | **1 high** — [`GHSA-q4gf-8mx6-v5v3`](https://github.com/advisories/GHSA-q4gf-8mx6-v5v3) — Next.js DoS with Server Components (CVSS 7.5) in `next` ≥16.0.0-beta.0 <16.2.3 | `node:20-alpine` (pending scout/trivy run) | `npm audit fix` bumped `next` from 16.2.2 → 16.2.4. Re-ran `npm audit`: **0 vulnerabilities** across all severities. |
| 2026-10-19 | Full code review before 1.0.0 | **3 critical, 4 high, 1 moderate** (prod) — `next` (Server Components DoS, middleware/proxy bypass), `next-auth`/`@auth/core` (fail-open existence-based auth checks, homoglyph email bypass), `postcss` (stringify XSS, file read), `sharp` (libvips/libheif/librsvg CVEs), `nanoid`, `source-map-js`, `baseline-browser-mapping`; plus 3 moderate dev-only (`vitest` mocker path traversal) | `node:20-alpine` → **`node:22-alpine`** (Node 20 reached end-of-life 2026-04-30) | `npm audit fix` (next 16.2.4 → 16.4.2, next-auth beta.30 → beta.32, @auth/core → 0.41.3, postcss → 8.5.23, sharp → 0.35.5) + vitest/coverage-istanbul → 4.1.12. Re-ran `npm audit`: **0 vulnerabilities** across all severities. CI on Node 22; `engines.node` is `>=22`. |

## Current state

As of the last row above:

```
npm audit:   info=0 low=0 moderate=0 high=0 critical=0 total=0
next:        16.4.2  (fix applied)
node (base): 22-alpine
deps (prod): 60  (npm ls --omit=dev --all)
```

## Cadence

- **Before every `0.X.0` minor release** — runs as part of release readiness
- **Monthly** during the 1.0.0 soak period
- **Immediately** on any GitHub Dependabot / security advisory notification

## Notes on policy

- **High + critical are blockers** for a release. Patch before tagging.
- **Moderate is a warning**. If no patched version is available in the
  dependency's major range, log the mitigation (e.g. "feature not used")
  in the table's `Actions taken` column and ship.
- **Low + info** are noise. Recorded but don't gate a release.
- **Base-image CVEs** follow the same tiers but patches often require
  rebuilding from a newer tag (e.g. `node:20-alpine` → `node:22-alpine`)
  which has broader test implications. Schedule major bumps during a
  release cycle, not in a patch.

## Known historical exceptions

None yet. This log started at 0.10.0 — previous releases (0.1.0 through
0.9.1) shipped without a formal audit record. Pre-0.10.0 audits were
implicit in the CI green signal but not explicitly captured here.
