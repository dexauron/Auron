# CODEBASE — карта кода Auron Finance (память о коде)

_Технический справочник по репозиторию: модули, функции, листы-таблицы, модель
данных, ключевые потоки и соглашения. Для будущих сессий и ИИ-ревьюеров.
Продуктовый контекст — в `00-VISION.md`; ограничения стека — в `REVIEW-CONTEXT.md`;
решения — в `DECISIONS.md`. Версия на момент карты: **v4.22.0**._

## Размер и файлы
- `webapp/Code.gs` — бэкенд (Google Apps Script), ~5600 строк, **195 функций**.
- `webapp/Index.html` — весь фронтенд (SPA в одном файле), ~10 300 строк, ванильный JS + inline CSS.
- `webapp/tests/*.test.js` — 105 тестов (money 26 + flows 79), запуск `node webapp/tests/*.test.js`.
- `webapp/appsscript.json` — манифест (scopes: spreadsheets, **drive**, script.storage, send_mail, scriptapp, external_request; webapp executeAs USER_ACCESSING, access ANYONE).
- `.github/workflows/deploy-appsscript.yml` — авто-деплой через clasp при пуше.
- `docs/` — vision, flows, screens, design, architecture, roadmap, ideas, decisions, backlog.

## Модель данных (листы Google Sheets)
Данные пользователя — в его личной таблице `Auron_Profile` (лист ПРОФИЛЬ + ОРГАНИЗАЦИИ),
каждая организация — отдельная таблица `Auron — <Название>` со следующими листами:

| Лист (SH_*) | Имя | Назначение |
|---|---|---|
| SH_BASE | БАЗА | Операции (доход/расход/перевод). Кол: `B_ID,B_UUID,B_DATE,B_TYPE,B_CAT,B_AMT,B_ACC,B_EMP…` (13) |
| SH_ACCOUNTS | СЧЕТА | Счета/кошельки (нач.баланс, статус, иконка, цвет) |
| SH_SHIFTS | СМЕНЫ | Кассовые смены (Z-отчёты, выплаты, расхождение) |
| SH_DEBTS | ДОЛГИ | Закупки/оплаты поставщикам. Кол: `D_ID,D_REP,D_TYPE(zakupka/oplata),D_AMT,D_DATE…` (10) |
| SH_PAYMENTS | ВЫПЛАТЫ | График платежей. Кол: `PY_ID,PY_NAME,PY_AMT,PY_ACC,PY_DUE,PY_STATUS,PY_CAT,PY_CREATED,PY_PAID` |
| SH_ORDERS | ЗАКАЗЫ | Заказы поставщикам. Кол: `O_ID,O_CONTR,O_ORDERED,O_EXPECTED,O_AMT,O_STATUS…` (10) |
| SH_GOODS | ТОВАРЫ | Справочник товаров из 1С. Кол: `G_BARCODE,G_NAME,G_GROUP,G_UNIT,G_SUPPLIER,G_BUY,G_RETAIL,G_SOLDQTY,G_REVENUE,G_PROFIT,G_STOCKQTY,G_STOCKSUM,G_UPDATED,G_ARTICLE,G_CODE` (15) |
| SH_PRICEHIST | ЦЕНЫ_ИСТ | История закупочных цен (дата/штрих/наимен/поставщик/цена) |
| SH_RETAILHIST | РОЗНИЦА_ИСТ | История розничных цен |
| SH_GOODSSNAP | ТОВАРЫ_ИСТ | Дневные снимки продаж (динамика) |
| SH_CONTRACTORS | КОНТРАГЕНТЫ | Справочник (поставщики/ТП): id,название,тип,телефон,коммент |
| SH_TIMESHEET | ТАБЕЛЬ | Табель. Кол: `T_YEAR,T_MON,T_DAY,T_EMP,T_IN,T_OUT…` (10) |
| SH_RECURRING | РЕКУРРЕНТНЫЕ | Ежемесячные расходы (шаблоны) |
| SH_OBLIG | ОБЯЗАТЕЛЬСТВА | Долги/накопления/кредиты (личные) |
| SH_NOTES | ЗАМЕТКИ | Заметки к дню (объясняют пики/провалы) |
| SH_SETTINGS | НАСТРОЙКИ | Ключ→значение (OWNER_EMAIL, BRAIN, WIDGETS, ACL_PROTECTED, ADVISOR_WARMUP_DAYS…) |
| SH_ACCESS | ДОСТУП | Роли/права участников: email,роль,добавлен,perms. **Защищён от прямого редактирования** (только владелец) |
| SH_AUDIT | АУДИТ | Кто/действие/сущность/детали |
| SH_LOG | ЖУРНАЛ | Событийный лог (вкл. «Отказ доступа») |
| SH_TRASH | КОРЗИНА | Удалённые операции (30 дней) |

