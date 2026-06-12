# 05 — Архитектура

> Статус: 🔄 в работе. Философия, данные, синхронизация, структура кода — утверждены. Интеграции — утверждены.

---

## Философия: Auron — платформа, не приложение

Auron строится как **конструктор с бесконечным потенциалом роста**. Не набор жёстко связанных экранов, а платформа из независимых блоков. Новые возможности добавляются без перестройки старых. Со временем — сторонние разработчики создают свои модули.

### Пять фундаментальных принципов

**1. Модульная архитектура**
Каждая функция — отдельный модуль: Касса, Поставщики, Персонал, Товары, ИИ и т.д.
- Модуль включается/выключается per-store в настройках
- Новый модуль = новый файл/пакет, не изменение существующего кода
- Магазин без сотрудников работает без модуля Персонала — тот просто отключён

```
Активные модули Way Market №1:
☑ Касса       ☑ Поставщики   ☑ Персонал
☑ Накопления  ☑ Товары       ☑ ИИ-ассистент
☐ Лояльность  ☐ Доставка     ☐ Маркетплейс (скоро)
```

**2. Шина событий — все модули общаются через события**
Каждое действие публикует событие в центральную шину. Любой модуль подписывается и реагирует — независимо, без связи друг с другом.

```
shift.closed      → [Аудит] [Уведомление] [ИИ] [Вебхук] [Отчёт]
debt.added        → [Аудит] [Уведомление] [Календарь денег] [Кассовый разрыв]
payment.made      → [Аудит] [Уведомление] [Надёжность поставщика]
order.received    → [Аудит] [Уведомление] [Склад] [Долг поставщика]
```

Добавить новую реакцию на событие = добавить нового слушателя. Старый код не трогается.

**3. Конфигурация вместо кода**
Что отображается, какие поля обязательны, как считается — в конфигурации, не захардкожено.

| Что настраивается | Пример |
|------------------|--------|
| Справочники | Отделы, статьи накоплений, типы расходов |
| Поля сущностей | Обязательные/опциональные поля у поставщика, заказа |
| Правила расчётов | Формула рентабельности, структура Z-отчёта |
| Шаблоны отчётов | Состав дневного/месячного отчёта |
| Виджеты главного экрана | Порядок и набор карточек |

Новый тип данных добавляется через конфиг — не требует деплоя.

**4. Кастомные поля везде**
Каждая сущность (поставщик, сотрудник, заказ, товар) поддерживает произвольные дополнительные поля.

```
Поставщик «Иванов П.»:
  [стандартные поля]
  + Зона доставки: «Север»         ← добавил этот магазин
  + Категория: «Молочка»           ← добавил этот магазин
  + Номер договора: «123/2024»     ← добавил этот магазин
```

Каждый магазин настраивает под себя. Auron хранит без изменения схемы (JSONB в Postgres).

**5. Движок прав — роли как наборы разрешений**
Роль = именованный набор разрешений, не фиксированный экран.

```
Разрешения: view_cash | edit_cash | view_debts | edit_debts |
            view_staff | edit_staff | view_reports | manage_access | ...

Роль «Бухгалтер»    = [view_cash, edit_cash, view_debts, edit_debts, view_staff, ...]
Роль «Администратор» = [view_debts, create_order, view_products, ...]
Роль «Владелец»     = [view_*] — только чтение

Владелец создаёт новую роль «Старший администратор»:
= [view_debts, edit_debts, create_order, view_staff] ← любой набор
```

Новый модуль добавляет свои разрешения в ту же систему — роли расширяются автоматически.

---

### Как это выглядит в будущем — Auron Marketplace

С этим фундаментом через 2-3 года:

```
Магазин «Стиль Обувь» заходит в Auron:
Установленные модули:
  [Стандарт: Касса, Поставщики, Персонал, Финансы]
  [+ Лояльность]   — установлен из маркетплейса
  [+ Размерная сетка] — создан сторонним разработчиком для обуви
  [+ WhatsApp-чат с клиентами] — сторонний модуль
```

