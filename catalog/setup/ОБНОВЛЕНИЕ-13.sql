-- Обновление базы каталога №13 (2026-07-17)
-- Зачем: покупатели БЕЗ аккаунта могут ПРЕДЛОЖИТЬ фото товара. Фото попадает в
-- очередь на проверку, и только после одобрения сотрудником становится видно
-- всем. Так витрину нельзя испортить чужой/плохой картинкой.
-- Как применить: Supabase Studio → SQL Editor → вставить весь текст → Run.

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
