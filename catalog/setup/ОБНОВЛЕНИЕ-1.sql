-- Обновление базы каталога №1 (2026-07-10)
-- Зачем: несколько штрихкодов и несколько поставщиков у одного товара + импорт из 1С.
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.
-- (Для новых установок не нужно — schema.sql уже содержит эти изменения.)

alter table catalog_products add column if not exists barcodes jsonb not null default '[]';
alter table catalog_products add column if not exists supplier_ids jsonb not null default '[]';

update catalog_products
  set barcodes = to_jsonb(array[barcode])
  where barcode is not null and barcode <> '' and barcodes = '[]'::jsonb;

update catalog_products
  set supplier_ids = to_jsonb(array[supplier_id::text])
  where supplier_id is not null and supplier_ids = '[]'::jsonb;

alter table catalog_products drop column if exists barcode;
alter table catalog_products drop column if exists supplier_id;

create unique index if not exists uq_products_code on catalog_products(code);