Каждый такой модуль:
- Слушает нужные события из шины
- Добавляет свои экраны/виджеты через систему модулей
- Добавляет кастомные поля к нужным сущностям
- Работает изолированно от остальных

---

## Что закладываем с первого дня (обязательно)

| Основа | Зачем нельзя добавить потом |
|--------|---------------------------|
| Feature flags per-user | Без них нельзя включать функции отдельным пользователям |
| Event bus (шина событий) | Переделать потом = переписать половину кода |
| Кастомные поля (JSONB) | Добавить в схему позже = миграция всех данных |
| Система модулей (реестр) | Без реестра модули превращаются в спагетти |
| Движок прав (permissions, не роли) | Роли жёсткие; permissions — гибкие и расширяемые |
| Трекинг каждого события | Данные для ИИ-обучения копятся пассивно с нуля |

---

## Данные

### Изоляция (multi-tenancy)
Каждый магазин — отдельная «организация». Все таблицы содержат колонку `org_id`. Supabase Row-Level Security (RLS) автоматически фильтрует: пользователь физически не может прочитать данные чужого магазина — даже при прямом запросе к API.

```
users          → один профиль на человека
organizations  → один магазин = одна организация
org_members    → пользователь ↔ организация ↔ роль (многие ко многим)
               (один человек может работать в нескольких магазинах)
```

### Три фундаментальных принципа профессиональной финансовой БД

**1. Двойная запись (double-entry bookkeeping)**
Каждая операция создаёт две строки: дебет одного счёта и кредит другого. Сумма всегда равна нулю — математическая невозможность потери денег или ошибки в балансе. Стандарт с 15 века, используется всеми банками и 1С.

**2. Неизменяемый реестр**
Финансовые проводки не удаляются и не редактируются никогда. Ошибка исправляется обратной проводкой (сторно). В истории видна и ошибка, и исправление. Юридически чисто.

**3. Закрытые фискальные периоды**
После закрытия месяца ни одна запись этого периода не меняется — даже администратором. Налоговая приходит через 3 года — данные те же.

---

### Схема таблиц (56 таблиц, 11 доменов)

> `id` = UUID везде. `org_id` = UUID на каждой строке (RLS-изоляция по магазину).
> Суммы = bigint в копейках. `→` = внешний ключ.

---

#### Домен 1: Идентификация и доступ (7 таблиц)

**`users`** — профили (глобальная таблица, без org_id)
```
id · phone(unique) · name · avatar_url · created_at · last_seen_at
```

**`organizations`** — магазины и бизнесы
```
id · owner_id→users · name · slug(unique) · settings(JSONB) · created_at
```
`settings`: метод накоплений, логика ночной смены, целевая рентабельность, часовой пояс.

**`org_members`** — кто в каком магазине с какой ролью
```
id · org_id · user_id→users · role_id→roles
   · status(active|suspended|invited) · invited_at · joined_at
```

**`roles`** — роли (не enum, а таблица → можно создавать свои)
```
id · org_id · name · is_system(bool) · created_at
```
Системные: owner, accountant, admin, staff. Пользователь создаёт свои: «Старший кассир», «Управляющий».

**`permissions`** — реестр всех разрешений системы
```
id · key(unique) · module · description
```
Пример: `key = 'shift.close'`, `module = 'kassa'`.

**`role_permissions`** — роль ↔ разрешение (many-to-many)
```
role_id→roles · permission_id→permissions   [составной PK]
```

**`invitations`** — приглашения по ссылке
```
id · org_id · phone · role_id→roles · token(unique)
   · expires_at · accepted_at · created_by→users
```

---

#### Домен 2: Безопасность и интеграции (4 таблицы)

**`sessions`** — активные сессии
```
id · user_id→users · device_name · device_type(mobile|desktop|tablet)
   · ip · last_seen_at · expires_at
```

**`api_keys`** — ключи для внешних интеграций
```
id · org_id · name · key_hash · permissions(JSONB)
   · last_used_at · expires_at · revoked_at · created_by→users
```

**`webhook_endpoints`** — куда слать вебхуки
```
id · org_id · url · events(JSONB) · secret_hash · is_active · created_at
```

