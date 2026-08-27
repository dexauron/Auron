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

# Есть несохранённые правки — значит, их должна была подхватить копилка.
# Если последний снимок старше 10 минут, автосохранение молча сломалось:
# один раз так и случилось, и откат унёс полтора часа работы.
STALE=""
if [ -n "$DIRTY" ]; then
  SAVE="claude/autosave-${BR##*/}"
  LAST=$(git log -1 --format=%ct "refs/remotes/origin/$SAVE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  if [ "$LAST" = "0" ] || [ $(( NOW - LAST )) -gt 600 ]; then
    STALE="ВНИМАНИЕ: автосохранение молчит уже больше 10 минут — на копилку не надейся, коммить руками."
    [ -f .claude/autosave.log ] && STALE="$STALE"$'\n'"Последние строки журнала:"$'\n'"$(tail -3 .claude/autosave.log)"
  fi
fi

MSG="Работа ещё не на GitHub"
[ "$AHEAD" != "0" ] && MSG="$MSG: $AHEAD коммит(ов) не запушено"
[ -n "$DIRTY" ] && MSG="$MSG; есть несохранённые правки:"$'\n'"$DIRTY"
MSG="$MSG"$'\n'"Папку контейнера иногда откатывает — незапушенное пропадёт. Закоммить и сделай: git push -u origin $BR"
[ -n "$STALE" ] && MSG="$MSG"$'\n'"$STALE"

# Один раз за сессию останавливаем и требуем разобраться, дальше — только текст.
MARK="/tmp/.auron-push-warned-$(git rev-parse --show-toplevel | md5sum | cut -c1-8)"
if [ ! -f "$MARK" ]; then
  touch "$MARK"
  echo "$MSG" >&2
  exit 2
fi
echo "$MSG"
