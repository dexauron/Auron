-- Обновление базы каталога №3 (2026-07-11)
-- Зачем: продажи из 1С и аналитика «Ходовые товары» (день / неделя / месяц / свой период).
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.
-- ⚠ Сначала должно быть выполнено ОБНОВЛЕНИЕ-2.sql (там список админов и права).
-- (Для новых установок не нужно — schema.sql уже содержит эти изменения.)

-- продажи по дням: строка на товар × дату
create table if not exists catalog_sales (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references catalog_products(id) on delete cascade,
  sale_date  date not null,
  qty        numeric not null default 0,
  amount     numeric,
  created_at timestamptz not null default now(),
  unique (product_id, sale_date)
);
create index if not exists idx_sales_date    on catalog_sales(sale_date);
create index if not exists idx_sales_product on catalog_sales(product_id);

alter table catalog_sales enable row level security;
drop policy if exists "sales: читать вошедшим" on catalog_sales;
create policy "sales: читать вошедшим" on catalog_sales for select to authenticated using (true);
drop policy if exists "sales: менять админу" on catalog_sales;
create policy "sales: менять админу"   on catalog_sales for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

-- топ продаж за период — считает база, телефону не нужно качать все строки
create or replace function catalog_top_products(p_from date, p_to date, p_limit int default 200)
returns table (product_id uuid, total_qty numeric, total_amount numeric)
language sql stable as $$
  select product_id, sum(qty) as total_qty, sum(amount) as total_amount
  from catalog_sales
  where sale_date between p_from and p_to
  group by product_id
  order by sum(qty) desc
  limit p_limit;
$$;
revoke all on function catalog_top_products(date, date, int) from public, anon;
grant execute on function catalog_top_products(date, date, int) to authenticated;