**`webhook_deliveries`** — лог каждой отправки
```
id · endpoint_id→webhook_endpoints · event_type · payload(JSONB)
   · status(pending|success|failed) · attempts
   · last_attempt_at · response_code · response_body
```

---

#### Домен 3: Подписки и биллинг (5 таблиц)

**`plans`** — тарифы
```
id · name · code(unique) · price_kopecks · billing_period(month|year)
   · features(JSONB) · is_active
```

**`subscriptions`** — активная подписка организации
```
id · org_id · plan_id→plans
   · status(trialing|active|past_due|cancelled)
   · trial_ends_at · current_period_start · current_period_end · cancelled_at
```

**`subscription_items`** — модули/пакеты внутри подписки
```
id · subscription_id→subscriptions · module_key · quantity · price_kopecks
```

**`invoices`** — счета на оплату Auron
```
id · org_id · subscription_id→subscriptions · amount_kopecks
   · status(draft|open|paid|void) · due_date · paid_at · pdf_url
```

**`usage_records`** — потребление для биллинга
```
id · org_id · metric(stores|ai_requests|sms|…)
   · quantity · period_start · period_end
```

---

#### Домен 4: Финансовое ядро — двойная запись (5 таблиц)

**`chart_of_accounts`** — план счетов
```
id · org_id · code · name
   · type(asset|liability|equity|income|expense)
   · parent_id→self · is_system · created_at
```
Примеры: «1000 Касса» (asset), «4000 Выручка» (income), «5100 Закупки» (expense).

**`fiscal_periods`** — фискальные периоды (месяцы)
```
id · org_id · year · month
   · status(open|closed|locked)
   · closed_at · closed_by→users
```
`locked` = нельзя менять даже администратору.

**`journal_entries`** — проводки (неизменяемые)
```
id · org_id · entry_date · description
   · ref_type(transaction|shift|adjustment|salary|…) · ref_id
   · fiscal_period_id→fiscal_periods
   · is_reversal(bool) · reversal_of→self
   · created_at · created_by→users
```

**`journal_lines`** — строки каждой проводки
```
id · entry_id→journal_entries
   · account_id→chart_of_accounts
   · debit_kopecks · credit_kopecks · memo
```
Правило: сумма всех `debit_kopecks` = сумма всех `credit_kopecks` в одной проводке.

**`transactions`** — бизнес-уровень (что видит пользователь)
```
id · org_id · client_uuid(unique)
   · type(income|expense|transfer|adjustment)
   · amount_kopecks
   · from_account_id→accounts · to_account_id→accounts
   · category_id→categories · employee_id→employees · shift_id→shifts
   · journal_entry_id→journal_entries
   · comment · transaction_date · transaction_time
   · is_locked · created_at · created_by→users · custom_fields(JSONB)
```
`client_uuid` — генерируется на клиенте, сервер отклоняет дубликат (защита от двойного нажатия).

---

#### Домен 5: Счета и банк (5 таблиц)

**`accounts`** — кассы, банки, резервы
```
id · org_id · name · type(cash|bank|reserve|card)
   · icon · color · currency(RUB) · is_active · sort_order · created_at
```

**`account_balance_snapshots`** — снимок баланса на конец дня
```
id · account_id→accounts · snapshot_date · balance_kopecks · created_at
```
Позволяет мгновенно получить баланс на любую дату без пересчёта транзакций.

**`bank_connections`** — OAuth-подключения к банкам
```
id · org_id · bank_name · access_token_enc · refresh_token_enc
   · expires_at · status(active|expired|error)
   · connected_at · connected_by→users
```

**`bank_statement_lines`** — строки банковской выписки
```
id · connection_id→bank_connections · external_id(unique)
   · transaction_date · amount_kopecks · description · counterparty
   · reconciled_transaction_id→transactions
```

**`reconciliation_sessions`** — процедура сверки банка
```
id · org_id · account_id→accounts
   · period_start · period_end
   · status(in_progress|completed)
   · opened_at · completed_at · opened_by→users
```

---

