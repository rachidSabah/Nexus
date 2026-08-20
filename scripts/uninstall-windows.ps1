# Agent Nexus Gateway — Windows uninstaller
# Usage:
#   irm https://raw.githubusercontent.com/rachidSabah/Nexus/main/scripts/uninstall-windows.ps1 | iex
#
# Safe by default:
#   - Removes the `nexus-gateway` CLI (global npm package)
#   - Removes the config directory (~/.agent-nexus) EXCEPT the vault
#   - Stops a running gateway if it can find the process
#   - NEVER deletes your vault/credentials unless -RemoveData is passed
#
# Destructive mode (opt-in):
#   irm .../uninstall-windows.ps1 | iex   # then run with -RemoveData
#   or:  Uninstall-Nexus -RemoveData

[CmdletBinding()]
param(
  [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'
$INSTALL_DIR = "$env:USERPROFILE\.agent-nexus"

function Write-Step($msg) { Write-Host "`n[nexus] $msg" -ForegroundColor Cyan }

Write-Step "Agent Nexus Gateway uninstaller (Windows)"

# Stop a running gateway if present (best-effort)
Write-Step "Stopping any running gateway..."
Get-Process -Name "nexus-gateway" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
# Also try the node process running the bin
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -like "*nexus-gateway*" -or $_.CommandLine -like "*apps/gateway/dist/bin.js*"
} | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove the CLI
Write-Step "Removing nexus-gateway CLI (global npm)..."
npm uninstall -g nexus-gateway 2>$null

if ($RemoveData) {
  Write-Step "REMOVE DATA requested — deleting $INSTALL_DIR (including vault)..."
  if (Test-Path $INSTALL_DIR) { Remove-Item -Recurse -Force $INSTALL_DIR }
  Write-Host "  Vault and all local data removed." -ForegroundColor Red
} else {
  Write-Step "Preserving vault/credentials in $INSTALL_DIR ..."
  if (Test-Path $INSTALL_DIR) {
    # Remove everything except the vault
    Get-ChildItem $INSTALL_DIR -Exclude "vault.json" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  Kept: $INSTALL_DIR\vault.json (your credentials are safe)." -ForegroundColor Green
    Write-Host "  To delete everything, re-run with -RemoveData." -ForegroundColor Yellow
  }
}

Write-Step "Done. Nexus has been uninstalled."
