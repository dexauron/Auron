-- Обновление базы каталога №4 (2026-07-11)
-- Зачем: (1) экономная история цен — запись только при изменении цены,
--        (2) смена пароля магазина и выход всех устройств сотрудников из приложения.
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.
-- ⚠ Сначала должны быть выполнены ОБНОВЛЕНИЕ-2.sql и ОБНОВЛЕНИЕ-3.sql.
-- (Для новых установок не нужно — schema.sql уже содержит эти изменения.)

-- ── 1. Запись цен только при изменении ──────────────────
-- Иначе ежедневный импорт плодит миллионы одинаковых строк и раздувает базу.
-- Дата у цены = последнее поступление товара у поставщика с этой ценой (из файла 1С).
-- Цена изменилась → новая строка истории; цена та же, поступление свежее → обновляется
-- только дата. Возвращает, сколько строк записано или обновлено.
create or replace function catalog_save_prices(p_rows jsonb)
returns integer
language plpgsql as $$
declare ins integer := 0; upd integer := 0;
begin
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

-- ── 2. Пароль магазина и выход устройств ────────────────
-- Уволился сотрудник → админ прямо в приложении ставит новый пароль магазина,
-- и все телефоны со старым входом выходят из системы.
create or replace function catalog_set_staff_password(p_password text)
returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare uid uuid;
begin
  if not catalog_is_admin() then
    raise exception 'Менять пароль магазина может только администратор';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Пароль должен быть не короче 6 символов';
  end if;
  select id into uid from auth.users where email = 'staff@waymarket.ru';
  if uid is null then
    raise exception 'Аккаунт сотрудников staff@waymarket.ru ещё не создан';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = uid;
  delete from auth.sessions where user_id = uid; -- все устройства сотрудников выходят
end $$;
revoke all on function catalog_set_staff_password(text) from public, anon;
grant execute on function catalog_set_staff_password(text) to authenticated;

-- Просто выгнать все устройства сотрудников, не меняя пароль
create or replace function catalog_logout_staff()
returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not catalog_is_admin() then
    raise exception 'Только администратор';
  end if;
  select id into uid from auth.users where email = 'staff@waymarket.ru';
  if uid is not null then
    delete from auth.sessions where user_id = uid;
  end if;
end $$;
revoke all on function catalog_logout_staff() from public, anon;
grant execute on function catalog_logout_staff() to authenticated;
