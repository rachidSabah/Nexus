# Nexus - Windows updater
# Usage:  irm https://raw.githubusercontent.com/rachidSabah/Nexus/main/scripts/update.ps1 | iex
#
# What it does:
#   1. Locate the Nexus repository (ANX_HOME/repo, NEXUS_REPO_DIR, or CWD)
#   2. Fetch + fast-forward pull from the official repo
#   3. pnpm install + build (rebuild all packages)
#   4. Stop the running gateway + dashboard, then restart them (health-checked)
#
# Does NOT reinstall Node.js, pnpm, or nuke your config/vault.

$ErrorActionPreference = 'Stop'

$REPO_URL     = 'https://github.com/rachidSabah/Nexus'
$INSTALL_DIR  = "$env:USERPROFILE\.agent-nexus"
$CONFIG_PATH  = "$INSTALL_DIR\config.json"
$GATEWAY_PORT = 8787
$DASHBOARD_PORT = 3000

function Write-Step($msg) { Write-Host ''; Write-Host "[nexus] $msg" -ForegroundColor Cyan }

Write-Step 'Nexus updater (Windows)'

# --- 1. locate repo ---
$REPO_DIR = $null
if ($env:NEXUS_REPO_DIR -and (Test-Path "$env:NEXUS_REPO_DIR\.git")) { $REPO_DIR = $env:NEXUS_REPO_DIR }
elseif ($env:ANX_HOME -and (Test-Path "$env:ANX_HOME\repo\.git")) { $REPO_DIR = "$env:ANX_HOME\repo" }
elseif (Test-Path "$INSTALL_DIR\repo\.git") { $REPO_DIR = "$INSTALL_DIR\repo" }
elseif ((Test-Path ".\.git") -and ((git remote get-url origin 2>$null) -like '*rachidSabah/Nexus*')) { $REPO_DIR = (Get-Location).Path }
if (-not $REPO_DIR) {
  Write-Host '  Could not locate the Nexus repository.' -ForegroundColor Red
  Write-Host '  Run the installer first, or set NEXUS_REPO_DIR / ANX_HOME.' -ForegroundColor Yellow
  exit 1
}
Write-Host "  Repository: $REPO_DIR"

# --- 2. pull ---
Write-Step 'Fetching updates from the official repository...'
Push-Location $REPO_DIR
try {
  git fetch origin
  $local = (git rev-parse --short HEAD).Trim()
  $branch = (git symbolic-ref refs/remotes/origin/HEAD 2>$null) -replace 'refs/remotes/origin/',''
  if (-not $branch) { $branch = 'main' }
  $upstream = "origin/$branch"
  $behind = [int]((git rev-list --count "HEAD..$upstream" 2>$null) -replace '\D','')
  Write-Host "  Local : $local ($branch)"
  Write-Host "  Behind: $behind commit(s)"
  if ($behind -le 0) {
    Write-Host ''; Write-Host '  Already up to date - nothing to install.' -ForegroundColor Green
    Pop-Location; exit 0
  }
  Write-Host '  Pulling...'
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  Fast-forward failed (local commits present). Stash/reset, then re-run.' -ForegroundColor Red
    Pop-Location; exit 1
  }
} finally { Pop-Location }

# --- 3. install + build ---
Write-Step 'Reinstalling dependencies and rebuilding...'
Push-Location $REPO_DIR
try {
  pnpm install
  if ($LASTEXITCODE -ne 0) { Write-Host '  pnpm install failed.' -ForegroundColor Red; Pop-Location; exit 1 }
  pnpm build
  if ($LASTEXITCODE -ne 0) { Write-Host '  Build failed - previous install still usable.' -ForegroundColor Red; Pop-Location; exit 1 }
} finally { Pop-Location }

# --- 4. restart services ---
Write-Step 'Restarting services...'
# Stop current listeners
$toKill = @()
$toKill += (Get-NetTCPConnection -LocalPort $GATEWAY_PORT -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object -ExpandProperty OwningProcess)
$toKill += (Get-NetTCPConnection -LocalPort $DASHBOARD_PORT -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object -ExpandProperty OwningProcess)
$toKill = $toKill | Where-Object { $_ -and $_ -ne 0 } | Sort-Object -Unique
foreach ($p in $toKill) { try { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } catch {} }
Start-Sleep -Seconds 2

Push-Location $REPO_DIR
try {
  $gwArgs = "apps/gateway/dist/bin.js"
  if (Test-Path $CONFIG_PATH) { $gwArgs += " --config $CONFIG_PATH" }
  $gw = Start-Process -FilePath 'node' -ArgumentList $gwArgs -WorkingDirectory $REPO_DIR -WindowStyle Hidden -PassThru -RedirectStandardOutput "$INSTALL_DIR\logs\gateway.log" -RedirectStandardError "$INSTALL_DIR\logs\gateway.err"

  # pnpm is a shell shim without a .exe on Windows; launch via cmd.exe so it
  # resolves from PATH (Start-Process -FilePath 'pnpm' fails with
  # "%1 is not a valid Win32 application").
  $dash = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c pnpm --filter @anx/dashboard start' -WorkingDirectory $REPO_DIR -WindowStyle Hidden -PassThru -RedirectStandardOutput "$INSTALL_DIR\logs\dashboard.log" -RedirectStandardError "$INSTALL_DIR\logs\dashboard.err"
} finally { Pop-Location }

# --- 5. health check ---
function Test-Http($url) {
  try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) } catch { return $false }
}
$ok = $false
for ($i = 0; $i -lt 45; $i++) {
  if ((Test-Http "http://127.0.0.1:$GATEWAY_PORT/health") -and (Test-Http "http://127.0.0.1:$DASHBOARD_PORT/")) { $ok = $true; break }
  Start-Sleep -Seconds 1
}

Write-Step 'Done.'
if ($ok) {
  Write-Host "  Gateway  : http://127.0.0.1:$GATEWAY_PORT (health: OK)" -ForegroundColor Green
  Write-Host "  Dashboard: http://127.0.0.1:$DASHBOARD_PORT (HTTP: OK)" -ForegroundColor Green
} else {
  Write-Host "  Services started but not healthy yet - check $INSTALL_DIR\logs" -ForegroundColor Yellow
}
Write-Host "  Repo     : $REPO_DIR"