#### Домен 6: Категории и планирование (5 таблиц)

**`categories`** — статьи доходов и расходов
```
id · org_id · name · type(income|expense|any)
   · icon · color · is_system · parent_id→self · sort_order · created_at
```

**`category_rules`** — автокатегоризация по ключевым словам
```
id · org_id · keyword · category_id→categories · priority · created_at
```
«Иванов» в комментарии → автоматически ставит категорию «Закупка».

**`budgets`** — плановые лимиты по категориям
```
id · org_id · name · category_id→categories
   · amount_kopecks · period_type(month|quarter|year) · is_active · created_at
```

**`budget_allocations`** — факт vs план по периодам
```
id · budget_id→budgets · period_start · period_end
   · planned_kopecks · actual_kopecks
```

**`goals`** — цели и накопления
```
id · org_id · name · target_kopecks · current_kopecks
   · deadline · account_id→accounts
   · status(active|achieved|cancelled) · created_at
```

---

#### Домен 7: Модуль Розница — Касса и Поставщики (6 таблиц)

**`shifts`** — Z-отчёты / смены
```
id · org_id · shift_date · shift_number(1|2) · cashier_id→employees
   · z_cash_kopecks · z_card_kopecks · z_sbp_kopecks · z_total_kopecks
   · fact_cash_kopecks · fact_card_kopecks · fact_sbp_kopecks · fact_total_kopecks
   · discrepancy_kopecks   ← (факт + выплаты) − Z
   · status(open|closed|cancelled) · notes · created_at · created_by→users
```

**`shift_withdrawals`** — выплаты с кассы (отдельно от смены)
```
id · org_id · shift_id→shifts · name
   · account_id→accounts · amount_kopecks · transaction_id→transactions
```

**`suppliers`** — торговые представители
```
id · org_id · name · reliability_score(0–100)
   · credit_limit_kopecks · payment_schedule_days
   · status(active|inactive) · notes
   · custom_fields(JSONB) · created_at
```

**`supplier_contacts`** — контакты поставщика (несколько на одного ТП)
```
id · supplier_id→suppliers · name · role · phone · whatsapp · is_primary · created_at
```

**`debt_entries`** — операции по долгам поставщика
```
id · org_id · supplier_id→suppliers
   · type(initial|purchase|payment|return|adjustment)
   · amount_kopecks   ← >0 долг растёт, <0 долг падает
   · account_id→accounts · invoice_url · operation_date
   · journal_entry_id→journal_entries
   · status(active|cancelled) · comment · created_at · created_by→users
```

**`purchase_orders`** — заявки на поставку
```
id · org_id · supplier_id→suppliers · expected_date
   · status(planned|received|cancelled)
   · total_kopecks · notes · created_at · created_by→users
```

---

#### Домен 8: Модуль Товары (4 таблицы)

**`product_categories`** — группы товаров
```
id · org_id · name · parent_id→self · created_at
```

**`products`** — товарная номенклатура
```
id · org_id · name · sku · barcode
   · category_id→product_categories
   · cost_kopecks · price_kopecks · unit
   · is_active · custom_fields(JSONB) · created_at
```

**`inventory_movements`** — каждое движение товара
```
id · org_id · product_id→products
   · type(receipt|sale|write_off|adjustment)
   · quantity · cost_kopecks
   · ref_type · ref_id   ← ссылка на документ-основание
   · movement_date · created_at · created_by→users
```

**`inventory_snapshots`** — остатки на конец дня
```
id · org_id · product_id→products
   · snapshot_date · quantity · cost_kopecks
```

---

#### Домен 9: Модуль Персонал (4 таблицы)

**`employees`** — сотрудники
```
id · org_id · name · phone
   · schedule_type(5/2|2/2|3/3|custom) · schedule_config(JSONB)
   · status(active|fired) · hire_date · fire_date
   · user_id→users   ← если есть доступ в приложение
   · custom_fields(JSONB) · created_at
```

**`employee_contracts`** — история условий работы
```
id · employee_id→employees
   · salary_type(fixed|hourly|percent) · rate_kopecks
   · start_date · end_date · notes
```

