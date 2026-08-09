# Agent Nexus Gateway — One-Command Installer for Windows PowerShell
#
# Installs everything needed and starts both gateway + dashboard:
#   1. Installs Node.js 22+ (via winget if missing)
#   2. Installs pnpm (via corepack)
#   3. Clones the repo
#   4. Installs all dependencies
#   5. Builds all packages
#   6. Registers the CLI globally (anx)
#   7. Starts the gateway (background, 127.0.0.1:8787)
#   8. Starts the dashboard (background, localhost:3000)
#   9. Verifies health
#  10. Detects coding agents
#  11. Displays URLs + next steps
#
# Usage:
#   irm https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.ps1 | iex
#
# Or for WSL from Windows PowerShell:
#   wsl curl -fsSL https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.sh | bash

$ErrorActionPreference = "Stop"

function Write-Info { Write-Host "i  $args" -ForegroundColor Blue }
function Write-Ok { Write-Host "v  $args" -ForegroundColor Green }
function Write-Warn { Write-Host "!  $args" -ForegroundColor Yellow }
function Write-Fail { Write-Host "x  $args" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=========================================================" -ForegroundColor White
Write-Host "  Agent Nexus Gateway - Installer (Windows PowerShell)   " -ForegroundColor White
Write-Host "=========================================================" -ForegroundColor White
Write-Host ""

# ── 1. Detect OS + architecture ───────────────────────────────────────────
$os = "Windows"
$arch = $env:PROCESSOR_ARCHITECTURE
Write-Info "OS: $os $arch"

# Check if running in WSL context (shouldn't happen, but warn)
if ($env:WSL_DISTRO_NAME) {
    Write-Warn "This appears to be running inside WSL. Use the bash installer instead:"
    Write-Host "  curl -fsSL https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.sh | bash"
    exit 1
}

# ── 2. Install Node.js 22+ if missing ──────────────────────────────────────
$nodeVersion = $null
try {
    $nodeVersion = [int]((node --version 2>$null) -replace 'v', '' -split '.')[0]
} catch {}

if (-not $nodeVersion -or $nodeVersion -lt 22) {
    if ($nodeVersion) {
        Write-Warn "Node.js v$nodeVersion found — need v22+. Upgrading..."
    } else {
        Write-Info "Node.js not found — installing via winget..."
    }

    # Try winget first (Windows Package Manager)
    try {
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements 2>$null
        Write-Info "Node.js installed via winget. Refreshing PATH..."
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    } catch {
        # Fallback: download nvm-windows
        Write-Info "winget not available — trying nvm-windows..."
        $nvmUrl = "https://github.com/coreybutler/nvm-windows/releases/latest/download/nvm-setup.exe"
        $nvmInstaller = "$env:TEMP\nvm-setup.exe"
        Write-Info "Downloading nvm-windows..."
        Invoke-WebRequest -Uri $nvmUrl -OutFile $nvmInstaller
        Start-Process -FilePath $nvmInstaller -Wait
        $env:Path += ";$env:APPDATA\nvm;$env:APPDATA\nvm\symlinks\nodejs"
        nvm install 22
        nvm use 22
    }

    # Verify
    $nodeVersion = $null
    try {
        $nodeVersion = [int]((node --version 2>$null) -replace 'v', '' -split '.')[0]
    } catch {}
    if (-not $nodeVersion -or $nodeVersion -lt 22) {
        Write-Fail "Could not install Node.js 22+. Please install manually from https://nodejs.org/"
    }
}
Write-Ok "Node.js $(node --version) ready"

# ── 3. Install pnpm if missing ────────────────────────────────────────────
$pnpmOk = $false
try { pnpm --version | Out-Null; $pnpmOk = $true } catch {}

if (-not $pnpmOk) {
    Write-Info "Installing pnpm..."
    corepack enable 2>$null
    if ($LASTEXITCODE -ne 0) {
        npm install -g pnpm 2>$null
    }
}
try { pnpm --version | Out-Null } catch {
    # If corepack didn't work, try npm directly
    npm install -g pnpm
}
Write-Ok "pnpm $(pnpm --version) ready"

# ── 4. Clone or update repo ──────────────────────────────────────────────
$installDir = if ($env:ANX_HOME) { $env:ANX_HOME } else { "$env:USERPROFILE\.agent-nexus" }
$repoDir = "$installDir\codingghosts"

if (Test-Path "$repoDir\.git") {
    Write-Info "Existing repo found at $repoDir — updating..."
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
Write-Info "Installing dependencies (this may take 1-2 minutes)..."
pnpm install --no-frozen-lockfile 2>&1 | Select-Object -Last 3

Write-Info "Building all packages..."
pnpm build 2>&1 | Select-Object -Last 3
Write-Ok "Build complete"

# ── 6. Register CLI globally ──────────────────────────────────────────────
Write-Info "Registering CLI..."
$binDir = "$env:USERPROFILE\.local\bin"
New-Item -ItemType Directory -Path $binDir -Force | Out-Null

# Create a wrapper script for Windows
$wrapperContent = @"
@echo off
node "$repoDir\packages\cli\dist\bin.js" %*
"@
Set-Content -Path "$binDir\anx.cmd" -Value $wrapperContent -Force

# Add to PATH
$pathEntries = $env:Path -split ';'
if ($binDir -notin $pathEntries) {
    $currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*$binDir*") {
        [System.Environment]::SetEnvironmentVariable("Path", "$binDir;$currentPath", "User")
        Write-Info "Added $binDir to user PATH (restart shell to apply)"
    }
    $env:Path = "$binDir;$env:Path"
}
Write-Ok "CLI registered: anx command available"

# ── 7. Kill any old instances ────────────────────────────────────────────
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*gateway*dist*bin*"
} | Stop-Process -Force -ErrorAction SilentlyContinue

Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*next*"
} | Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Seconds 2

