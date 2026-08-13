#!/bin/bash
# Что делает: в начале каждой сессии проверяет, не «откатилась» ли рабочая копия.
#
# Зачем. Контейнер, в котором идёт работа, иногда возвращает папку к старому
# состоянию: свежие коммиты пропадают, файлы выглядят как несколько часов назад.
# За одну сессию это случалось трижды. Всё запушенное при этом цело — на GitHub,
# — но заметить откат и вернуть копию приходилось вручную, и каждый раз это
# выглядело как «что-то потерялось».
#
# Правило: источник правды — GitHub, а не папка в контейнере. Если папка отстала
# и в ней нет несохранённых правок — молча подтягиваем её до GitHub. Если
# несохранённые правки есть — НИЧЕГО не трогаем и громко предупреждаем: своё
# добро дороже удобства.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

BR=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ -z "$BR" ] || [ "$BR" = "HEAD" ] && exit 0

git fetch -q origin "$BR" 2>/dev/null || { echo "Сеть недоступна — проверка состояния папки пропущена (ветка $BR)."; exit 0; }

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BR" 2>/dev/null) || exit 0
# Считаем «несохранёнными» только правки отслеживаемых файлов. Новые файлы,
# которые ещё не добавлены в git (строки «??»), при восстановлении не пропадают
# — reset их не трогает, поэтому мешать восстановлению они не должны.
DIRTY=$(git status --porcelain | grep -v '^??' | head -20)

if [ "$LOCAL" = "$REMOTE" ]; then
  [ -n "$DIRTY" ] && echo "Внимание: есть несохранённые правки (git status):"$'\n'"$DIRTY"
  echo "Папка совпадает с GitHub (ветка $BR, коммит ${LOCAL:0:7})."
  exit 0
fi

# папка отстала от GitHub — это и есть «откат контейнера»
if git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  BEHIND=$(git rev-list --count "$LOCAL..$REMOTE")
  if [ -n "$DIRTY" ]; then
    echo "ВНИМАНИЕ: папка откатилась на $BEHIND коммит(ов) назад, НО в ней есть несохранённые правки — не трогаю."
    echo "Сначала разберись с ними, потом: git reset --hard origin/$BR"
    echo "$DIRTY"
    exit 0
  fi
  git reset --hard -q "origin/$BR" && echo "Папка откатилась на $BEHIND коммит(ов) — восстановил из GitHub (ветка $BR, коммит ${REMOTE:0:7}). Ничего не потеряно."
  exit 0
fi

# папка ВПЕРЕДИ GitHub: есть коммиты, которых нет на GitHub — их нужно запушить
if git merge-base --is-ancestor "$REMOTE" "$LOCAL"; then
  AHEAD=$(git rev-list --count "$REMOTE..$LOCAL")
  echo "ВНИМАНИЕ: $AHEAD коммит(ов) есть только в папке и НЕ запушены — при откате контейнера они пропадут."
  echo "Сделай: git push -u origin $BR"
  exit 0
fi

echo "ВНИМАНИЕ: папка и GitHub разошлись (ветка $BR). Разберись вручную, не перезаписывай вслепую."
