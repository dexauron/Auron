-- Обновление базы каталога №16 (2026-07-18)
-- Зачем: анонимный учёт популярности — какие товары чаще открывают и что ищут.
-- ЛИЧНОСТЬ НЕ СОХРАНЯЕТСЯ: только обезличенные счётчики. Из них строится раздел
-- «Популярное» и подсказки частых запросов.
-- Как применить: Supabase Studio → SQL Editor → вставить весь текст → Run.

-- сколько раз открывали карточку товара
create table if not exists catalog_popularity (
  product_id uuid primary key references catalog_products(id) on delete cascade,
  views      bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table catalog_popularity enable row level security;
-- счётчики популярности видны всем — это не персональные данные
drop policy if exists "pop: читать всем" on catalog_popularity;
create policy "pop: читать всем" on catalog_popularity
  for select to anon, authenticated using (true);

-- обезличенные частые запросы
create table if not exists catalog_search_terms (
  term       text primary key,
  hits       bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table catalog_search_terms enable row level security;
drop policy if exists "search: читать всем" on catalog_search_terms;
create policy "search: читать всем" on catalog_search_terms
  for select to anon, authenticated using (true);

-- открыли карточку товара → +1 к просмотрам (писать можно только через функцию)
create or replace function catalog_track_view(p_product_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from catalog_products where id = p_product_id) then return; end if;
  insert into catalog_popularity (product_id, views, updated_at)
    values (p_product_id, 1, now())
  on conflict (product_id) do update
    set views = catalog_popularity.views + 1, updated_at = now();
end $$;
grant execute on function catalog_track_view(uuid) to anon, authenticated;

-- поисковый запрос → +1 (нормализуем: нижний регистр, без крайних пробелов)
create or replace function catalog_track_search(p_term text)
returns void language plpgsql security definer set search_path = public as $$
declare t text;
begin
  t := lower(btrim(coalesce(p_term, '')));
  if length(t) < 2 or length(t) > 60 then return; end if;
  insert into catalog_search_terms (term, hits, updated_at)
    values (t, 1, now())
  on conflict (term) do update
    set hits = catalog_search_terms.hits + 1, updated_at = now();
end $$;
grant execute on function catalog_track_search(text) to anon, authenticated;
