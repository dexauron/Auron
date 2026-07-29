---
name: auron-supabase-api
description: "Соглашения слоя данных Auron — app/js/api.js поверх self-hosted Supabase (PostgREST). Использовать при написании или ревью запросов к базе, RPC, обработки ошибок, заголовков, пагинации, фильтров. Отражает реальный код api.js и стек self-hosted Supabase на Timeweb. Не путать с catalog/ — у него отдельная база."
---

# Auron — слой данных (api.js поверх self-hosted Supabase)

Backend: **self-hosted Supabase** на Timeweb Cloud (Москва). Стек: PostgreSQL + Auth +
PostgREST + Realtime + Storage. Весь доступ к данным — через один слой `app/js/api.js`.

## Базовые соглашения из реального кода

- База REST: `window.SUPABASE_URL + '/rest/v1'`. Ключ: `window.SUPABASE_ANON_KEY`.
- Заголовки: `apikey`, `Content-Type: application/json`, `Prefer: return=representation`,
  `Authorization: Bearer <AUTH.getToken()>`.
- Ошибка сети → бросать понятное сообщение по-русски: `'Нет соединения с сервером'`.
- Ошибка сервера → брать `json.message || json.hint || json.details || 'Ошибка ' + status`.
- Есть минимальный query-builder `_q(table)` с `.eq/.neq/.gt/.gte/.lte/.ilike/.order/.limit/.offset`
  и `_rpc(fn, args)` для хранимых функций. Использовать их, не плодить свой fetch.

## Изоляция магазинов — RLS по org_id

Каждая таблица (кроме глобальных `users`, `plans`, `permissions`, `notification_templates`,
`feature_flags`) содержит `org_id`. Row-Level Security фильтрует автоматически: пользователь
**физически не прочитает** данные чужого магазина даже прямым запросом. См. skill
`auron-rls-roles`.

- Не полагайся только на фильтр в запросе для изоляции — источник истины это RLS в БД.
- Клиент всё равно передаёт корректный контекст (JWT с org), но защита — на сервере.

## Идемпотентность записи

Операции ввода несут `client_uuid` (unique). Сервер отклоняет дубликат — защита от двойного
нажатия и повторной отправки. См. skill `auron-offline-sync`.

## Форматы (API-first, ISO)

- Даты — **ISO 8601**. Суммы — **копейки (bigint)**. ID — **UUID**.
- Кастомные поля сущностей — в JSONB-колонке `custom_fields`; их описание/валидация — в
  `custom_field_definitions`. Не расширять схему ради нового поля — использовать JSONB.

## Границы

- `catalog/` — **отдельное приложение** со своей базой (отдельный проект Supabase Cloud,
  ключи в `catalog/js/config.js`). С кодом и базой Auron НЕ смешивать.
- Не хардкодить то, что по архитектуре живёт в конфиге: справочники, обязательность полей,
  формулы расчётов, состав отчётов, набор виджетов (принцип «конфигурация вместо кода»).

## Чек-лист ревью запроса

- [ ] Идёт через `_req/_q/_rpc`, а не через голый fetch
- [ ] Ошибки перехвачены, сообщение по-русски и человекочитаемое
- [ ] Запись несёт `client_uuid`, если это операция ввода
- [ ] Полагается на RLS для изоляции, а не только на клиентский фильтр
- [ ] Суммы в копейках, даты ISO 8601
- [ ] Не смешивает данные/ключи Auron и catalog/
