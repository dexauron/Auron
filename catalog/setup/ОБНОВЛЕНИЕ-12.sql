-- Обновление базы каталога №12 (2026-07-17)
-- Зачем:
--   1) История розничной цены — как меняется цена на полке (по загрузкам «Остатков»).
--   2) Индексы для быстрого поиска по коду/штрихкоду/названию на большом каталоге.
-- Как применить: Supabase Studio → SQL Editor → вставить весь текст → Run.
-- Повторный запуск безопасен (всё через IF NOT EXISTS / OR REPLACE).

-- ── 1. История розничной цены ────────────────────────────────
create table if not exists catalog_retail_history (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references catalog_products(id) on delete cascade,
  retail_price numeric not null,
  changed_at  date not null default current_date,
  created_at  timestamptz not null default now(),
  unique (product_id, changed_at)   -- одна запись за день на товар (повторный импорт обновит)
);
create index if not exists idx_retail_hist_product on catalog_retail_history(product_id, changed_at desc);

alter table catalog_retail_history enable row level security;
-- розничная цена видна всем вошедшим — её история тоже; ведёт (пишет) только админ
drop policy if exists "retail_hist: читать вошедшим" on catalog_retail_history;
create policy "retail_hist: читать вошедшим" on catalog_retail_history
  for select to authenticated using (true);
drop policy if exists "retail_hist: менять админу" on catalog_retail_history;
create policy "retail_hist: менять админу" on catalog_retail_history
  for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

-- ── 2. Индексы поиска (ускоряют выборки на 15 000+ товаров) ───
-- поиск по названию без учёта регистра (триграммы)
create extension if not exists pg_trgm;
create index if not exists idx_products_name_trgm on catalog_products using gin (lower(name) gin_trgm_ops);
-- быстрый поиск по штрихкодам (массив хранится в jsonb)
create index if not exists idx_products_barcodes on catalog_products using gin (barcodes);
-- сортировка/фильтр по розничной цене
create index if not exists idx_products_retail on catalog_products(retail_price) where retail_price is not null;
-- артикул (иногда ищут по нему)
create index if not exists idx_products_article on catalog_products(article) where article is not null;
