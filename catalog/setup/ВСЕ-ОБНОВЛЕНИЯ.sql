-- ═══════════════════════════════════════════════════════════════
-- Way Market · Каталог — ВСЕ ОБНОВЛЕНИЯ БАЗЫ (2..8) одним файлом
-- ───────────────────────────────────────────────────────────────
-- Как применить: Supabase → SQL Editor → вставить ВЕСЬ текст → Run.
-- Безопасно запускать, даже если часть уже выполнена (идемпотентно).
-- ⚠ Перед запуском впиши свои email в ОБНОВЛЕНИИ-6 и -7 (см. пометки ниже),
--   если они отличаются от заготовок (dexauron@gmail.com / manager@ / staff@).
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════ ОБНОВЛЕНИЕ-2 ═══════════════
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


-- ═══════════════ ОБНОВЛЕНИЕ-3 ═══════════════
-- Обновление базы каталога №3 (2026-07-11, обновлено 2026-07-12)
-- Зачем: продажи из 1С и аналитика «Ходовые товары».
-- Отчёт 1С «Продажи» — агрегированный ЗА ПЕРИОД (в шапке «Период: … - …»),
-- поэтому храним продажи по периодам: товар × период → количество и сумма.
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.
-- ⚠ Сначала должно быть выполнено ОБНОВЛЕНИЕ-2.sql (там список админов и права).
-- (Для новых установок не нужно — schema.sql уже содержит эти изменения.)

-- если таблица осталась от старой версии (по дням, колонка sale_date) —
-- пересоздаём её под периоды (продажи всегда можно загрузить заново из 1С)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'catalog_sales' and column_name = 'sale_date'
  ) then
    drop table catalog_sales cascade;
  end if;
end $$;

-- продажи по периодам: строка на товар × период отчёта
create table if not exists catalog_sales (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references catalog_products(id) on delete cascade,
  period_from date not null,
  period_to   date not null,
  qty         numeric not null default 0,
  amount      numeric,
  created_at  timestamptz not null default now(),
  unique (product_id, period_from, period_to)
);
create index if not exists idx_sales_period  on catalog_sales(period_from, period_to);
create index if not exists idx_sales_product on catalog_sales(product_id);

alter table catalog_sales enable row level security;
drop policy if exists "sales: читать вошедшим" on catalog_sales;
create policy "sales: читать вошедшим" on catalog_sales for select to authenticated using (true);
drop policy if exists "sales: менять админу" on catalog_sales;
create policy "sales: менять админу"   on catalog_sales for all    to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

-- топ товаров за период (сумма по отчётам, попавшим в диапазон) — считает база
create or replace function catalog_top_products(p_from date, p_to date, p_limit int default 300)
returns table (product_id uuid, total_qty numeric, total_amount numeric)
language sql stable as $$
  select product_id, sum(qty) as total_qty, sum(amount) as total_amount
  from catalog_sales
  where period_from >= p_from and period_to <= p_to
  group by product_id
  order by sum(qty) desc
  limit p_limit;
$$;
revoke all on function catalog_top_products(date, date, int) from public, anon;
grant execute on function catalog_top_products(date, date, int) to authenticated;

-- список загруженных периодов (для выбора в «Ходовых товарах»), новые сверху
create or replace function catalog_sales_periods()
returns table (period_from date, period_to date, positions bigint)
language sql stable as $$
  select period_from, period_to, count(*) as positions
  from catalog_sales
  group by period_from, period_to
  order by period_to desc, period_from desc;
$$;
revoke all on function catalog_sales_periods() from public, anon;
grant execute on function catalog_sales_periods() to authenticated;


-- ═══════════════ ОБНОВЛЕНИЕ-4 ═══════════════
-- Обновление базы каталога №4 (2026-07-11)
-- Зачем: (1) экономная история цен — запись только при изменении цены,
--        (2) смена пароля магазина и выход всех устройств сотрудников из приложения.
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.
-- ⚠ Сначала должны быть выполнены ОБНОВЛЕНИЕ-2.sql и ОБНОВЛЕНИЕ-3.sql.
-- (Для новых установок не нужно — schema.sql уже содержит эти изменения.)

