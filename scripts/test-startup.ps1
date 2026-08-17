# Nexus — Windows startup/installation verification
# Verifies the production gateway + dashboard lifecycle WITHOUT a full reinstall.
# Usage (run from anywhere; uses absolute paths under %USERPROFILE%\.agent-nexus):
#   powershell -ExecutionPolicy Bypass -File scripts/test-startup.ps1
#
# This is the same verification the installer performs after spawning the
# services, extracted so it can be run independently (CI gate / manual check).
# It does NOT start or stop anything — it only asserts the real runtime state.

$ErrorActionPreference = 'Stop'
$INSTALL_DIR   = "$env:USERPROFILE\.agent-nexus"
$REPO_DIR      = "$INSTALL_DIR\repo"
$GATEWAY_PORT  = 8787
$DASHBOARD_PORT = 3000

$pass = 0; $fail = 0
function Check($name, $ok) {
  if ($ok) { Write-Host "  [PASS] $name" -ForegroundColor Green; $script:pass++ }
  else     { Write-Host "  [FAIL] $name" -ForegroundColor Red;   $script:fail++ }
}

Write-Host "[nexus] Verifying Windows startup state..." -ForegroundColor Cyan

# 1. Repository present
Check "Repository cloned at $REPO_DIR" (Test-Path "$REPO_DIR\.git")

# 2. Gateway TCP listening
$gwListen = $false
try { $gwListen = ($null -ne (Get-NetTCPConnection -LocalPort $GATEWAY_PORT -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' })) } catch {}
Check "Gateway listening on TCP :$GATEWAY_PORT" $gwListen

# 3. Dashboard TCP listening
$dashListen = $false
try { $dashListen = ($null -ne (Get-NetTCPConnection -LocalPort $DASHBOARD_PORT -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' })) } catch {}
Check "Dashboard listening on TCP :$DASHBOARD_PORT" $dashListen

# 4. Gateway HTTP health
$gwOk = $false
try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:$GATEWAY_PORT/health" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop; $gwOk = ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) } catch {}
Check "Gateway HTTP /health responds" $gwOk

# 5. Gateway models endpoint (proxy surface)
$modelsOk = $false
try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:$GATEWAY_PORT/v1/models" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop; $modelsOk = ($r.StatusCode -eq 200) } catch {}
Check "Gateway HTTP /v1/models responds" $modelsOk

# 6. Dashboard HTTP root
$dashOk = $false
try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:$DASHBOARD_PORT/" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop; $dashOk = ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) } catch {}
Check "Dashboard HTTP / responds" $dashOk

# 7. Dashboard proxy to gateway (the architectural contract)
$proxyOk = $false
try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:$DASHBOARD_PORT/api/v1/models" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop; $proxyOk = ($r.StatusCode -eq 200) } catch {}
Check "Dashboard proxies /api/* to gateway" $proxyOk

# 8. Gateway does NOT falsely serve /dashboard (architectural fact)
$dashRoute404 = $false
try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:$GATEWAY_PORT/dashboard" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop; $dashRoute404 = ($r.StatusCode -ge 400) } catch { $dashRoute404 = $true }
Check "Gateway correctly does NOT serve /dashboard (separate Next.js app)" $dashRoute404

Write-Host ""
Write-Host "  Result: $pass passed, $fail failed." -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host "  [OK] Nexus Windows startup verified." -ForegroundColor Green
