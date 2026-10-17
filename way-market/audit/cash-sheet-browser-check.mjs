// Браузерная проверка кассового листа (/): новичок, расчёты, состояния, история, настройки, печать, черновик, телефон.
// Только для пустой тестовой базы: сервер запускать с временной папкой данных, не с рабочей.
//   HOME=/tmp/wm LOCALAPPDATA= node way-market/local-app/server.mjs
//   PLAYWRIGHT_FROM=/путь/к/package.json-с-playwright [CHROMIUM=/путь/к/chrome] node way-market/audit/cash-sheet-browser-check.mjs ./shots
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'cash-sheet-shots', URL = process.env.WAY_URL ?? 'http://127.0.0.1:3210/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU' });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push('pageerror ' + e.message));
page.on('console', m => m.type() === 'error' && !/favicon|404/.test(m.text()) && problems.push('console ' + m.text()));
page.on('dialog', d => d.accept());
const text = sel => page.textContent(sel);
const status = () => page.evaluate(() => { const n = document.getElementById('save-state'), r = n.getBoundingClientRect(); return { text: n.textContent, cls: n.className, visible: r.top >= 0 && r.bottom <= innerHeight }; });
const clear = async sel => { await page.click(sel); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); };
const ok = (name) => console.log('✓', name);
await page.goto(URL); await page.waitForSelector('#save:not([disabled])');
assert.deepEqual(await page.evaluate(() => fetch('/api/shifts').then(r => r.json())), [], 'База не пустая: запускайте проверку только на временной тестовой базе');

// 1. Пустой лист: все пропуски у кнопки, первое поле в фокусе, ничего не сохранено.
await page.fill('[name=accountant]', 'Тестовый бухгалтер'); await page.fill('[name=cashier]', 'Тестовый кассир');
await page.click('#save'); await page.waitForTimeout(150);
let s = await status();
assert.equal(s.text, 'Не заполнено строк: 14, начиная с «Наличка». Если суммы не было — впишите 0.');
assert.equal(s.cls, 'error'); assert.ok(s.visible, 'status near save is visible');
assert.equal(await page.evaluate(() => document.activeElement.name), 'cashReport');
assert.equal(await page.getAttribute('[name=lunch]', 'aria-invalid'), 'true');
assert.equal(await text('#report-status'), 'Не заполнено: 14');
assert.deepEqual(await page.evaluate(() => fetch('/api/shifts').then(r => r.json())), []);
await page.screenshot({ path: `${out}/after-desktop-missing.png` });
await page.click('#example'); await clear('[name=lunch]'); await clear('[name=bankReturns]'); await page.click('#save'); await page.waitForTimeout(150);
assert.equal((await status()).text, 'Не заполнено: Обед, Эквайринг · Возвраты. Если суммы не было — впишите 0.'); assert.equal(await page.evaluate(() => document.activeElement.name), 'lunch');
await page.click('#new');
ok('пустой лист: список незаполненного у кнопки, без сохранения');

// 2. Суммы как в документе и Enter как в Excel.
await page.fill('[name=cashReport]', '34 000,50'); await page.keyboard.press('Enter');
assert.equal(await page.evaluate(() => document.activeElement.name), 'cashViaTerminal', 'Enter moves to next row');
assert.equal(await page.inputValue('[name=cashReport]'), '34 000,50');
assert.equal(await page.getAttribute('[name=cashReport]', 'aria-invalid'), null);
await page.keyboard.press('Shift+Enter'); assert.equal(await page.evaluate(() => document.activeElement.name), 'cashReport');
assert.equal(await page.inputValue('[name=cashReport]'), '34000,50', 'raw value while editing');
await page.fill('[name=cashReport]', '34 00'); await page.keyboard.press('Tab');
assert.match(await text('#calculation-errors'), /Наличка: нужны рубли/);
ok('«34 000,50» принимается, «34 00» отклоняется, Enter переходит по строкам');

