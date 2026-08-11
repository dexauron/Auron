-- Обновление базы каталога №18 (2026-07-19)
-- Зачем: администратор может удалить загруженный отчёт продаж (один период).
-- Удаляются только строки продаж этого периода — товары, цены и прочее не трогаются.
-- Как применить: Supabase Studio → SQL Editor → вставить весь текст → Run.

create or replace function catalog_delete_sales_period(p_from date, p_to date)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not catalog_is_admin() then
    raise exception 'Удалять отчёты продаж может только администратор';
  end if;
  delete from catalog_sales where period_from = p_from and period_to = p_to;
end $$;
revoke all on function catalog_delete_sales_period(date, date) from public, anon;
grant execute on function catalog_delete_sales_period(date, date) to authenticated;
