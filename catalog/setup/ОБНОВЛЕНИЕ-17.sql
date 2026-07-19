-- Обновление базы каталога №17 (2026-07-19)
-- Зачем: «Ходовые товары» профессионально — ранжирование по ВЫРУЧКЕ (деньгам),
-- а не по смешанному количеству (кг и шт нельзя складывать в один рейтинг).
-- Функция топа теперь умеет сортировать и по выручке, и по количеству, а новая
-- функция считает итог периода (для доли товара в обороте, %).
-- Как применить: Supabase Studio → SQL Editor → вставить весь текст → Run.

-- старую версию (3 аргумента) убираем, чтобы не было двусмысленности
drop function if exists catalog_top_products(date, date, int);

-- топ товаров за период: p_order = 'amount' (по выручке, по умолчанию) | 'qty' (по количеству)
create or replace function catalog_top_products(
  p_from date, p_to date, p_limit int default 300, p_order text default 'amount')
returns table (product_id uuid, total_qty numeric, total_amount numeric)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not catalog_can_purchase() then
    raise exception 'Аналитика доступна только администратору и аналитику';
  end if;
  return query
    select s.product_id, sum(s.qty), sum(s.amount)
    from catalog_sales s
    where s.period_from = p_from and s.period_to = p_to
    group by s.product_id
    order by case when p_order = 'qty' then sum(s.qty)
                  else coalesce(sum(s.amount), 0) end desc
    limit p_limit;
end $$;
revoke all on function catalog_top_products(date, date, int, text) from public, anon;
grant execute on function catalog_top_products(date, date, int, text) to authenticated;

-- итог периода: всего продано штук и на какую сумму (для доли товара в обороте)
create or replace function catalog_period_total(p_from date, p_to date)
returns table (total_qty numeric, total_amount numeric)
language sql stable security definer set search_path = public, auth as $$
  select coalesce(sum(qty), 0), coalesce(sum(amount), 0)
  from catalog_sales where period_from = p_from and period_to = p_to;
$$;
revoke all on function catalog_period_total(date, date) from public, anon;
grant execute on function catalog_period_total(date, date) to authenticated;