// 3. Тестовый пример: расчёт как в 0.8.1; Enter в последнем поле не сохраняет.
await page.click('#example'); await page.waitForTimeout(100);
assert.equal(await text('#total-sales'), '89 000,00 ₽');
assert.equal(await text('#report-expected'), '22 500,00 ₽');
assert.equal(await text('#difference'), '−200,00 ₽'); assert.equal(await page.getAttribute('#difference', 'class'), 'negative');
assert.equal(await text('#bank-difference'), '−100,00 ₽');
await page.focus('[name=received]'); await page.keyboard.press('Enter');
assert.equal(await page.evaluate(() => document.activeElement.id), 'save');
assert.deepEqual(await page.evaluate(() => fetch('/api/shifts').then(r => r.json())), [], 'Enter did not save');
await page.screenshot({ path: `${out}/after-desktop-example.png`, fullPage: true });
ok('пример: 89 000 / 22 500 / −200 / −100; Enter не сохраняет');

// 4. Неизвестное ≠ 0: пустой пересчёт и пустое «Био».
await clear('[name=received]'); assert.equal(await text('#difference'), '—'); assert.equal(await page.getAttribute('#difference', 'class'), '');
await clear('[name=bio]'); assert.equal(await text('#bank-difference'), '—'); assert.equal(await text('#report-bankNet'), '—');
await page.fill('[name=received]', '22300'); await page.fill('[name=bio]', '0');
await page.fill('[name=received]', '22 600'); assert.equal(await text('#difference'), '+100,00 ₽'); assert.equal(await page.getAttribute('#difference', 'class'), 'positive');
await page.fill('[name=received]', '22500'); assert.equal(await text('#difference'), '0,00 ₽'); assert.equal(await page.getAttribute('#difference', 'class'), '');
await page.fill('[name=received]', '22300');
await page.focus('[name=suppliers]'); await page.keyboard.press('Tab'); await page.keyboard.type('1500'); assert.equal(await page.inputValue('[name=payroll]'), '1500', 'typing replaces amount after Tab'); await page.fill('[name=payroll]', '1000');
ok('пусто — без нуля, знака и цвета; + зелёный, 0 нейтральный');

// 5. Сохранение и исправление.
await page.click('#save'); await page.waitForTimeout(300);
s = await status(); assert.match(s.text, /^Сохранено · версия 1/); assert.equal(s.cls, 'ok');
assert.equal(await text('#save'), 'Сохранено'); assert.ok(await page.isDisabled('#save')); assert.ok(!(await page.isDisabled('#print')));
assert.ok(await page.isHidden('#revision-fields')); assert.match(await text('#record-text'), /версия 1/);
await page.fill('[name=received]', '22500');
assert.equal(await text('#save'), 'Сохранить исправление'); assert.ok(await page.isVisible('#revision-fields'));
await page.click('#save'); await page.waitForTimeout(150);
s = await status(); assert.equal(s.text, 'Напишите, что исправлено и почему.'); assert.ok(s.visible);
assert.equal(await page.evaluate(() => document.activeElement.name), 'reason');
await page.fill('[name=reason]', 'Пересчитали наличку'); await page.click('#save'); await page.waitForTimeout(300);
assert.match((await status()).text, /^Сохранено · версия 2/);
await page.screenshot({ path: `${out}/after-desktop-saved.png` });
ok('сохранение, исправление только с причиной, версия 2');

