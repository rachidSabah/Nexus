# Agent Nexus Gateway — installer (Windows)
# Usage (PowerShell as admin):
#   iwr -useb https://agent-nexus-gateway.dev/install.ps1 | iex

$ErrorActionPreference = 'Stop'

$Version = if ($env:ANX_VERSION) { $env:ANX_VERSION } else { '0.1.0' }
$InstallDir = if ($env:ANX_INSTALL_DIR) { $env:ANX_INSTALL_DIR } else { "$env:LOCALAPPDATA\Programs\agent-nexus-gateway" }

Write-Host "Installing Agent Nexus Gateway v$Version..." -ForegroundColor Cyan

# Check Node.js
$nodeVersion = & node -v 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Node.js is required (v22+). Install from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
$major = [int]($nodeVersion -replace '^v(\d+)\..*', '$1')
if ($major -lt 22) {
    Write-Host "Node.js 22+ is required (found $nodeVersion)." -ForegroundColor Red
    exit 1
}

# Check pnpm
$pnpmVersion = & pnpm -v 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "pnpm not found. Enabling via corepack..."
    & corepack enable
    & corepack prepare pnpm@9.12.0 --activate
}

# Create install dir
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Download
$Url = "https://github.com/rachidSabah/codingghosts/releases/download/v$Version/agent-nexus-gateway-$Version-windows.tar.gz"
$TempFile = "$env:TEMP\anx.tar.gz"

try {
    Write-Host "Downloading $Url..."
    Invoke-WebRequest -Uri $Url -OutFile $TempFile -UseBasicParsing
} catch {
    Write-Host "Download failed. Building from source instead..." -ForegroundColor Yellow
    git clone --depth 1 --branch "v$Version" https://github.com/rachidSabah/codingghosts.git "$env:TEMP\anx"
    Push-Location "$env:TEMP\anx"
    & pnpm install
    & pnpm build
    & pnpm --filter @anx/cli link --global
    Pop-Location
    Write-Host "Installed via build-from-source." -ForegroundColor Green
    exit 0
}

# Extract (requires tar on Windows 10+)
tar -xzf $TempFile -C $InstallDir

# Add to PATH
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable('PATH', "$userPath;$InstallDir", 'User')
    Write-Host "Added $InstallDir to user PATH. Restart your terminal for changes to take effect."
}

# Verify
Write-Host ""
Write-Host "Installed: $InstallDir\anx.exe" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Set your provider API key:  `$env:OPENAI_API_KEY = 'sk-...'"
Write-Host "  2. Start the gateway:          anx-gateway"
Write-Host "  3. Test it:                    anx health"
Write-Host ""
Write-Host "Documentation: https://github.com/rachidSabah/codingghosts/blob/main/docs/README.md"
