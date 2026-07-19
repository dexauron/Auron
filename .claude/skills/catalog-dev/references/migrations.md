# Миграции базы каталога (ОБНОВЛЕНИЕ-NN.sql)

Схему базы правит **владелец вручную** в Supabase Studio → SQL Editor. Код сам
базу не мигрирует. Значит, каждое изменение схемы — это новый файл-инструкция,
который владелец скопирует и выполнит.

## Шаги

1. Найди максимальный номер среди `catalog/setup/ОБНОВЛЕНИЕ-*.sql`, создай
   следующий: `catalog/setup/ОБНОВЛЕНИЕ-<N+1>.sql`.
2. Продублируй ТОТ ЖЕ SQL в конец трёх сводных файлов, каждый — со своим
   разделителем-заголовком:
   - `catalog/setup/ВСЕ-ОБНОВЛЕНИЯ.sql`
   - `catalog/setup/НОВАЯ-БАЗА.sql`
   - `catalog/setup/schema.sql`
   Разделитель: `-- ═══════════════ ОБНОВЛЕНИЕ-NN ═══════════════` + короткое
   описание одной строкой.
3. В ответе владельцу напомни: «выполнить `ОБНОВЛЕНИЕ-NN.sql` в Studio».

## Правила SQL

- **Идемпотентность** — файл можно выполнить повторно без ошибок:
  `create table if not exists`, `alter table … add column if not exists`,
  `create or replace function`, `create index if not exists`, и обязательно
  `drop policy if exists "…" on …;` перед `create policy`.
- **RLS**: у новых таблиц включай `enable row level security` и явные политики.
  Обезличенные/витринные данные можно открыть на чтение `anon, authenticated`.
  Внутренние (цены, контакты) — только `authenticated` и по правам.
- **Доступ покупателя (`anon`) на запись — только через функции**
  `security definer` с `set search_path = public` и `grant execute … to anon,
  authenticated`. Напрямую в таблицы `anon` писать не должен.
- Права на «сотруднические» функции отзывай у anon:
  `revoke all on function … from public, anon;` + `grant execute … to
  authenticated;`.

## Шаблон файла

```sql
-- Обновление базы каталога №NN (ГГГГ-ММ-ДД)
-- Зачем: <простыми словами, зачем это владельцу>.
-- Как применить: Supabase Studio → SQL Editor → вставить весь текст → Run.

create table if not exists catalog_example (
  id         uuid primary key default gen_random_uuid(),
  ...
  created_at timestamptz not null default now()
);
alter table catalog_example enable row level security;
drop policy if exists "example: читать всем" on catalog_example;
create policy "example: читать всем" on catalog_example
  for select to anon, authenticated using (true);

create or replace function catalog_do_something(p_arg uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  ...
end $$;
grant execute on function catalog_do_something(uuid) to anon, authenticated;
```

## Клиент должен пережить непринятую миграцию

Пока владелец не выполнил `ОБНОВЛЕНИЕ-NN.sql`, таблиц/функций нет. Новые вызовы
в `app.js` оборачивай так, чтобы ошибка тихо игнорировалась, а приложение
работало как раньше (фича просто «спит»):

```js
async function loadExample() {
  try {
    const { data, error } = await sb.from('catalog_example').select('*');
    if (error) throw error;
    // …используем data…
  } catch (e) { /* база старой версии — фича не показывается */ }
}
```

RPC-вызовы учёта тоже делай «не критичными»:
`sb.rpc('catalog_do_something', args).then(() => {}, () => {});`
