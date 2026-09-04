/* Проверка экранов в настоящем браузере.
   Открывает дашборд, загружает выгрузки, проходит по всем экранам,
   прожимает каждую кнопку-фильтр, открывает окна «Подробнее» и следит,
   чтобы нигде не было ошибки и чтобы вредный текст в названиях
   показывался как текст, а не выполнялся.

   Запуск:  node tests/проверка-экранов.mjs "путь/к/папке/Данные_1С_и_Excel"
   Нужен Playwright и Chromium. Если их нет — проверка пропускается.  */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + path.join(HERE, '..', 'Дашборд_ВайМаркет.html');
const CORPUS = process.argv[2] || path.join(HERE, '..', 'Данные_1С_и_Excel');

const SCREENS = ['today', 'suppliers', 'cash', 'dds', 'staff', 'stock', 'orders', 'expiry',
  'losses', 'dead', 'pnl', 'bep', 'abc', 'pricecmp', 'incexp', 'search', 'data', 'settings',
  'pulse', 'findash', 'finbase', 'finpay', 'finreport', 'finday', 'import', 'match', 'recon',
  'confirm', 'terms', 'reconcile', 'conflicts', 'compare', 'markup', 'payroll',
  'manual', 'records', 'debtors', 'sheets', 'check', 'reset',
  'flow', 'problems', 'eaters', 'pace', 'yearago', 'avgcheck', 'calend',
  'groupprofit', 'itemprofit'];

// строка, которая пытается выполниться, если её вставят в страницу как разметку
const BAD = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';

// Playwright бывает установлен рядом, а бывает глобально — берём тот, что найдётся.
// Модуль общий (CommonJS), поэтому нужное лежит либо сразу, либо в .default.
async function loadChromium() {
  for (const where of ['playwright', '/opt/node22/lib/node_modules/playwright/index.js',
    '/usr/lib/node_modules/playwright/index.js']) {
    try {
      const m = await import(where);
      const c = m.chromium || (m.default && m.default.chromium);
      if (c) return c;
    } catch (e) { /* попробуем следующий путь */ }
  }
  return null;
}
const chromium = await loadChromium();
if (!chromium) { console.log('Playwright не установлен — проверка экранов пропущена.'); process.exit(0); }

let failed = 0, passed = 0;
function check(name, ok, got, want) {
  if (ok) { passed++; console.log('  ✅ ' + name + (got !== undefined ? '  → ' + got : '')); }
  else { failed++; console.log('  ❌ ' + name + '  получено: ' + got + ', ожидалось: ' + want); }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
}).catch(() => null);
if (!browser) { console.log('Chromium не найден — проверка экранов пропущена.'); process.exit(0); }

async function open(withFiles) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('ошибка страницы: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('ошибка в консоли: ' + m.text()); });
  page.on('dialog', d => { errs.push('всплыло окно (возможен вредный код): ' + d.message()); d.dismiss(); });
  await page.goto(PAGE);
  await page.waitForTimeout(700);
  if (withFiles && fs.existsSync(CORPUS)) {
    const files = fs.readdirSync(CORPUS).filter(f => /\.(xls|xlsx|csv)$/i.test(f)).map(f => path.join(CORPUS, f));
    if (files.length) {
      await page.setInputFiles('#filesInput', files);
      await page.waitForTimeout(Math.max(8000, files.length * 1200));
    }
  }
  return { page, errs };
}
const walk = async (page, fn) => {
  for (const id of SCREENS) {
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(120);
    if (fn) await fn(id);
  }
};

console.log('Страница: ' + PAGE + '\nВыгрузки: ' + (fs.existsSync(CORPUS) ? CORPUS : 'нет, часть проверок на пустой базе') + '\n');

/* 1. Пустая база: ни один экран не должен падать */
{
  console.log('— Пустая база');
  const { page, errs } = await open(false);
  await walk(page);
  check('все ' + SCREENS.length + ' экранов открываются без ошибок', errs.length === 0,
    errs.length ? errs.slice(0, 3).join(' | ') : 'без ошибок', 'без ошибок');
  await page.close();
  console.log('');
}

