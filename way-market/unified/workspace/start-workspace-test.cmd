@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 x64 is required.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])!==24){console.error('Node.js 24 required');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
echo NEW isolated workspace test. The previous cash database is NOT changed.
echo Open http://127.0.0.1:3211 in the SERVER browser via RDP.
echo Use the setup code printed below to create the first owner.
echo LAN is disabled. No Windows service is installed.
node workspace-server.mjs
pause
