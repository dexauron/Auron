@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0Prepare-WorkspaceHttps.ps1" %*
pause
