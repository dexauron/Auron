-- Обновление базы каталога №14 (2026-07-17)
-- Зачем: дата поступления товара (завоза), чтобы фильтровать каталог по
-- произвольному диапазону дат «поступление с … по …». Заполняется импортами:
--   • «Остатки» — датой отчёта; • «Цены поставщиков» — датой поступления из файла;
--   • «Прайс-лист» — датой из шапки файла.
-- Как применить: Supabase Studio → SQL Editor → вставить весь текст → Run.

alter table catalog_products add column if not exists arrival_at date; -- дата последнего поступления
create index if not exists idx_products_arrival on catalog_products(arrival_at) where arrival_at is not null;
