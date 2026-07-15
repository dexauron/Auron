-- Обновление базы каталога №10 (2026-07-13)
-- Зачем: любой вошедший сотрудник может добавить фото товара (не только админ).
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.

-- загружать фото в хранилище может любой вошедший (был только админ)
drop policy if exists "фото: загружать админу" on storage.objects;
drop policy if exists "фото: загружать вошедшим" on storage.objects;
create policy "фото: загружать вошедшим" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-photos');

-- добавить фото к товару может любой вошедший — через функцию (сам товар
-- правит только админ, а фото дописываем безопасно через security definer)
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