**`timesheet_entries`** — табель по дням
```
id · org_id · employee_id→employees · work_date
   · status(worked|half_day|day_off|sick|absent|vacation)
   · coefficient(0.00–1.00)   ← 0.75 для нестандартных случаев
   · confirmed · confirmed_by→users · note · created_at
```

**`salary_calculations`** — расчёт зарплаты (документ, не просто запись)
```
id · org_id · employee_id→employees
   · period_start · period_end
   · gross_kopecks · deductions_kopecks · net_kopecks
   · status(draft|approved|paid) · paid_at
   · transaction_id→transactions · created_at · created_by→users
```

---

#### Домен 10: Уведомления, задачи и файлы (6 таблиц)

**`notification_templates`** — шаблоны сообщений
```
id · key(unique) · module · title_template · body_template
   · variables(JSONB) · created_at
```

**`notifications`** — сгенерированные уведомления
```
id · org_id · user_id→users · template_id→notification_templates
   · data(JSONB) · read_at · created_at
```

**`notification_deliveries`** — статус доставки по каналам
```
id · notification_id→notifications
   · channel(push|telegram|whatsapp|sms|email)
   · status(pending|sent|failed) · sent_at · error
```

**`tasks`** — задачи с дедлайном и исполнителем
```
id · org_id · title · body · assignee_id→users · created_by→users
   · due_at · remind_at · status(open|done|cancelled) · done_at
   · ref_type · ref_id   ← опциональная ссылка на сущность
   · created_at
```

**`files`** — метаданные файлов (чеки, накладные, документы)
```
id · org_id · name · size_bytes · mime_type
   · storage_url · hash · uploaded_by→users · created_at
```

**`file_links`** — полиморфная привязка файла к любой сущности
```
id · file_id→files · entity_type(transaction|debt|shift|supplier|…) · entity_id
```

---

#### Домен 11: ИИ, платформа и аудит (5 таблиц)

**`feature_flags`** — флаги функций (включить/выключить без деплоя)
```
id · key(unique) · description · default_value(bool) · module · created_at
```

**`user_feature_flags`** — переопределение флага для конкретного аккаунта
```
user_id→users · org_id · flag_key→feature_flags · value(bool)
   · set_by→users · set_at   [составной PK]
```

**`analytics_events`** — каждое действие пользователя
```
id · org_id · user_id→users · event_name · properties(JSONB)
   · screen · session_id · created_at
```

**`ai_insights`** — инсайты от ИИ
```
id · org_id · type(anomaly|trend|prediction|advice)
   · title · body · data(JSONB) · confidence(0.0–1.0)
   · status(new|read|dismissed) · created_at
```

**`ai_feedback`** — реакция пользователя на инсайт
```
id · insight_id→ai_insights · user_id→users
   · rating(useful|not_useful) · comment · created_at
```

**`audit_log`** — полный снимок ДО и ПОСЛЕ каждого изменения
```
id · org_id · user_id→users · table_name · entity_id
   · action(insert|update) · old_data(JSONB) · new_data(JSONB) · created_at
```

**`data_exports`** — запросы на экспорт данных
```
id · org_id · requested_by→users
   · type(full|transactions|staff|…)
   · status(pending|ready|failed) · file_url · expires_at · created_at
```

---

### Правила хранения данных

**Точность:** все суммы в **копейках** (bigint). Деление на 100 — только при отображении.

**Неизменяемость финансов:** проводки в `journal_entries` и `journal_lines` не редактируются и не удаляются никогда. Ошибка исправляется обратной проводкой (`is_reversal = true`).

**Кастомные поля:** JSONB-колонка `custom_fields` на сущностях + описание полей в `roles` через `custom_fields_meta` (отдельная таблица при необходимости).

**Бессрочное хранение:** данные не удаляются автоматически. `status = cancelled` вместо физического удаления для бизнес-объектов. `audit_log` — вечный.

---

## Синхронизация и офлайн

### Офлайн-режим: только просмотр
Если интернет пропал — приложение продолжает работать в режиме чтения. Данные, загруженные до обрыва, доступны. Запись новых операций заблокирована с понятным сообщением.

