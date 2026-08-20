@echo off
REM Starts the Nexus gateway as a SINGLE non-watch process so it does not
REM collide with a previous instance (the tsx watch loop caused EADDRINUSE).
REM Anchored to this script's location (%~dp0) so it works from any clone.
REM Machine-agnostic: no hardcoded user paths. Log -> .gateway.log next to
REM this script (already covered by .gitignore *.log).
title Nexus Gateway
cd /d "%~dp0"

set NODE_ENV=development
set AGENT_NEXUS_GATEWAY_PORT=8787
set LOGFILE=%~dp0.gateway.log
set TMPF=%TEMP%\nx_ports.txt
set TMPF2=%TEMP%\nx_8787.txt
set TMPF3=%TEMP%\nx_listen.txt

REM Free port 8787 if a previous gateway (or any process) is still holding it.
REM We filter via temp files (no pipes inside the for-loop) to stay robust
REM under every shell that launches this .bat.
netstat -ano > "%TMPF%" 2>nul
findstr ":%AGENT_NEXUS_GATEWAY_PORT% " "%TMPF%" > "%TMPF2%" 2>nul
findstr "LISTENING" "%TMPF2%" > "%TMPF3%" 2>nul
for /f "tokens=5" %%a in (%TMPF3%) do (
  if not "%%a"=="" (
    echo Freeing port %AGENT_NEXUS_GATEWAY_PORT% (PID %%a)...
    taskkill /F /PID %%a >nul 2>&1
  )
)

REM Give the OS a moment to release the socket.
ping -n 3 127.0.0.1 >nul 2>&1

REM Run as a SINGLE non-watch tsx process. `tsx watch` re-launches the gateway
REM internally on every file save and collides with the previous still-bound
REM instance (EADDRINUSE crash-loop) - so we deliberately do NOT use --watch.
REM After editing server.ts, run stop_gateway.bat then this script again.
echo Starting Nexus gateway ... ^(logs to %LOGFILE%^)
pnpm --filter @anx/gateway exec tsx src/bin.ts > "%LOGFILE%" 2>&1