/* 2. С данными: каждая кнопка-фильтр на каждом экране */
{
  console.log('— Кнопки-фильтры');
  const { page, errs } = await open(true);
  let clicked = 0, screensWithFilters = 0;
  for (const id of SCREENS) {
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(180);
    const n = await page.evaluate(() => document.querySelectorAll('.chip').length);
    if (n) screensWithFilters++;
    // жмём по очереди неактивные кнопки: список каждый раз перерисовывается
    for (let i = 0; i < Math.min(n, 12); i++) {
      const ok = await page.evaluate(() => {
        const c = document.querySelector('.chip:not(.active)');
        if (!c) return false; c.click(); return true;
      });
      if (!ok) break;
      await page.waitForTimeout(80);
      clicked++;
    }
    await page.evaluate(() => document.querySelectorAll('[data-filter-clear]').forEach(b => b.click()));
    await page.waitForTimeout(100);
  }
  check('фильтры есть на большинстве экранов', screensWithFilters >= 20,
    screensWithFilters + ' из ' + SCREENS.length, '>=20');
  check('нажатие любой кнопки не ломает экран', errs.length === 0 && clicked > 100,
    clicked + ' нажатий, ошибок ' + errs.length, '>100 нажатий, 0 ошибок');
  await page.close();
  console.log('');
}

/* 3. Окна «Подробнее» */
{
  console.log('— Окно «Подробнее»');
  const { page, errs } = await open(true);
  await page.evaluate(() => { const b = document.querySelector('[data-period="all"]'); if (b) b.click(); });
  await page.waitForTimeout(500);
  let opened = 0, broken = 0;
  for (const id of SCREENS) {
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(160);
    const total = await page.evaluate(() => document.querySelectorAll('[data-more]').length);
    for (let i = 0; i < Math.min(2, total); i++) {
      await page.evaluate(k => { const b = document.querySelectorAll('[data-more]')[k]; if (b) b.click(); }, i);
      await page.waitForTimeout(140);
      const r = await page.evaluate(() => {
        const d = document.querySelector('.backdrop .detail');
        return { open: !!d, bad: d ? d.innerHTML.indexOf('Не получилось') >= 0 : false };
      });
      if (r.open) opened++;
      if (r.bad) broken++;
      await page.evaluate(() => { const b = document.querySelector('[data-act="close-sheet"]'); if (b) b.click(); });
      await page.waitForTimeout(80);
      await page.evaluate(v => window.WMUI.go(v), id);
      await page.waitForTimeout(120);
    }
  }
  check('окна открываются', opened > 30, opened + ' окон', '>30');
  check('ни одно окно не собралось с ошибкой', broken === 0, broken, 0);
  check('в консоли чисто', errs.length === 0, errs.length ? errs.slice(0, 2).join(' | ') : 'чисто', 'чисто');
  await page.close();
  console.log('');
}

/* 4. Вредный текст в названиях выводится как текст */
{
  console.log('— Вредный код в названиях');
  const { page, errs } = await open(true);
  await page.evaluate(bad => {
    const S = window.WMStore, d = new Date().toISOString().slice(0, 10);
    S.add('supreg', { name: bad, termDays: 3, aliases: [bad] });
    S.add('dds', { date: d, type: 'Расход', category: bad, method: bad, amount: 100,
      note: bad, cashier: bad, shift: bad });
    S.add('dds', { date: d, type: 'Приход', category: bad, method: bad, amount: 900,
      note: bad, cashier: bad, shift: bad });
    S.add('debtors', { date: d, name: bad, sum: 500, phone: bad });
    S.add('timesheet', { date: d, employee: bad, hours: 12, rate: 100, shift: bad });
    S.add('payouts', { date: d, employee: bad, type: bad, form: bad, amount: 300 });
    S.add('inventory', { date: d, name: bad, accounted: 1, fact: 0, price: 10, reason: bad });
    S.add('expiry', { name: bad, group: bad, qty: 1, price: 10, bestBefore: '2026-12-01' });
    S.add('plans', { due: d, supplier: bad, amount: 100, doc: bad, method: bad });
    window.WMUI.recompute();
  }, BAD);
  await walk(page);
  for (const kind of ['firm', 'category', 'employee', 'debtor', 'method', 'product', 'group', 'shift']) {
    await page.evaluate(([k, bad]) => window.WMDetail.open(k, bad), [kind, BAD.toLowerCase()]);
    await page.waitForTimeout(110);
    await page.evaluate(() => { const b = document.querySelector('[data-act="close-sheet"]'); if (b) b.click(); });
  }
  const pwned = await page.evaluate(() => !!window.__pwned);
  const imgs = await page.evaluate(() => document.querySelectorAll('img[src="x"]').length);
  check('вредный код не выполнился', !pwned, pwned ? 'ВЫПОЛНИЛСЯ' : 'показан как текст', 'показан как текст');
  check('картинка-ловушка не создалась', imgs === 0, imgs, 0);
  check('экраны при этом не сломались', errs.length === 0,
    errs.length ? errs.slice(0, 2).join(' | ') : 'чисто', 'чисто');
  await page.close();
  console.log('');
}

