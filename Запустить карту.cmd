@echo off
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 (
  node "%~dp0map-server.js"
) else (
  "C:\Users\Asus TUF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "%~dp0map-server.js"
)
pause
