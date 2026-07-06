#Requires -Version 5.1
<#
.SYNOPSIS
    Sync Lexarr source to Unraid and rebuild the container.

.DESCRIPTION
    Rsyncs src/, prisma/, and root config files to Unraid, builds a new
    Docker image tagged with the package.json version, and hot-swaps the
    running container.  Run from the lexarr project root.

.PARAMETER NoSync
    Skip the SCP step (useful when only re-deploying a previously synced build).

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
$REMOTE  = "/mnt/user/appdata/lexarr"
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
Write-Host "  Lexarr deploy  →  $IMAGE`:$tag  →  $UNRAID" -ForegroundColor Cyan
Write-Host ""

# ── 1. Sync source ────────────────────────────────────────────────────────
if (-not $NoSync) {
    Write-Host "[1/3] Syncing source files..."

    # Directories — scp -r copies the directory itself into the target parent
    $dirs = @("src", "prisma", "public")
    foreach ($dir in $dirs) {
        if (Test-Path $dir) {
            Write-Host "      $dir/"
            & scp -o StrictHostKeyChecking=no -r $dir "${UNRAID}:${REMOTE}/"
            if ($LASTEXITCODE -ne 0) { Write-Error "SCP failed: $dir"; exit 1 }
        }
    }

    # Individual root-level files
    $files = @(
        "package.json",
        "package-lock.json",
        "next.config.ts",
        "tsconfig.json",
        "postcss.config.mjs",
        "eslint.config.mjs",
        "Dockerfile"
    )
    foreach ($file in $files) {
        if (Test-Path $file) {
            Write-Host "      $file"
            & scp -o StrictHostKeyChecking=no $file "${UNRAID}:${REMOTE}/$file"
            if ($LASTEXITCODE -ne 0) { Write-Error "SCP failed: $file"; exit 1 }
        }
    }

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
    $gitSha = (git rev-parse --short HEAD).Trim()
    $buildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    # Run the build and stream output; grep keeps it tidy but shows errors in full
    & ssh -o StrictHostKeyChecking=no $UNRAID @"
cd $REMOTE && docker build --build-arg GIT_SHA=$gitSha --build-arg BUILD_TIME=$buildTime -t ${IMAGE}:${tag} . 2>&1 | grep -E --color=never 'error|Error|ERROR|writing image|naming to|^#[0-9]+ ERROR'
"@
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Build failed. Run with full output:" -ForegroundColor Red
        Write-Host "  ssh $UNRAID `"cd $REMOTE && docker build --build-arg GIT_SHA=$gitSha --build-arg BUILD_TIME=$buildTime -t ${IMAGE}:${tag} .`"" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "      Build succeeded." -ForegroundColor Green
    Write-Host ""
}

# ── 3. Redeploy container ─────────────────────────────────────────────────
Write-Host "[3/3] Redeploying container..."

$volFlags = ($VOLUMES | ForEach-Object { "-v $_" }) -join " "
$deployCmd = @"
docker stop lexarr 2>/dev/null || true
docker rm   lexarr 2>/dev/null || true
docker run -d \
  --name lexarr \
  --network $NETWORK \
  -p $PORT \
  --env-file $ENV_FILE \
  $volFlags \
  --restart unless-stopped \
  ${IMAGE}:${tag} \
&& docker tag ${IMAGE}:${tag} ${IMAGE}:latest \
&& echo 'started'
"@

$result = & ssh -o StrictHostKeyChecking=no $UNRAID $deployCmd
if ($LASTEXITCODE -ne 0 -or $result -notcontains "started") {
    Write-Error "Container start failed."
    exit 1
}

Write-Host "      Waiting for Next.js to be ready..."
Start-Sleep -Seconds 10

$logs = & ssh -o StrictHostKeyChecking=no $UNRAID "docker logs lexarr --tail 5 2>&1"
Write-Host ""
$logs | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
Write-Host ""

if ($logs -match "Ready in") {
    Write-Host "  Lexarr $tag is live at http://${UnraidHost}:5056" -ForegroundColor Green
} else {
    Write-Host "  Container started but 'Ready' not yet seen — check logs:" -ForegroundColor Yellow
    Write-Host "  ssh $UNRAID `"docker logs lexarr --tail 20`"" -ForegroundColor Yellow
}
Write-Host ""
