#!/usr/bin/env bash
# Собрать один архив со всем проектом — чтобы скачать или отдать разработчику.
#   bash handoff/make-bundle.sh            → auron-bundle-ГГГГ-ММ-ДД.zip в корне
set -e
cd "$(dirname "$0")/.."
NAME="auron-bundle-$(date +%F).zip"
rm -f "$NAME"
zip -qr "$NAME" \
  handoff docs webapp .claude/skills CLAUDE.md README.md 2>/dev/null || \
zip -qr "$NAME" handoff docs webapp CLAUDE.md
echo "Готово: $NAME"
echo "Внутри: код (webapp), документы (docs), папка для переноса (handoff)."
