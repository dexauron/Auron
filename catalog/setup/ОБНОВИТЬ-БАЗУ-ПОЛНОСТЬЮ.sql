-- Way Market · Каталог — ПОЛНОЕ обновление базы одним файлом.
-- Приводит базу к самой свежей версии: все таблицы, функции, права и обновления
-- (включая 12–16). БЕЗОПАСНО: НИЧЕГО НЕ УДАЛЯЕТ — товары, цены, продажи, фото,
-- контакты остаются на месте. Можно запускать хоть каждый день, ничего не
-- задвоится и не сломается.
-- Как применить: Supabase Studio → SQL Editor → вставить ВЕСЬ этот текст → Run.

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
  supplier_ids jsonb not null default '[]',
  code       text,
  article    text,
  barcodes   jsonb not null default '[]',
  is_weighted boolean not null default false,
  unit       text,
  retail_price numeric,
  stock_qty  numeric,
  stock_at   date,
  department text,
  note       text,
  photos     jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Колонки, добавленные обновлениями 14–15 (на случай старой таблицы)
alter table catalog_products add column if not exists arrival_at  date;   -- дата поступления (обновление 14)
alter table catalog_products add column if not exists description text;   -- описание товара (обновление 15)

create index if not exists idx_products_group on catalog_products(group_id);
create unique index if not exists uq_products_code on catalog_products(code);
create index if not exists idx_products_updated on catalog_products(updated_at);
create index if not exists idx_products_arrival on catalog_products(arrival_at) where arrival_at is not null;

create table if not exists catalog_admins (
  email      text primary key,
  created_at timestamptz not null default now()
);

create table if not exists catalog_roles (
  email      text primary key,
  role       text not null check (role in ('admin','manager','cashier')),
  created_at timestamptz not null default now()
);

create table if not exists catalog_supplier_contacts (
  supplier_id  uuid primary key references catalog_suppliers(id) on delete cascade,
  phone        text,
  contact_name text,
  note         text,
  updated_at   timestamptz not null default now()
);

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

-- История розничной цены (обновление 12)
create table if not exists catalog_retail_history (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references catalog_products(id) on delete cascade,
  retail_price numeric not null,
  changed_at  date not null default current_date,
  created_at  timestamptz not null default now(),
  unique (product_id, changed_at)
);
create index if not exists idx_retail_hist_product on catalog_retail_history(product_id, changed_at desc);

-- Фото от покупателей — очередь на проверку (обновление 13)
create table if not exists catalog_photo_suggestions (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references catalog_products(id) on delete cascade,
  url         text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_photo_sugg_created on catalog_photo_suggestions(created_at desc);

-- Анонимный учёт популярности (обновление 16)
create table if not exists catalog_popularity (
  product_id uuid primary key references catalog_products(id) on delete cascade,
  views      bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists catalog_search_terms (
  term       text primary key,
  hits       bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Индексы поиска (обновление 12)
create extension if not exists pg_trgm;
create index if not exists idx_products_name_trgm on catalog_products using gin (lower(name) gin_trgm_ops);
create index if not exists idx_products_barcodes on catalog_products using gin (barcodes);
create index if not exists idx_products_retail on catalog_products(retail_price) where retail_price is not null;
create index if not exists idx_products_article on catalog_products(article) where article is not null;

-- ── Функции ─────────────────────────────────────────────

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

create or replace function catalog_sales_periods()
returns table (period_from date, period_to date, positions bigint)
language sql stable as $$
  select period_from, period_to, count(*) from catalog_sales
  group by period_from, period_to order by period_to desc, period_from desc;
$$;
revoke all on function catalog_sales_periods() from public, anon;
grant execute on function catalog_sales_periods() to authenticated;

create or replace function catalog_my_role() returns text
language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select role from catalog_roles where email = auth.jwt()->>'email'),
    case when (auth.jwt()->>'email') is not null then 'cashier' end
  );
$$;
revoke all on function catalog_my_role() from public, anon;
grant execute on function catalog_my_role() to authenticated;

create or replace function catalog_is_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select role from catalog_roles where email = auth.jwt()->>'email') = 'admin', false)
      or exists (select 1 from catalog_admins where email = auth.jwt()->>'email');
$$;

create or replace function catalog_can_purchase() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select catalog_my_role() in ('admin','manager');
$$;
revoke all on function catalog_can_purchase() from public, anon;
grant execute on function catalog_can_purchase() to authenticated;

