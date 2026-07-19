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

git worktree add -q "$WT" "$DEPLOY_BRANCH"
trap 'git worktree remove --force "$WT" 2>/dev/null || true' EXIT

# полностью заменяем catalog/ содержимым рабочей ветки
rm -rf "$WT/catalog"
cp -a "$REPO_ROOT/catalog" "$WT/catalog"

cd "$WT"
git add -A catalog
if git diff --cached --quiet; then
  echo "Каталог в деплой-ветке уже совпадает — коммитить нечего."
  exit 0
fi
git commit -q -m "$MSG"
for i in 1 2 3 4; do git push origin "$DEPLOY_BRANCH" && break || sleep $((2**i)); done
echo "Готово: catalog/ зазеркалирован в $DEPLOY_BRANCH, сайт пересоберётся."