# ── 8. Start gateway (background) ────────────────────────────────────────
Write-Info "Starting gateway on 127.0.0.1:8787..."

Start-Process -FilePath "node" `
    -ArgumentList "$repoDir\apps\gateway\dist\bin.js" `
    -WorkingDirectory $repoDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput "$installDir\gateway.log" `
    -RedirectStandardError "$installDir\gateway-error.log"

Write-Info "Waiting for gateway to start..."
$gwOk = $false
for ($i = 1; $i -le 20; $i++) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:8787/health" -TimeoutSec 2 -ErrorAction Stop
        $gwOk = $true
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}

if ($gwOk) {
    Write-Ok "Gateway is healthy: $($response.status)"
} else {
    Write-Warn "Gateway didn't respond within 20s. Check: $installDir\gateway.log"
}

# ── 9. Start dashboard (background) ───────────────────────────────────────
Write-Info "Starting dashboard on localhost:3000..."

Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "cd /d $repoDir && pnpm --filter @anx/dashboard dev" `
    -WindowStyle Hidden `
    -RedirectStandardOutput "$installDir\dashboard.log" `
    -RedirectStandardError "$installDir\dashboard-error.log"

Write-Info "Waiting for dashboard to start..."
$dashOk = $false
for ($i = 1; $i -le 20; $i++) {
    try {
        $code = (Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop).StatusCode
        if ($code -eq 200 -or $code -eq 307) {
            $dashOk = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}

if ($dashOk) {
    Write-Ok "Dashboard is running at http://localhost:3000"
} else {
    Write-Warn "Dashboard didn't respond within 40s. Check: $installDir\dashboard.log"
    Write-Host "  Start manually: cd $repoDir; pnpm --filter @anx/dashboard dev"
}

# ── 10. Detect coding agents ──────────────────────────────────────────────
if ($gwOk) {
    Write-Info "Detecting coding agents..."
    try {
        $detect = Invoke-RestMethod -Uri "http://127.0.0.1:8787/v1/agents/detect" -TimeoutSec 10
        if ($detect.foundCount -gt 0) {
            Write-Ok "Coding agents detected: $($detect.foundCount)/$($detect.totalCount)"
        } else {
            Write-Info "No coding agents detected. Install Claude Code, Codex, etc. to enable auto-integration."
        }
    } catch {
        Write-Warn "Could not detect agents."
    }
}

# ── 11. Display summary ──────────────────────────────────────────────────
Write-Host ""
Write-Host "=========================================================" -ForegroundColor White
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor White
Write-Host ""

if ($gwOk) {
    Write-Host "  Gateway:   http://127.0.0.1:8787" -ForegroundColor Green
    Write-Host "  Dashboard: http://localhost:3000" -ForegroundColor Green
} else {
    Write-Host "  Gateway:   not running (check logs)" -ForegroundColor Yellow
    Write-Host "  Dashboard: not running" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  CLI commands:" -ForegroundColor Blue
Write-Host "    anx doctor         - run full diagnostics"
Write-Host "    anx health         - check gateway health"
Write-Host "    anx models         - list available models"
Write-Host "    anx models --free  - list free models"
Write-Host "    anx integrations list  - detect coding agents"
Write-Host "    anx integrations install --all  - auto-configure all agents"
Write-Host ""
Write-Host "  API examples:" -ForegroundColor Blue
Write-Host "    curl http://127.0.0.1:8787/v1/models"
Write-Host "    curl http://127.0.0.1:8787/v1/keys"
Write-Host "    curl http://127.0.0.1:8787/v1/budget"
Write-Host ""
Write-Host "  To stop:" -ForegroundColor Blue
Write-Host "    Get-Process node | Where-Object { `$_.CommandLine -like '*gateway*' } | Stop-Process"
Write-Host "    Get-Process node | Where-Object { `$_.CommandLine -like '*next*' } | Stop-Process"
Write-Host ""
Write-Host "  Logs:" -ForegroundColor Blue
Write-Host "    Gateway:  $installDir\gateway.log"
Write-Host "    Dashboard: $installDir\dashboard.log"
Write-Host ""
Write-Host "  Repo: $repoDir" -ForegroundColor Blue
Write-Host ""

# ── 12. Open browser ──────────────────────────────────────────────────────
if ($dashOk) {
    Write-Info "Opening dashboard in browser..."
    Start-Process "http://localhost:3000"
}

# ── WSL hint ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Also available for WSL:" -ForegroundColor DarkGray
Write-Host "    wsl curl -fsSL https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.sh | bash"
Write-Host ""
