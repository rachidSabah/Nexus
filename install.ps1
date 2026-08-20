# Nexus - Windows installer
# Usage:  irm https://raw.githubusercontent.com/rachidSabah/Nexus/main/install.ps1 | iex
#
# What it does:
#   1. Detect Windows + architecture
#   2. Verify Node.js (>= 20) - prints actionable link if missing
#   3. Install pnpm (if not present)
#   4. Clone or update the Nexus repository into %USERPROFILE%\.agent-nexus\repo
#   5. pnpm install + build (and link the `anx` CLI)
#   6. Expose `anx` on the user PATH (idempotent) + verify it resolves
#   7. Create ~/.agent-nexus and write a local config (vault key auto-generated)
#   8. Start the gateway + dashboard in the background (with real health verification)
#   9. Auto-open default browser to http://127.0.0.1:8787/dashboard
#   10. Print the dashboard URL, CLI status, and next-steps
#
# Does NOT silently install unrelated software.
# Node.js must be installed by the user (download link is printed if missing).

$ErrorActionPreference = 'Stop'

$REPO_URL     = 'https://github.com/rachidSabah/Nexus'
$INSTALL_DIR  = "$env:USERPROFILE\.agent-nexus"
$REPO_DIR     = "$INSTALL_DIR\repo"
$GATEWAY_PORT = 8787
$DASHBOARD_PORT = 3000

function Write-Step($msg) { Write-Host ''; Write-Host "[nexus] $msg" -ForegroundColor Cyan }

Write-Step 'Nexus installer (Windows)'

# --- 1. platform ---
Write-Step 'Detecting platform...'
$arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
Write-Host "  Windows $arch"

# --- 2. node ---
Write-Step 'Checking Node.js...'
$nodeOk = $false
try {
  $nodeVer = (node --version).TrimStart('v')
  $major   = [int]($nodeVer.Split('.')[0])
  if ($major -ge 20) { $nodeOk = $true }
} catch { $nodeOk = $false }

if (-not $nodeOk) {
  Write-Host '  Node.js >= 20 is required but was not found.' -ForegroundColor Red
  Write-Host '  Install it from https://nodejs.org (LTS) or via winget:' -ForegroundColor Yellow
  Write-Host '    winget install OpenJS.NodeJS.LTS' -ForegroundColor Yellow
  Write-Host '  Then re-run this installer.' -ForegroundColor Yellow
  exit 1
}
Write-Host "  Node.js $nodeVer OK"

# --- 3. pnpm ---
Write-Step 'Checking pnpm...'
$pnpmOk = $false
try { pnpm --version | Out-Null; $pnpmOk = $true } catch { }
if (-not $pnpmOk) {
  Write-Host '  Installing pnpm...' -ForegroundColor Yellow
  npm install -g pnpm@latest
}
$pnpmVer = pnpm --version
Write-Host "  pnpm $pnpmVer OK"

# --- 4. clone or update ---
Write-Step 'Setting up Nexus repository...'
New-Item -ItemType Directory -Force -Path $INSTALL_DIR | Out-Null

if (Test-Path "$REPO_DIR\.git") {
  Write-Host '  Updating existing clone...'
  git -C $REPO_DIR pull --ff-only
} else {
  Write-Host "  Cloning $REPO_URL ..."
  git clone --depth 1 $REPO_URL $REPO_DIR
}

# --- 5. build + link CLI ---
Write-Step 'Installing dependencies and building...'
Push-Location $REPO_DIR
try {
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  Lockfile out of sync - running a normal install.' -ForegroundColor Yellow
    pnpm install
  }
  pnpm install
  pnpm --filter @anx/cli build
  pnpm build
} finally {
  Pop-Location
}

# --- 5b. expose the `anx` CLI globally (idempotent) ---
Write-Step "Exposing the 'anx' command..."
$binDir = "$REPO_DIR\node_modules\.bin"
$anxCmd = "$binDir\anx.CMD"

Push-Location $REPO_DIR
try { pnpm install --silent } finally { Pop-Location }

