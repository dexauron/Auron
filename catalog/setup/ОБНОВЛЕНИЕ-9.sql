-- Обновление базы каталога №9 (2026-07-13)
-- Зачем: правильная математика «Ходовых товаров».
-- Раньше топ считался по всем периодам, ВЛОЖЕННЫМ в выбранный. Если загружены
-- пересекающиеся периоды (например «01.06–30.06» и «01.06–12.07»), продажи июня
-- складывались дважды. Теперь топ считается РОВНО по выбранному периоду.
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.

create or replace function catalog_top_products(p_from date, p_to date, p_limit int default 300)
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
    group by s.product_id order by sum(s.qty) desc limit p_limit;
end $$;
revoke all on function catalog_top_products(date, date, int) from public, anon;
grant execute on function catalog_top_products(date, date, int) to authenticated;
