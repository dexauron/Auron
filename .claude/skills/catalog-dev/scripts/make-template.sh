#!/usr/bin/env bash
# Собирает ЗАГОТОВКУ каталога для чужого магазина из живого кода catalog/.
#
# Зачем скриптом, а не отдельной папкой с копией кода: копия устареет через
# неделю. Заготовка всегда собирается из того, что работает сегодня, а личное
# (название, логотип, талисман, данные, адрес репозитория) вычищается здесь —
# в одном месте, которое видно целиком.
#
#   bash .claude/skills/catalog-dev/scripts/make-template.sh [папка-куда]
#
# По умолчанию складывает в ../wm-catalog-template рядом с репозиторием.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="$(dirname "$HERE")"
ROOT="$(cd "$SKILL/../../.." && pwd)"
SRC="$ROOT/catalog"
OUT="${1:-$ROOT/../wm-catalog-template}"

[ -d "$SRC" ] || { echo "нет папки каталога: $SRC"; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"

# 1. Весь код как есть. Каталог ложится в КОРЕНЬ репозитория: тогда GitHub
#    Pages отдаёт его прямо, без подпапки, и адрес получается короче.
rsync -a --exclude 'data' "$SRC"/ "$OUT"/

# 2. Личное — вон.
rm -f  "$OUT/icons/logo-round.png" \
       "$OUT/icons/wolf.png" \
       "$OUT/icons/wolf-head.png" \
       "$OUT/icons/icon-192.png" \
       "$OUT/icons/icon-512.png" \
       "$OUT/icons/apple-touch-icon.png"
rm -f  "$OUT/КАК-СДЕЛАТЬ-СВОЙ-КАТАЛОГ.md"

# 3. Нейтральные значки вместо наших (однотонные, цвета ACCENT заготовки).
python3 -I "$HERE/make-icons.py" "$OUT/icons" >/dev/null

# 4. Настройки, манифест, лицензия, инструкции, сборка сайта.
cp "$SKILL/template/config.js"                 "$OUT/js/config.js"
cp "$SKILL/template/manifest.webmanifest"      "$OUT/manifest.webmanifest"
cp "$SKILL/template/README.md"                 "$OUT/README.md"
cp "$SKILL/template/LICENSE"                   "$OUT/LICENSE"
cp "$SKILL/template/НАСТРОИТЬ-С-ПОМОЩЬЮ-ИИ.md" "$OUT/НАСТРОИТЬ-С-ПОМОЩЬЮ-ИИ.md"
cp "$SKILL/template/КАК-СДЕЛАТЬ-СВОЙ-КАТАЛОГ.md" "$OUT/КАК-СДЕЛАТЬ-СВОЙ-КАТАЛОГ.md"
mkdir -p "$OUT/.github/workflows"
cp "$SKILL/template/.github/workflows/pages.yml" "$OUT/.github/workflows/pages.yml"

# 5. Пустая витрина: чужой магазин начинает с нуля, а не с наших товаров.
mkdir -p "$OUT/data"
cat > "$OUT/data/README.md" <<'TXT'
# Папка данных

Здесь каталог сам хранит витрину — то, что видно без пароля. Сейчас пусто:
товары появятся после первой загрузки из 1С (меню → «Загрузка из 1С»).

Руками сюда ничего кладывать не нужно. Файлы `*.enc` и папка `sec/` —
зашифрованная часть; на сайт она не выкладывается.
TXT

# 6. Кэш офлайн-копии начинаем с первой версии: у чужого магазина своя история.
sed -i "s/const CACHE = 'wm-catalog-v[0-9]*'/const CACHE = 'catalog-v1'/" "$OUT/sw.js"

# 7. Сверка: ничего нашего не уехало.
BAD=0
for pat in 'Way Market' 'dexauron' '79640616601' 'Грозн' 'logo-round' 'wolf\.png' 'wolf-head\.png'; do
  # LICENSE законно содержит имя автора
  if grep -rInE "$pat" "$OUT" --exclude=LICENSE >/dev/null 2>&1; then
    echo "⚠ в заготовке осталось «$pat»:"
    grep -rInE "$pat" "$OUT" --exclude=LICENSE | head -5
    BAD=1
  fi
done
if ls "$OUT"/data/*.json >/dev/null 2>&1; then echo "⚠ в заготовке остались данные витрины"; BAD=1; fi

echo
if [ "$BAD" = 0 ]; then
  echo "Готово: заготовка в $OUT — личного в ней ничего нет."
else
  echo "Заготовка собрана, НО сверка нашла лишнее (см. выше) — почини и собери заново."
  exit 1
fi
echo "Файлов: $(find "$OUT" -type f | wc -l), размер: $(du -sh "$OUT" | cut -f1)"
