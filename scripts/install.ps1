# Agent Nexus Gateway — One-Command Installer for Windows PowerShell
#
# Usage:
#   irm https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.ps1 | iex
#
# What it does:
#   1. Installs Node.js 22+ (via winget if missing)
#   2. Installs pnpm (via corepack)
#   3. Clones the repo
#   4. Installs all dependencies + builds
#   5. Registers the CLI (anx.cmd)
#   6. Starts gateway (127.0.0.1:8787)
#   7. Starts dashboard (localhost:3000)
#   8. Verifies health
#   9. Opens browser

$ErrorActionPreference = "Stop"

function W-Info { Write-Host "[INFO]  $args" -ForegroundColor Blue }
function W-Ok { Write-Host "[OK]    $args" -ForegroundColor Green }
function W-Warn { Write-Host "[WARN]  $args" -ForegroundColor Yellow }
function W-Fail { Write-Host "[FAIL]  $args" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=========================================================" -ForegroundColor White
Write-Host "  Agent Nexus Gateway - Installer (Windows)              " -ForegroundColor White
Write-Host "=========================================================" -ForegroundColor White
Write-Host ""

# ── 1. Check / install Node.js 22+ ────────────────────────────────────────
$needNode = $true
try {
    $nv = node --version 2>$null
    if ($nv) {
        $major = [int]($nv -replace 'v','' -split '\.')[0]
        if ($major -ge 22) { $needNode = $false; W-Ok "Node.js $nv found" }
        else { W-Warn "Node.js $nv found — need v22+. Will upgrade..." }
    }
} catch {}

if ($needNode) {
    W-Info "Installing Node.js 22 via winget..."
    try {
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements 2>$null
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } catch {
        W-Warn "winget failed. Trying nvm-windows..."
        $nvmExe = "$env:TEMP\nvm-setup.exe"
        Invoke-WebRequest "https://github.com/coreybutler/nvm-windows/releases/latest/download/nvm-setup.exe" -OutFile $nvmExe
        Start-Process $nvmExe -Wait
        $env:Path += ";$env:APPDATA\nvm"
        nvm install 22
        nvm use 22
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    }
    try { $nv = node --version 2>$null } catch { W-Fail "Node.js installation failed. Install manually from https://nodejs.org/" }
    W-Ok "Node.js $nv ready"
}

# ── 2. Install pnpm ──────────────────────────────────────────────────────
try { pnpm --version | Out-Null } catch {
    W-Info "Installing pnpm..."
    corepack enable 2>$null
    if ($LASTEXITCODE -ne 0) { npm install -g pnpm }
}
try { pnpm --version | Out-Null } catch { npm install -g pnpm; }
W-Ok "pnpm $(pnpm --version) ready"

# ── 3. Clone repo ────────────────────────────────────────────────────────
$installDir = "$env:USERPROFILE\.agent-nexus"
$repoDir = "$installDir\codingghosts"

if (Test-Path "$repoDir\.git") {
    W-Info "Updating existing repo..."
    Set-Location $repoDir
    git pull --ff-only 2>$null
} else {
    W-Info "Cloning repo to $repoDir..."
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    git clone --depth 1 https://github.com/rachidSabah/codingghosts.git $repoDir
    Set-Location $repoDir
}

# ── 4. Install deps + build ─────────────────────────────────────────────
W-Info "Installing dependencies (1-2 min)..."
pnpm install --no-frozen-lockfile 2>&1 | Select-Object -Last 3

W-Info "Building all packages..."
pnpm build 2>&1 | Select-Object -Last 3
W-Ok "Build complete"

# ── 5. Register CLI ─────────────────────────────────────────────────────
$binDir = "$env:USERPROFILE\.local\bin"
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
Set-Content -Path "$binDir\anx.cmd" -Value "@echo off`r`nnode `"$repoDir\packages\cli\dist\bin.js`" %*" -Encoding ASCII -Force
# Add to PATH
$userPath = [System.Environment]::GetEnvironmentVariable("Path","User")
if ($userPath -notlike "*$binDir*") {
    [System.Environment]::SetEnvironmentVariable("Path","$binDir;$userPath","User")
    $env:Path = "$binDir;$env:Path"
    W-Info "Added $binDir to PATH"
}
W-Ok "CLI registered: anx.cmd"

# ── 6. Kill old processes ────────────────────────────────────────────────
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*gateway*" -or $_.CommandLine -like "*next*"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# ── 7. Start gateway ────────────────────────────────────────────────────
W-Info "Starting gateway on 127.0.0.1:8787..."
# Use a batch wrapper so the process survives this script exiting
$gwBat = "$installDir\start-gateway.bat"
Set-Content -Path $gwBat -Value "@echo off`r`ncd /d `"$repoDir`"`r`nnode apps\gateway\dist\bin.js > `"$installDir\gateway.log`" 2>&1" -Encoding ASCII -Force
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$gwBat`"" -WindowStyle Hidden

W-Info "Waiting for gateway..."
$gwOk = $false
for ($i = 1; $i -le 25; $i++) {
    try {
        $r = Invoke-RestMethod "http://127.0.0.1:8787/health" -TimeoutSec 2 -ErrorAction Stop
        $gwOk = $true
        break
    } catch { Start-Sleep -Seconds 1 }
}
if ($gwOk) { W-Ok "Gateway healthy: $($r.status)" }
else { W-Warn "Gateway not responding. Check $installDir\gateway.log" }

# ── 8. Start dashboard ──────────────────────────────────────────────────
W-Info "Starting dashboard on localhost:3000..."
$dashBat = "$installDir\start-dashboard.bat"
# Use the full path to pnpm to avoid PATH issues
$pnpmPath = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
if (-not $pnpmPath) { $pnpmPath = "pnpm" }
Set-Content -Path $dashBat -Value "@echo off`r`ncd /d `"$repoDir`"`r`n`"$pnpmPath`" --filter @anx/dashboard dev > `"$installDir\dashboard.log`" 2>&1" -Encoding ASCII -Force
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$dashBat`"" -WindowStyle Hidden

W-Info "Waiting for dashboard (may take 30-60s for first compile)..."
$dashOk = $false
for ($i = 1; $i -le 30; $i++) {
    try {
        $code = (Invoke-WebRequest "http://localhost:3000" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop).StatusCode
        if ($code -eq 200 -or $code -eq 307) { $dashOk = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}
if ($dashOk) { W-Ok "Dashboard running at http://localhost:3000" }
else {
    W-Warn "Dashboard not responding yet. It may still be compiling."
    W-Info "Check: $installDir\dashboard.log"
    W-Info "Or start manually: cd $repoDir; pnpm --filter @anx/dashboard dev"
}

# ── 9. Summary ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=========================================================" -ForegroundColor White
if ($gwOk -and $dashOk) {
    Write-Host "  Installation Complete!" -ForegroundColor Green
} else {
    Write-Host "  Installation Partial — check warnings above" -ForegroundColor Yellow
}
Write-Host "=========================================================" -ForegroundColor White
Write-Host ""
if ($gwOk) { Write-Host "  Gateway:   http://127.0.0.1:8787" -ForegroundColor Green }
else { Write-Host "  Gateway:   NOT RUNNING (check $installDir\gateway.log)" -ForegroundColor Yellow }
if ($dashOk) { Write-Host "  Dashboard: http://localhost:3000" -ForegroundColor Green }
else { Write-Host "  Dashboard: NOT RUNNING (check $installDir\dashboard.log)" -ForegroundColor Yellow }
Write-Host ""
Write-Host "  CLI: anx doctor  |  anx models  |  anx integrations install --all"
Write-Host "  Stop: taskkill /f /im node.exe"
Write-Host ""

# Open browser
if ($dashOk) { Start-Process "http://localhost:3000" }
