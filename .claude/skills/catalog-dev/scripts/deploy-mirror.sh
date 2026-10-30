#!/usr/bin/env bash
# Зеркалирует папку catalog/ из текущей рабочей ветки в деплой-ветку
# claude/store-product-catalog-60wer4 — пуш туда пересобирает сайт (GitHub Pages).
# Использование:  bash deploy-mirror.sh "текст коммита"
# Запускать из корня репозитория (там, где лежит папка catalog/).
set -euo pipefail

DEPLOY_BRANCH="claude/store-product-catalog-60wer4"
MSG="${1:-deploy: обновление каталога}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
WT="$(mktemp -d)/deploy-wt"

cd "$REPO_ROOT"

# свежая деплой-ветка (с ретраями на сетевые сбои)
for i in 1 2 3; do git fetch origin "$DEPLOY_BRANCH" && break || sleep $((2**i)); done

# ВАЖНО: приложение само пишет в деплой-ветку (публикация витрины), поэтому
# локальная ветка легко отстаёт. Всегда отталкиваемся от СВЕЖЕЙ удалённой версии,
# иначе пуш отклонят (non-fast-forward) и данные разъедутся.
git branch -f "$DEPLOY_BRANCH" "origin/$DEPLOY_BRANCH"

git worktree add -q "$WT" "$DEPLOY_BRANCH"
trap 'git worktree remove --force "$WT" 2>/dev/null || true' EXIT

# Данные витрины (catalog/data/) публикует САМО приложение прямо в деплой-ветку
# по ключу владельца — в рабочей ветке их нет. Поэтому при зеркалировании кода
# их надо сохранить, иначе выложенный каталог затрётся.
TMP_DATA="$(mktemp -d)"
[ -d "$WT/catalog/data" ] && cp -a "$WT/catalog/data" "$TMP_DATA/data"

# ──────────────────────────────────────────────────────────────────────────────
# СТОП-ПРОВЕРКА: не затереть чужую работу.
#
# 30.10.2026 этот скрипт молча удалил из деплой-ветки 15 файлов (boot.js,
# catalog-crypto.js, publication-data.js, recover.html, ui.css и десять
# проверок) и откатил правки в 30 других. Их добавили туда отдельными
# запросами на слияние — в рабочей ветке их не было, а скрипт заменяет
# catalog/ целиком. Владелец заметил по пропавшим возможностям.
#
# Поэтому перед заменой сверяемся: код в деплой-ветке должен совпадать с тем,
# что это зеркало туда положило в прошлый раз (метка .mirror-source). Любое
# расхождение — чья-то работа, и мы останавливаемся, а не переписываем.
MARK="$WT/catalog/.mirror-source"
SRC=""
[ -f "$MARK" ] && SRC="$(sed -n 's/^SOURCE_COMMIT=//p' "$MARK" | head -1)"

FOREIGN=""
if [ -n "$SRC" ] && git cat-file -e "${SRC}^{commit}" 2>/dev/null; then
  # что изменилось в коде деплой-ветки после прошлого зеркалирования
  # quotepath=false — иначе пути с русскими буквами приходят в «\320\232…»
  FOREIGN="$(cd "$WT" && git -c core.quotepath=false diff --name-only "$SRC" -- catalog \
    ':(exclude)catalog/data' ':(exclude)catalog/.mirror-source')"
else
  # метки нет (первый запуск после этой правки) — ловим хотя бы удаления:
  # файл есть в деплой-ветке и нет в рабочей, значит замена его убьёт
  FOREIGN="$(cd "$WT" && git -c core.quotepath=false ls-files catalog \
    | grep -v '^catalog/data/' | grep -v '^catalog/\.mirror-source$' \
    | while IFS= read -r f; do [ -e "$REPO_ROOT/$f" ] || printf '%s\n' "$f"; done)"
fi

if [ -n "$FOREIGN" ]; then
  echo "ОСТАНОВЛЕНО: в деплой-ветке есть код, которого нет в рабочей ветке." >&2
  echo "Замена catalog/ затёрла бы его. Файлы:" >&2
  echo "$FOREIGN" | sed 's/^/  /' >&2
  echo >&2
  echo "Сначала перенеси эту работу в рабочую ветку, потом зеркаль:" >&2
  echo "  git fetch origin $DEPLOY_BRANCH" >&2
  echo "  git log --oneline <рабочая-ветка>..origin/$DEPLOY_BRANCH -- catalog" >&2
  echo "  git checkout origin/$DEPLOY_BRANCH -- <нужные файлы>   # и прогнать проверки" >&2
  exit 1
fi

# полностью заменяем catalog/ содержимым рабочей ветки
rm -rf "$WT/catalog"
cp -a "$REPO_ROOT/catalog" "$WT/catalog"

# метка для следующего запуска: из какого коммита взят этот код
printf 'SOURCE_BRANCH=%s\nSOURCE_COMMIT=%s\n' \
  "$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)" \
  "$(git -C "$REPO_ROOT" rev-parse HEAD)" > "$WT/catalog/.mirror-source"

# возвращаем данные витрины, опубликованные приложением
if [ -d "$TMP_DATA/data" ]; then
  rm -rf "$WT/catalog/data"
  cp -a "$TMP_DATA/data" "$WT/catalog/data"
fi
rm -rf "$TMP_DATA"

cd "$WT"
git add -A catalog
if git diff --cached --quiet; then
  echo "Каталог в деплой-ветке уже совпадает — коммитить нечего."
  exit 0
fi
git commit -q -m "$MSG"
for i in 1 2 3 4; do git push origin "$DEPLOY_BRANCH" && break || sleep $((2**i)); done
echo "Готово: catalog/ зазеркалирован в $DEPLOY_BRANCH, сайт пересоберётся."
