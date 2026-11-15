#Requires -Version 5.1
<#
.SYNOPSIS
    Ship the current master commit to Unraid and swap the running container.

.DESCRIPTION
    Ships the committed HEAD (git archive) to a fresh build directory on
    Unraid, builds a Docker image, and swaps the running container -- with a
    database backup taken while the old container is stopped, and a rollback
    that also restores that backup if the new image migrated the schema.

    Only a commit that is master, pushed, and green in CI is deployed (see
    -Force). The server-side steps live in scripts/deploy-remote.sh, which
    ships with the commit.

.PARAMETER Rehearse
    Build the image and run it on port 5059 against a copy of the live DB
    with dummy keys and notifications off, then tear it down. The live
    container is never touched. Works from any branch.

.PARAMETER Force
    Deploy even if the commit isn't master, isn't pushed, or CI hasn't
    passed for it. Prints a warning; use for emergencies only.

.PARAMETER NoSync
    Skip shipping the source (re-build from the already-shipped commit).

.PARAMETER NoBuild
    Skip the Docker build step and re-use the image already on Unraid.

.EXAMPLE
    .\deploy.ps1 -UnraidHost 192.168.1.100 -Rehearse   # try it first
    .\deploy.ps1 -UnraidHost 192.168.1.100             # then deploy
    $env:LEXARR_UNRAID_HOST = "192.168.1.100"            # or set it once
#>
param(
    [switch]$Rehearse,
    [switch]$Force,
    [switch]$NoSync,
    [switch]$NoBuild,
    [string]$UnraidHost = $(if ($env:LEXARR_UNRAID_HOST) { $env:LEXARR_UNRAID_HOST } else { "your-server-ip" }),
    # The container being replaced. Overridable so the rollback path can be
    # exercised against a throwaway container instead of production.
    [string]$ContainerName = "lexarr",
    [int]$HostPort = 5056,
    [string]$DataVolume = "lexarr-data",
    [string]$EnvFile = "/mnt/user/appdata/lexarr/.env"
)

$ErrorActionPreference = "Stop"

# ── Config ────────────────────────────────────────────────────────────────
$UNRAID  = "root@$UnraidHost"
$SSH     = @("-o", "StrictHostKeyChecking=no", $UNRAID)
$BUILDS  = "/mnt/user/appdata/lexarr-build"    # one clean dir per deployed commit
$IMAGE   = "lexarr"
$NETWORK = "arrnet"
$REHEARSAL_PORT = 5059
$VOLUMES = @(
    "/mnt/user/data/stack-healthcheck:/stack-health:ro",
    "${DataVolume}:/app/data"
)
$isProduction = ($ContainerName -eq "lexarr")

function Remote([string]$cmd) { & ssh @SSH $cmd }
function Step([string]$msg) { Write-Host $msg }
function Ok([string]$msg) { Write-Host "      $msg" -ForegroundColor Green }
function Fail([string]$msg) { Write-Host ""; Write-Host "  $msg" -ForegroundColor Red; exit 1 }

# ── Version from package.json ─────────────────────────────────────────────
if (-not (Test-Path "package.json")) {
    Write-Error "Run deploy.ps1 from the lexarr project root (package.json not found)."
    exit 1
}
$version  = (Get-Content "package.json" -Raw | ConvertFrom-Json).version
$gitSha   = (git rev-parse --short HEAD).Trim()
$fullSha  = (git rev-parse HEAD).Trim()
# Every image is tagged with its commit, so v0.20.0 built from two different
# commits can't be confused. v<version> and latest follow the live container.
$shaTag   = "v$version-$gitSha"
$BUILD_DIR = "$BUILDS/$gitSha"
$REMOTE_SCRIPT = "bash $BUILD_DIR/scripts/deploy-remote.sh"

$mode = if ($Rehearse) { "rehearsal on :$REHEARSAL_PORT" } else { "$ContainerName on :$HostPort" }
Write-Host ""
Write-Host "  Lexarr deploy  ->  ${IMAGE}:$shaTag  ->  $UNRAID  ($mode)" -ForegroundColor Cyan
Write-Host ""

# ── 0. Deploy only committed, pushed, CI-green master ─────────────────────
# The image is built from `git archive HEAD`, so uncommitted edits would be
# silently left out. Refuse instead of surprising anyone.
$dirty = (git status --porcelain --untracked-files=no) -join "`n"
if ($dirty) {
    Write-Host "Working tree has uncommitted changes -- commit or stash them first:" -ForegroundColor Red
    Write-Host $dirty
    exit 1
}

