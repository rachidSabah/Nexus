# Agent Nexus Gateway — Uninstaller for Windows PowerShell
# Usage: irm https://raw.githubusercontent.com/rachidSabah/Nexus/main/scripts/uninstall.ps1 | iex
$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "Stopping gateway + dashboard..." -ForegroundColor Blue
Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*gateway*" } | Stop-Process -Force
Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*next*" } | Stop-Process -Force
Start-Sleep -Seconds 2
Write-Host "Processes stopped." -ForegroundColor Green

$binDir = Join-Path $env:USERPROFILE ".local\bin"
$installDir = Join-Path $env:USERPROFILE ".agent-nexus"
$repoDir = Join-Path $installDir "repo"

Remove-Item (Join-Path $binDir "anx.cmd") -Force -ErrorAction SilentlyContinue

# Explicitly remove the cloned source directory (.agent-nexus\repo).
# The installer clones into it; a stale copy left by a failed/partial install
# must be cleaned. Retry a few times because a still-shutting-down node/next
# process may hold open handles inside it - otherwise the delete fails silently
# under SilentlyContinue and the directory is left behind.
function Remove-WithRetry($path, $label) {
  for ($i = 1; $i -le 5; $i++) {
    if (-not (Test-Path $path)) { return $true }
    Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
  if (Test-Path $path) {
    Write-Host "  WARNING: could not remove $label ($path)." -ForegroundColor Yellow
    Write-Host "  Close any Nexus/gateway/dashboard terminals and re-run this uninstaller." -ForegroundColor Yellow
    return $false
  }
  return $true
}

Remove-WithRetry $repoDir "Nexus repo"
Remove-WithRetry $installDir "Nexus config dir"

Write-Host ""
Write-Host "Uninstall complete. Node.js and pnpm left installed." -ForegroundColor Green
