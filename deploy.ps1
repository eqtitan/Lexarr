#Requires -Version 5.1
<#
.SYNOPSIS
    Sync Lexarr source to Unraid and rebuild the container.

.DESCRIPTION
    Ships the committed HEAD (git archive) to a fresh build directory on
    Unraid, builds a Docker image tagged with the package.json version, and
    hot-swaps the running container.  Run from the lexarr project root with
    a clean working tree -- what gets deployed is exactly the commit, never
    stray local edits or stale files left on the server.

.PARAMETER NoSync
    Skip shipping the source (re-build from the already-shipped commit).

.PARAMETER NoBuild
    Skip the Docker build step and re-use the image already on Unraid.

.EXAMPLE
    .\deploy.ps1
    .\deploy.ps1 -NoSync   # rebuild + redeploy without re-syncing files
#>
param(
    [switch]$NoSync,
    [switch]$NoBuild,
    [string]$UnraidHost = "your-server-ip"
)

$ErrorActionPreference = "Stop"

# ── Config ────────────────────────────────────────────────────────────────
$UNRAID  = "root@$UnraidHost"
$REMOTE  = "/mnt/user/appdata/lexarr"          # holds .env (never overwritten)
$BUILDS  = "/mnt/user/appdata/lexarr-build"    # one clean dir per deployed commit
$IMAGE   = "lexarr"

# Container run params (mirrors the hand-crafted docker run we've been using)
$NETWORK   = "arrnet"
$PORT      = "5056:5056"
$ENV_FILE  = "$REMOTE/.env"
$VOLUMES   = @(
    "/mnt/user/data/stack-healthcheck:/stack-health:ro",
    "lexarr-data:/app/data"
)

# ── Version from package.json ─────────────────────────────────────────────
if (-not (Test-Path "package.json")) {
    Write-Error "Run deploy.ps1 from the lexarr project root (package.json not found)."
    exit 1
}
$pkg     = Get-Content "package.json" -Raw | ConvertFrom-Json
$version = $pkg.version
$tag     = "v$version"

Write-Host ""
Write-Host "  Lexarr deploy  ->  $IMAGE`:$tag  ->  $UNRAID" -ForegroundColor Cyan
Write-Host ""

# ── 0. Deploy only committed code ─────────────────────────────────────────
# The image is built from `git archive HEAD`, so uncommitted edits would be
# silently left out. Refuse instead of surprising anyone.
$dirty = (git status --porcelain --untracked-files=no) -join "`n"
if ($dirty) {
    Write-Host "Working tree has uncommitted changes -- commit or stash them first:" -ForegroundColor Red
    Write-Host $dirty
    exit 1
}
$gitSha = (git rev-parse --short HEAD).Trim()
$BUILD_DIR = "$BUILDS/$gitSha"

# ── 1. Ship the commit ────────────────────────────────────────────────────
# A fresh directory per commit: the old scp-over-the-top sync never deleted
# anything, so removed files (and .bak copies) lingered on the server and
# could end up in an image.
if (-not $NoSync) {
    Write-Host "[1/3] Shipping commit $gitSha..."
    $archive = Join-Path ([System.IO.Path]::GetTempPath()) "lexarr-$gitSha.tar"
    & git archive --format=tar -o $archive HEAD
    if ($LASTEXITCODE -ne 0) { Write-Error "git archive failed"; exit 1 }
    # Via a temp file, not a pipe: Windows PowerShell can mangle binary
    # data piped between native commands.
    & scp -o StrictHostKeyChecking=no $archive "${UNRAID}:/tmp/lexarr-$gitSha.tar"
    if ($LASTEXITCODE -ne 0) { Remove-Item $archive; Write-Error "SCP failed"; exit 1 }
    Remove-Item $archive
    & ssh -o StrictHostKeyChecking=no $UNRAID "rm -rf $BUILD_DIR && mkdir -p $BUILD_DIR && tar -xf /tmp/lexarr-$gitSha.tar -C $BUILD_DIR && rm -f /tmp/lexarr-$gitSha.tar"
    if ($LASTEXITCODE -ne 0) { Write-Error "Extracting on Unraid failed"; exit 1 }
    # Keep the three most recent build directories.
    & ssh -o StrictHostKeyChecking=no $UNRAID "ls -dt $BUILDS/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf"

    Write-Host "      Done." -ForegroundColor Green
    Write-Host ""
}

