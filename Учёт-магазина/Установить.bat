@echo off
chcp 65001 > nul
title Установка «Учёта магазина»
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo   ==========================================================
echo     УСТАНОВКА «УЧЁТА МАГАЗИНА»
echo   ==========================================================
echo.
echo   Программа никуда не «ставится» в обычном смысле: она вся
echo   лежит в одной папке. Установка — это копирование этой
echo   папки туда, где вам удобно, и ярлык на рабочем столе.
echo.

if not exist "Учёт_магазина.html" (
  echo   Рядом с этим файлом нет "Учёт_магазина.html".
  echo   Запускайте «Установить.bat» из папки программы, целиком.
  echo.
  pause
  exit /b 1
)

echo   Сейчас откроется окно выбора папки.
echo   Выберите, КУДА положить программу:
echo     • флешку — чтобы носить с собой;
echo     • папку на компьютере — чтобы работала здесь.
echo.
pause

rem Окно выбора папки. Обычный .bat такого не умеет — просим PowerShell.
set "TARGET="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -STA -Command ^
  "Add-Type -AssemblyName System.Windows.Forms;" ^
  "$d = New-Object System.Windows.Forms.FolderBrowserDialog;" ^
  "$d.Description = 'Куда положить программу «Учёт магазина»';" ^
  "$d.ShowNewFolderButton = $true;" ^
  "if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }"`) do set "TARGET=%%D"

if not defined TARGET (
  echo.
  echo   Папку не выбрали — ничего не сделано.
  echo.
  pause
  exit /b 0
)

set "DEST=%TARGET%\Учёт магазина"

rem Установка в ту же папку, где программа уже лежит, — это не установка.
if /i "%DEST%"=="%CD%" (
  echo.
  echo   Вы выбрали ту же папку, где программа уже лежит.
  echo   Копировать саму в себя нельзя — выберите другое место.
  echo.
  pause
  exit /b 1
)

echo.
echo   Копирую в: %DEST%
echo   Это займёт несколько секунд.
echo.

rem /E — с подпапками, /NFL /NDL /NJH /NJS — без простыни в окне.
rem Папку с выгрузками 1С НЕ копируем: там закупочные цены и телефоны
rem поставщиков, и новая копия должна начинаться чистой.
robocopy "%CD%" "%DEST%" /E /NFL /NDL /NJH /NJS /NC /NS ^
  /XD "Данные_1С_и_Excel" > nul
set "RC=%ERRORLEVEL%"

rem robocopy: 0–7 это успех, 8 и выше — настоящая ошибка
if %RC% GEQ 8 (
  echo   Скопировать не получилось (код %RC%^).
  echo   Чаще всего это значит: на диске нет места или папка защищена от записи.
  echo.
  pause
  exit /b 1
)

rem Папку под выгрузки создаём пустой, с памяткой внутри
if not exist "%DEST%\Данные_1С_и_Excel" mkdir "%DEST%\Данные_1С_и_Excel"
if exist "Данные_1С_и_Excel\ПОЛОЖИТЕ_СЮДА_ВЫГРУЗКИ.txt" (
  copy /y "Данные_1С_и_Excel\ПОЛОЖИТЕ_СЮДА_ВЫГРУЗКИ.txt" "%DEST%\Данные_1С_и_Excel\" > nul
)

rem Ярлык на рабочем столе — чтобы не искать папку каждый раз
powershell -NoProfile -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Учёт магазина.lnk');" ^
  "$s.TargetPath = '%DEST%\Запустить.bat';" ^
  "$s.WorkingDirectory = '%DEST%';" ^
  "$s.Description = 'Учёт магазина';" ^
  "$s.Save()" > nul 2>&1

echo   ==========================================================
echo     ГОТОВО
echo   ==========================================================
echo.
echo   Программа лежит здесь:
echo     %DEST%
echo.
echo   На рабочем столе появился ярлык «Учёт магазина».
echo.
echo   ЧТО СДЕЛАТЬ ПЕРВЫМ ДЕЛОМ, ОДИН РАЗ:
echo     1. Запустите программу.
echo     2. Слева откройте «Данные и копии».
echo     3. «Подключить папку» — укажите ЭТУ ЖЕ папку.
echo        Тогда записи будут ложиться файлом рядом с программой.
echo     4. Там же «Куда класть вторую копию» — укажите ДРУГОЕ место:
echo        вторую флешку или папку на компьютере. Если эта флешка
echo        потеряется или сломается, база останется во второй папке.
echo.
pause
