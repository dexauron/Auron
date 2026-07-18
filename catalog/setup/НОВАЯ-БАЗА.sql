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
  retail_price numeric,     -- розничная цена (цена на полке) — видна всем
  stock_qty  numeric,       -- остаток на складе (из отчёта 1С «Остатки»)
  stock_at   date,          -- на какую дату актуален остаток
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

-- Роли аккаунтов: admin (всё) / manager (аналитик, зал — закупочные цены,
-- контакты, аналитика) / cashier (только товар и розничная цена). Аккаунт без
-- записи здесь, но вошедший — cashier. Пример:
--   insert into catalog_roles (email, role) values ('manager@waymarket.ru','manager');
create table if not exists catalog_roles (
  email      text primary key,
  role       text not null check (role in ('admin','manager','cashier')),
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

-- Продажи из 1С по периодам — для аналитики «Ходовые товары»
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

-- «Разведка цен»: магазины-конкуренты и их розничные цены
create table if not exists catalog_competitors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  note       text,
  created_at timestamptz not null default now()
);
create table if not exists catalog_competitor_prices (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references catalog_products(id) on delete cascade,
  competitor_id uuid not null references catalog_competitors(id) on delete cascade,
  price         numeric not null,
  observed_at   date not null default current_date,
  created_at    timestamptz not null default now(),
  unique (product_id, competitor_id)
);
create index if not exists idx_comp_prices_product on catalog_competitor_prices(product_id);

-- топ товаров за период — считает база (только админ и аналитик)
create or replace function catalog_top_products(p_from date, p_to date, p_limit int default 300)
returns table (product_id uuid, total_qty numeric, total_amount numeric)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not catalog_can_purchase() then
    raise exception 'Аналитика доступна только администратору и аналитику';
  end if;
  -- ровно выбранный период (а не «все вложенные») — иначе при вложенных
  -- периодах продажи посчитались бы дважды
  return query
    select s.product_id, sum(s.qty), sum(s.amount)
    from catalog_sales s
    where s.period_from = p_from and s.period_to = p_to
    group by s.product_id order by sum(s.qty) desc limit p_limit;
end $$;
revoke all on function catalog_top_products(date, date, int) from public, anon;
grant execute on function catalog_top_products(date, date, int) to authenticated;

-- список загруженных периодов продаж
create or replace function catalog_sales_periods()
returns table (period_from date, period_to date, positions bigint)
language sql stable as $$
  select period_from, period_to, count(*) from catalog_sales
  group by period_from, period_to order by period_to desc, period_from desc;
$$;
revoke all on function catalog_sales_periods() from public, anon;
grant execute on function catalog_sales_periods() to authenticated;

-- роль текущего пользователя: из catalog_roles, иначе вошедший = cashier
create or replace function catalog_my_role() returns text
language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select role from catalog_roles where email = auth.jwt()->>'email'),
    case when (auth.jwt()->>'email') is not null then 'cashier' end
  );
$$;
revoke all on function catalog_my_role() from public, anon;
grant execute on function catalog_my_role() to authenticated;

-- проверка «этот пользователь — админ?» (роль admin или старый список catalog_admins)
create or replace function catalog_is_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select role from catalog_roles where email = auth.jwt()->>'email') = 'admin', false)
      or exists (select 1 from catalog_admins where email = auth.jwt()->>'email');
$$;

-- кто видит закупочные цены и контакты поставщиков: админ и аналитик
create or replace function catalog_can_purchase() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select catalog_my_role() in ('admin','manager');
$$;
revoke all on function catalog_can_purchase() from public, anon;
grant execute on function catalog_can_purchase() to authenticated;

-- добавить фото к товару может любой вошедший (сам товар правит только админ)
create or replace function catalog_add_photo(p_product_id uuid, p_url text)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if (auth.jwt()->>'email') is null then
    raise exception 'Только для вошедших';
  end if;
  update catalog_products
     set photos = coalesce(photos, '[]'::jsonb) || to_jsonb(p_url),
         updated_at = now()
   where id = p_product_id;
end $$;
revoke all on function catalog_add_photo(uuid, text) from public, anon;
grant execute on function catalog_add_photo(uuid, text) to authenticated;

-- ── Права доступа: каталог читают все; цены и контакты — вошедшие; менять — только админ ──

alter table catalog_groups            enable row level security;
alter table catalog_suppliers         enable row level security;
alter table catalog_products          enable row level security;
alter table catalog_admins            enable row level security;
alter table catalog_roles             enable row level security;
alter table catalog_supplier_contacts enable row level security;
alter table catalog_prices            enable row level security;
alter table catalog_sales             enable row level security;
alter table catalog_competitors       enable row level security;
alter table catalog_competitor_prices enable row level security;

create policy "groups: читать всем"        on catalog_groups    for select using (true);
create policy "groups: менять админу"      on catalog_groups    for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
create policy "suppliers: читать всем"     on catalog_suppliers for select using (true);
create policy "suppliers: менять админу"   on catalog_suppliers for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
create policy "products: читать всем"      on catalog_products  for select using (true);
create policy "products: менять админу"    on catalog_products  for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
create policy "admins: читать вошедшим"    on catalog_admins            for select to authenticated using (true);
create policy "roles: читать вошедшим"     on catalog_roles             for select to authenticated using (true);
create policy "roles: менять админу"       on catalog_roles             for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
create policy "contacts: читать закупки"   on catalog_supplier_contacts for select to authenticated using (catalog_can_purchase());
create policy "contacts: менять админу"    on catalog_supplier_contacts for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
create policy "prices: читать закупки"     on catalog_prices            for select to authenticated using (catalog_can_purchase());
create policy "prices: менять админу"      on catalog_prices            for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
create policy "sales: читать вошедшим"     on catalog_sales             for select to authenticated using (true);
create policy "sales: менять админу"       on catalog_sales             for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
-- разведка цен: читают и ведут все вошедшие; удаляет — админ
create policy "competitors: читать"        on catalog_competitors        for select to authenticated using (true);
create policy "competitors: добавлять"     on catalog_competitors        for insert to authenticated with check (true);
create policy "competitors: править"       on catalog_competitors        for update to authenticated using (true) with check (true);
create policy "competitors: удалять админу" on catalog_competitors       for delete to authenticated using (catalog_is_admin());
create policy "comp_prices: читать"        on catalog_competitor_prices  for select to authenticated using (true);
create policy "comp_prices: добавлять"     on catalog_competitor_prices  for insert to authenticated with check (true);
create policy "comp_prices: править"       on catalog_competitor_prices  for update to authenticated using (true) with check (true);
create policy "comp_prices: удалять админу" on catalog_competitor_prices for delete to authenticated using (catalog_is_admin());

