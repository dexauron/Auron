-- Way Market · Каталог товаров — создание базы данных
-- Запустить ОДИН раз в SQL Editor нового проекта Supabase (см. НАСТРОЙКА.md)

-- ── Таблицы ─────────────────────────────────────────────

create table if not exists catalog_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists catalog_suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists catalog_products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  group_id   uuid references catalog_groups(id) on delete set null,
  supplier_ids jsonb not null default '[]', -- поставщики товара (может быть несколько)
  code       text,          -- код кассы
  article    text,          -- артикул
  barcodes   jsonb not null default '[]', -- штрихкоды (может быть несколько; пусто = нет)
  is_weighted boolean not null default false, -- весовой товар
  unit       text,          -- единица продажи из 1С: шт / кг / упак…
  department text,          -- отдел / секция кассы
  note       text,          -- примечание
  photos     jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_group on catalog_products(group_id);
create unique index if not exists uq_products_code on catalog_products(code); -- для импорта из 1С
create index if not exists idx_products_updated on catalog_products(updated_at); -- быстрая докачка изменившихся

-- Администраторы: только они могут менять каталог. Первого админа впиши сам:
--   insert into catalog_admins (email) values ('ТВОЙ-EMAIL');
create table if not exists catalog_admins (
  email      text primary key,
  created_at timestamptz not null default now()
);

-- Контакты поставщиков — отдельная таблица: видны только вошедшим
create table if not exists catalog_supplier_contacts (
  supplier_id  uuid primary key references catalog_suppliers(id) on delete cascade,
  phone        text,
  contact_name text,
  note         text,
  updated_at   timestamptz not null default now()
);

-- Цены поставщиков с историей: строка на товар × поставщик × дату (заполняет импорт 1С)
create table if not exists catalog_prices (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references catalog_products(id) on delete cascade,
  supplier_id uuid not null references catalog_suppliers(id) on delete cascade,
  price       numeric not null,
  price_date  date not null default current_date,
  created_at  timestamptz not null default now(),
  unique (product_id, supplier_id, price_date)
);
create index if not exists idx_prices_product on catalog_prices(product_id);

-- Продажи по дням из импорта 1С — для аналитики «Ходовые товары»
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

-- проверка «этот пользователь — админ?» для прав доступа
create or replace function catalog_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from catalog_admins where email = auth.jwt()->>'email');
$$;

-- ── Права доступа: каталог читают все; цены и контакты — вошедшие; менять — только админ ──

alter table catalog_groups            enable row level security;
alter table catalog_suppliers         enable row level security;
alter table catalog_products          enable row level security;
alter table catalog_admins            enable row level security;
alter table catalog_supplier_contacts enable row level security;
alter table catalog_prices            enable row level security;
alter table catalog_sales             enable row level security;

create policy "groups: читать всем"        on catalog_groups    for select using (true);
create policy "groups: менять админу"      on catalog_groups    for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
create policy "suppliers: читать всем"     on catalog_suppliers for select using (true);
create policy "suppliers: менять админу"   on catalog_suppliers for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
create policy "products: читать всем"      on catalog_products  for select using (true);
create policy "products: менять админу"    on catalog_products  for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
create policy "admins: читать вошедшим"    on catalog_admins            for select to authenticated using (true);
create policy "contacts: читать вошедшим"  on catalog_supplier_contacts for select to authenticated using (true);
create policy "contacts: менять админу"    on catalog_supplier_contacts for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
create policy "prices: читать вошедшим"    on catalog_prices            for select to authenticated using (true);
create policy "prices: менять админу"      on catalog_prices            for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
create policy "sales: читать вошедшим"     on catalog_sales             for select to authenticated using (true);
create policy "sales: менять админу"       on catalog_sales             for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

-- ── Хранилище фотографий ────────────────────────────────

insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do nothing;

create policy "фото: смотреть всем"     on storage.objects for select using (bucket_id = 'product-photos');
create policy "фото: загружать админу"  on storage.objects for insert to authenticated with check (bucket_id = 'product-photos' and catalog_is_admin());
create policy "фото: менять админу"     on storage.objects for update to authenticated using (bucket_id = 'product-photos' and catalog_is_admin());
create policy "фото: удалять админу"    on storage.objects for delete to authenticated using (bucket_id = 'product-photos' and catalog_is_admin());

-- ── Стартовые группы товаров (потом меняются в приложении) ──

insert into catalog_groups (name, sort_order) values
  ('Хлебобулочные', 1),
  ('Выпечка и фастфуд', 2),
  ('Сладости', 3),
  ('Напитки', 4),
  ('Молочные продукты', 5),
  ('Бакалея', 6),
  ('Химия', 7),
  ('Прочее', 8);