-- ── 1. Запись цен только при изменении ──────────────────
-- Иначе ежедневный импорт плодит миллионы одинаковых строк и раздувает базу.
-- Дата у цены = последнее поступление товара у поставщика с этой ценой (из файла 1С).
-- Цена изменилась → новая строка истории; цена та же, поступление свежее → обновляется
-- только дата. Возвращает, сколько строк записано или обновлено.
create or replace function catalog_save_prices(p_rows jsonb)
returns integer
language plpgsql as $$
declare ins integer := 0; upd integer := 0;
begin
  -- цена не изменилась, но поступление свежее → обновляем дату у последней записи
  with incoming as (
    select (r->>'product_id')::uuid   as pid,
           (r->>'supplier_id')::uuid  as sid,
           (r->>'price')::numeric     as price,
           coalesce(nullif(r->>'price_date','')::date, current_date) as d
    from jsonb_array_elements(p_rows) as r
  ),
  latest as (
    select distinct on (cp.product_id, cp.supplier_id)
           cp.id, cp.product_id, cp.supplier_id, cp.price, cp.price_date
    from catalog_prices cp
    join (select distinct pid, sid from incoming) i
      on i.pid = cp.product_id and i.sid = cp.supplier_id
    order by cp.product_id, cp.supplier_id, cp.price_date desc
  )
  update catalog_prices cp
     set price_date = i.d
    from incoming i
    join latest l on l.product_id = i.pid and l.supplier_id = i.sid
   where cp.id = l.id and l.price = i.price and i.d > l.price_date;
  get diagnostics upd = row_count;

  -- новая или изменившаяся цена → новая строка истории
  with incoming as (
    select (r->>'product_id')::uuid   as pid,
           (r->>'supplier_id')::uuid  as sid,
           (r->>'price')::numeric     as price,
           coalesce(nullif(r->>'price_date','')::date, current_date) as d
    from jsonb_array_elements(p_rows) as r
  ),
  latest as (
    select distinct on (cp.product_id, cp.supplier_id)
           cp.product_id, cp.supplier_id, cp.price
    from catalog_prices cp
    join (select distinct pid, sid from incoming) i
      on i.pid = cp.product_id and i.sid = cp.supplier_id
    order by cp.product_id, cp.supplier_id, cp.price_date desc
  )
  insert into catalog_prices (product_id, supplier_id, price, price_date)
  select i.pid, i.sid, i.price, i.d
  from incoming i
  left join latest l on l.product_id = i.pid and l.supplier_id = i.sid
  where l.product_id is null or l.price is distinct from i.price
  on conflict (product_id, supplier_id, price_date) do update set price = excluded.price;
  get diagnostics ins = row_count;

  return ins + upd;
end $$;
revoke all on function catalog_save_prices(jsonb) from public, anon;
grant execute on function catalog_save_prices(jsonb) to authenticated;

-- ── 2. Пароль магазина и выход устройств ────────────────
-- Уволился сотрудник → админ прямо в приложении ставит новый пароль магазина,
-- и все телефоны со старым входом выходят из системы.
create or replace function catalog_set_staff_password(p_password text)
returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare uid uuid;
begin
  if not catalog_is_admin() then
    raise exception 'Менять пароль магазина может только администратор';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Пароль должен быть не короче 6 символов';
  end if;
  select id into uid from auth.users where email = 'staff@waymarket.ru';
  if uid is null then
    raise exception 'Аккаунт сотрудников staff@waymarket.ru ещё не создан';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = uid;
  delete from auth.sessions where user_id = uid; -- все устройства сотрудников выходят
end $$;
revoke all on function catalog_set_staff_password(text) from public, anon;
grant execute on function catalog_set_staff_password(text) to authenticated;

-- Просто выгнать все устройства сотрудников, не меняя пароль
create or replace function catalog_logout_staff()
returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not catalog_is_admin() then
    raise exception 'Только администратор';
  end if;
  select id into uid from auth.users where email = 'staff@waymarket.ru';
  if uid is not null then
    delete from auth.sessions where user_id = uid;
  end if;
end $$;
revoke all on function catalog_logout_staff() from public, anon;
grant execute on function catalog_logout_staff() to authenticated;


-- ═══════════════ ОБНОВЛЕНИЕ-5 ═══════════════
-- Обновление базы каталога №5 (2026-07-12)
-- Зачем: быстрый старт и «докачка» — приложение подтягивает только изменившиеся
--        товары, а не весь каталог заново. Нужен индекс по дате изменения.
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.
-- (Для новых установок не нужно — schema.sql уже содержит этот индекс.)

create index if not exists idx_products_updated on catalog_products(updated_at);