$userPath  = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathParts = $userPath -split ';' | Where-Object { $_.Trim() -ne '' }
if ($pathParts -notcontains $binDir) {
  $newPath = ($pathParts + $binDir) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  $env:Path = $env:Path + ';' + $binDir
  Write-Host "  Added $binDir to your user PATH." -ForegroundColor Green
} else {
  Write-Host '  $binDir already on user PATH.' -ForegroundColor Yellow
}

$anxResolved = $false
$anxVersion  = $null
if (Test-Path $anxCmd) {
  try {
    $anxVersion = & "$binDir\anx.CMD" --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $anxVersion) { $anxResolved = $true }
  } catch { }
}
if ($anxResolved) {
  Write-Host "  'anx' is available: $anxVersion" -ForegroundColor Green
} else {
  Write-Host "  WARNING: 'anx' could not be auto-verified." -ForegroundColor Yellow
  Write-Host "  You can still run it via: $binDir\anx.CMD" -ForegroundColor Yellow
}

# --- 6. config ---
Write-Step 'Creating configuration...'
if (-not (Test-Path "$INSTALL_DIR\config.json")) {
  $vaultKey = $null
  try { $vaultKey = (openssl rand -hex 32 2>$null).Trim() } catch { }
  if (-not $vaultKey) {
    $vaultKey = -join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
  }
  $cfg = @{
    port      = $GATEWAY_PORT
    vaultPath = "$INSTALL_DIR\vault.json"
    security  = @{ vaultKey = $vaultKey }
  } | ConvertTo-Json -Depth 5
  Set-Content -Path "$INSTALL_DIR\config.json" -Value $cfg
  Write-Host '  Generated config + vault key.'
} else {
  Write-Host '  Existing config preserved.'
}

if (-not (Test-Path "$REPO_DIR\.env")) {
  Copy-Item "$REPO_DIR\.env.example" "$REPO_DIR\.env"
  Write-Host '  Created .env from .env.example - add your API keys.'
}

# --- 7. start gateway + dashboard (with real health verification) ---
$logDir  = "$INSTALL_DIR\logs"
$pidFile = "$INSTALL_DIR\nexus.pids"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-TcpPort($port) {
  try {
    return ($null -ne (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
      Where-Object { $_.State -eq 'Listen' }))
  } catch { return $false }
}
function Test-Http($url) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch { return $false }
}
function Wait-ForService($port, $url, $timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort $port -and (Test-Http $url)) { return $true }
    Start-Sleep -Seconds 1
  }
  return (Test-TcpPort $port -and (Test-Http $url))
}

$gatewayPid   = $null
$dashboardPid = $null

$gatewayUp   = Test-TcpPort $GATEWAY_PORT
$dashboardUp = Test-TcpPort $DASHBOARD_PORT

if ($gatewayUp) {
  Write-Host "  Gateway already listening on :$GATEWAY_PORT - reusing." -ForegroundColor Yellow
} else {
  Write-Step 'Starting gateway (background)...'
  $gwLog = "$logDir\gateway.log"
  $proc = Start-Process -FilePath 'node' `
    -ArgumentList "$REPO_DIR\apps\gateway\dist\bin.js", '--config', "$INSTALL_DIR\config.json" `
    -WorkingDirectory $REPO_DIR `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $gwLog -RedirectStandardError "$logDir\gateway.err"
  $gatewayPid = $proc.Id
  Write-Host "  Gateway PID: $gatewayPid"
}

$gatewayOk = Wait-ForService $GATEWAY_PORT "http://127.0.0.1:$GATEWAY_PORT/health" 30
if (-not $gatewayOk) {
  Write-Host ''
  Write-Host "  [FAILED] Gateway did not become healthy on :$GATEWAY_PORT." -ForegroundColor Red
  if ($gatewayPid) { Write-Host "  Gateway PID: $gatewayPid" }
  Write-Host '  Gateway log:' -ForegroundColor Red
  if (Test-Path "$logDir\gateway.err") { Get-Content "$logDir\gateway.err" -Tail 20 | ForEach-Object { "    $_" } }
  if (Test-Path "$logDir\gateway.log") { Get-Content "$logDir\gateway.log" -Tail 20 | ForEach-Object { "    $_" } }
  Write-Host '  Installation incomplete - fix the above and re-run the installer.' -ForegroundColor Red
  exit 1
}

if ($dashboardUp) {
  Write-Host "  Dashboard already listening on :$DASHBOARD_PORT - reusing." -ForegroundColor Yellow
} else {
  Write-Step 'Starting dashboard (background)...'
  $dashLog = "$logDir\dashboard.log"
  $dashProc = Start-Process -FilePath 'pnpm' `
    -ArgumentList '--filter', '@anx/dashboard', 'start' `
    -WorkingDirectory $REPO_DIR `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $dashLog -RedirectStandardError "$logDir\dashboard.err"
  $dashboardPid = $dashProc.Id
  Write-Host "  Dashboard PID: $dashboardPid"
}

