@echo off
chcp 65001 >nul
setlocal
title Way Market
cd /d "%~dp0"
if not exist "%~dp0start.mjs" (
  echo Не найдены файлы приложения.
  echo Извлеките ВЕСЬ ZIP-архив в отдельную папку.
  echo Затем запустите start-way-market.cmd из извлечённой папки.
  pause
  exit /b 1
)
if exist "%~dp0runtime\node.exe" (
  set "WAY_MARKET_NODE=%~dp0runtime\node.exe"
) else (
  where node.exe >nul 2>nul
  if errorlevel 1 (
    echo Node.js не найден. Для этой сборки нужен Node.js 24.
    echo После установки заново откройте этот файл запуска.
    echo Если Node.js уже установлен, перезагрузите компьютер и повторите запуск.
    echo Это локальное приложение с сервером, а не отдельный HTML-файл.
    pause
    exit /b 1
  )
  set "WAY_MARKET_NODE=node.exe"
)
"%WAY_MARKET_NODE%" "%~dp0launch.cjs"
if errorlevel 1 echo Запуск не выполнен. Скопируйте текст ошибки из этого окна.
pause
