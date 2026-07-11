-- Обновление базы каталога №2 (2026-07-11)
-- Зачем: вход для сотрудников, цены поставщиков с историей, контакты поставщиков,
--        единица продажи (шт/кг/упак) из импорта 1С.
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.
-- ⚠ ВАЖНО: запускать ДО создания аккаунта сотрудников — скрипт записывает
--   всех НЫНЕШНИХ пользователей (то есть владельца) в администраторы.
-- После запуска: Authentication → Users → Add user → email staff@waymarket.ru,
--   пароль = общий пароль магазина, галочка Auto Confirm User.
-- (Для новых установок не нужно — schema.sql уже содержит эти изменения.)

-- единица продажи из 1С: шт / кг / упак…
alter table catalog_products add column if not exists unit text;

-- список администраторов: все, кто зарегистрирован сейчас (владелец)
create table if not exists catalog_admins (
  email      text primary key,
  created_at timestamptz not null default now()
);
insert into catalog_admins (email)
  select email from auth.users where email is not null
  on conflict do nothing;

-- контакты поставщиков — отдельная таблица, чтобы их не видели без входа
create table if not exists catalog_supplier_contacts (
  supplier_id  uuid primary key references catalog_suppliers(id) on delete cascade,
  phone        text,
  contact_name text,
  note         text,
  updated_at   timestamptz not null default now()
);

-- цены поставщиков с историей: одна строка на товар × поставщик × дату
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

-- ── Права доступа ───────────────────────────────────────
-- Было: писать может любой вошедший. Теперь вошедших два (админ и сотрудники),
-- поэтому: читать цены/контакты — всем вошедшим, менять что-либо — только админу.

alter table catalog_admins            enable row level security;
alter table catalog_supplier_contacts enable row level security;
alter table catalog_prices            enable row level security;

drop policy if exists "admins: читать вошедшим" on catalog_admins;
create policy "admins: читать вошедшим"   on catalog_admins            for select to authenticated using (true);
drop policy if exists "contacts: читать вошедшим" on catalog_supplier_contacts;
create policy "contacts: читать вошедшим" on catalog_supplier_contacts for select to authenticated using (true);
drop policy if exists "contacts: менять админу" on catalog_supplier_contacts;
create policy "contacts: менять админу"   on catalog_supplier_contacts for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
drop policy if exists "prices: читать вошедшим" on catalog_prices;
create policy "prices: читать вошедшим"   on catalog_prices            for select to authenticated using (true);
drop policy if exists "prices: менять админу" on catalog_prices;
create policy "prices: менять админу"     on catalog_prices            for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

drop policy if exists "groups: менять админу" on catalog_groups;
create policy "groups: менять админу"    on catalog_groups    for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
drop policy if exists "suppliers: менять админу" on catalog_suppliers;
create policy "suppliers: менять админу" on catalog_suppliers for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());
drop policy if exists "products: менять админу" on catalog_products;
create policy "products: менять админу"  on catalog_products  for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

drop policy if exists "фото: загружать админу" on storage.objects;
create policy "фото: загружать админу" on storage.objects for insert to authenticated with check (bucket_id = 'product-photos' and catalog_is_admin());
drop policy if exists "фото: менять админу" on storage.objects;
create policy "фото: менять админу"    on storage.objects for update to authenticated using (bucket_id = 'product-photos' and catalog_is_admin());
drop policy if exists "фото: удалять админу" on storage.objects;
create policy "фото: удалять админу"   on storage.objects for delete to authenticated using (bucket_id = 'product-photos' and catalog_is_admin());
