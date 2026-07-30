# Бесплатные API — справочник для Auron

> Собрано 2026-07-29 из открытых каталогов и официальных источников. Это ориентир, не
> скопированный код. Лимиты «бесплатных тарифов» проверять на сайте — меняются.

## Каталоги «всех» бесплатных API (там их сотни)
- **public-apis/public-apis** — самый большой список, по категориям, с пометкой Auth
  (No Auth / API Key / OAuth). https://github.com/public-apis/public-apis
- **public-api-lists** — 787+ API, 48 категорий, есть поиск + свой JSON.
  https://github.com/public-api-lists/public-api-lists
- **public-apis-no-auth-only** — только те, что вообще без ключа.
  https://github.com/alexandresanlim/public-apis-no-auth-only
- **free-for-dev** — бесплатные тарифы сервисов (хостинг, БД, email, CI и т.п.).
  https://github.com/ripienaar/free-for-dev · сайт https://free-for.dev

## Полезное именно Auron (розница/финансы/РФ)

### Деньги / курсы — бесплатно, без ключа
- **ЦБ РФ** — курсы валют, ключевая ставка, драгметаллы.
  `https://www.cbr-xml-daily.ru/daily_json.js` (JSON) · офиц. `https://www.cbr.ru/development/dws/`
  → **уже подключено** в `app/js/integrations.js` (`Integrations.cbrRates()`).
- **open.er-api.com** — мировые курсы, без ключа (запас/сравнение).

### Проверка контрагентов / компании (ЕГРЮЛ/ЕГРИП) — бесплатный тариф
- **DaData** — компании по ИНН, адреса, реквизиты, справочник валют. Есть бесплатный лимит.
  https://dadata.ru/api/  (нужен ключ — хранить только у владельца, не в коде)
- **API-ФНС** — данные ФНС, ЕГРЮЛ/ЕГРИП, отслеживание изменений. https://api-fns.ru/
- **SpectrumData** — проверка контрагента, есть бесплатная. https://spectrumdata.ru/contragent-api/

### Уведомления / отправка — бесплатно
- **Telegram Bot API** — официально бесплатно. → **уже подключено** (`Integrations.tgSend()`).
- **Web Share API** (браузер) — без ключа. → **уже подключено** (`Integrations.share()`).
- **wa.me / t.me ссылки** — без ключа. → **уже есть** (`Integrations.waLink/tgShareLink`).

### Прочее по мере надобности (в каталогах выше)
- Карты/адреса: **OpenStreetMap Nominatim** (без ключа, вежливые лимиты).
- Штрихкоды/товары: открытые базы (Open Food Facts и т.п.) — качество разное.

## Граница (важно)
НЕ подключаем «бесплатные AI-прокси» и подобные обходные шлюзы из рейтинга
(free-llm-api, sub2api, CLIProxyAPI, GPT_API_free…): это доступ к платным сервисам через
обход чужих лимитов/условий, часто на чужих ключах — риск для приложения о деньгах.
Нужен ИИ — берём официальный API (Anthropic/OpenAI/Яндекс) с ключом владельца.

## Правило подключения (по auron-security-antipatterns)
- Ключи любых сервисов — **только в localStorage владельца или на сервере**, НИКОГДА в коде/репо.
- Кросс-доменные запросы проверять на CORS; graceful-degradation, если сервис недоступен.
