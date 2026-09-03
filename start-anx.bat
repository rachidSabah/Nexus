@echo off
title ANX - Agent Nexus Gateway ^& Dashboard
echo ========================================================
echo   ANX - Agent Nexus v0.5 Starting...
echo   Features: Tool Auto-Healer, Schema Sanitizer,
echo             Stream Clamping, Context Sanitizer,
echo             Native Google Antigravity CLI (agy)
echo ========================================================
cd /d "%~dp0"

rem Release stale dev servers on port 3000 and 8787 if present
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8787 " ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>nul

rem Ensure Dashboard build exists so chunks are statically served with zero 404s
if not exist apps\dashboard\.next (
  echo Building Nexus Dashboard assets...
  call pnpm --filter @anx/dashboard build
)

rem Start Gateway ^& Dashboard cleanly
start "Nexus Gateway" cmd /k "pnpm --filter @anx/gateway dev"
start "Nexus Dashboard" cmd /k "pnpm --filter @anx/dashboard start"

rem Wait for Gateway (8787) and Dashboard (3000) to be fully ready
echo Waiting for Nexus Gateway on port 8787 and Dashboard on port 3000...
for /l %%i in (1, 1, 30) do (
  curl -s -f http://127.0.0.1:8787/health >nul 2>nul
  if not errorlevel 1 (
    curl -s -f http://localhost:3000 >nul 2>nul
    if not errorlevel 1 (
      echo Nexus Gateway ^& Dashboard are healthy and active!
      goto :services_ready
    )
  )
  timeout /t 1 /nobreak >nul
)
:services_ready

rem Open Dashboard in default browser
start http://localhost:3000

rem Start Claude CLI / Code connected to gateway
where claude >nul 2>nul
if %errorlevel% equ 0 (
  start "Claude CLI" cmd /k "claude"
) else (
  start "Claude CLI" cmd /k "npx --no-install @anthropic-ai/claude-code || echo ANX Services Running!"
)