-- ═══════════════ ОБНОВЛЕНИЕ-6 ═══════════════
-- Обновление базы каталога №6 (2026-07-13)
-- Зачем: чинит «в аккаунте администратора не показываются цены».
-- Причина была в том, что при импорте цены записывались только если аккаунт
-- признан администратором. Если email админа не попал в список catalog_admins,
-- цены молча НЕ сохранялись — и потом их никто не видел.
-- Что делает этот скрипт:
--   1) добавляет владельца в администраторы (впиши свой email ниже);
--   2) делает сохранение цен надёжным (пишет от имени базы + понятная ошибка,
--      если вошёл не администратор — больше не будет «тихой потери» цен);
--   3) показывает, сколько цен уже загружено (для проверки).
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.

-- ── 1. Владелец — администратор ───────────────────────────
-- ⚠ ЗАМЕНИ на email, которым ты входишь в каталог как администратор:
insert into catalog_admins (email) values ('dexauron@gmail.com')
  on conflict (email) do nothing;

-- ── 2. Надёжное сохранение цен ────────────────────────────
-- security definer: функция пишет цены от имени базы, поэтому корректный
-- админ всегда сохранит цены. Но внутри — явная проверка: не админ → ошибка.
create or replace function catalog_save_prices(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public, auth as $$
declare ins integer := 0; upd integer := 0;
begin
  if not catalog_is_admin() then
    raise exception 'Сохранять цены может только администратор. Проверь, что твой email есть в списке администраторов (catalog_admins).';
  end if;

  -- цена не изменилась, но поступление свежее → обновляем дату у последней записи
  with incoming as (
    select (r->>'product_id')::uuid   as pid,
           (r->>'supplier_id')::uuid  as sid,
           (r->>'price')::numeric     as price,
           coalesce(nullif(r->>'price_date','')::date, current_date) as d
    from jsonb_array_elements(p_rows) as r
  ),
  latest as (
    select distinct on (cp.product_id, cp.supplier_id)
           cp.id, cp.product_id, cp.supplier_id, cp.price, cp.price_date
    from catalog_prices cp
    join (select distinct pid, sid from incoming) i
      on i.pid = cp.product_id and i.sid = cp.supplier_id
    order by cp.product_id, cp.supplier_id, cp.price_date desc
  )
  update catalog_prices cp
     set price_date = i.d
    from incoming i
    join latest l on l.product_id = i.pid and l.supplier_id = i.sid
   where cp.id = l.id and l.price = i.price and i.d > l.price_date;
  get diagnostics upd = row_count;

  -- новая или изменившаяся цена → новая строка истории
  with incoming as (
    select (r->>'product_id')::uuid   as pid,
           (r->>'supplier_id')::uuid  as sid,
           (r->>'price')::numeric     as price,
           coalesce(nullif(r->>'price_date','')::date, current_date) as d
    from jsonb_array_elements(p_rows) as r
  ),
  latest as (
    select distinct on (cp.product_id, cp.supplier_id)
           cp.product_id, cp.supplier_id, cp.price
    from catalog_prices cp
    join (select distinct pid, sid from incoming) i
      on i.pid = cp.product_id and i.sid = cp.supplier_id
    order by cp.product_id, cp.supplier_id, cp.price_date desc
  )
  insert into catalog_prices (product_id, supplier_id, price, price_date)
  select i.pid, i.sid, i.price, i.d
  from incoming i
  left join latest l on l.product_id = i.pid and l.supplier_id = i.sid
  where l.product_id is null or l.price is distinct from i.price
  on conflict (product_id, supplier_id, price_date) do update set price = excluded.price;
  get diagnostics ins = row_count;

  return ins + upd;
end $$;
revoke all on function catalog_save_prices(jsonb) from public, anon;
grant execute on function catalog_save_prices(jsonb) to authenticated;

-- ── 3. Проверка: что уже есть в базе ──────────────────────
select
  (select count(*) from catalog_prices)                        as всего_цен,
  (select count(distinct product_id) from catalog_prices)      as товаров_с_ценами,
  (select count(*) from catalog_admins)                        as администраторов;


-- ═══════════════ ОБНОВЛЕНИЕ-7 ═══════════════
-- Обновление базы каталога №7 (2026-07-13)
-- Зачем: три роли доступа + розничная цена товара.
--   • Главный админ  — загрузка товара, полный контроль, все цены.
--   • Аналитик (зал) — закупочные и розничные цены, контакты, аналитика; без загрузки.
--   • Кассир         — только товар и розничная цена (без закупочных цен и контактов).
--   • Розничная цена — из файла импорта, видна всем (это цена на полке).
-- Как применить: Supabase → SQL Editor → вставить весь текст → Run.
-- ⚠ Должны быть выполнены ОБНОВЛЕНИЯ 2..6.

-- ── 1. Розничная цена товара ──────────────────────────────
-- Цена, по которой товар продаётся в магазине. Не секрет — видна всем.
alter table catalog_products add column if not exists retail_price numeric;

-- ── 2. Роли аккаунтов ─────────────────────────────────────
create table if not exists catalog_roles (
  email      text primary key,
  role       text not null check (role in ('admin','manager','cashier')),
  created_at timestamptz not null default now()
);
alter table catalog_roles enable row level security;
drop policy if exists "roles: читать вошедшим" on catalog_roles;
create policy "roles: читать вошедшим" on catalog_roles for select to authenticated using (true);
drop policy if exists "roles: менять админу" on catalog_roles;
create policy "roles: менять админу"   on catalog_roles for all to authenticated using (catalog_is_admin()) with check (catalog_is_admin());

-- прежние администраторы становятся ролью admin (обратная совместимость)
insert into catalog_roles (email, role)
  select email, 'admin' from catalog_admins on conflict (email) do nothing;

-- ⚠ ВПИШИ реальные email аккаунтов (создай их в Authentication → Users):
--   главный админ — уже добавлен из списка администраторов.
--   аналитик/зал:
insert into catalog_roles (email, role) values ('manager@waymarket.ru', 'manager')
  on conflict (email) do update set role = excluded.role;
--   кассир (общий аккаунт зала/касс):
insert into catalog_roles (email, role) values ('staff@waymarket.ru', 'cashier')
  on conflict (email) do update set role = excluded.role;

-- ── 3. Функции ролей ──────────────────────────────────────
-- роль текущего пользователя: из таблицы, иначе (любой вошедший) — cashier
create or replace function catalog_my_role() returns text
language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select role from catalog_roles where email = auth.jwt()->>'email'),
    case when (auth.jwt()->>'email') is not null then 'cashier' end
  );
