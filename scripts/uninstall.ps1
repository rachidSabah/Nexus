# Agent Nexus Gateway — Uninstaller for Windows PowerShell
# Usage: irm https://raw.githubusercontent.com/rachidSabah/Nexus/main/scripts/uninstall.ps1 | iex
$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "Stopping gateway + dashboard..." -ForegroundColor Blue

# Windows PowerShell's Get-Process has NO CommandLine property, so matching on
# $_.CommandLine always fails (returns $null -> nothing is killed -> open handles
# keep the install dir from being deleted). Use Win32_Process, which exposes the
# real command line, to find and stop the gateway/dashboard node processes.
function Stop-NexusProcesses {
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    $cmd = $p.CommandLine
    if ($cmd -and ($cmd -like "*agent-nexus*" -or $cmd -like "*\.agent-nexus\*" -or $cmd -like "*gateway*" -or $cmd -like "*next*" -or $cmd -like "*nexus-gateway*")) {
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
    }
  }
}
Stop-NexusProcesses

# Belt-and-suspenders: if anything is still bound to our ports, kill its owner.
function Stop-PortOwner($port) {
  $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }
  foreach ($c in $conn) {
    try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } catch { }
  }
}
Stop-PortOwner 8787
Stop-PortOwner 3000

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
  $ok = $false
  for ($i = 1; $i -le 8; $i++) {
    if (-not (Test-Path $path)) { $ok = $true; break }
    Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
    # Re-attempt to stop any stragglers that may have respawned or held handles.
    Stop-NexusProcesses
    Start-Sleep -Seconds 1
  }
  if (Test-Path $path) {
    Write-Host "  WARNING: could not remove $label ($path)." -ForegroundColor Yellow
    Write-Host "  Close any Nexus/gateway/dashboard terminals and re-run this uninstaller." -ForegroundColor Yellow
  } else {
    $ok = $true
  }
  # Suppress the boolean return value so it does not print to stdout.
  $null = $ok
}

Remove-WithRetry $repoDir "Nexus repo"
Remove-WithRetry $installDir "Nexus config dir"

Write-Host ""
Write-Host "Uninstall complete. Node.js and pnpm left installed." -ForegroundColor Green
