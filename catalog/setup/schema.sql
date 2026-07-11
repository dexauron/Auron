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
