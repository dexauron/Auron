# Auron Finance — Context for AI Reviewers (READ THIS FIRST)

> **Для владельца (RU):** это «вводная» для других ИИ. Дай им ссылку на этот файл
> или вставь его текст ПЕРЕД кодом — тогда ИИ поймёт наш стек и ограничения и не
> будет советовать чужое (React, Tailwind, настоящую БД) или «переизобретать» то,
> что уже сделано. Ключевые файлы для ревью: `webapp/Code.gs`, `webapp/Index.html`, `docs/`.

## What this app is
A finance app for a single grocery store (Way Market, Chechnya/Russia), owned by a
**non-programmer**. It sits **on top of the store's 1C/Штрих-М retail system** (which is
the source of truth for goods, stock, sales — imported via Excel paste). Auron handles
what 1C does poorly: **cash/shifts, blind cash-collection, supplier debts, payments,
money movement, profit/price analytics, and a gentle self-learning advisor.**

## Stack & hard constraints (DO NOT recommend against these)
- **Backend:** Google Apps Script (`Code.gs`, ~5k lines). Server functions called from the
  browser via `google.script.run` (wrapped as `gs(fn,args)` → Promise).
- **Frontend:** ONE single-file SPA `Index.html` (~10k lines), **vanilla JS + inline CSS**.
  No build step, no framework, no npm at runtime.
- **Database:** Google Sheets (rows = records). **Not a relational/transactional DB.**
- **Hosting:** served as a web app at a fixed `/exec` URL; auto-deployed via GitHub Actions (clasp).
- **Primary device:** iPhone/Safari (PWA). iOS/GAS limits apply (no BarcodeDetector on Safari,
  localStorage not persisted inside the Google iframe → critical flags stored server-side).

**Therefore, these are WRONG for us (please don't suggest):**
- React / Vue / Tailwind / component frameworks / shadcn — we are intentionally vanilla single-file.
- A "TransactionManager with rollback" — Sheets are **not transactional**; rollback is fiction here.
  We use a reentrant script lock `_withLock()`.
- Client IP / User-Agent in the audit log — Apps Script **cannot** reliably obtain these.
- Rate limiting — Google already quotas GAS; low value here.
- Indexing / partitioning / archiving for "100k+ rows" — premature for one store; Sheets handles
  our volume. Revisit only at multi-store / backend stage.

## Design language
Design **tokens are CSS variables** (`--brand`, `--surface`, 8px spacing scale, radius 20/14).
Default theme is **light + green accent**; theme/accent are user-switchable. Numbers use tabular
figures (Space Grotesk). Icons are a single line-SVG set (emoji removed from chrome). Motion:
CSS transitions/keyframes, `prefers-reduced-motion` respected, transform/opacity only.

## Roles & permissions (ALREADY IMPLEMENTED — don't reinvent)
Roles: **Владелец / Бухгалтер / Администратор / Сотрудник зала** (deliberately **no "Cashier"** role —
owner's decision for a grocery store).
Permission catalog (6): `finance, kassa, receive, goods, payments, manage`.
- Per-member permissions editable by owner (checkbox screen), stored in sheet `ДОСТУП` (SH_ACCESS).
- Server guards: `_permGuard`, `_finGuard`, `_canManage`, returning `FIN_DENIED` / `MANAGE_DENIED`.
- UI hides what a user lacks: body gets `perm-<key>` classes; elements marked `data-need="X"` are
  hidden by CSS if the class is absent. Bottom tabs, the "+" menu, home widgets and the settings
  tree all filter by permission.
- Audit: sheet `АУДИТ` (who/action/entity/details) + `ЖУРНАЛ` log.
- Permission reads cached via `CacheService`.

## Self-learning ("Мозг")
Statistical per-store learning (no external AI needed):
- Expenses: per-category mean/std (z-score) over 90 days → flags unusual/duplicate expenses;
  learns from owner feedback (`brainLearn` ok/issue → `dismissed`/`catTol`) and a sensitivity setting.
- Revenue: learns typical revenue per weekday → gently notes days far below normal.
- Purchases: learns typical purchase size per supplier → gently notes unusually large ones.
- **Warm-up gate:** judgment-based advice stays HIDDEN until ~180 days of data (`ADVISOR_WARMUP_DAYS`),
  so it doesn't judge on thin data. Factual reminders (low stock, pay-today, cash-gap) work immediately.
- Non-intrusive: advice is a passive home card, never popups.

## The #1 REAL limitation (please focus security review here)
Because data lives in **Google Sheets shared with employees** (`addEditor` on invite), an invited
employee technically has editor access to the underlying spreadsheet and could open it **directly,
bypassing the app's role UI**. The app enforces roles in UI + server function guards, but there is
**no true data isolation** on this architecture. Real isolation requires migrating to a proper
backend (documented in `docs/08-ARCH-OPTIONS.md`). This — not "indexes" or "rollback" — is the
architecture's most important weakness.

## What a genuinely useful review looks like
1. Read the ACTUAL code (`webapp/Code.gs`, `webapp/Index.html`) before advising.
2. Respect the stack: solutions must work in **vanilla JS + Google Apps Script + Sheets**, no build.
3. Fit the user: a non-programmer running ONE grocery store; simplicity > enterprise ceremony.
4. Prioritize: correctness bugs, money math errors, permission leaks, GAS-specific pitfalls,
   iOS/Safari issues, and concrete UX friction — over generic "add microservices/rollback" advice.
5. If you suggest a pattern, say exactly where in our files it applies and why it beats what's there.

## Key files
- `webapp/Code.gs` — backend (all server functions, permission model, self-learning, imports).
- `webapp/Index.html` — entire SPA (screens, widgets, roles UI, design tokens).
- `webapp/tests/*.test.js` — money math + flow tests (run: `node webapp/tests/*.test.js`).
- `docs/` — product vision, decisions log (`DECISIONS.md`), architecture options (`08`), ideas (`07`),
  backend/roadmap (`10`, `11`).

## Roadmap / already decided (don't re-propose as "new")
Telegram bot, 1C integration, multi-tenant supplier/rep portal, in-app messenger + tasks, own
self-hosted AI, and a real backend migration are **already planned** (see `docs/07`, `08`, `10`).
Excluded by owner decision: inventory/revision (1C does it), employee sales ranking (grocery),
price-tag printing (1C), customer debt ledger.
