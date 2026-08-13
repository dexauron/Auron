# 10 — Скилы на будущее (когда перейдём на настоящий backend)

**Статус: 🔮 план. Ставим НЕ сейчас, а на этапе перехода с Google-таблиц на backend (см. `08-ARCH-OPTIONS.md`).**

## Зачем этот документ
Полноценная сборка веб-приложения «под ключ» (React/Next + Node + Postgres + auth + деплой) — это ДРУГОЙ стек, не наш нынешний Apps Script. Такие скилы сейчас поставить можно, но им негде работать — будут висеть мёртвым грузом. Здесь зафиксирован **готовый комплект**, чтобы в нужный момент проверить на инъекции и поставить разом.

## Что стоит СЕЙЧАС (уже установлено)
- Дизайн: `impeccable · emil-design-eng · apple-design · taste-skill`
- Проверка: `webapp-testing` + встроенные `code-review · verify · security-review · simplify`
- Этого набора хватает, пока мы на одном GAS-файле.

## Комплект НА БУДУЩЕЕ (ставить при backend-миграции)

| Этап | Скил / репозиторий | Зачем |
|------|--------------------|-------|
| Фронтенд-фреймворк | `web-artifacts-builder` (офиц.) · fullstack-developer · Jeffallan/claude-skills | React/Next/Tailwind/shadcn компоненты |
| Бэкенд · API | `mcp-builder` (офиц.) · backend-скилы (Express/REST/GraphQL) | Сервер, интеграции (1С, банк) |
| База данных · auth | Supabase / Postgres / Prisma / auth скилы | Настоящая изоляция данных сотрудников (то, что нельзя на общей таблице) |
| Качество | `refactoring-skills` (нужный поднабор: refactor-*, error-handling, data-validation, code-documentation) · code-review-skill | Паттерны, «запахи кода» |
| Деплой | Vercel / Netlify / GitHub Actions скилы | У нас уже есть свой Actions-деплой — адаптируем |

## Правила установки (наш регламент)
1. Тянем ТОЛЬКО из авторских/проверенных репозиториев.
2. Каждый скил — проверка на prompt-injection/эксфильтрацию перед установкой.
3. Копируем только markdown-руководства; node-скрипты/боевой авто-тулинг — не в финансовый репозиторий.
4. Ставим не «всё подряд», а нужный поднабор под конкретную задачу — чтобы дополняли, не мешали.

## Каталоги-склады (искать по мере надобности)
ComposioHQ/awesome-claude-skills · travisvn/awesome-claude-skills · Jeffallan/claude-skills · VoltAgent/awesome-claude-code-subagents.

## Триггер
Открываем этот документ, когда владелец утвердит переход на backend (`08-ARCH-OPTIONS.md`). До этого — не трогаем.
