# Agent Nexus Gateway — Windows installer
# Usage:  irm https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.ps1 | iex
#
# What it does:
#   1. Detect Windows + architecture
#   2. Verify Node.js (>= 20) and npm; print a clear message if missing
#   3. Install the `nexus-gateway` CLI via npm (global)
#   4. Create ~/.agent-nexus and a local config
#   5. Start the gateway
#   6. Print the dashboard URL
#
# It does NOT silently install unrelated software. Node.js must be installed
# by the user (a download link is printed if missing).

$ErrorActionPreference = 'Stop'

$REPO_URL = 'https://github.com/rachidSabah/codingghosts'   # <-- set before publishing
$INSTALL_DIR = "$env:USERPROFILE\.agent-nexus"
$GATEWAY_PORT = 8787
$DASHBOARD_URL = "http://127.0.0.1:$GATEWAY_PORT/dashboard"

function Write-Step($msg) { Write-Host "`n[nexus] $msg" -ForegroundColor Cyan }

Write-Step "Agent Nexus Gateway installer (Windows)"

# --- 1. platform ---
Write-Step "Detecting platform..."
$arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
Write-Host "  Windows $arch"

# --- 2. node/npm ---
Write-Step "Checking Node.js..."
$nodeOk = $false
try {
  $nodeVer = (node --version).TrimStart('v')  # e.g. 22.11.0
  $major = [int]($nodeVer.Split('.')[0])
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

$npmOk = $false
try { npm --version | Out-Null; $npmOk = $true } catch {}
if (-not $npmOk) {
  Write-Host "  npm not found. Reinstall Node.js (npm ships with it)." -ForegroundColor Red
  exit 1
}

# --- 3. install package ---
Write-Step "Installing nexus-gateway CLI (global)..."
npm install -g nexus-gateway@latest

# --- 4. config dir ---
Write-Step "Creating $INSTALL_DIR ..."
New-Item -ItemType Directory -Force -Path $INSTALL_DIR | Out-Null

if (-not (Test-Path "$INSTALL_DIR\config.json")) {
  $vaultKey = (openssl rand -hex 32) 2>$null
  if (-not $vaultKey) { $vaultKey = -join ((48..57)+(97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ }) }
  $cfg = @{
    port      = $GATEWAY_PORT
    vaultPath = "$INSTALL_DIR\vault.json"
    security  = @{ vaultKey = $vaultKey }
  } | ConvertTo-Json -Depth 5
  Set-Content -Path "$INSTALL_DIR\config.json" -Value $cfg
  Write-Host "  Generated config + vault key."
}

# --- 5. start gateway ---
Write-Step "Starting gateway..."
$proc = Start-Process -FilePath "nexus-gateway" -ArgumentList "--config", "$INSTALL_DIR\config.json" `
  -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 4

# --- 6. report ---
Write-Step "Done."
Write-Host "  Gateway : http://127.0.0.1:$GATEWAY_PORT" -ForegroundColor Green
Write-Host "  Dashboard: $DASHBOARD_URL" -ForegroundColor Green
Write-Host "  Config  : $INSTALL_DIR\config.json"
Write-Host ""
Write-Host "  Next: open the dashboard, add a provider API key, and point your"
Write-Host "  coding agent at http://127.0.0.1:$GATEWAY_PORT/v1"
Write-Host ""
Write-Host "  Source: $REPO_URL"
