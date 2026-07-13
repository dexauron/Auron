-- Обновление базы каталога №8 (2026-07-13)
-- Зачем: «разведка цен» — сравнение с другими магазинами.
-- Сотрудник в чужом магазине сканирует штрихкод (или находит товар),
-- выбирает магазин-конкурент (или создаёт новый) и вписывает их розничную
-- цену. В карточке товара видно: наша розничная цена и цены у конкурентов
-- с датой, когда цену внесли. Вести разведку может любой вошедший сотрудник.
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.

-- магазины-конкуренты
create table if not exists catalog_competitors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  note       text,
  created_at timestamptz not null default now()
);

-- цена товара в магазине-конкуренте (одна актуальная на товар × магазин)
create table if not exists catalog_competitor_prices (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references catalog_products(id) on delete cascade,
  competitor_id uuid not null references catalog_competitors(id) on delete cascade,
  price         numeric not null,
  observed_at   date not null default current_date, -- когда внесли/увидели цену
  created_at    timestamptz not null default now(),
  unique (product_id, competitor_id)
);
create index if not exists idx_comp_prices_product on catalog_competitor_prices(product_id);

alter table catalog_competitors       enable row level security;
alter table catalog_competitor_prices enable row level security;

-- читать и вести разведку может любой вошедший сотрудник; удалять — только админ
drop policy if exists "competitors: читать вошедшим" on catalog_competitors;
create policy "competitors: читать вошедшим" on catalog_competitors for select to authenticated using (true);
drop policy if exists "competitors: добавлять вошедшим" on catalog_competitors;
create policy "competitors: добавлять вошедшим" on catalog_competitors for insert to authenticated with check (true);
drop policy if exists "competitors: править вошедшим" on catalog_competitors;
create policy "competitors: править вошедшим" on catalog_competitors for update to authenticated using (true) with check (true);
drop policy if exists "competitors: удалять админу" on catalog_competitors;
create policy "competitors: удалять админу" on catalog_competitors for delete to authenticated using (catalog_is_admin());

drop policy if exists "comp_prices: читать вошедшим" on catalog_competitor_prices;
create policy "comp_prices: читать вошедшим" on catalog_competitor_prices for select to authenticated using (true);
drop policy if exists "comp_prices: вести вошедшим" on catalog_competitor_prices;
create policy "comp_prices: вести вошедшим" on catalog_competitor_prices for insert to authenticated with check (true);
drop policy if exists "comp_prices: править вошедшим" on catalog_competitor_prices;
create policy "comp_prices: править вошедшим" on catalog_competitor_prices for update to authenticated using (true) with check (true);
drop policy if exists "comp_prices: удалять админу" on catalog_competitor_prices;
create policy "comp_prices: удалять админу" on catalog_competitor_prices for delete to authenticated using (catalog_is_admin());
