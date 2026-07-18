-- Обновление базы каталога №15 (2026-07-18)
-- Зачем: описание товара (текст под названием в карточке, как в витринах магазинов).
-- Как применить: Supabase Studio → SQL Editor → вставить весь текст → Run.

alter table catalog_products add column if not exists description text;
