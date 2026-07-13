-- Обновление базы каталога №6 (2026-07-13)
-- Зачем: чинит «в аккаунте администратора не показываются цены».
-- Причина была в том, что при импорте цены записывались только если аккаунт
-- признан администратором. Если email админа не попал в список catalog_admins,
-- цены молча НЕ сохранялись — и потом их никто не видел.
-- Что делает этот скрипт:
--   1) добавляет владельца в администраторы (впиши свой email ниже);
--   2) делает сохранение цен надёжным (пишет от имени базы + понятная ошибка,
--      если вошёл не администратор — больше не будет «тихой потери» цен);
--   3) показывает, сколько цен уже загружено (для проверки).
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.

-- ── 1. Владелец — администратор ───────────────────────────
-- ⚠ ЗАМЕНИ на email, которым ты входишь в каталог как администратор:
insert into catalog_admins (email) values ('dexauron@gmail.com')
  on conflict (email) do nothing;

-- ── 2. Надёжное сохранение цен ────────────────────────────
-- security definer: функция пишет цены от имени базы, поэтому корректный
-- админ всегда сохранит цены. Но внутри — явная проверка: не админ → ошибка.
create or replace function catalog_save_prices(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public, auth as $$
declare ins integer := 0; upd integer := 0;
begin
  if not catalog_is_admin() then
    raise exception 'Сохранять цены может только администратор. Проверь, что твой email есть в списке администраторов (catalog_admins).';
  end if;

  -- цена не изменилась, но поступление свежее → обновляем дату у последней записи
  with incoming as (
    select (r->>'product_id')::uuid   as pid,
           (r->>'supplier_id')::uuid  as sid,
           (r->>'price')::numeric     as price,
           coalesce(nullif(r->>'price_date','')::date, current_date) as d
    from jsonb_array_elements(p_rows) as r
  ),
  latest as (
    select distinct on (cp.product_id, cp.supplier_id)
           cp.id, cp.product_id, cp.supplier_id, cp.price, cp.price_date
    from catalog_prices cp
    join (select distinct pid, sid from incoming) i
      on i.pid = cp.product_id and i.sid = cp.supplier_id
    order by cp.product_id, cp.supplier_id, cp.price_date desc
  )
  update catalog_prices cp
     set price_date = i.d
    from incoming i
    join latest l on l.product_id = i.pid and l.supplier_id = i.sid
   where cp.id = l.id and l.price = i.price and i.d > l.price_date;
  get diagnostics upd = row_count;

  -- новая или изменившаяся цена → новая строка истории
  with incoming as (
    select (r->>'product_id')::uuid   as pid,
           (r->>'supplier_id')::uuid  as sid,
           (r->>'price')::numeric     as price,
           coalesce(nullif(r->>'price_date','')::date, current_date) as d
    from jsonb_array_elements(p_rows) as r
  ),
  latest as (
    select distinct on (cp.product_id, cp.supplier_id)
           cp.product_id, cp.supplier_id, cp.price
    from catalog_prices cp
    join (select distinct pid, sid from incoming) i
      on i.pid = cp.product_id and i.sid = cp.supplier_id
    order by cp.product_id, cp.supplier_id, cp.price_date desc
  )
  insert into catalog_prices (product_id, supplier_id, price, price_date)
  select i.pid, i.sid, i.price, i.d
  from incoming i
  left join latest l on l.product_id = i.pid and l.supplier_id = i.sid
  where l.product_id is null or l.price is distinct from i.price
  on conflict (product_id, supplier_id, price_date) do update set price = excluded.price;
  get diagnostics ins = row_count;

  return ins + upd;
end $$;
revoke all on function catalog_save_prices(jsonb) from public, anon;
grant execute on function catalog_save_prices(jsonb) to authenticated;

-- ── 3. Проверка: что уже есть в базе ──────────────────────
select
  (select count(*) from catalog_prices)                        as всего_цен,
  (select count(distinct product_id) from catalog_prices)      as товаров_с_ценами,
  (select count(*) from catalog_admins)                        as администраторов;
