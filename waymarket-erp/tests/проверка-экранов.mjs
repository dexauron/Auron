/* Проверка экранов в настоящем браузере.
   Открывает программу, проходит по всем экранам, вводит смену и итоги дня,
   жмёт фильтры, проверяет раскладку на телефоне, планшете и компьютере.

   Запуск:  node tests/проверка-экранов.mjs
   Нужен Playwright и Chromium. Если их нет — проверка пропускается.  */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + path.join(HERE, '..', 'Дашборд_ВайМаркет.html');

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

async function open(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts || {});
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('ошибка страницы: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('ошибка в консоли: ' + m.text()); });
  page.on('dialog', d => { errs.push('всплыло окно: ' + d.message()); d.dismiss(); });
  await page.goto(PAGE);
  await page.waitForTimeout(800);
  return { page, ctx, errs };
}
const screensOf = page => page.evaluate(() =>
  [...document.querySelectorAll('.nav-item')].map(e => e.dataset.go));

console.log('Страница: ' + PAGE + '\n');

/* 1. Пустая база: ни один экран не падает */
{
  console.log('— Пустая база');
  const { page, ctx, errs } = await open();
  const ids = await screensOf(page);
  for (const id of ids) { await page.evaluate(v => window.WMUI.go(v), id); await page.waitForTimeout(110); }
  check('все ' + ids.length + ' экранов открываются', errs.length === 0 && ids.length >= 10,
    errs.slice(0, 3).join(' | ') || ids.join(', '), 'без ошибок');
  check('экранов 1С в меню нет',
    !ids.some(id => ['stock', 'orders', 'expiry', 'losses', 'dead', 'abc', 'pricecmp',
      'incexp', 'import', 'match', 'recon', 'suppliers'].includes(id)),
    'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 2. Полный день магазина: сверка кассы утром, итоги вечером */
{
  console.log('— День магазина');
  const { page, ctx, errs } = await open();
  await page.evaluate(() => {
    window.WMStore.setSetting('openCashStart', 0);
    window.WMStore.setSetting('openDebtStart', 100000);
    window.WMUI.recompute();
  });

  await page.evaluate(() => window.WMUI.openForm('shiftClose'));
  await page.waitForTimeout(350);
  const fill = (n, v) => page.fill('.sheet [name="' + n + '"]', v);
  await fill('date', '2026-09-01');
  await fill('cashier', 'Аня');
  await fill('openCash', '0');
  await fill('zCash', '26467');
  await fill('zCashless', '29743');
  await fill('payouts', '10000');
  await fill('factCash', '16000');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(600);

  const r = await page.evaluate(() => {
    const E = window.WM, S = window.WMStore;
    const sh = (S.state.dds || []).find(x => E.isShift(x));
    const c = E.shiftCalc(sh);
    return { expected: c.expected, diff: c.diff, status: c.status,
      cash: E.cashOnHand(S.state.dds, S.settings), cashless: E.cashlessTotal(S.state.dds) };
  });
  check('расчётный остаток = размен + Z-нал − выплаты', r.expected === 16467, r.expected, 16467);
  check('расхождение = факт − расчётный', r.diff === -467 && r.status === 'недостача', r.diff, -467);
  check('БЕЗНАЛ В КАССУ НЕ ПОПАЛ', r.cash === 16000, 'в ящике ' + r.cash, 16000);
  check('безнал посчитан отдельно', r.cashless === 29743, r.cashless, 29743);

  await page.evaluate(() => window.WMUI.openForm('dayTotals'));
  await page.waitForTimeout(350);
  await fill('date', '2026-09-01');
  await fill('goodsCash', '5000');
  await fill('debtPaid', '3000');
  await fill('debtTaken', '12000');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(600);
  const d = await page.evaluate(() => {
    const E = window.WM, S = window.WMStore;
    return { debt: E.supplierDebt(S.state.dds, S.settings).debt,
      cash: E.cashOnHand(S.state.dds, S.settings) };
  });
  check('долг = начальный + взято − погашено', d.debt === 109000, d.debt, 109000);
  check('ИТОГИ ДНЯ КАССУ НЕ ДВИГАЮТ — двойного счёта нет', d.cash === 16000, d.cash, 16000);

  // вторая смена с разрывом размена
  await page.evaluate(() => {
    window.WMStore.add('dds', { type: 'Смена', date: '2026-09-02', till: 'Касса 1', shift: 'Ночь',
      cashier: 'Пётр', openCash: 6000, zCash: 20000, zCashless: 10000, payouts: 0, factCash: 26000 });
    window.WMStore.save(); window.WMUI.recompute(); window.WMUI.go('pulse');
  });
  await page.waitForTimeout(500);
  const pulse = await page.textContent('#page');
  check('на Пульте видно кассу, долг и кто недосдаёт',
    pulse.includes('Наличные в кассе') && pulse.includes('Долг поставщикам') && pulse.includes('Аня'),
    'видно', 'видно');
  check('программа заметила, что размен не сходится с прошлой сменой',
    pulse.includes('Размен не сходится'), 'заметила', 'заметила');

  await page.evaluate(() => window.WMUI.go('morning'));
  await page.waitForTimeout(400);
  const morn = await page.textContent('#page');
  check('на «Утре» видна недостача', morn.includes('467'), 'видна', 'видна');
  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 3. Кнопки-фильтры на каждом экране */
{
  console.log('— Кнопки-фильтры');
  const { page, ctx, errs } = await open();
  await page.evaluate(() => {
    const S = window.WMStore;
    for (let i = 1; i <= 12; i++) {
      const dd = String(i).padStart(2, '0');
      S.add('dds', { type: 'Смена', date: '2026-09-' + dd, till: 'Касса 1', shift: i % 2 ? 'День' : 'Ночь',
        cashier: i % 3 ? 'Аня' : 'Пётр', openCash: 5000, zCash: 20000 + i * 100,
        zCashless: 15000, payouts: 3000, factCash: 22000 + i * 100 - (i === 4 ? 900 : 0) });
      S.add('dds', { type: 'День', date: '2026-09-' + dd, goodsCash: 1000, debtPaid: 500, debtTaken: 2000 });
    }
    S.add('plans', { due: '2026-09-01', supplier: 'Рамми', amount: 15000, status: 'Запланирована' });
    S.add('debtors', { date: '2026-07-01', name: 'Сосед', sum: 5000, paid: 0 });
    S.save(); window.WMUI.recompute();
  });
  const ids = await screensOf(page);
  let clicked = 0, withFilters = 0;
  for (const id of ids) {
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(150);
    const n = await page.evaluate(() => document.querySelectorAll('.chip').length);
    if (n) withFilters++;
    for (let i = 0; i < Math.min(n, 10); i++) {
      const ok = await page.evaluate(() => {
        const c = document.querySelector('.chip:not(.active)');
        if (!c) return false; c.click(); return true;
      });
      if (!ok) break;
      await page.waitForTimeout(70); clicked++;
    }
    await page.evaluate(() => document.querySelectorAll('[data-filter-clear]').forEach(b => b.click()));
    await page.waitForTimeout(80);
  }
  check('фильтры есть на экранах со списками', withFilters >= 4, withFilters + ' экранов', '>=4');
  check('нажатие любой кнопки не ломает экран', errs.length === 0 && clicked > 10,
    clicked + ' нажатий, ошибок ' + errs.length, '0 ошибок');
  await page.close(); await ctx.close();
  console.log('');
}

/* 4. Вредный текст в названиях выводится текстом, а не выполняется */
{
  console.log('— Вредный код в названиях');
  const BAD = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
  const { page, ctx, errs } = await open();
  await page.evaluate(bad => {
    const S = window.WMStore, d = '2026-09-01';
    S.add('dds', { type: 'Смена', date: d, till: bad, shift: bad, cashier: bad,
      openCash: 0, zCash: 1000, zCashless: 0, payouts: 0, factCash: 900, note: bad });
    S.add('dds', { type: 'Расход', date: d, category: bad, method: bad, amount: 100, note: bad });
    S.add('plans', { due: d, supplier: bad, amount: 100, status: 'Запланирована', note: bad });
    S.add('debtors', { date: d, name: bad, phone: bad, sum: 100, paid: 0, note: bad });
    S.add('staff', { name: bad, position: bad, phone: bad });
    S.save(); window.WMUI.recompute();
  }, BAD);
  const ids = await screensOf(page);
  for (const id of ids) { await page.evaluate(v => window.WMUI.go(v), id); await page.waitForTimeout(110); }
  const pwned = await page.evaluate(() => !!window.__pwned);
  const imgs = await page.evaluate(() => document.querySelectorAll('img[src="x"]').length);
  check('вредный код не выполнился', !pwned, 'показан как текст', 'не выполнился');
  check('картинка-ловушка не создалась', imgs === 0, imgs, 0);
  check('экраны при этом не сломались', errs.length === 0, errs.slice(0, 2).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 5. Телефон, планшет и компьютер */
{
  console.log('— Телефон, планшет и компьютер');
  const DEVICES = [
    { name: 'iPhone SE', w: 375, h: 667, kind: 'phone' },
    { name: 'iPhone 15 Pro', w: 393, h: 852, kind: 'phone' },
    { name: 'iPad mini', w: 744, h: 1133, kind: 'tablet' },
    { name: 'iPad Pro книжно', w: 834, h: 1194, kind: 'tablet' },
    { name: 'ноутбук', w: 1440, h: 900, kind: 'desktop' },
    { name: 'большой монитор', w: 1920, h: 1080, kind: 'desktop' }
  ];
  let wide = [], badLayout = [];
  const allErrs = [];
  for (const d of DEVICES) {
    const { page, ctx, errs } = await open({ viewport: { width: d.w, height: d.h },
      hasTouch: d.kind !== 'desktop', isMobile: d.kind === 'phone' });
    await page.evaluate(() => {
      const S = window.WMStore;
      S.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День',
        cashier: 'Аня', openCash: 0, zCash: 26467, zCashless: 29743, payouts: 10000, factCash: 16000 });
      S.save(); window.WMUI.recompute();
    });
    const layout = await page.evaluate(() => {
      const vis = el => !!el && getComputedStyle(el).display !== 'none';
      return { sidebar: vis(document.querySelector('.sidebar')),
        tabbar: vis(document.getElementById('tabbar')),
        menuBtn: vis(document.getElementById('menuBtn')) };
    });
    const want = d.kind === 'phone' ? (!layout.sidebar && layout.tabbar)
      : d.kind === 'tablet' ? (!layout.sidebar && !layout.tabbar && layout.menuBtn)
      : (layout.sidebar && !layout.tabbar);
    if (!want) badLayout.push(d.name + ' ' + JSON.stringify(layout));
    for (const v of await screensOf(page)) {
      await page.evaluate(x => window.WMUI.go(x), v);
      await page.waitForTimeout(130);
      const over = await page.evaluate(() => document.body.scrollWidth - document.body.clientWidth);
      if (over > 2) wide.push(d.name + ' / ' + v + ': +' + over + 'px');
    }
    errs.forEach(e => allErrs.push(d.name + ': ' + e));
    await page.close(); await ctx.close();
  }
  check('ни на одном экране ничего не уезжает вбок', wide.length === 0,
    wide.slice(0, 4).join(' | ') || 'нигде', 'нигде');
  check('раскладка своя для телефона, планшета и компьютера', badLayout.length === 0,
    badLayout.join(' | ') || 'у всех верная', 'у всех верная');

  const { page, ctx } = await open({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
  await page.evaluate(() => {
    window.WMStore.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 0, zCash: 10000, zCashless: 0, payouts: 0, factCash: 10000 });
    window.WMStore.save(); window.WMUI.recompute(); window.WMUI.go('morning');
  });
  await page.waitForTimeout(500);
  const t = await page.evaluate(() => {
    const td = document.querySelector('table.data tbody tr td:nth-child(2)');
    if (!td) return null;
    return { block: getComputedStyle(td).display !== 'table-cell',
      label: td.getAttribute('data-label') || '',
      headHidden: getComputedStyle(document.querySelector('table.data thead')).display === 'none' };
  });
  check('на телефоне строка таблицы становится карточкой',
    !!t && t.block && t.headHidden && !!t.label, t ? 'подпись «' + t.label + '»' : 'нет таблицы',
    'карточка с подписями');
  const small = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('#tabbar .tab, .page .btn').forEach(b => {
      const r = b.getBoundingClientRect();
      if (r.height && r.height < 40) bad.push(b.textContent.trim().slice(0, 16) + ' ' + Math.round(r.height));
    });
    return bad;
  });
  check('кнопки на телефоне не мельче пальца', small.length === 0,
    small.slice(0, 3).join(' | ') || 'все крупные', 'все от 40 px');
  await page.evaluate(() => window.WMUI.openForm('shiftClose'));
  await page.waitForTimeout(350);
  const form = await page.evaluate(() => {
    const inp = document.querySelector('.sheet .form-row input');
    if (!inp) return null;
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    return { size: parseFloat(getComputedStyle(inp).fontSize),
      wide: inp.getBoundingClientRect().width > sheet.width * 0.6 };
  });
  check('в форме на телефоне поля крупные и во всю ширину',
    !!form && form.size >= 16 && form.wide, form ? form.size + 'px' : 'формы нет', '16px и шире половины');
  await page.close(); await ctx.close();

  check('в консоли чисто на всех устройствах', allErrs.length === 0,
    allErrs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  console.log('');
}

/* 6. Справочники: кассиры, увольнение, переименование */
{
  console.log('— Справочники');
  const { page, ctx, errs } = await open();
  await page.evaluate(() => {
    const S = window.WMStore;
    S.add('dds', { type: 'Расход', date: '2026-09-01', category: 'Хозтовары',
      method: 'Наличные', cashier: 'Аня', amount: 500 });
    S.add('dds', { type: 'Расход', date: '2026-09-02', category: 'Хозтовары',
      method: 'Наличные', cashier: 'Аня', amount: 700 });
    S.save(); window.WMUI.recompute(); window.WMUI.go('dicts');
  });
  await page.waitForTimeout(500);
  await page.click('[data-act="dict-staff-import"]');
  await page.waitForTimeout(500);
  const staffN = await page.evaluate(() => (window.WMStore.state.staff || []).length);
  check('кассиры собраны из записей', staffN > 0, staffN + ' карточек', '>0');

  await page.evaluate(() => { const b = document.querySelector('[data-act="staff-fire"]'); if (b) b.click(); });
  await page.waitForTimeout(350);
  await page.fill('.sheet input[name="fired"]', '2026-09-05');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(500);
  const fired = await page.evaluate(() => {
    const S = window.WMStore, f = (S.state.staff || []).find(x => x.fired);
    return { when: f && f.fired,
      inList: f ? window.WMQuick.dicts(S.state, S.settings).cashiers.indexOf(f.name) >= 0 : null };
  });
  check('уволенный записан с датой', fired.when === '2026-09-05', fired.when, '2026-09-05');

  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.chip')].find(x => x.textContent.indexOf('Статьи расходов') >= 0);
    if (c) c.click();
  });
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('table.data tbody tr')]
      .find(r => r.textContent.indexOf('Хозтовары') >= 0);
    if (row) row.querySelector('[data-act="dict-rename"]').click();
  });
  await page.waitForTimeout(350);
  await page.fill('.sheet input[name="name"]', 'Хозрасходы');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(500);
  const ren = await page.evaluate(() => ({
    old: (window.WMStore.state.dds || []).filter(r => r.category === 'Хозтовары').length,
    now: (window.WMStore.state.dds || []).filter(r => r.category === 'Хозрасходы').length }));
  check('переименование переписало записи', ren.old === 0 && ren.now === 2, 'стало ' + ren.now, 2);
  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

await browser.close();
console.log('Итог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
process.exit(failed ? 1 : 0);
