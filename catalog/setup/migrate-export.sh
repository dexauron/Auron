#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Way Market · Каталог — ЭКСПОРТ данных со СТАРОГО сервера.
# Запускать от root на старом сервере, где сейчас работает база:
#   bash migrate-export.sh
# Собирает всё в один файл /root/catalog-migration.tgz — его скачаешь и
# перенесёшь на новый сервер. Старый сервер НЕ трогается (только читаем).
# ─────────────────────────────────────────────────────────────
set -euo pipefail

DIR="${SUPA_DIR:-/opt/waymarket-supabase/supabase/docker}"
OUT=/root/catalog-migration
cd "$DIR"

echo "▶ [1/4] Данные каталога (товары, цены, продажи, поставщики…)"
rm -rf "$OUT"; mkdir -p "$OUT"
# только строки таблиц catalog_* (структуру создаст схема на новом сервере)
docker compose exec -T db pg_dump -U postgres -d postgres \
  --data-only --no-owner --disable-triggers \
  -t 'public.catalog_*' > "$OUT/catalog-data.sql"

echo "▶ [2/4] Список фотографий (метаданные хранилища)"
# только строки storage.objects — сам «ящик» product-photos создаст схема на новом
docker compose exec -T db pg_dump -U postgres -d postgres \
  --data-only --no-owner --disable-triggers \
  -t 'storage.objects' > "$OUT/storage-meta.sql"

echo "▶ [3/4] Сами файлы фотографий"
rm -rf "$OUT/storage-files"; mkdir -p "$OUT/storage-files"
# копируем файлы из контейнера storage (работает при любом типе тома)
docker compose cp storage:/var/lib/storage/. "$OUT/storage-files/" 2>/dev/null \
  || echo "  (фото в хранилище не найдено — возможно, их пока нет, это не ошибка)"

echo "▶ [4/4] Упаковываем всё в один файл"
tar czf /root/catalog-migration.tgz -C /root catalog-migration
SIZE=$(du -h /root/catalog-migration.tgz | cut -f1)

cat <<EOF

═══════════════════════════════════════════════════════════════
✅ ЭКСПОРТ ГОТОВ:  /root/catalog-migration.tgz  ($SIZE)

Что дальше:
  1) Скачай этот файл со старого сервера (или скопируй сразу на новый), напр.:
       scp root@СТАРЫЙ-IP:/root/catalog-migration.tgz .
       scp catalog-migration.tgz root@НОВЫЙ-IP:/root/
  2) На НОВОМ сервере запусти:  bash migrate-import.sh
Старый сервер оставь работать, пока не проверим новый.
═══════════════════════════════════════════════════════════════
EOF
