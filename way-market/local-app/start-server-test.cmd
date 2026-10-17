@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 x64 from https://nodejs.org/ first.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])!==24){console.error('Node.js 24 required');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
echo Server test mode. Database: %ProgramData%\WayMarket-Test\cash-test.sqlite
echo Open http://127.0.0.1:3210 in the SERVER browser via RDP.
echo LAN access is NOT enabled. No Windows service is installed yet.
node server.mjs --server-test
pause
