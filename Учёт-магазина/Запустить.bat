@echo off
chcp 65001 > nul
title Учёт магазина
cd /d "%~dp0"

if not exist "Учёт_магазина.html" (
  echo.
  echo   Рядом с этим файлом нет "Учёт_магазина.html".
  echo   Скопируйте папку целиком, вместе с папками js и vendor.
  echo.
  pause
  exit /b 1
)

rem Открываем в Chrome или Edge: только они умеют сохранять данные прямо в папку.
set "PAGE=%~dp0Учёт_магазина.html"

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%PAGE%"
  exit
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%PAGE%"
  exit
)
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%PAGE%"
  exit
)
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%PAGE%"
  exit
)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "%PAGE%"
  exit
)

echo   Chrome и Edge не найдены — открываю браузером по умолчанию.
echo   Если данные не будут сохраняться в папку, поставьте Chrome или Edge.
start "" "%PAGE%"
exit