# ── 2. Docker build ───────────────────────────────────────────────────────
if (-not $NoBuild) {
    Write-Host "[2/3] Building $IMAGE`:$tag on Unraid (this takes ~30s)..."

    # GIT_SHA/BUILD_TIME are baked in as build args so /api/version reports
    # real provenance instead of falling back to "unknown". Computed locally
    # (not on the remote) so GIT_SHA reflects the commit actually being
    # deployed from this machine.
    $buildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    # `set -o pipefail` is required here: without it, $LASTEXITCODE reflects
    # grep's exit code (0 if it matched any line, success OR failure) instead
    # of docker build's real exit code -- a masked-failure bug that let a
    # broken build through undetected on 2026-07-06 and tore down the live
    # container before the replacement was ready. Single-line command (no
    # backslash-continuations) to avoid CRLF-vs-LF line-ending issues when a
    # PowerShell here-string crosses SSH to a Linux remote shell.
    $buildRemoteCmd = "set -o pipefail; cd $BUILD_DIR && docker build --build-arg GIT_SHA=$gitSha --build-arg BUILD_TIME=$buildTime -t ${IMAGE}:${tag} . 2>&1 | grep -E --color=never 'error|Error|ERROR|writing image|naming to|^#[0-9]+ ERROR'"
    & ssh -o StrictHostKeyChecking=no $UNRAID $buildRemoteCmd
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Build failed. Run with full output:" -ForegroundColor Red
        Write-Host "  ssh $UNRAID `"cd $BUILD_DIR && docker build --build-arg GIT_SHA=$gitSha --build-arg BUILD_TIME=$buildTime -t ${IMAGE}:${tag} .`"" -ForegroundColor Yellow
        exit 1
    }

    # Belt-and-suspenders: confirm the image actually exists before touching
    # the running container, regardless of what the build's exit code says.
    $imageCheck = & ssh -o StrictHostKeyChecking=no $UNRAID "docker images -q ${IMAGE}:${tag}"
    if ([string]::IsNullOrWhiteSpace($imageCheck)) {
        Write-Error "Build reported success but ${IMAGE}:${tag} does not exist on Unraid. Aborting before touching the live container."
        exit 1
    }

    Write-Host "      Build succeeded and image verified present." -ForegroundColor Green
    Write-Host ""
}

# ── 3. Redeploy container ─────────────────────────────────────────────────
# Rename (don't remove) the old container until the new one is confirmed
# healthy, so a bad deploy can roll back instead of leaving nothing running --
# a version of this script that did `docker rm` unconditionally caused a real
# outage on 2026-07-06 when a build silently failed and the replacement never
# started. Every remote step below is single-line (no backslash-continuation
# here-strings) and exit-code-checked individually rather than chained.
Write-Host "[3/3] Redeploying container..."

$volFlags = ($VOLUMES | ForEach-Object { "-v $_" }) -join " "

# Step back the old container out of the way (renamed, not removed)
& ssh -o StrictHostKeyChecking=no $UNRAID "docker stop lexarr 2>/dev/null; docker rename lexarr lexarr-previous 2>/dev/null; true"

# Start the new one
$runCmd = "docker run -d --name lexarr --network $NETWORK -p $PORT --env-file $ENV_FILE $volFlags --restart unless-stopped ${IMAGE}:${tag}"
& ssh -o StrictHostKeyChecking=no $UNRAID $runCmd
$startFailed = ($LASTEXITCODE -ne 0)

if (-not $startFailed) {
    Write-Host "      Waiting for Next.js to be ready..."
    Start-Sleep -Seconds 10
    $health = & ssh -o StrictHostKeyChecking=no $UNRAID "curl -s -o /dev/null -w '%{http_code}' http://localhost:5056/api/healthz"
    if ($health -ne "200") { $startFailed = $true }
}

if ($startFailed) {
    Write-Host ""
    Write-Host "  New container failed to start or isn't healthy -- rolling back." -ForegroundColor Red
    & ssh -o StrictHostKeyChecking=no $UNRAID "docker stop lexarr 2>/dev/null; docker rm lexarr 2>/dev/null; docker rename lexarr-previous lexarr 2>/dev/null; docker start lexarr"
    Write-Error "Deploy failed and was rolled back to the previous container. Check logs: ssh $UNRAID `"docker logs lexarr --tail 50`""
    exit 1
}

# New container confirmed healthy -- safe to drop the old one now
& ssh -o StrictHostKeyChecking=no $UNRAID "docker rm lexarr-previous 2>/dev/null; docker tag ${IMAGE}:${tag} ${IMAGE}:latest"

Write-Host ""
Write-Host "  Lexarr $tag is live and healthy at http://${UnraidHost}:5056" -ForegroundColor Green
Write-Host ""