```
┌────────────────────────────────────────────┐
│  ⚠️  Нет соединения                        │
│  Данные на 14:32 — просмотр доступен       │
│  Ввод операций будет доступен при           │
│  восстановлении сети                       │
└────────────────────────────────────────────┘
```

**Реализация:** Service Worker кэширует последние загруженные данные. Стратегия stale-while-revalidate — при открытии сразу показываем кэш, в фоне обновляем.

### Реальное время: 3+ человека в одном магазине
Когда кассир вводит операцию — бухгалтер и владелец видят изменения без перезагрузки страницы. Supabase Realtime (WebSocket) отправляет событие всем подключённым устройствам организации.

```
Кассир вводит расход ₽15 000
   ↓ мгновенно (оптимистичный UI)
   ↓ сохраняется на сервере
   ↓ Supabase Realtime → WebSocket
Бухгалтер видит новую операцию в Журнале (без перезагрузки)
Владелец видит обновлённый баланс на Главной
```

### Разрешение конфликтов
Конфликты практически исключены: офлайн = только чтение, значит одновременная запись в одну запись невозможна. Если всё же два устройства записали разное — побеждает более поздняя по timestamp (last-write-wins). Для финансовых операций это приемлемо.

---

## Структура кода

### v1: Монолит с внутренними модулями
Один HTML-файл (`app/index.html`) с чётким разделением внутри:

```
app/
  index.html          ← точка входа, HTML-каркас
  js/
    api.js            ← все запросы к Supabase (один слой)
    auth.js           ← авторизация
    state.js          ← глобальный стейт приложения
    router.js         ← SPA-навигация между вкладками
    modules/
      home.js         ← Главная
      kassa.js        ← Касса / Z-отчёт
      journal.js      ← Журнал
      analytics.js    ← Аналитика
      settings.js     ← Настройки
  sw.js               ← Service Worker (офлайн-кэш, PWA)
```

Новый модуль = новый файл в `modules/` + регистрация в `router.js`. Существующий код не трогается.

### Когда переходить на сборщик
v1 деплоится напрямую на GitHub Pages без сборки — это сознательное решение: никаких зависимостей, простой деплой. Когда модулей станет много и файлы превысят разумный размер — переходим на Vite. Признак: `js/` папка превысила 15 файлов или суммарно 5 000 строк.

---

## Что переносим из старого кода, что выбрасываем

| Компонент | Решение | Причина |
|-----------|---------|---------|
| Supabase Auth | ✅ Оставляем | Работает, правильная архитектура |
| `app/js/auth.js` | ✅ Оставляем с доработкой | Добавить мультимагазинность |
| `app/js/api.js` | 🔄 Переписываем | Привести в соответствие с новой схемой данных |
| `app/sw.js` | ✅ Оставляем | Обновить только версию кэша (`auron-vNN`) |
| `.github/workflows/deploy.yml` | ✅ Оставляем | Деплой на GitHub Pages работает |
| Весь UI в `index.html` | 🔄 Переписываем | Новая дизайн-система, новая структура экранов |
| Supabase таблицы | 🔄 Мигрируем | Добавить `org_id`, RLS, новые таблицы |

---

## Интеграции — заложить с первого дня

### Принцип: API-first
Всё что делает приложение — доступно через REST API. Любая внешняя система может читать данные и отправлять события через стандартные запросы.

### Что реализовать в архитектуре:
- **REST API** — Supabase PostgREST даёт почти бесплатно, нужно только правильно настроить RLS
- **Webhooks** — при ключевых событиях (смена закрыта, выплата проведена, заказ получен) Auron POST-запросом уведомляет подписанный адрес
- **API-ключи per-organisation** — каждая интеграция получает ключ с нужными правами, отзывается в настройках
- **Стандартный формат** — даты ISO 8601, суммы в копейках, ID как UUID

### Плановые интеграции (по приоритету):

