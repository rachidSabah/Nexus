# Agent Nexus Gateway — Uninstaller for Windows PowerShell
# Usage: irm https://raw.githubusercontent.com/rachidSabah/Nexus/main/scripts/uninstall.ps1 | iex
$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "Stopping gateway + dashboard..." -ForegroundColor Blue
Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*gateway*" } | Stop-Process -Force
Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*next*" } | Stop-Process -Force
Start-Sleep -Seconds 2
Write-Host "Processes stopped." -ForegroundColor Green

$binDir = "$env:USERPROFILE\.local\bin"
$installDir = "$env:USERPROFILE\.agent-nexus"

Remove-Item "$binDir\anx.cmd" -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$installDir" -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Uninstall complete. Node.js and pnpm left installed." -ForegroundColor Green
