# Nexus — Windows installer
# Usage:  irm https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.ps1 | iex
#
# What it does:
#   1. Detect Windows + architecture
#   2. Verify Node.js (>= 20) — prints actionable link if missing
#   3. Install pnpm (if not present)
#   4. Clone or update the Nexus repository into %USERPROFILE%\.agent-nexus\repo
#   5. pnpm install + build
#   6. Create ~/.agent-nexus and write a local config (vault key auto-generated)
#   7. Start the gateway in the background
#   8. Print the dashboard URL and next-steps
#
# Does NOT silently install unrelated software.
# Node.js must be installed by the user (download link is printed if missing).

$ErrorActionPreference = 'Stop'

$REPO_URL    = 'https://github.com/rachidSabah/codingghosts'
$INSTALL_DIR = "$env:USERPROFILE\.agent-nexus"
$REPO_DIR    = "$INSTALL_DIR\repo"
$GATEWAY_PORT = 8787

function Write-Step($msg) { Write-Host "`n[nexus] $msg" -ForegroundColor Cyan }

Write-Step "Nexus installer (Windows)"

# --- 1. platform ---
Write-Step "Detecting platform..."
$arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
Write-Host "  Windows $arch"

# --- 2. node ---
Write-Step "Checking Node.js..."
$nodeOk = $false
try {
  $nodeVer = (node --version).TrimStart('v')
  $major   = [int]($nodeVer.Split('.')[0])
  if ($major -ge 20) { $nodeOk = $true }
} catch { $nodeOk = $false }

if (-not $nodeOk) {
  Write-Host "  Node.js >= 20 is required but was not found." -ForegroundColor Red
  Write-Host "  Install it from https://nodejs.org (LTS) or via winget:" -ForegroundColor Yellow
  Write-Host "    winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
  Write-Host "  Then re-run this installer." -ForegroundColor Yellow
  exit 1
}
Write-Host "  Node.js $nodeVer OK"

# --- 3. pnpm ---
Write-Step "Checking pnpm..."
$pnpmOk = $false
try { pnpm --version | Out-Null; $pnpmOk = $true } catch {}
if (-not $pnpmOk) {
  Write-Host "  Installing pnpm..." -ForegroundColor Yellow
  npm install -g pnpm@latest
}
$pnpmVer = pnpm --version
Write-Host "  pnpm $pnpmVer OK"

# --- 4. clone or update ---
Write-Step "Setting up Nexus repository..."
New-Item -ItemType Directory -Force -Path $INSTALL_DIR | Out-Null

if (Test-Path "$REPO_DIR\.git") {
  Write-Host "  Updating existing clone..."
  git -C $REPO_DIR pull --ff-only
} else {
  Write-Host "  Cloning $REPO_URL ..."
  git clone --depth 1 $REPO_URL $REPO_DIR
}

# --- 5. build ---
Write-Step "Installing dependencies and building..."
Push-Location $REPO_DIR
try {
  pnpm install --frozen-lockfile
  pnpm build
} finally {
  Pop-Location
}

# --- 6. config ---
Write-Step "Creating configuration..."
if (-not (Test-Path "$INSTALL_DIR\config.json")) {
  $vaultKey = $null
  try { $vaultKey = (openssl rand -hex 32 2>$null).Trim() } catch {}
  if (-not $vaultKey) {
    $vaultKey = -join ((48..57)+(97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
  }
  $cfg = @{
    port      = $GATEWAY_PORT
    vaultPath = "$INSTALL_DIR\vault.json"
    security  = @{ vaultKey = $vaultKey }
  } | ConvertTo-Json -Depth 5
  Set-Content -Path "$INSTALL_DIR\config.json" -Value $cfg
  Write-Host "  Generated config + vault key."
} else {
  Write-Host "  Existing config preserved."
}

# Copy .env.example if no .env exists
if (-not (Test-Path "$REPO_DIR\.env")) {
  Copy-Item "$REPO_DIR\.env.example" "$REPO_DIR\.env"
  Write-Host "  Created .env from .env.example — add your API keys."
}

# --- 7. start gateway ---
Write-Step "Starting gateway (background)..."
$binPath = "$REPO_DIR\apps\gateway\dist\bin.js"
$proc = Start-Process -FilePath "node" `
  -ArgumentList $binPath, "--config", "$INSTALL_DIR\config.json" `
  -WorkingDirectory $REPO_DIR `
  -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 4

# --- 8. report ---
Write-Step "Done."
Write-Host ""
Write-Host "  Gateway   : http://127.0.0.1:$GATEWAY_PORT" -ForegroundColor Green
Write-Host "  Dashboard : http://127.0.0.1:$GATEWAY_PORT/dashboard" -ForegroundColor Green
Write-Host "  Config    : $INSTALL_DIR\config.json"
Write-Host "  Repo      : $REPO_DIR"
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Open the dashboard and add a provider API key."
Write-Host "    2. Point your coding agent at: http://127.0.0.1:$GATEWAY_PORT/v1"
Write-Host "    3. Select a routing policy (e.g. nexus/best-coding) and start coding."
Write-Host ""
Write-Host "  Source: $REPO_URL"