// 6. История: подпись расхождения, старая версия только для просмотра.
await page.click('[data-view=history]'); await page.waitForSelector('.history-item');
assert.match(await text('.history-item'), /\d\d\.\d\d\.\d{4} · Тестовый кассир/); assert.match(await text('.history-item .amount-block'), /Расхождение0,00/);
await page.click('.version-list summary'); await page.waitForSelector('.version-list p button');
await page.screenshot({ path: `${out}/after-desktop-history.png` });
await page.click('.version-list p:last-of-type button'); await page.waitForTimeout(200);
assert.match(await text('#record-text'), /версия 1 из 2/); assert.equal(await text('#save'), 'Только просмотр'); assert.ok(await page.isDisabled('#save'));
assert.ok(await page.isDisabled('[name=cashReport]')); assert.ok(!(await page.isDisabled('#print')));
assert.equal(await text('#difference'), '−200,00 ₽');
await page.screenshot({ path: `${out}/after-desktop-readonly.png` });
await page.click('#record-latest'); await page.waitForTimeout(200);
assert.match(await text('#record-text'), /версия 2\./); assert.ok(!(await page.isDisabled('[name=cashReport]')));
ok('история: старая версия только для просмотра, переход к последней');

// 7. Печать берёт сохранённый снимок.
await page.click('#print'); await page.waitForTimeout(100);
assert.match(await text('#print-view'), /Расхождение0,00/); assert.match(await text('#print-view'), /Расхождение эквайринга−100,00/);
await page.emulateMedia({ media: 'print' }); await page.pdf({ path: `${out}/after-print.pdf`, format: 'A4' }); await page.emulateMedia({ media: 'screen' });
ok('печать сохранённой версии');

// 8. Чеки владельца: «Настроить» ведёт к правилу и возвращает к листу; расчёт по выбранному правилу.
await page.click('#new'); await page.click('#example'); await page.fill('[name=owner]', '500');
assert.equal(await text('#report-status'), 'Нужна настройка'); assert.equal(await text('#report-expected'), '—');
await page.click('#save'); await page.waitForTimeout(150);
assert.match((await status()).text, /Чеки владельца: укажите в настройках/);
await page.click('#calculation-errors button'); await page.waitForTimeout(200);
assert.ok(await page.isVisible('#settings-view')); assert.equal(await page.evaluate(() => document.activeElement.name), 'ownerKind');
assert.equal(await page.evaluate(() => document.querySelector('[name=ownerKind]').closest('label').className), 'attention');
await page.screenshot({ path: `${out}/after-desktop-rule.png` });
await page.selectOption('[name=ownerKind]', 'goods-in-cash');
assert.ok(await page.isVisible('#settings-bar'));
await page.click('#settings-save'); await page.waitForTimeout(150);
assert.match(await text('#settings-state'), /Укажите, кто изменяет/);
await page.fill('[name=settingsReason]', 'Чеки владельца — товар в наличной выручке'); await page.click('#settings-save'); await page.waitForTimeout(300);
assert.ok(await page.isVisible('#cash-view')); assert.match((await status()).text, /Настройки сохранены и применены/);
assert.equal(await text('#report-expected'), '22 000,00 ₽'); assert.equal(await text('#report-payouts'), '9 000,00 ₽');
ok('правило «Чеки владельца» из ошибки, возврат к листу, к передаче 22 000');

// 9. Скрытая ненулевая строка учитывается и видна; отключение ненулевой — запрещено.
await page.click('[data-view=settings]');
await page.uncheck('.settings-row[data-id=payroll] [data-key=visible]');
await page.fill('[name=settingsReason]', 'Скрыть ЗП'); await page.click('#settings-save'); await page.waitForTimeout(300);
await page.click('[data-view=cash]');
assert.ok(await page.isHidden('[name=payroll]')); assert.match(await text('#hidden-values'), /Выплата ЗП 1 000,00/);
assert.equal(await text('#report-expected'), '22 000,00 ₽');
await page.click('[data-view=settings]');
await page.uncheck('.settings-row[data-id=payroll] [data-key=enabled]');
await page.fill('[name=settingsReason]', 'Отключить ЗП'); await page.click('#settings-save'); await page.waitForTimeout(300);
assert.match(await text('#settings-state'), /есть сумма/);
await page.click('#settings-reload'); await page.waitForTimeout(200);
ok('скрытая строка с суммой учитывается и перечислена; отключение запрещено');

