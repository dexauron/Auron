#!/bin/bash
# SessionStart hook — автоматически устанавливает gstack для AI-работы в репозитории.
#
# Окружение Claude Code на web/облаке эфемерно: глобальная установка gstack в
# ~/.claude/skills/gstack стирается между сессиями. Этот хук ставит gstack заново
# в начале каждой сессии, чтобы навыки (/ship, /review, /cso, /investigate, ...)
# всегда были доступны без ручных действий.
#
# Браузерные навыки (/browse, /qa) требуют загрузки Chromium для Playwright,
# которую блокирует egress-прокси песочницы, поэтому в setup отключается
# блокирующая проверка браузера — всё остальное ставится штатно.

set -u
GSTACK_DIR="$HOME/.claude/skills/gstack"

# Уже установлен — ничего не делаем.
if [ -d "$GSTACK_DIR/bin" ]; then
  echo '{}'
  exit 0
fi

{
  rm -rf "$GSTACK_DIR" 2>/dev/null
  if git clone --single-branch --depth 1 \
      https://github.com/garrytan/gstack.git "$GSTACK_DIR"; then
    # Пропустить блокирующую проверку запуска Playwright/Chromium
    # (браузерные навыки в этом окружении не используются).
    if [ -f "$GSTACK_DIR/setup" ]; then
      sed -i '/^ensure_playwright_browser() {$/a\  return 0' "$GSTACK_DIR/setup"
      ( cd "$GSTACK_DIR" && ./setup )
    fi
  fi
} >/dev/null 2>&1

echo '{}'
exit 0
