#!/bin/bash
# Что делает: в конце ответа проверяет, что сделанная работа уже на GitHub.
#
# Зачем. Папка в контейнере ненадёжна — её иногда откатывает. Всё, что не
# запушено, при откате исчезает. Поэтому «сделано» = «запушено», а не «лежит в
# папке». Хук напоминает об этом один раз за сессию, а дальше только пишет
# предупреждение (блокировать снова нельзя: если сети нет, работа встанет).
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

BR=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ -z "$BR" ] || [ "$BR" = "HEAD" ] && exit 0

DIRTY=$(git status --porcelain | grep -v '^??' | head -10)
AHEAD=0
if git rev-parse "origin/$BR" >/dev/null 2>&1; then
  AHEAD=$(git rev-list --count "origin/$BR..HEAD" 2>/dev/null || echo 0)
fi

[ -z "$DIRTY" ] && [ "$AHEAD" = "0" ] && exit 0   # всё на GitHub — молчим

MSG="Работа ещё не на GitHub"
[ "$AHEAD" != "0" ] && MSG="$MSG: $AHEAD коммит(ов) не запушено"
[ -n "$DIRTY" ] && MSG="$MSG; есть несохранённые правки:"$'\n'"$DIRTY"
MSG="$MSG"$'\n'"Папку контейнера иногда откатывает — незапушенное пропадёт. Закоммить и сделай: git push -u origin $BR"

# Один раз за сессию останавливаем и требуем разобраться, дальше — только текст.
MARK="/tmp/.auron-push-warned-$(git rev-parse --show-toplevel | md5sum | cut -c1-8)"
if [ ! -f "$MARK" ]; then
  touch "$MARK"
  echo "$MSG" >&2
  exit 2
fi
echo "$MSG"
