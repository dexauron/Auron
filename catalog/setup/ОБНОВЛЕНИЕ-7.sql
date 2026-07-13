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