if (-not $Rehearse) {
    # There's no branch protection on this repo, so this is the gate that
    # keeps an unreviewed or red commit off the server.
    $problems = @()
    $branch = (git rev-parse --abbrev-ref HEAD).Trim()
    if ($branch -ne "master") { $problems += "on branch '$branch', not master" }
    & git fetch -q origin master
    $remoteSha = (git rev-parse origin/master).Trim()
    if ($fullSha -ne $remoteSha) { $problems += "HEAD $gitSha is not origin/master ($($remoteSha.Substring(0,7)))" }
    $ci = $null
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        # try/catch: Windows PowerShell turns a native command's stderr into
        # a terminating error under ErrorActionPreference=Stop.
        try {
            $ci = (& gh run list --workflow ci.yml --commit $fullSha --event push --limit 1 --json conclusion -q '.[0].conclusion' 2>$null)
        } catch { $ci = $null }
    }
    if ($ci -ne "success") {
        $state = if ($ci) { $ci } else { "no finished run found (or gh missing)" }
        $problems += "CI for $gitSha is not green: $state"
    }
    if ($problems.Count -gt 0) {
        if (-not $Force) {
            Write-Host "Refusing to deploy:" -ForegroundColor Red
            $problems | ForEach-Object { Write-Host "  - $_" }
            Write-Host "Rehearse with -Rehearse, or override with -Force (emergencies only)."
            exit 1
        }
        Write-Host "WARNING: deploying anyway (-Force):" -ForegroundColor Yellow
        $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
        Write-Host ""
    }
}

# ── 1. Ship the commit ────────────────────────────────────────────────────
# A fresh directory per commit, so files removed from the repo can't linger
# into an image. core.autocrlf=false: with autocrlf on (the Windows default),
# git archive writes CRLF line endings, which breaks shell scripts on Linux.
if (-not $NoSync) {
    Step "[1/4] Shipping commit $gitSha..."
    $archive = Join-Path ([System.IO.Path]::GetTempPath()) "lexarr-$gitSha.tar"
    & git -c core.autocrlf=false archive --format=tar -o $archive HEAD
    if ($LASTEXITCODE -ne 0) { Fail "git archive failed" }
    # Via a temp file, not a pipe: Windows PowerShell can mangle binary
    # data piped between native commands.
    & scp -o StrictHostKeyChecking=no $archive "${UNRAID}:/tmp/lexarr-$gitSha.tar"
    if ($LASTEXITCODE -ne 0) { Remove-Item $archive; Fail "SCP failed" }
    Remove-Item $archive
    Remote "rm -rf $BUILD_DIR && mkdir -p $BUILD_DIR && tar -xf /tmp/lexarr-$gitSha.tar -C $BUILD_DIR && rm -f /tmp/lexarr-$gitSha.tar"
    if ($LASTEXITCODE -ne 0) { Fail "Extracting on Unraid failed" }
    # Keep the three most recent build directories. Only directories named
    # like a commit sha are ever pruned -- anything else under $BUILDS is
    # someone's, not ours (a stale hand-copied source tree once sat there).
    Remote "find $BUILDS -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9a-f]{7,40}' -printf '%T@ %p\n' | sort -rn | tail -n +4 | cut -d' ' -f2- | xargs -r rm -rf"
    Ok "Done."
    Write-Host ""
}

