-- Обновление базы каталога №11 (2026-07-13)
-- Зачем: показывать остатки (количество на складе) из отчёта 1С «Остатки
-- номенклатуры». Плюс дата, на которую актуальны остатки.
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.

alter table catalog_products add column if not exists stock_qty numeric;   -- остаток на складе
alter table catalog_products add column if not exists stock_at  date;      -- на какую дату остаток
