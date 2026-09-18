#!/bin/bash
# Открыть «Учёт магазина» на Mac или Linux.
# Двойной клик в Finder запускает этот файл как программу.
#
# Chrome и Edge открываем НАРОЧНО, а не браузер по умолчанию: только они
# умеют писать данные прямо в папку программы. В Safari этого нет, и записи
# останутся внутри браузера — работать можно, но файла рядом не будет.

set -u
cd "$(dirname "$0")" || exit 1

if [ ! -f "Учёт_магазина.html" ]; then
  echo
  echo "  Рядом с этим файлом нет «Учёт_магазина.html»."
  echo "  Скопируйте папку целиком, вместе с папками js и vendor."
  echo
  read -r -p "  Нажмите Enter, чтобы закрыть. " _
  exit 1
fi

PAGE="$(pwd)/Учёт_магазина.html"

if [ "$(uname)" = "Darwin" ]; then
  for app in "Google Chrome" "Microsoft Edge" "Yandex"; do
    if [ -d "/Applications/$app.app" ]; then
      open -a "$app" "$PAGE"
      exit 0
    fi
  done
  echo "  Chrome и Edge не найдены — открываю браузером по умолчанию."
  echo "  Если данные не будут сохраняться в папку, поставьте Chrome."
  open "$PAGE"
  exit 0
fi

for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge yandex-browser; do
  if command -v "$b" > /dev/null 2>&1; then
    "$b" "$PAGE" > /dev/null 2>&1 &
    exit 0
  fi
done

echo "  Chrome и Edge не найдены — открываю браузером по умолчанию."
echo "  Если данные не будут сохраняться в папку, поставьте Chrome."
xdg-open "$PAGE" > /dev/null 2>&1 &