// 10. Сохранённый лист не меняется от новых настроек.
await page.click('[data-view=history]'); await page.waitForSelector('.history-item');
await page.click('.history-item'); await page.waitForTimeout(200);
assert.ok(await page.isVisible('[name=payroll]'), 'old sheet keeps its own visible rows');
assert.equal(await text('#report-expected'), '22 500,00 ₽');
ok('старый лист со своим снимком настроек');

// 11. Черновик переживает перезагрузку.
await page.click('#new'); await page.fill('[name=cashier]', 'Кассир черновика'); await page.fill('[name=cashReport]', '1 234,50');
await page.reload(); await page.waitForSelector('#notice:not([hidden])');
assert.match(await text('#notice'), /Есть несохранённый лист/);
await page.click('#notice button:first-of-type'); await page.waitForTimeout(200);
assert.equal(await page.inputValue('[name=cashier]'), 'Кассир черновика'); assert.equal(await page.inputValue('[name=cashReport]'), '1 234,50');
assert.match((await status()).text, /Черновик восстановлен/);
await page.click('#new'); await page.waitForTimeout(100);
assert.equal(await page.evaluate(() => localStorage.getItem('way-market:excel-draft')), null);
ok('черновик восстановлен после перезагрузки и удалён при новом листе');

// 12. Старая запись подробного режима открывается в /advanced.html.
const legacy = await page.evaluate(async () => { const { token } = await fetch('/api/session').then(r => r.json());
  const input = { date: '2026-10-16', register: 'Тестовая касса', shiftNo: 'OLD-1', cashier: 'Старый кассир', author: 'Тест', accountant: 'Тест', opening: '0', zCash: '1000', otherIn: '0', retained: '0', claimed: '', received: '1000', zBasisConfirmed: true, payments: [] };
  const r = await fetch('/api/shifts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Way-Token': token }, body: JSON.stringify({ requestId: crypto.randomUUID(), expectedVersion: 0, input }) }); return r.json(); });
await page.click('[data-view=history]'); await page.waitForSelector('.history-item');
await Promise.all([page.waitForURL(/advanced\.html#record=/), page.click('.history-item:has-text("Старый кассир")')]);
await page.waitForTimeout(500); assert.match(await page.textContent('body'), /Открыта сохранённая версия/); assert.ok(await page.evaluate(() => [...document.querySelectorAll('input')].some(i => i.value === 'Старый кассир')));
ok('старая запись открывается в подробном режиме: ' + legacy.id.slice(0, 8));

// 13. Телефон и узкий экран: без горизонтальной прокрутки, панель над вкладками.
for (const [w, h, name] of [[390, 844, 'phone'], [320, 740, 'small'], [820, 1180, 'tablet']]) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'ru-RU' });
  p.on('pageerror', e => problems.push(name + ' ' + e.message));
  await p.goto(URL); await p.waitForSelector('#save:not([disabled])'); await p.click('#example'); await p.waitForTimeout(100);
  const m = await p.evaluate(() => { const a = document.querySelector('.actions').getBoundingClientRect(), nav = document.querySelector('.rail nav').getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth - innerWidth, barBottom: a.bottom, navTop: nav.top, minFont: Math.min(...[...document.querySelectorAll('#cash-view *, .rail nav button')].filter(n => n.offsetParent && n.childNodes.length && [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim())).map(n => parseFloat(getComputedStyle(n).fontSize))) }; });
  assert.equal(m.overflow, 0, name + ' overflow'); if (w < 800) assert.ok(m.barBottom <= m.navTop + 1, name + ' bar above tabs');
  assert.ok(m.minFont >= 12, name + ' min font ' + m.minFont);
  await p.screenshot({ path: `${out}/after-${name}-top.png` });
  await p.screenshot({ path: `${out}/after-${name}-full.png`, fullPage: true });
  await p.click('#save'); await p.waitForTimeout(300);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(100);
  await p.screenshot({ path: `${out}/after-${name}-saved-bottom.png` });
  console.log('✓', name, JSON.stringify(m)); await p.close();
}
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'нет ошибок JS');
await browser.close();