$dashboardOk = Wait-ForService $DASHBOARD_PORT "http://127.0.0.1:$DASHBOARD_PORT/" 45
if (-not $dashboardOk) {
  Write-Host ''
  Write-Host "  [FAILED] Dashboard did not become reachable on :$DASHBOARD_PORT." -ForegroundColor Red
  if ($dashboardPid) { Write-Host "  Dashboard PID: $dashboardPid" }
  Write-Host '  Dashboard log:' -ForegroundColor Red
  if (Test-Path "$logDir\dashboard.err") { Get-Content "$logDir\dashboard.err" -Tail 20 | ForEach-Object { "    $_" } }
  if (Test-Path "$logDir\dashboard.log") { Get-Content "$logDir\dashboard.log" -Tail 20 | ForEach-Object { "    $_" } }
  Write-Host '  Gateway is running; dashboard failed to start. Re-run the installer.' -ForegroundColor Red
  exit 1
}

# Persist PIDs for clean shutdown / idempotent restarts.
"gateway=$gatewayPid`ndashboard=$dashboardPid" | Set-Content -Path $pidFile

# --- 8. auto-open browser & report ---
Write-Step 'Opening Agent Nexus Control Plane in default browser...'
try {
  Start-Process "http://127.0.0.1:$GATEWAY_PORT/dashboard"
} catch {
  Write-Host "  Could not auto-open browser; please navigate to http://127.0.0.1:$GATEWAY_PORT/dashboard" -ForegroundColor Yellow
}

Write-Step 'Done.'
Write-Host ''
Write-Host "  Gateway   : http://127.0.0.1:$GATEWAY_PORT  (health: OK)" -ForegroundColor Green
Write-Host "  Dashboard : http://127.0.0.1:$GATEWAY_PORT/dashboard  (HTTP: OK)" -ForegroundColor Green
Write-Host "  Direct UI : http://127.0.0.1:$DASHBOARD_PORT" -ForegroundColor Green
Write-Host "  Config    : $INSTALL_DIR\config.json"
Write-Host "  Logs      : $logDir"
Write-Host "  Repo      : $REPO_DIR"
Write-Host ''
if ($anxResolved) {
  Write-Host "  CLI       : 'anx' command is available (use from any terminal)" -ForegroundColor Green
} else {
  Write-Host "  CLI       : run '$binDir\anx.CMD' (restart your terminal to pick up PATH)" -ForegroundColor Yellow
}
Write-Host ''
Write-Host '  Next steps:'
Write-Host "    1. Configure provider API keys in Dashboard (http://127.0.0.1:$GATEWAY_PORT/dashboard)"
Write-Host "    2. Point your coding agent at: http://127.0.0.1:$GATEWAY_PORT/v1"
Write-Host '    3. Manage agents from the dashboard or CLI:'
Write-Host '         anx agents list'
Write-Host '         anx agents install claude-code'
Write-Host '         anx agents status'
Write-Host ''
Write-Host "  Source: $REPO_URL"