## Бэкенд: модули (баннеры в Code.gs)
AUTH · SYSTEM · SETTINGS · ACCOUNTS · TRANSACTIONS · IMPORT (1С через Excel-вставку) ·
ТОВАРЫ · Z-REPORT · DEBTS/REPS · TIMESHEET · ANALYTICS · **МОЗГ** (детектор аномалий +
самообучение) · ПУЛЬС · АВТООТЧЁТ · RECURRING · BUDGET · PAYMENTS · SEED/DEMO ·
TEAM/ACCESS · CONTRACTORS · PRO REPORTS · ORDERS · CASH FORECAST · AUTOMATION ·
TEAM ACROSS ORGS · MY PROFILE · CONTRACTOR CARD · DAY NOTES · MISC · OBLIGATIONS.

## Ролевая модель и права
- Роли: **Владелец / Бухгалтер / Администратор / Сотрудник зала** (роли «Кассир» нет).
- Права (PERM_CATALOG, 6): `finance · kassa · receive · goods · payments · manage`.
- По роли: `_rolePerms`; персонально: `_memberPerms` (из ДОСТУП, JSON в 4-й колонке);
  текущий: `_myPerms`/`_hasPerm`. Владелец/неопознанный email → все права (fail-open).
- Владелец: `_isOwner` (сверяет OWNER_EMAIL из НАСТРОЙКИ).
- Серверные гарды: `_finGuard`, `_permGuard`, `_canManage` → `FIN_DENIED`/`MANAGE_DENIED`;
  отказы пишутся в ЖУРНАЛ (`_logDenied`).
- UI: `body` получает классы `perm-<право>`; элементы `data-need="X"` скрыты CSS, если права нет.
  Нижние вкладки, меню «+», виджеты и дерево настроек фильтруются по правам.

## Самообучение («Мозг»)
- Состояние в НАСТРОЙКИ ключ `BRAIN` (sensitivity, catTol, dismissed).
- Аномалии расходов: z-оценка по категории (90 дней), дубли; обучение `brainLearn` (ok/issue).
- Советник `getAdvisor`: факты (заканчивается, оплаты, кассовый разрыв, сезон) + оценочные
  советы (цены, рост закупок, выручка/день, размер закупки у поставщика).
- **Порог созревания** `ADVISOR_WARMUP_DAYS` (по умолч. 180): оценочные советы и «Контроль
  операций» СКРЫТЫ, пока данных мало (`_advisorAgeDays`). Факты работают сразу.

## Фронтенд (Index.html)
- **Вкладки/панели** `#tab-*`: home, kassa, suppliers, analytics, journal, report, settings
  (нижние 4 — настраиваемые под роль: `_navCatalog`/`_navCfg`/`renderNav`).
- **Виджеты главной** (`_homeWidgets`, настраиваемые, свои по ролям `_roleWidgetDefaults`):
  quick, reminders, checklist, ask, restock, season, insight, advisor, savings, pulse, money,
  debts, tax, growth, peaks, topGoods, dead, abc, metrics, trend, suppliers.
  Рендер: `_renderHomeBoard` (агрегатный `getDashboard` + независимые лоадеры `_wX`).
- **Единый объект `App`** со `App.s` (state). Ключевое: `App.can(key)`, `App.s.perms/isOwner/myRole`.
- **Мост к серверу**: `gs(fn,args)` → Promise (сторож 45с, отклоняет на `__error`).
- **Дизайн-токены**: CSS-переменные (`--brand`, 8px-сетка, radius 20/14); тема light+green
  по умолчанию (data-theme/data-accent на `<html>`); линейные SVG-иконки (без эмодзи в chrome).

## Ключевые соглашения
- `_withLock(fn)` — реентрант script-lock (нет транзакций в Sheets).
- Кэш: `CacheService` (cache-and-bust); критические флаги пользователя — в `UserProperties`
  (localStorage в iframe GAS не персистится).
- Деньги: везде **целые рубли** (`Math.round`), копеек нет → float не копится.
- `_gnum` — парсинг чисел из русского формата (пробелы, запятая-разделитель).
- iOS: BarcodeDetector нет в Safari → сканер деградирует в ручной ввод; готов мост `App.onNativeScan`.

## Известное слабое место №1
Модель `addEditor`: приглашённый сотрудник — редактор всей таблицы, может открыть данные
напрямую в Google Sheets, минуя ролевой UI. Митигации: серверные гарды (главная защита),
защита листа ДОСТУП, предупреждение при приглашении, лог отказов. Полная изоляция — только
при переходе на backend (`08-ARCH-OPTIONS.md`).

## Тесты и деплой
- Перед пушем: `node --check` на Code.gs (копия .js), `webapp/tests/*.test.js`, проверка HTML
  (сбалансированность), бамп `APP_VERSION`.
- Деплой: GitHub Actions → clasp push. Лимит Apps Script — 200 версий (см. `webapp/DEPLOY.md`).
