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
  supplier_id uuid references catalog_suppliers(id) on delete set null, -- от какого поставщика приходит
  code       text,          -- код кассы
  article    text,          -- артикул
  barcode    text,          -- штрихкод (пусто = штрихкода нет)
  is_weighted boolean not null default false, -- весовой товар
  department text,          -- отдел / секция кассы
  note       text,          -- примечание
  photos     jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_group    on catalog_products(group_id);
create index if not exists idx_products_supplier on catalog_products(supplier_id);

-- ── Права доступа: читать могут все, менять — только вошедший админ ──

alter table catalog_groups    enable row level security;
alter table catalog_suppliers enable row level security;
alter table catalog_products  enable row level security;

create policy "groups: читать всем"        on catalog_groups    for select using (true);
create policy "groups: менять админу"      on catalog_groups    for all    to authenticated using (true) with check (true);
create policy "suppliers: читать всем"     on catalog_suppliers for select using (true);
create policy "suppliers: менять админу"   on catalog_suppliers for all    to authenticated using (true) with check (true);
create policy "products: читать всем"      on catalog_products  for select using (true);
create policy "products: менять админу"    on catalog_products  for all    to authenticated using (true) with check (true);

-- ── Хранилище фотографий ────────────────────────────────

insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do nothing;

create policy "фото: смотреть всем"     on storage.objects for select using (bucket_id = 'product-photos');
create policy "фото: загружать админу"  on storage.objects for insert to authenticated with check (bucket_id = 'product-photos');
create policy "фото: менять админу"     on storage.objects for update to authenticated using (bucket_id = 'product-photos');
create policy "фото: удалять админу"    on storage.objects for delete to authenticated using (bucket_id = 'product-photos');

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
