@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
 echo Нужен Node.js 24. После установки заново откройте этот файл.
 pause
 exit /b 1
)
node.exe -e "if(Number(process.versions.node.split('.')[0])!==24){console.error('Нужен Node.js 24');process.exit(1)}"
if errorlevel 1 (
 pause
 exit /b 1
)
if not exist "tunnel-test.mjs" (
 echo Извлеките ВЕСЬ ZIP в отдельную папку.
 pause
 exit /b 1
)
node.exe tunnel-test.mjs
pause
