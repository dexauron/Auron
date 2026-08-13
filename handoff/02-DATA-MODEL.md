# Данные

Одна Google-таблица на магазин. Каждый лист — по сути таблица базы данных.
Ниже — что есть сейчас и как это ложится в нормальную БД.

## Листы

| Лист | Колонки | Смысл |
|---|---|---|
| **БАЗА** | ID, UUID, Дата, Тип, Категория, Сумма, Счёт, Сотрудник, Комментарий, Чек, Z_Ref, Locked, Смена | все денежные операции. Тип: Доход/Расход. Перевод — ДВЕ строки с общим `Z_Ref` |
| **СЧЕТА** | ID, Название, Нач_Баланс, Статус, Иконка, Цвет | касса, карта, СБП. Баланс не хранится — считается по БАЗЕ |
| **СМЕНЫ** | ID, Дата, Смена, Кассир, Rows_JSON, Wyplatas_JSON, Расхождение, Создано | приём кассы: Z-отчёт, выплаты, недостача/излишек |
| **ДОЛГИ** | ID, Представитель, Тип, Сумма, Дата, Счёт, Комментарий, Создано, Накладная, Статус | долги поставщикам. Тип: `zakupka` (+долг) / `oplata` (−долг) |
| **ВЫПЛАТЫ** | ID, Контрагент, Сумма, Комментарий, Дата, Статус, Назначение, Создано, Оплачено, Календарь | план платежей (не факт) |
| **ТОВАРЫ** | Штрихкод, Наименование, Группа, Единица, Поставщик, ЦенаЗакуп, ЦенаРозн, Продано_Кол, Выручка, Прибыль, Остаток_Кол, Остаток_Сумма, Обновлено, Артикул, Код | справочник из 1С, ~16 500 строк |
| **ЦЕНЫ_ИСТ** | Дата, Штрихкод, Наименование, Поставщик, Цена | история закупочных цен, ~22 000 строк |
| **РОЗНИЦА_ИСТ** | Дата, Штрихкод, Наименование, Розничная цена | история цен на полке |
| **ТОВАРЫ_ИСТ** | Дата, Выручка, Прибыль, Продано_Кол, Товаров, Ср_Наценка | дневные снимки для динамики |
| **СПИСАНИЯ** | ID, Дата, Вид, Причина, Наименование, Кол-во, Сумма, Контрагент, Комментарий, Создано, Кто | списания и возвраты поставщику |
| **ТАБЕЛЬ** | Год, Месяц, День, Сотрудник, Приход, Уход, Статус, Часы, Ставка, Комментарий | учёт рабочего времени |
| **КОНТРАГЕНТЫ** | ID, Название, Тип, Телефон, Комментарий, Создано | справочник поставщиков |
| **ЗАКАЗЫ** | ID, Контрагент, Заказано, Ожидается, Сумма, Статус, Комментарий, Создано, Получено, Факт_Сумма | заказы поставщикам |
| **ОБЯЗАТЕЛЬСТВА** | ID, Тип, Название, Сумма, Комментарий, Создано | личные долги/накопления/кредиты |
| **РЕКУРРЕНТНЫЕ** | ID, Название, Категория, Сумма, Счёт, День, Активна, Создано | шаблоны повторяющихся расходов |
| **ЗАМЕТКИ** | Дата, Текст, Обновлено | заметка за день |
| **КОРЗИНА** | как БАЗА + Удалено, Кто удалил | удалённые операции, 30 дней |
| **ДОСТУП** | Email, Роль, Добавлен (+4-я колонка: личные права в JSON) | сотрудники магазина |
| **НАСТРОЙКИ** | Ключ, Значение | всё настраиваемое: категории, смены, кассиры, замок периода, режим накладных |
| **ЖУРНАЛ** | Время, Действие, Детали | что происходило |
| **АУДИТ** | Время, Сущность, ID, Действие, Кто, Детали | кто создал/изменил/удалил конкретную запись |

