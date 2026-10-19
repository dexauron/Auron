@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 exit /b 1
node -e "if(Number(process.versions.node.split('.')[0])!==24){console.error('Node.js 24 required');process.exit(1)}"
if errorlevel 1 exit /b 1
node workspace-https.mjs %*
pause