$$;
revoke all on function catalog_my_role() from public, anon;
grant execute on function catalog_my_role() to authenticated;

-- админ = роль admin (или остался в старом списке catalog_admins)
create or replace function catalog_is_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select role from catalog_roles where email = auth.jwt()->>'email') = 'admin', false)
      or exists (select 1 from catalog_admins where email = auth.jwt()->>'email');
$$;

-- кто видит ЗАКУПОЧНЫЕ цены и контакты: главный админ и аналитик
create or replace function catalog_can_purchase() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select catalog_my_role() in ('admin','manager');
$$;
revoke all on function catalog_can_purchase() from public, anon;
grant execute on function catalog_can_purchase() to authenticated;

-- ── 4. Права: закупочные цены и контакты — только админ+аналитик ──
drop policy if exists "prices: читать вошедшим" on catalog_prices;
drop policy if exists "prices: читать закупки"  on catalog_prices;
create policy "prices: читать закупки" on catalog_prices
  for select to authenticated using (catalog_can_purchase());

drop policy if exists "contacts: читать вошедшим" on catalog_supplier_contacts;
drop policy if exists "contacts: читать закупки"  on catalog_supplier_contacts;
create policy "contacts: читать закупки" on catalog_supplier_contacts
  for select to authenticated using (catalog_can_purchase());

-- аналитика (Ходовые товары) — админ и аналитик, не кассиры
create or replace function catalog_top_products(p_from date, p_to date, p_limit int default 300)
returns table (product_id uuid, total_qty numeric, total_amount numeric)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not catalog_can_purchase() then
    raise exception 'Аналитика доступна только администратору и аналитику';
  end if;
  return query
    select s.product_id, sum(s.qty), sum(s.amount)
    from catalog_sales s
    where s.period_from >= p_from and s.period_to <= p_to
    group by s.product_id order by sum(s.qty) desc limit p_limit;
end $$;
revoke all on function catalog_top_products(date, date, int) from public, anon;
grant execute on function catalog_top_products(date, date, int) to authenticated;

-- ── 5. Проверка ───────────────────────────────────────────
select email, role from catalog_roles order by role, email;


-- ═══════════════ ОБНОВЛЕНИЕ-8 ═══════════════
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