Плюс отдельная таблица-профиль пользователя: листы **ПРОФИЛЬ** и
**ОРГАНИЗАЦИИ** (какие магазины ему доступны).

## Что важно знать, а не видно из таблицы

1. **Балансы счетов нигде не хранятся.** Считаются перебором БАЗЫ и
   кэшируются. При переносе в БД — либо материализованное представление,
   либо пересчёт по индексу.
2. **Перевод между счетами — две строки** с общим `Z_Ref`. Удалять и
   восстанавливать надо обе, иначе деньги появятся из воздуха.
3. **Долг поставщикам** = сумма по ДОЛГАМ, сгруппированная по
   представителю. Переплата (минус) в общий долг не входит.
4. Есть служебный контрагент `🏪 Магазин — накладные` — на нём лежат
   ручные поправки при сверке долга и старые записи «одной суммой».
5. **Суммы округляются до рубля** при записи. Копейки не хранятся нигде.
6. Даты — настоящие даты Google Таблиц, не строки. При выгрузке в CSV
   следить за часовым поясом.

## Предлагаемая схема для нормальной БД (PostgreSQL)

```sql
-- Организации и люди
create table org        (id uuid pk, name text, owner_id uuid, created_at timestamptz);
create table app_user   (id uuid pk, email citext unique, name text, phone text);
create table membership (org_id uuid, user_id uuid, roles text[],   -- несколько ролей
                         perms text[], suspended bool, edit_free bool,
                         primary key (org_id, user_id));

-- Деньги
create table account    (id uuid pk, org_id uuid, name text, kind text,
                         opening numeric(14,2), status text, icon text, color text);
create table tx         (id uuid pk, org_id uuid, occurred_on date, kind text,      -- income/expense
                         category text, amount numeric(14,2), account_id uuid,
                         employee text, comment text, receipt_url text,
                         transfer_ref uuid, locked bool, shift text,
                         created_by uuid, created_at timestamptz, deleted_at timestamptz);
create index on tx (org_id, occurred_on);

-- Поставщики и долги
create table counterparty (id uuid pk, org_id uuid, name text, kind text, phone text);
create table debt_entry   (id uuid pk, org_id uuid, counterparty_id uuid,
                           kind text,        -- zakupka | oplata
                           amount numeric(14,2), occurred_on date,
                           account_id uuid, comment text, invoice text,
                           created_by uuid, created_at timestamptz);
create index on debt_entry (org_id, counterparty_id);

-- Смены
create table shift  (id uuid pk, org_id uuid, occurred_on date, name text,
                     cashier text, revenue_cash numeric, revenue_cashless jsonb,
                     paid_suppliers numeric, collected numeric, left_in_till numeric,
                     discrepancy numeric, created_by uuid, created_at timestamptz);

-- Товары (из 1С)
create table product     (org_id uuid, barcode text, name text, group_name text,
                          unit text, supplier text, buy numeric, retail numeric,
                          sold_qty numeric, revenue numeric, profit numeric,
                          stock_qty numeric, stock_sum numeric, updated_at date,
                          article text, code text, primary key (org_id, barcode));
create table price_history (org_id uuid, barcode text, supplier text,
                            price numeric, on_date date);

-- Служебное
create table audit  (id bigserial pk, org_id uuid, entity text, entity_id text,
                     action text, actor uuid, detail text, at timestamptz);
create table setting(org_id uuid, key text, value text, primary key (org_id, key));
```

Всё остальное (списания, заказы, выплаты, табель, обязательства,
рекуррентные, заметки) переносится один в один по колонкам из таблицы выше.

## Как выгрузить данные

В приложении: **Отчёт → Экспорт** (CSV с BOM, открывается в Excel).
Для полного переноса проще скачать саму Google-таблицу как `.xlsx` и
разобрать листы — названия колонок совпадают с таблицей выше.
