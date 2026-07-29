# STATE — снимок текущего состояния

> Обновлено: 2026-07-29

## Что за проект
**Auron Finance** — универсальная финансовая платформа (от личного бюджета до сети магазинов),
модульная. v1.0 = модуль розницы на примере Way Market. Владелец — не программист, общение
по-русски, простым языком.

## Текущий этап
**Разговор 7 — написание кода.** Все документы `docs/` утверждены. Следующий шаг по
`CLAUDE.md`: переписать `app/index.html` (SPA) + `app/js/api.js` + `app/js/auth.js` по
утверждённой схеме и дизайн-системе.

## Технический контекст (коротко)
- Backend: **self-hosted Supabase** на Timeweb Cloud (Москва, 201.51.6.170). Стек PostgreSQL +
  Auth + PostgREST + Realtime + Storage.
- Фронт: `app/` — SPA в `index.html` (~7000 строк), деплой на GitHub Pages →
  https://dexauron.github.io/Auron/
- `catalog/` — отдельное приложение со своей базой. С Auron не смешивать.
- Две ветки/два приложения, деплой собирает из обеих. Auron → `claude/optimistic-einstein-Afzmv`,
  каталог → `claude/store-product-catalog-60wer4`.

## Ключевые факты «под рукой» (частые грабли)
- Деньги — **копейки (bigint)**, деление на 100 только на экране.
- Финансовый реестр **неизменяем** — только сторно, никаких DELETE/UPDATE по сумме.
- Изоляция магазинов — **RLS по org_id** в БД, не клиентский фильтр.
- Доступ проверяется по **permission-ключу**, не по имени роли. Роли «Кассир» нет.
- Офлайн = **только просмотр**; запись несёт `client_uuid` (идемпотентность).
- Менял фронт → **бампни `auron-vNN`** в `sw.js`.
- На клиенте только **anon-ключ** Supabase, никогда service_role.

## Скилы (состояние)
- Установлено **125 скилов** в `.claude/skills/` (100 по популярности + 9 под стек +
  16 написаны с нуля под Auron). Опись — `.claude/SKILLS-INVENTORY.md`, полный каталог
  найденного — `.claude/SKILLS-CATALOG.md`.
- Профильные под Auron: `auron-offline-sync`, `auron-double-entry`, `auron-supabase-api`,
  `auron-rls-roles`, `auron-pwa-deploy`, `auron-money-format`, `auron-modules`,
  `auron-integrations`, `auron-cloud-backup`, `auron-antipatterns`,
  `auron-security-antipatterns`, `auron-token-economy`, `precise-execution`,
  `auron-web-research`, `auron-account-assist`, `credential-safety`, `auron-memory`.

## Открытая работа
- PR #7 (ветка `claude/github-repo-rankings-ektgst`) — скилы + память + план. Черновик.
- Не начато: собственно код (`api.js` и т.д.) — ждёт отмашки владельца и ветки приложения.
- **План разработки готов: `memory/PLAN.md`** (фазы 0–5, начинать с `api.js`).
- Офлайн-просмотр (уровень 1) сделан и влит в ветку приложения (c249df7): SW отдаёт
  последние данные офлайн + баннер «данные на HH:MM». Кэш v51.
- Офлайн-редактирование (уровень 2) — предложение `memory/PROPOSAL-offline-write.md`, ждёт решения.
- Фиксы кода (SW-кэш + XSS-экранирование) **влиты прямо в ветку приложения**
  `claude/optimistic-einstein-Afzmv` (коммит 2fbe2ba) → деплой пересобирается.
  Осталось критичное: **HTTPS для backend** (серверный шаг владельца) — без него прод
  не свяжется с базой (mixed content).

## Граница, которую держим
Доступ к сайтам/аккаунтам — только законными средствами и к аккаунтам владельца. Инструменты
и инструкции по обходу защиты (капчи, paywall, чужой вход) не создаём даже «для ознакомления».