create or replace function catalog_add_photo(p_product_id uuid, p_url text)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if (auth.jwt()->>'email') is null then raise exception 'Только для вошедших'; end if;
  update catalog_products
     set photos = coalesce(photos, '[]'::jsonb) || to_jsonb(p_url), updated_at = now()
   where id = p_product_id;
end $$;
revoke all on function catalog_add_photo(uuid, text) from public, anon;
grant execute on function catalog_add_photo(uuid, text) to authenticated;

create or replace function catalog_suggest_photo(p_product_id uuid, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_url is null or p_url = '' then raise exception 'нет ссылки на фото'; end if;
  if not exists (select 1 from catalog_products where id = p_product_id) then raise exception 'товар не найден'; end if;
  insert into catalog_photo_suggestions (product_id, url) values (p_product_id, p_url);
end $$;
grant execute on function catalog_suggest_photo(uuid, text) to anon, authenticated;

create or replace function catalog_approve_suggestion(p_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare s catalog_photo_suggestions;
begin
  if (auth.jwt()->>'email') is null then raise exception 'только для сотрудников'; end if;
  select * into s from catalog_photo_suggestions where id = p_id;
  if not found then return; end if;
  update catalog_products set photos = coalesce(photos, '[]'::jsonb) || to_jsonb(s.url), updated_at = now() where id = s.product_id;
  delete from catalog_photo_suggestions where id = p_id;
end $$;
revoke all on function catalog_approve_suggestion(uuid) from public, anon;
grant execute on function catalog_approve_suggestion(uuid) to authenticated;

create or replace function catalog_track_view(p_product_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from catalog_products where id = p_product_id) then return; end if;
  insert into catalog_popularity (product_id, views, updated_at) values (p_product_id, 1, now())
  on conflict (product_id) do update set views = catalog_popularity.views + 1, updated_at = now();
end $$;
grant execute on function catalog_track_view(uuid) to anon, authenticated;

create or replace function catalog_track_search(p_term text)
returns void language plpgsql security definer set search_path = public as $$
declare t text;
begin
  t := lower(btrim(coalesce(p_term, '')));
  if length(t) < 2 or length(t) > 60 then return; end if;
  insert into catalog_search_terms (term, hits, updated_at) values (t, 1, now())
  on conflict (term) do update set hits = catalog_search_terms.hits + 1, updated_at = now();
end $$;
grant execute on function catalog_track_search(text) to anon, authenticated;

-- ── Права доступа (RLS): повторный запуск безопасен (сначала снимаем, потом ставим) ──

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
alter table catalog_retail_history    enable row level security;
alter table catalog_photo_suggestions enable row level security;
alter table catalog_popularity        enable row level security;
alter table catalog_search_terms      enable row level security;

drop policy if exists "groups: читать всем" on catalog_groups;
create policy "groups: читать всем" on catalog_groups for select using (true);
drop policy if exists "groups: менять админу" on catalog_groups;
create policy "groups: менять админу" on catalog_groups for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

drop policy if exists "suppliers: читать всем" on catalog_suppliers;
create policy "suppliers: читать всем" on catalog_suppliers for select using (true);
drop policy if exists "suppliers: менять админу" on catalog_suppliers;
create policy "suppliers: менять админу" on catalog_suppliers for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

drop policy if exists "products: читать всем" on catalog_products;
create policy "products: читать всем" on catalog_products for select using (true);
drop policy if exists "products: менять админу" on catalog_products;
create policy "products: менять админу" on catalog_products for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

drop policy if exists "admins: читать вошедшим" on catalog_admins;
create policy "admins: читать вошедшим" on catalog_admins for select to authenticated using (true);

drop policy if exists "roles: читать вошедшим" on catalog_roles;
create policy "roles: читать вошедшим" on catalog_roles for select to authenticated using (true);
drop policy if exists "roles: менять админу" on catalog_roles;
create policy "roles: менять админу" on catalog_roles for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

drop policy if exists "contacts: читать закупки" on catalog_supplier_contacts;
create policy "contacts: читать закупки" on catalog_supplier_contacts for select to authenticated using (catalog_can_purchase());
drop policy if exists "contacts: менять админу" on catalog_supplier_contacts;
create policy "contacts: менять админу" on catalog_supplier_contacts for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

drop policy if exists "prices: читать закупки" on catalog_prices;
create policy "prices: читать закупки" on catalog_prices for select to authenticated using (catalog_can_purchase());
drop policy if exists "prices: менять админу" on catalog_prices;
create policy "prices: менять админу" on catalog_prices for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

drop policy if exists "sales: читать вошедшим" on catalog_sales;
create policy "sales: читать вошедшим" on catalog_sales for select to authenticated using (true);
drop policy if exists "sales: менять админу" on catalog_sales;
create policy "sales: менять админу" on catalog_sales for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

drop policy if exists "competitors: читать" on catalog_competitors;
create policy "competitors: читать" on catalog_competitors for select to authenticated using (true);
drop policy if exists "competitors: добавлять" on catalog_competitors;
create policy "competitors: добавлять" on catalog_competitors for insert to authenticated with check (true);
drop policy if exists "competitors: править" on catalog_competitors;
create policy "competitors: править" on catalog_competitors for update to authenticated using (true) with check (true);
drop policy if exists "competitors: удалять админу" on catalog_competitors;
create policy "competitors: удалять админу" on catalog_competitors for delete to authenticated using (catalog_is_admin());

drop policy if exists "comp_prices: читать" on catalog_competitor_prices;
create policy "comp_prices: читать" on catalog_competitor_prices for select to authenticated using (true);
drop policy if exists "comp_prices: добавлять" on catalog_competitor_prices;
create policy "comp_prices: добавлять" on catalog_competitor_prices for insert to authenticated with check (true);
drop policy if exists "comp_prices: править" on catalog_competitor_prices;
create policy "comp_prices: править" on catalog_competitor_prices for update to authenticated using (true) with check (true);
drop policy if exists "comp_prices: удалять админу" on catalog_competitor_prices;
create policy "comp_prices: удалять админу" on catalog_competitor_prices for delete to authenticated using (catalog_is_admin());

drop policy if exists "retail_hist: читать вошедшим" on catalog_retail_history;
create policy "retail_hist: читать вошедшим" on catalog_retail_history for select to authenticated using (true);
drop policy if exists "retail_hist: менять админу" on catalog_retail_history;
create policy "retail_hist: менять админу" on catalog_retail_history for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

drop policy if exists "sugg: читать вошедшим" on catalog_photo_suggestions;
create policy "sugg: читать вошедшим" on catalog_photo_suggestions for select to authenticated using (true);
drop policy if exists "sugg: разбирать вошедшим" on catalog_photo_suggestions;
create policy "sugg: разбирать вошедшим" on catalog_photo_suggestions for all to authenticated using (true) with check (true);

drop policy if exists "pop: читать всем" on catalog_popularity;
create policy "pop: читать всем" on catalog_popularity for select to anon, authenticated using (true);
drop policy if exists "search: читать всем" on catalog_search_terms;
create policy "search: читать всем" on catalog_search_terms for select to anon, authenticated using (true);

-- ── Хранилище фотографий ────────────────────────────────

insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do nothing;

drop policy if exists "фото: смотреть всем" on storage.objects;
create policy "фото: смотреть всем" on storage.objects for select using (bucket_id = 'product-photos');
drop policy if exists "фото: загружать вошедшим" on storage.objects;
create policy "фото: загружать вошедшим" on storage.objects for insert to authenticated with check (bucket_id = 'product-photos');
drop policy if exists "фото: менять админу" on storage.objects;
create policy "фото: менять админу" on storage.objects for update to authenticated using (bucket_id = 'product-photos' and catalog_is_admin());
drop policy if exists "фото: удалять админу" on storage.objects;
create policy "фото: удалять админу" on storage.objects for delete to authenticated using (bucket_id = 'product-photos' and catalog_is_admin());
drop policy if exists "фото: покупатель предлагает" on storage.objects;
create policy "фото: покупатель предлагает" on storage.objects for insert to anon
  with check (bucket_id = 'product-photos' and (storage.foldername(name))[1] = 'suggestions');

-- ── Стартовые группы товаров — добавятся ТОЛЬКО если таблица групп пуста
--    (на заполненной базе твои группы не трогаются и не дублируются) ──
insert into catalog_groups (name, sort_order)
select v.name, v.sort_order from (values
  ('Хлебобулочные', 1), ('Выпечка и фастфуд', 2), ('Сладости', 3), ('Напитки', 4),
  ('Молочные продукты', 5), ('Бакалея', 6), ('Химия', 7), ('Прочее', 8)
) as v(name, sort_order)
where not exists (select 1 from catalog_groups);