-- ── Хранилище фотографий ────────────────────────────────

insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do nothing;

create policy "фото: смотреть всем"     on storage.objects for select using (bucket_id = 'product-photos');
-- загружать фото может любой вошедший сотрудник (добавить фото товара)
create policy "фото: загружать вошедшим" on storage.objects for insert to authenticated with check (bucket_id = 'product-photos');
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

-- ── Аккаунты и роли для нового сервера (впиши свои email при необходимости) ──
insert into catalog_admins (email) values ('dexauron@gmail.com') on conflict do nothing;
insert into catalog_roles (email, role) values
  ('dexauron@gmail.com', 'admin'),
  ('manager@waymarket.ru', 'manager'),
  ('staff@waymarket.ru',   'cashier')
on conflict (email) do update set role = excluded.role;

-- ── История розничной цены + индексы поиска (обновление №12) ──
create table if not exists catalog_retail_history (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references catalog_products(id) on delete cascade,
  retail_price numeric not null,
  changed_at  date not null default current_date,
  created_at  timestamptz not null default now(),
  unique (product_id, changed_at)
);
create index if not exists idx_retail_hist_product on catalog_retail_history(product_id, changed_at desc);
alter table catalog_retail_history enable row level security;
create policy "retail_hist: читать вошедшим" on catalog_retail_history
  for select to authenticated using (true);
create policy "retail_hist: менять админу" on catalog_retail_history
  for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

create extension if not exists pg_trgm;
create index if not exists idx_products_name_trgm on catalog_products using gin (lower(name) gin_trgm_ops);
create index if not exists idx_products_barcodes on catalog_products using gin (barcodes);
create index if not exists idx_products_retail on catalog_products(retail_price) where retail_price is not null;
create index if not exists idx_products_article on catalog_products(article) where article is not null;


-- ═══════════════ ОБНОВЛЕНИЕ-13 ═══════════════
-- Покупатели без аккаунта предлагают фото → очередь на проверку → одобрение сотрудником.
-- очередь предложенных фото
create table if not exists catalog_photo_suggestions (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references catalog_products(id) on delete cascade,
  url         text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_photo_sugg_created on catalog_photo_suggestions(created_at desc);

alter table catalog_photo_suggestions enable row level security;
-- очередь видят и разбирают только вошедшие сотрудники; покупатели пишут туда
-- лишь через функцию ниже (напрямую в таблицу — нельзя)
drop policy if exists "sugg: читать вошедшим" on catalog_photo_suggestions;
create policy "sugg: читать вошедшим" on catalog_photo_suggestions
  for select to authenticated using (true);
drop policy if exists "sugg: разбирать вошедшим" on catalog_photo_suggestions;
create policy "sugg: разбирать вошедшим" on catalog_photo_suggestions
  for all to authenticated using (true) with check (true);

-- покупатель (без аккаунта) предлагает фото — кладётся в очередь на проверку
create or replace function catalog_suggest_photo(p_product_id uuid, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_url is null or p_url = '' then raise exception 'нет ссылки на фото'; end if;
  if not exists (select 1 from catalog_products where id = p_product_id) then
    raise exception 'товар не найден';
  end if;
  insert into catalog_photo_suggestions (product_id, url) values (p_product_id, p_url);
end $$;
grant execute on function catalog_suggest_photo(uuid, text) to anon, authenticated;

-- сотрудник одобряет фото: добавляет его товару и убирает из очереди
create or replace function catalog_approve_suggestion(p_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare s catalog_photo_suggestions;
begin
  if (auth.jwt()->>'email') is null then raise exception 'только для сотрудников'; end if;
  select * into s from catalog_photo_suggestions where id = p_id;
  if not found then return; end if;
  update catalog_products
     set photos = coalesce(photos, '[]'::jsonb) || to_jsonb(s.url), updated_at = now()
   where id = s.product_id;
  delete from catalog_photo_suggestions where id = p_id;
end $$;
revoke all on function catalog_approve_suggestion(uuid) from public, anon;
grant execute on function catalog_approve_suggestion(uuid) to authenticated;

-- Хранилище фото: покупателю разрешаем загрузку ТОЛЬКО в папку suggestions/
drop policy if exists "фото: покупатель предлагает" on storage.objects;
create policy "фото: покупатель предлагает" on storage.objects
  for insert to anon
  with check (bucket_id = 'product-photos' and (storage.foldername(name))[1] = 'suggestions');


-- ═══════════════ ОБНОВЛЕНИЕ-14 ═══════════════
-- Дата поступления (завоза) товара — для фильтра по произвольному диапазону дат.
alter table catalog_products add column if not exists arrival_at date;
create index if not exists idx_products_arrival on catalog_products(arrival_at) where arrival_at is not null;
