-- Обновление базы каталога №3 (2026-07-11, обновлено 2026-07-12)
-- Зачем: продажи из 1С и аналитика «Ходовые товары».
-- Отчёт 1С «Продажи» — агрегированный ЗА ПЕРИОД (в шапке «Период: … - …»),
-- поэтому храним продажи по периодам: товар × период → количество и сумма.
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.
-- ⚠ Сначала должно быть выполнено ОБНОВЛЕНИЕ-2.sql (там список админов и права).
-- (Для новых установок не нужно — schema.sql уже содержит эти изменения.)

-- если таблица осталась от старой версии (по дням, колонка sale_date) —
-- пересоздаём её под периоды (продажи всегда можно загрузить заново из 1С)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'catalog_sales' and column_name = 'sale_date'
  ) then
    drop table catalog_sales cascade;
  end if;
end $$;

-- продажи по периодам: строка на товар × период отчёта
create table if not exists catalog_sales (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references catalog_products(id) on delete cascade,
  period_from date not null,
  period_to   date not null,
  qty         numeric not null default 0,
  amount      numeric,
  created_at  timestamptz not null default now(),
  unique (product_id, period_from, period_to)
);
create index if not exists idx_sales_period  on catalog_sales(period_from, period_to);
create index if not exists idx_sales_product on catalog_sales(product_id);

alter table catalog_sales enable row level security;
drop policy if exists "sales: читать вошедшим" on catalog_sales;
create policy "sales: читать вошедшим" on catalog_sales for select to authenticated using (true);
drop policy if exists "sales: менять админу" on catalog_sales;
create policy "sales: менять админу"   on catalog_sales for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

-- топ товаров за период (сумма по отчётам, попавшим в диапазон) — считает база
create or replace function catalog_top_products(p_from date, p_to date, p_limit int default 300)
returns table (product_id uuid, total_qty numeric, total_amount numeric)
language sql stable as $$
  select product_id, sum(qty) as total_qty, sum(amount) as total_amount
  from catalog_sales
  where period_from >= p_from and period_to <= p_to
  group by product_id
  order by sum(qty) desc
  limit p_limit;
$$;
revoke all on function catalog_top_products(date, date, int) from public, anon;
grant execute on function catalog_top_products(date, date, int) to authenticated;

-- список загруженных периодов (для выбора в «Ходовых товарах»), новые сверху
create or replace function catalog_sales_periods()
returns table (period_from date, period_to date, positions bigint)
language sql stable as $$
  select period_from, period_to, count(*) as positions
  from catalog_sales
  group by period_from, period_to
  order by period_to desc, period_from desc;
$$;
revoke all on function catalog_sales_periods() from public, anon;
grant execute on function catalog_sales_periods() to authenticated;
