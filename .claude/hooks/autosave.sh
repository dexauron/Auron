#!/bin/bash
# Автосохранение: любое изменение файлов сразу уезжает на GitHub.
#
# Зачем. Папку контейнера иногда откатывает к старому состоянию прямо посреди
# работы. Хуки начала и конца сессии спасали только то, что уже закоммичено, —
# а несколько раз пропадала именно работа между коммитами (однажды это был
# целый готовый экран заказов). Отменить сам откат нельзя: его делает среда.
# Значит, нужно, чтобы терять было нечего.
#
# Как. После каждой правки снимаем «слепок» рабочей папки и кладём его
# отдельным коммитом в ветку-копилку claude/autosave-<ветка>. Рабочая ветка,
# индекс и история при этом НЕ трогаются: снимок делается через отдельный
# индекс во временной папке, поэтому обычные коммиты выглядят так же аккуратно,
# как раньше. Если папку откатит — всё лежит в копилке на GitHub.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

BR=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ -z "$BR" ] || [ "$BR" = "HEAD" ] && exit 0
SAVE="claude/autosave-${BR##*/}"

# Не чаще раза в 15 секунд: правки идут пачками, и пуш на каждую строку
# только тормозил бы работу.
MARK="/tmp/.auron-autosave-$(pwd | md5sum | cut -c1-8)"
if [ -f "$MARK" ] && [ $(( $(date +%s) - $(stat -c %Y "$MARK" 2>/dev/null || echo 0) )) -lt 15 ]; then exit 0; fi

# Папка чистая И копилка уже совпадает с последним коммитом — делать нечего.
# Если папка чистая, но копилка отстала (работу только что закоммитили) —
# снимок всё равно нужен: иначе в копилке навсегда останется «хвост», который
# в следующей сессии вернётся как якобы потерянная работа.
if [ -z "$(git status --porcelain)" ] \
   && [ "$(git rev-parse -q "refs/remotes/origin/$SAVE^{tree}" 2>/dev/null)" = "$(git rev-parse -q "HEAD^{tree}" 2>/dev/null)" ]; then
  exit 0
fi
touch "$MARK"

# Слепок рабочей папки через ОТДЕЛЬНЫЙ индекс: рабочий индекс не трогаем
IDX="/tmp/.auron-autosave-index-$$"
export GIT_INDEX_FILE="$IDX"
cp -f "$(git rev-parse --git-dir)/index" "$IDX" 2>/dev/null || true
git add -A >/dev/null 2>&1 || { rm -f "$IDX"; exit 0; }
TREE=$(git write-tree 2>/dev/null)
rm -f "$IDX"
unset GIT_INDEX_FILE
[ -z "$TREE" ] && exit 0

PARENT=$(git rev-parse --verify -q "refs/remotes/origin/$SAVE" || git rev-parse HEAD)
# то же содержимое — второй раз не пишем
[ "$(git rev-parse -q "$PARENT^{tree}" 2>/dev/null)" = "$TREE" ] && exit 0
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "автосохранение $(date '+%d.%m %H:%M:%S') (ветка $BR)" 2>/dev/null)
[ -z "$COMMIT" ] && exit 0

# в фоне, чтобы не задерживать работу
( git push -q --force origin "$COMMIT:refs/heads/$SAVE" >/dev/null 2>&1 &&
  git update-ref "refs/remotes/origin/$SAVE" "$COMMIT" ) >/dev/null 2>&1 &
exit 0
