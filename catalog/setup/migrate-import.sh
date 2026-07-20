#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Way Market · Каталог — ИМПОРТ данных на НОВЫЙ сервер.
# Порядок: сначала на новом сервере должен работать Supabase и быть применена
# схема (ОБНОВИТЬ-БАЗУ-ПОЛНОСТЬЮ.sql в Studio). Затем положи сюда архив
# /root/catalog-migration.tgz (со старого сервера) и запусти:
#   bash migrate-import.sh
# Переносит товары, цены, продажи, поставщиков и фотографии. Идемпотентно:
# перед загрузкой чистит соответствующие таблицы, дублей не будет.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

DIR="${SUPA_DIR:-/opt/waymarket-supabase/supabase/docker}"
ARCH=/root/catalog-migration.tgz
SRC=/root/catalog-migration
cd "$DIR"

[ -f "$ARCH" ] || { echo "❌ Нет файла $ARCH — скопируй его со старого сервера сюда."; exit 1; }
echo "▶ [1/5] Распаковываю архив"
rm -rf "$SRC"; tar xzf "$ARCH" -C /root

psql() { docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "▶ [2/5] Проверяю, что схема каталога уже создана"
psql -c "select 1 from catalog_products limit 1;" >/dev/null 2>&1 \
  || { echo "❌ Таблиц каталога нет. Сначала применi ОБНОВИТЬ-БАЗУ-ПОЛНОСТЬЮ.sql в Studio → SQL Editor."; exit 1; }

echo "▶ [3/5] Чищу стартовые данные (чтобы не задвоились), затем гружу перенесённые"
psql -c "truncate table
  catalog_groups, catalog_suppliers, catalog_products, catalog_prices,
  catalog_sales, catalog_supplier_contacts, catalog_competitors,
  catalog_competitor_prices, catalog_retail_history, catalog_photo_suggestions,
  catalog_popularity, catalog_search_terms, catalog_admins, catalog_roles
  restart identity cascade;"
psql < "$SRC/catalog-data.sql"

echo "▶ [4/5] Переношу список фотографий и файлы"
psql -c "truncate table storage.objects;" 2>/dev/null || true
if [ -s "$SRC/storage-meta.sql" ]; then
  psql < "$SRC/storage-meta.sql" \
    || echo "  ⚠ метаданные фото не легли (возможно, другая версия Supabase). Не страшно: фото можно заново подтянуть в приложении (автопоиск фото). Скажи Клоду — поможем."
fi
if [ -d "$SRC/storage-files" ] && [ -n "$(ls -A "$SRC/storage-files" 2>/dev/null)" ]; then
  docker compose cp "$SRC/storage-files/." storage:/var/lib/storage/ \
    && docker compose restart storage >/dev/null 2>&1 || true
fi

echo "▶ [5/5] Проверка"
N=$(psql -tAc "select count(*) from catalog_products;")
G=$(psql -tAc "select count(*) from catalog_groups;")
S=$(psql -tAc "select count(*) from catalog_sales;")
cat <<EOF

═══════════════════════════════════════════════════════════════
✅ ИМПОРТ ГОТОВ.  Товаров: $N · Групп: $G · Строк продаж: $S

Осталось:
  1) Studio → Authentication → Users → создай заново 3 аккаунта
     (dexauron@gmail.com, manager@waymarket.ru, staff@waymarket.ru),
     каждому Auto Confirm. Пароли задай (можно прежние).
  2) Пришли Клоду АДРЕС новой базы и ANON-ключ — он пропишет их в приложение.
Старый сервер выключай только после проверки, что новый работает.
═══════════════════════════════════════════════════════════════
EOF
