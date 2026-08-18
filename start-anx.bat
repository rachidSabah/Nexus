@echo off
title ANX - Agent Nexus Gateway ^& Dashboard
echo ========================================================
echo   Starting ANX Gateway, Dashboard ^& Claude CLI...
echo ========================================================
cd /d "F:\codingghosts"

rem Clean the dashboard build cache so `next dev` never reuses a stale
rem production `.next` (which causes `middleware-manifest.json missing`
rem and `__webpack_modules__ is not a function` -> every page 500).
if exist apps\dashboard\.next rmdir /s /q apps\dashboard\.next

rem Start Gateway & Dashboard in dev mode
start "ANX Gateway & Dashboard" cmd /k "pnpm dev"

rem Wait 4 seconds for services to initialize
timeout /t 4 /nobreak >nul

rem Open Dashboard in default browser
start http://localhost:3000

rem Start Claude CLI / Code connected to gateway
where claude >nul 2>nul
if %errorlevel% equ 0 (
  start "Claude CLI" cmd /k "claude"
) else (
  start "Claude CLI" cmd /k "npx --no-install @anthropic-ai/claude-code || echo ANX Services Running!"
)
