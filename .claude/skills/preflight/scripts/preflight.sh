#!/usr/bin/env bash
# Проверка перед пушем. Ничего не чинит и ничего не меняет — только смотрит
# и говорит, что не так. Запускать из корня репозитория:
#   bash .claude/skills/preflight/scripts/preflight.sh
#
# Код возврата: 0 — можно пушить, 1 — нельзя.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

FAIL=0
say()  { printf '%s\n' "$*"; }
bad()  { printf '  ✗ %s\n' "$*"; FAIL=1; }
good() { printf '  ✓ %s\n' "$*"; }

changed() { git diff --name-only HEAD -- "$1" | grep -q . \
         || git diff --cached --name-only -- "$1" | grep -q .; }

# Файл, записанный в ту же секунду, что и предыдущая проверка, git может
# счесть неизменённым (он сравнивает время из индекса). Из-за этого проверка
# один раз соврала: сказала «версия не поднята», хотя она была поднята.
# Ложная тревога не опасна, а вот ложное «всё хорошо» опасно — поэтому
# заставляем git перечитать состояние файлов перед сравнением.
git update-index -q --really-refresh >/dev/null 2>&1 || true

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ── 1. Синтаксис Code.gs ────────────────────────────────────────────────
# Apps Script не проверяет файл до запуска: опечатка становится видна только
# у владельца в магазине. Поэтому проверяем копией через node.
say "1. Синтаксис webapp/Code.gs"
if [ -f webapp/Code.gs ]; then
  cp webapp/Code.gs "$TMP/Code.js"
  if out=$(node --check "$TMP/Code.js" 2>&1); then good "синтаксис OK"
  else bad "синтаксис сломан"; printf '      %s\n' "$out"; fi
else good "файла нет — пропускаем"; fi

# ── 2. Тесты ────────────────────────────────────────────────────────────
say "2. Тесты webapp/tests"
if compgen -G "webapp/tests/*.test.js" > /dev/null; then
  n=0
  for t in webapp/tests/*.test.js; do
    n=$((n+1))
    if out=$(cd webapp && node "tests/$(basename "$t")" 2>&1); then :
    else bad "упал $(basename "$t")"; printf '%s\n' "$out" | tail -12 | sed 's/^/      /'; fi
  done
  [ "$FAIL" -eq 0 ] && good "все $n файлов зелёные"
else bad "тестов не найдено — так быть не должно"; fi

# ── 3. Версия приложения ────────────────────────────────────────────────
# Без поднятия версии у владельца останется старая страница из кэша, и он
# скажет «ничего не изменилось». Это случалось.
say "3. Версия"
for pair in "webapp/Index.html|APP_VERSION" "app/index.html|APP_VERSION" "app/sw.js|CACHE_NAME"; do
  f="${pair%%|*}"; key="${pair##*|}"
  [ -f "$f" ] || continue
  if changed "$f"; then
    if git diff HEAD -- "$f" | grep -q "^+.*$key"; then good "$f — $key поднят"
    else bad "$f изменён, но $key не поднят"; fi
  fi
done
[ "$FAIL" -eq 0 ] && good "проверено"

# ── 4. Мусор, который нельзя пушить ─────────────────────────────────────
say "4. Отладочный мусор в изменениях"
for pat in 'console\.log' 'debugger' 'TODO:REMOVE' 'XXX'; do
  hits=$(git diff HEAD -- webapp app 2>/dev/null | grep -c "^+.*$pat" || true)
  [ "${hits:-0}" -gt 0 ] && bad "$pat — $hits шт. в добавленных строках"
done
[ "$FAIL" -eq 0 ] && good "чисто"

say ""
if [ "$FAIL" -eq 0 ]; then say "Готово к пушу."; else
  say "ПУШИТЬ НЕЛЬЗЯ — сначала почини перечисленное."; fi
exit "$FAIL"
