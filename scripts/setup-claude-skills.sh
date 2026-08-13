#!/usr/bin/env bash
#
# Доустановка тяжёлых навыков Claude Code для проекта Auron.
#
# Плагины и MCP-серверы ставятся автоматически — они прописаны
# в .claude/settings.json и .mcp.json и лежат в репозитории.
# Здесь ставится только gstack: он весит ~23 МБ, поэтому в git его не кладём.
#
# Запуск (из корня проекта):
#   bash scripts/setup-claude-skills.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/.claude/skills"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> Ставлю навыки в $SKILLS_DIR"
mkdir -p "$SKILLS_DIR"

# --- gstack: набор из 57 навыков (планирование, ревью, QA, деплой) -----------
if [ -d "$SKILLS_DIR/gstack" ]; then
  echo "    gstack уже стоит — пропускаю (удали папку, чтобы переустановить)"
else
  echo "==> Скачиваю gstack…"
  git clone --depth 1 https://github.com/garrytan/gstack.git "$TMP_DIR/gstack"

  # Собственные тесты gstack занимают ~34 МБ и для работы не нужны
  rm -rf "$TMP_DIR/gstack/.git" \
         "$TMP_DIR/gstack/test" \
         "$TMP_DIR/gstack/browse/test" \
         "$TMP_DIR/gstack/benchmark" \
         "$TMP_DIR/gstack/benchmark-models"

  cp -r "$TMP_DIR/gstack" "$SKILLS_DIR/gstack"
  echo "    готово: $(find "$SKILLS_DIR/gstack" -name SKILL.md | wc -l | tr -d ' ') навыков"
fi

echo
echo "Готово. Перезапусти Claude Code, чтобы навыки подхватились."
