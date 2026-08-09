# Agent Nexus Gateway — one-command installer for Windows PowerShell
#
# Usage:
#   irm https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.ps1 | iex
#
# Or from a local clone:
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#
# Master prompt #26: "Create installation commands for Windows PowerShell:
#   irm <official-install-url> | iex"
#
# The installer:
#   1. Detects OS + architecture
#   2. Checks for Node.js 22+ and pnpm
#   3. Installs pnpm if missing (via corepack)
#   4. Clones the repo (or uses existing clone)
#   5. Installs dependencies + builds
#   6. Registers the CLI globally (anx)
#   7. Starts the gateway as a background service
#   8. Verifies health
#   9. Detects coding agents
#   10. Displays dashboard URL

$ErrorActionPreference = "Stop"

function Write-Info { Write-Host "ℹ $args" -ForegroundColor Blue }
function Write-Ok { Write-Host "✓ $args" -ForegroundColor Green }
function Write-Warn { Write-Host "⚠ $args" -ForegroundColor Yellow }
function Write-Fail { Write-Host "✗ $args" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════"
Write-Host "  Agent Nexus Gateway — Installer (Windows PowerShell)"
Write-Host "═══════════════════════════════════════════════════════════"
Write-Host ""

# ── 1. Detect OS + architecture ─────────────────────────────────────────
$os = "Windows"
$arch = $env:PROCESSOR_ARCHITECTURE
Write-Info "OS: $os $arch"

# ── 2. Check for Node.js 22+ ──────────────────────────────────────────────
$nodeVersion = $null
try {
    $nodeVersion = (node --version 2>$null) -replace 'v', '' -split '.' | Select-Object -First 1
} catch {}

if (-not $nodeVersion) {
    Write-Fail "Node.js is not installed. Install Node.js 22+ from https://nodejs.org/ first."
}

if ([int]$nodeVersion -lt 22) {
    Write-Fail "Node.js v$nodeVersion is too old. Install Node.js 22+ from https://nodejs.org/"
}
Write-Ok "Node.js $(node --version) detected"

# ── 3. Install pnpm if missing ───────────────────────────────────────────
$pnpmInstalled = $false
try { pnpm --version | Out-Null; $pnpmInstalled = $true } catch {}

if (-not $pnpmInstalled) {
    Write-Info "Installing pnpm via corepack..."
    corepack enable 2>$null
    if ($LASTEXITCODE -ne 0) {
        npm install -g pnpm
    }
}
Write-Ok "pnpm $(pnpm --version) detected"

# ── 4. Clone or use existing repo ─────────────────────────────────────────
$installDir = if ($env:ANX_HOME) { $env:ANX_HOME } else { "$env:USERPROFILE\.agent-nexus" }
$repoDir = "$installDir\codingghosts"

if (Test-Path "$repoDir\.git") {
    Write-Info "Existing repo found at $repoDir — pulling latest..."
    Set-Location $repoDir
    git pull --ff-only 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Warn "Could not pull latest (offline?)" }
} else {
    Write-Info "Cloning repo to $repoDir..."
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    git clone --depth 1 https://github.com/rachidSabah/codingghosts.git $repoDir
    Set-Location $repoDir
}

# ── 5. Install dependencies + build ──────────────────────────────────────
Write-Info "Installing dependencies..."
pnpm install --no-frozen-lockfile 2>&1 | Select-Object -Last 3

Write-Info "Building all packages..."
pnpm build 2>&1 | Select-Object -Last 3
Write-Ok "Build complete"

# ── 6. Register CLI globally ─────────────────────────────────────────────
Write-Info "Registering CLI..."
$binDir = "$env:USERPROFILE\.local\bin"
New-Item -ItemType Directory -Path $binDir -Force | Out-Null

# Create a wrapper script instead of a symlink (Windows doesn't do symlinks easily)
$wrapperContent = @"
@echo off
node "$repoDir\packages\cli\dist\bin.js" %*
"@
Set-Content -Path "$binDir\anx.cmd" -Value $wrapperContent -Force

# Add to PATH if not already there
$pathEntries = $env:Path -split ';'
if ($binDir -notin $pathEntries) {
    Write-Warn "Add $binDir to your PATH to use 'anx' globally."
    Write-Host "  Run this in PowerShell as admin:"
    Write-Host "    [Environment]::SetEnvironmentVariable('Path', '$binDir;' + `$env:Path, 'User')"
}
Write-Ok "CLI registered at $binDir\anx.cmd"

# ── 7. Start gateway as background service ────────────────────────────────
Write-Info "Starting gateway on 127.0.0.1:8787..."

# Kill any existing instance
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*gateway*dist*bin*"
} | Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Seconds 1

# Start as a background job
Start-Process -FilePath "node" -ArgumentList "$repoDir\apps\gateway\dist\bin.js" -WorkingDirectory $repoDir -WindowStyle Hidden -RedirectStandardOutput "$installDir\gateway.log" -RedirectStandardError "$installDir\gateway-error.log"

# ── 8. Verify health ──────────────────────────────────────────────────────
Write-Info "Waiting for gateway to start..."
$healthOk = $false
for ($i = 1; $i -le 15; $i++) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:8787/health" -TimeoutSec 2 -ErrorAction Stop
        $healthOk = $true
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}

if ($healthOk) {
    Write-Ok "Gateway is healthy: $($response.status) · $($response.endpoints.healthy)/$($response.endpoints.total) endpoints"
} else {
    Write-Warn "Gateway didn't respond within 15s. Check $installDir\gateway.log"
}

# ── 9. Detect coding agents ───────────────────────────────────────────────
if ($healthOk) {
    Write-Info "Detecting coding agents..."
    try {
        $detect = Invoke-RestMethod -Uri "http://127.0.0.1:8787/v1/agents/detect" -TimeoutSec 10
        Write-Ok "Coding agents detected: $($detect.foundCount)/$($detect.totalCount)"
    } catch {
        Write-Warn "Could not detect agents."
    }
}

# ── 10. Display dashboard URL + next steps ──────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════"
Write-Host "  Installation Complete!"
Write-Host "═══════════════════════════════════════════════════════════"
Write-Host ""
Write-Host "  Gateway:  http://127.0.0.1:8787"
Write-Host "  Health:   curl http://127.0.0.1:8787/health"
Write-Host "  CLI:      anx doctor    (run diagnostics)"
Write-Host "            anx health    (check gateway)"
Write-Host "            anx models    (list models)"
Write-Host "            anx models --free  (list free models)"
Write-Host ""
Write-Host "  To start the dashboard:"
Write-Host "    cd $repoDir; pnpm --filter @anx/dashboard dev"
Write-Host "    Then open http://localhost:3000"
Write-Host ""
Write-Host "  To stop the gateway:"
Write-Host "    Get-Process node | Where-Object { `$_.CommandLine -like '*gateway*' } | Stop-Process"
Write-Host ""
Write-Host "  Logs: $installDir\gateway.log"
Write-Host "  Repo: $repoDir"
Write-Host ""
