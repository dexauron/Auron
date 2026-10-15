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
echo Open http://127.0.0.1:3210 on THIS computer after the server starts.
echo Test data only. Stop with Ctrl+C.
node server.mjs
pause
