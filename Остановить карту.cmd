@echo off
if not exist "%~dp0.map-server.pid" (
  echo Map server is not running.
  pause
  exit /b 0
)
set /p MAP_SERVER_PID=<"%~dp0.map-server.pid"
taskkill /PID %MAP_SERVER_PID% /T /F
del "%~dp0.map-server.pid" >nul 2>nul
pause