# ── 2. Docker build ───────────────────────────────────────────────────────
if (-not $NoBuild) {
    Step "[2/4] Building ${IMAGE}:$shaTag on Unraid (this takes ~1 min)..."
    # GIT_SHA/BUILD_TIME are baked in so /api/version reports real provenance.
    $buildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    # pipefail: without it the exit code is grep's, not docker build's -- a
    # masked failure that once tore down the live container (2026-07-06).
    Remote "set -o pipefail; cd $BUILD_DIR && docker build --build-arg GIT_SHA=$gitSha --build-arg BUILD_TIME=$buildTime -t ${IMAGE}:${shaTag} . 2>&1 | grep -E --color=never 'error|Error|ERROR|writing image|naming to|^#[0-9]+ ERROR'"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed. Run with full output:" -ForegroundColor Red
        Write-Host "  ssh $UNRAID `"cd $BUILD_DIR && docker build -t ${IMAGE}:${shaTag} .`"" -ForegroundColor Yellow
        exit 1
    }
}
# Confirm the image exists before touching anything, whatever the build said.
if ([string]::IsNullOrWhiteSpace((Remote "docker images -q ${IMAGE}:${shaTag}"))) {
    Fail "${IMAGE}:$shaTag does not exist on Unraid. Nothing was changed."
}
Ok "Image ${IMAGE}:$shaTag present."
Write-Host ""

# ── Rehearsal: run against a copy of the live DB, then stop ───────────────
if ($Rehearse) {
    Step "[3/4] Rehearsing..."
    Remote "$REMOTE_SCRIPT rehearse ${IMAGE}:${shaTag} $REHEARSAL_PORT"
    if ($LASTEXITCODE -ne 0) { Fail "Rehearsal FAILED -- don't deploy this commit. The live container was not touched." }
    Write-Host ""
    Write-Host "  Rehearsal passed. Deploy with: .\deploy.ps1 -UnraidHost $UnraidHost" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# ── 3. Back up the DB with the old container stopped ──────────────────────
# Stopped first, so no request can land between the backup and the swap.
Step "[3/4] Stopping $ContainerName and backing up its database..."
$previous = "$ContainerName-previous"
if (Remote "docker ps -aq --filter name=^/$previous$") {
    Fail "A '$previous' container already exists (a past deploy didn't finish). Inspect it and remove it before deploying."
}
Remote "docker stop $ContainerName >/dev/null 2>&1; docker rename $ContainerName $previous >/dev/null 2>&1; true"

$backupOut = Remote "$REMOTE_SCRIPT backup $DataVolume $ContainerName-$gitSha $EnvFile"
if ($LASTEXITCODE -ne 0) {
    Remote "docker rename $previous $ContainerName >/dev/null 2>&1; docker start $ContainerName >/dev/null"
    Fail "Database backup failed -- restarted the old container, nothing was changed."
}
$backupPath, $migrationsBefore = (($backupOut | Select-Object -Last 1) -split " ")
Ok "Backup: $backupPath ($migrationsBefore migrations)"
Write-Host ""

# ── 4. Start the new container; roll back (DB too) if it isn't healthy ───
Step "[4/4] Starting ${IMAGE}:$shaTag..."
$volFlags = ($VOLUMES | ForEach-Object { "-v $_" }) -join " "
Remote "docker run -d --name $ContainerName --network $NETWORK -p ${HostPort}:5056 --env-file $EnvFile $volFlags --restart unless-stopped ${IMAGE}:${shaTag}"
$healthy = ($LASTEXITCODE -eq 0)
if ($healthy) {
    # Polls /api/livez for up to 90s (migrations run first), then requires
    # healthz's DB check. An unreachable *arr app only warns.
    Remote "$REMOTE_SCRIPT wait-healthy $HostPort 90 $ContainerName"
    $healthy = ($LASTEXITCODE -eq 0)
}

if (-not $healthy) {
    Write-Host ""
    Write-Host "  New container failed to start or isn't healthy -- rolling back." -ForegroundColor Red
    Remote "docker logs $ContainerName --tail 30 2>&1"
    Remote "docker rm -f $ContainerName >/dev/null 2>&1; true"
    # The new image runs `prisma migrate deploy` before the app starts, so a
    # failed deploy may still have changed the schema. The old app can't be
    # trusted on a newer schema: put the pre-deploy DB back first.
    $migrationsAfter = (Remote "$REMOTE_SCRIPT migrations $DataVolume" | Select-Object -Last 1)
    if ($backupPath -ne "none" -and $migrationsAfter -ne $migrationsBefore) {
        Write-Host "  Schema changed ($migrationsBefore -> $migrationsAfter migrations); restoring the pre-deploy DB." -ForegroundColor Yellow
        Remote "$REMOTE_SCRIPT restore $DataVolume $backupPath"
        if ($LASTEXITCODE -ne 0) { Fail "RESTORE FAILED. The old container is stopped as '$previous'. Restore $backupPath by hand before starting it." }
    }
    Remote "docker rename $previous $ContainerName >/dev/null 2>&1; docker start $ContainerName >/dev/null"
    Remote "$REMOTE_SCRIPT wait-healthy $HostPort 90 $ContainerName"
    $oldOk = if ($LASTEXITCODE -eq 0) { "and is healthy" } else { "BUT IS NOT HEALTHY -- check it now" }
    Fail "Deploy failed. Rolled back to the previous container, which is running $oldOk."
}

# Healthy: drop the old container and move the moving tags.
Remote "docker rm $previous >/dev/null 2>&1; true"
if ($isProduction) {
    Remote "docker tag ${IMAGE}:${shaTag} ${IMAGE}:v$version && docker tag ${IMAGE}:${shaTag} ${IMAGE}:latest"
    # Record what's live in git too. Not a v* tag, so it doesn't look like a
    # release.
    $deployTag = "deployed/$((Get-Date).ToString('yyyyMMdd-HHmm'))-$gitSha"
    & git tag -a $deployTag -m "Deployed v$version ($gitSha) to $UnraidHost" HEAD
    & git push -q origin $deployTag
    if ($LASTEXITCODE -ne 0) { Write-Host "  (couldn't push git tag $deployTag -- push it by hand)" -ForegroundColor Yellow }

    # Keep the 3 newest Lexarr images (this one, the previous one for
    # rollback, one more) and remove older tags plus untagged leftovers
    # from rebuilds. Each image is ~330 MB. An image a container still
    # uses can't be removed, so a failed rmi is fine. Untagged leftovers
    # are matched by the label the Dockerfile sets, so other projects'
    # images are never touched.
    $prune = @'
keep=$(docker image ls lexarr --format '{{.ID}}' | awk '!s[$1]++' | head -n 3); docker image ls lexarr --format '{{.Repository}}:{{.Tag}} {{.ID}}' | while read ref id; do echo $keep | grep -qw $id || { docker rmi $ref >/dev/null 2>&1 && echo "      removed old image $ref"; }; done; docker image prune -f --filter label=org.opencontainers.image.title=lexarr >/dev/null 2>&1; true
'@
    Remote $prune
}

Write-Host ""
Write-Host "  Lexarr v$version ($gitSha) is live and healthy at http://${UnraidHost}:$HostPort" -ForegroundColor Green
Write-Host "  Pre-deploy backup: $backupPath" -ForegroundColor Green
Write-Host "  Add a row to docs/deployments.md." -ForegroundColor Green
Write-Host ""