| Интеграция | Что даёт | Приоритет |
|-----------|---------|----------|
| WhatsApp Business API | Автоотправка отчётов, уведомления | 🔴 Первая очередь |
| Telegram Bot API | Уведомления + команды боту | 🔴 Первая очередь |
| 1С | Живая синхронизация вместо Excel-импорта | 🔴 Первая очередь |
| Банки (Тинькофф, Сбер) | Автоимпорт банковских выписок | 🟡 Вторая очередь |
| Кассы (АТОЛ, Штрих-М) | Прямое получение Z-отчётов | 🟡 Вторая очередь |
| МойСклад | Синхронизация остатков | 🟡 Вторая очередь |
| Google / Яндекс Календарь | Выплаты как события | 🟢 Третья очередь |
| ФНС | Отправка отчётности | 🟢 Третья очередь |
| Wildberries / Ozon | Продажи на маркетплейсах | 🟢 Третья очередь |

### Как выглядит для пользователя (раздел Настройки → Интеграции):
```
Интеграции

WhatsApp  [Подключить]   ← вводишь номер, получаешь код
Telegram  [Подключить]   ← открывает бота
1С        [Настроить]    ← вводишь API-ключ 1С
Банк      [Подключить]   ← OAuth авторизация банка
Zapier    [Подключить]   ← открывает Zapier с готовым шаблоном

API-ключ для разработчиков:  sk-auron-xxxx  [Копировать]  [Обновить]
Webhooks:  [+ Добавить адрес]
Email для накладных:  invoice-xxxx@auron.app  [Копировать]
```

---

### Отправка через мессенджеры — три уровня

| Уровень | Способ | Настройка | Автоматика |
|---------|--------|-----------|-----------|
| **Базовый** (работает сразу) | **Web Share API** — браузер показывает системный шейр: WhatsApp, Telegram, Viber, VK, SMS — всё что установлено. Никаких ключей. | Нет | Нет — пользователь жмёт «Отправить» |
| **Полуавтомат** | **wa.me / t.me ссылки** — кнопка открывает нужный чат с готовым текстом. Один тап — сообщение уже набрано | Нет | Нет — пользователь жмёт «Отправить» |
| **Полная автоматика** | **Telegram Bot API** (официальный, бесплатный) — бот сам отправляет отчёт каждый вечер | Подключить бота в настройках | Да — без участия пользователя |
| **Полная автоматика** | **WhatsApp Business API** (официальный Meta) — надёжно, но сложная регистрация | Настройка через Meta Business | Да — без участия пользователя |
| **Полная автоматика** | **Green API** (неофициальный шлюз, популярен в РФ) — работает через SIM-карту в облаке, дешевле | Ввести ключ Green API | Да — без участия пользователя |

**Стратегия:** Web Share API включён по умолчанию — пользователь может делиться отчётом с первого дня без настройки. Автоматическая отправка подключается в настройках как апгрейд.

---

### Дополнительные каналы интеграции

| Канал | Что даёт | Реализация |
|-------|---------|-----------|
| **Zapier / Make** | Владелец без программиста соединяет Auron с 6000+ сервисами | Готовый Zapier App — публикуется в каталоге |
| **Email-to-action** | Переслал накладную → ИИ читает → долг создаётся автоматически | Уникальный адрес per-org: `invoice-{uuid}@auron.app` |
| **Глубокие ссылки** | `auron://suppliers/ivanov` — из WhatsApp/QR открывает нужный экран | Universal Links (iOS) + App Links (Android) |
| **CSV / JSON импорт** | Загрузить данные из любой системы, не только Excel | Стандартные форматы на входе и выходе |
| **SMS-уведомления** | Запасной канал если push не работает | Через SMS.ru / SMSC — платная функция |
| **QR-коды** | Быстрый доступ к карточке поставщика, заказу, отчёту | Генерируется на любом объекте, сканируется стандартной камерой |

### Примеры Zapier-сценариев (без программиста):
- «Каждый вечер копировать итог дня в Google Sheets»
- «При кассовом разрыве — письмо владельцу на Gmail»
- «При новом долге поставщику — запись в Airtable»
- «При получении заказа — уведомление в Slack»
