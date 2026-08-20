@echo off
REM Stops the Nexus gateway by freeing its port (8787). Safe to run even if
REM the gateway is already down. Anchored to this script's location (%~dp0)
REM so it works from any clone. Machine-agnostic: no hardcoded user paths.
title Nexus Gateway Stop
cd /d "%~dp0"

set PORT=8787
echo Stopping Nexus gateway on port %PORT% ...

REM Capture the listening PID into a variable and kill it.
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  if not "%%a"=="" (
    echo   killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
  )
)

REM Give the OS a moment to release the socket.
ping -n 3 127.0.0.1 >nul 2>&1

echo Done. Port %PORT% is now free.