/* 5. Выбранный фильтр не теряется при переходе на другой экран и обратно */
{
  console.log('— Фильтр не теряется');
  const { page } = await open(true);
  await page.evaluate(() => window.WMUI.go('stock'));
  await page.waitForTimeout(400);
  const picked = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.chip')].find(x => x.textContent.indexOf('Закончилось') >= 0);
    if (!c) return null; c.click(); return c.textContent.trim();
  });
  await page.waitForTimeout(400);
  const was = await page.evaluate(() => (document.querySelector('.filter-note') || { textContent: '' }).textContent.trim());
  await page.evaluate(() => window.WMUI.go('abc')); await page.waitForTimeout(250);
  await page.evaluate(() => window.WMUI.go('stock')); await page.waitForTimeout(400);
  const now = await page.evaluate(() => (document.querySelector('.filter-note') || { textContent: '' }).textContent.trim());
  check('фильтр на месте после возврата', !!picked && was === now && !!was, now || 'пусто', was || 'та же строка');
  await page.close();
  console.log('');
}

/* 6. Ввод кассы: три способа оплаты и список выплат из ящика.
      Форма скопирована с Auron Finance, поэтому проверяем именно её:
      Z и факт по наличным, карте и СБП, выплаты строками, деньги в пути. */
{
  console.log('— Касса за смену');
  const { page, errs } = await open(false);
  await page.evaluate(() => window.WMUI.openForm('cashShift'));
  await page.waitForTimeout(300);
  const names = await page.$$eval('.sheet input,.sheet select', els => els.map(e => e.name).filter(Boolean));
  check('в форме есть Z-отчёт и факт по СБП', names.includes('zSbp') && names.includes('fSbp'),
    names.join(', '), 'zSbp и fSbp');
  check('список выплат начинается с одной строки', names.includes('pay_n0') && names.includes('pay_a0'),
    'есть', 'есть');
  await page.click('[data-pairadd="pay"]');
  await page.click('[data-pairadd="pay"]');
  await page.waitForTimeout(150);
  const rowCount = await page.$$eval('.pair-list .pair-row', e => e.length);
  check('кнопка «+ ещё строка» добавляет выплаты', rowCount === 3, rowCount + ' строки', 3);

  const fill = async (n, v) => page.fill('.sheet [name="' + n + '"]', v);
  await fill('date', '2026-09-01');
  await fill('zCash', '10000'); await fill('fCash', '10200');
  await fill('zCard', '50000'); await fill('fCard', '50000');
  await fill('zSbp', '20000'); await fill('fSbp', '20000');
  await fill('pay_n0', 'Такси Ване'); await fill('pay_a0', '300');
  await fill('pay_n1', 'Вода'); await fill('pay_a1', '250*2');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(600);

  const r = await page.evaluate(() => {
    const S = window.WMStore, F = window.WMFin;
    const day = (S.state.dds || []).filter(x => x.date === '2026-09-01');
    return {
      count: day.length,
      sbp: day.filter(x => x.method === 'СБП').length,
      pays: day.filter(x => F.isExpense(x)).map(x => x.category + '=' + x.amount).sort().join(' | '),
      diff: day.filter(x => F.isIncome(x)).reduce((a, x) => a + (x.diff || 0), 0),
      transit: F.inTransit(S.state.dds || [], [], S.settings).sum,
      cash: F.balances(S.state.dds || [], {}).map['Наличные']
    };
  });
  check('смена записалась: 3 прихода и 2 выплаты', r.count === 5, r.count + ' записей', 5);
  check('выручка по СБП попала отдельной строкой', r.sbp === 1, r.sbp, 1);
  check('выплаты записаны по названиям, «250*2» посчиталось',
    r.pays === 'Вода=500 | Такси Ване=300', r.pays, 'Вода=500 | Такси Ване=300');
  check('расхождение по наличным посчиталось', r.diff === 200, r.diff, 200);
  check('наличные в кассе = выручка минус выплаты', r.cash === 9200, r.cash, 9200);
  check('карта и СБП ушли в «деньги в пути»', r.transit === 68600, r.transit, 68600);

  await page.evaluate(() => window.WMUI.go('finpulse'));
  await page.waitForTimeout(500);
  const pulse = await page.textContent('#page');
  check('на Пульте видно СБП и деньги в пути',
    pulse.includes('СБП') && pulse.includes('Деньги в пути'), 'видно', 'видно');
  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' / ') || 'чисто', 'чисто');
  await page.close();
  console.log('');
}

await browser.close();
console.log('Итог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
process.exit(failed ? 1 : 0);
