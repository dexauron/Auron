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
  // Контур 1 (ручной учёт) и контур 2 (аналитика 1С) — оба на месте
  const need1 = ['pulse', 'morning', 'evening', 'finpay', 'ledger', 'cashiers', 'debtors',
    'timesheet', 'sched', 'payroll', 'staffcards', 'pnl', 'bep', 'bepdays', 'taxcal',
    'findash', 'owner', 'moneyflow', 'avgcheck', 'earners', 'ready', 'dicts', 'reset'];
  const need2 = ['suppliers', 'stock', 'orders', 'expiry', 'losses', 'dead', 'groups',
    'itemprofit', 'shelf', 'returns', 'abc', 'pricecmp'];
  const miss1 = need1.filter(id => !ids.includes(id));
  const miss2 = need2.filter(id => !ids.includes(id));
  check('все экраны ручного учёта на месте', miss1.length === 0, miss1.join(', ') || 'все', 'все');
  check('все экраны товарной аналитики на месте', miss2.length === 0, miss2.join(', ') || 'все', 'все');

  // Разделение контуров: данные 1С живут в памяти и в базу не пишутся
  const sep = await page.evaluate(() => {
    const S = window.WMStore, U = window.WMUI;
    const before = S.COLLECTIONS.reduce((n, c) => n + (S.state[c] || []).length, 0);
    const d = U.data();
    d.writeoffs = [{ name: 'Молоко', qty: 2, cost: 300, reason: 'Просрочка', date: '2026-09-01' }];
    d.sales = [{ key: 'k1', name: 'Молоко', qty: 10, revenue: 1000, cogs: 700 }];
    U.recompute();
    const after = S.COLLECTIONS.reduce((n, c) => n + (S.state[c] || []).length, 0);
    return { before, after, writeoffSum: U.calc().writeoffSum };
  });
  check('аналитика 1С не пишется в служебную базу',
    sep.before === sep.after && sep.writeoffSum === 300,
    'записей ' + sep.before + '→' + sep.after + ', списаний ' + sep.writeoffSum, 'база не выросла');
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

/* 5б. Зарплата: табель → ведомость → выдача остатка */
{
  console.log('— Зарплата от табеля до выдачи');
  const { page, ctx, errs } = await open();
  await page.evaluate(() => {
    const S = window.WMStore;
    S.add('staff', { name: 'Аня', position: 'Кассир', rate: 220, rateNight: 250, normShifts: 15 });
    S.add('staff', { name: 'Борис', position: 'Администратор', salary: 60000 });
    S.setSetting('payrollMonth', '2026-09');
    S.setSetting('reportMonth', '2026-09');
    S.save(); window.WMUI.recompute();
  });

  await page.evaluate(() => window.WMUI.openForm('timesheetRow'));
  await page.waitForTimeout(350);
  const fill = (n, v) => page.fill('.sheet [name="' + n + '"]', v);
  await fill('date', '2026-09-01');
  await fill('employee', 'Аня');
  await fill('hoursDay', '0');
  await fill('hoursNight', '12');
  await fill('bonus', '1000');
  await fill('fine', '500');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(600);

  const t = await page.evaluate(() => {
    const E = window.WM, S = window.WMStore;
    const row = S.state.timesheet[0];
    const c = E.timesheetCalc(row, S.state.staff[0], S.settings);
    const b = E.payrollSummary(S.state.timesheet, S.state.payouts, S.state.staff, S.settings);
    const anya = b.find(r => r.employee === 'Аня');
    const boris = b.find(r => r.employee === 'Борис');
    return { total: c.total, left: anya.left, who: anya.employee,
      borisAccrued: boris ? boris.accrued : 0 };
  });
  check('ночная смена посчиталась по своей ставке', t.total === 3500, t.total, 3500);
  check('в ведомости появился остаток к выдаче', t.left === 3500 && t.who === 'Аня', t.left, 3500);
  check('ОКЛАД БЕЗ СМЕН НЕ НАЧИСЛЯЕТСЯ', t.borisAccrued === 0, t.borisAccrued, 0);

  await page.evaluate(() => window.WMUI.go('payroll'));
  await page.waitForTimeout(400);
  const pay = (await page.textContent('#page')).replace(/[\u00a0\u202f]/g, ' ');
  check('на «Ведомости» видно начисление и остаток',
    pay.includes('Аня') && pay.includes('3 500'),
    pay.includes('3 500') ? 'видно' : 'суммы нет', 'видно');

  // кнопка «Выдать остаток» подставляет сумму
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-act="pay-rest"]')][0];
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  const amount = await page.evaluate(() => {
    const el = document.querySelector('.sheet [name="amount"]');
    return el ? el.value : '';
  });
  check('«Выдать остаток» подставляет ровно остаток', String(amount).replace(/\s/g, '') === '3500',
    amount, 3500);
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => {
    const E = window.WM, S = window.WMStore;
    const b = E.payrollSummary(S.state.timesheet, S.state.payouts, S.state.staff, S.settings)
      .find(r => r.employee === 'Аня');
    return { left: b.left, paid: b.paid };
  });
  check('после выдачи остаток обнулился', after.left === 0 && after.paid === 3500, after.left, 0);

  // ФОТ из табеля должен встать в P&L
  await page.evaluate(() => {
    const S = window.WMStore;
    S.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 0, zCash: 26467, zCashless: 29743, payouts: 10000, factCash: 16467 });
    S.add('dds', { type: 'День', date: '2026-09-01', goodsCash: 5000, debtPaid: 3000, debtTaken: 12000 });
    S.save(); window.WMUI.recompute(); window.WMUI.go('pnl');
  });
  await page.waitForTimeout(500);
  const pnl = (await page.textContent('#page')).replace(/[\u00a0\u202f]/g, ' ');
  check('в P&L валовая прибыль = выручка − закуп', pnl.includes('39 210'),
    pnl.includes('39 210') ? 'видно' : 'суммы нет', '39 210');
  check('ФОТ в P&L помечен как «табель»', pnl.includes('табель'), 'помечен', 'табель');
  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 5б-2. Касса, инкассация и защита от двойного счёта — в живом браузере */
{
  console.log('— Инкассация и защита от двойного счёта');
  const { page, ctx, errs } = await open();
  const fill = (n, v) => page.fill('.sheet [name="' + n + '"]', v);
  const pick = (n, v) => page.selectOption('.sheet [name="' + n + '"]', v);

  await page.evaluate(() => {
    window.WMStore.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1',
      shift: 'День', cashier: 'Аня', openCash: 0, zCash: 26467, zCashless: 29743,
      payouts: 10000, factCash: 16467 });
    window.WMStore.setSetting('reportMonth', '2026-09');
    window.WMStore.save(); window.WMUI.recompute();
  });

  // Расшифровываем выплату из ящика — касса меняться не должна
  await page.evaluate(() => window.WMUI.openForm('moneyOut'));
  await page.waitForTimeout(350);
  await fill('date', '2026-09-01');
  await fill('category', 'Аренда');
  await pick('source', 'Из ящика');
  await fill('amount', '5000');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(600);

  const c1 = await page.evaluate(() => {
    const E = window.WM, S = window.WMStore;
    return { cash: E.cashOnHand(S.state.dds, S.settings),
      rent: E.pnl({ rows: S.state.dds }).costs.find(c => c.key === 'rent').sum };
  });
  check('РАСХОД ИЗ ЯЩИКА КАССУ НЕ ТРОНУЛ', c1.cash === 16467, c1.cash, 16467);
  check('но в затраты месяца вошёл', c1.rent === 5000, c1.rent, 5000);

  // Закуп расходом записать нельзя — форма объясняет, куда его писать
  await page.evaluate(() => window.WMUI.openForm('moneyOut'));
  await page.waitForTimeout(350);
  await fill('category', 'Закуп товара');
  await fill('amount', '10000');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(500);
  const blocked = await page.evaluate(() => {
    const S = window.WMStore;
    return { saved: (S.state.dds || []).some(r => /закуп/i.test(r.category || '')),
      toast: (document.querySelector('.toast') || {}).textContent || '' };
  });
  check('ЗАКУП РАСХОДОМ НЕ ЗАПИСАЛСЯ', !blocked.saved, blocked.saved ? 'записался' : 'отклонён',
    'отклонён');
  check('и программа сказала, куда его писать',
    /Итоги дня/.test(blocked.toast), blocked.toast.slice(0, 60), 'подсказка про Итоги дня');
  await page.evaluate(() => window.WMUI.closeSheet());
  await page.waitForTimeout(300);

  // Инкассация: касса вниз, сейф вверх, прибыль без изменений
  const before = await page.evaluate(() => window.WM.pnl({ rows: window.WMStore.state.dds }).net);
  await page.evaluate(() => window.WMUI.openForm('moveCash'));
  await page.waitForTimeout(350);
  await fill('date', '2026-09-02');
  await pick('from', 'Касса');
  await pick('to', 'Сейф');
  await fill('amount', '10000');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(600);
  const c2 = await page.evaluate(() => {
    const E = window.WM, S = window.WMStore;
    return { cash: E.cashOnHand(S.state.dds, S.settings),
      safe: E.safeOnHand(S.state.dds, S.settings),
      net: E.pnl({ rows: S.state.dds }).net };
  });
  check('инкассация уменьшила кассу', c2.cash === 6467, c2.cash, 6467);
  check('и положила деньги в сейф', c2.safe === 10000, c2.safe, 10000);
  check('ИНКАССАЦИЯ ПРИБЫЛЬ НЕ ИЗМЕНИЛА', c2.net === before, c2.net, before);

  // Больше денег, чем есть в ящике, увезти нельзя
  await page.evaluate(() => window.WMUI.openForm('moveCash'));
  await page.waitForTimeout(350);
  await fill('amount', '999999');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(500);
  const over = await page.evaluate(() => ({
    moves: (window.WMStore.state.dds || []).filter(r => r.type === 'Перемещение').length,
    toast: (document.querySelector('.toast') || {}).textContent || '' }));
  check('нельзя увезти больше, чем лежит в ящике', over.moves === 1,
    over.moves + ' перемещений', 1);
  await page.evaluate(() => window.WMUI.closeSheet());
  await page.waitForTimeout(300);

  // Экран закрытия месяца показывает несведённые выплаты
  await page.evaluate(() => window.WMUI.go('monthclose'));
  await page.waitForTimeout(500);
  const mc = (await page.textContent('#page')).replace(/[\u00a0\u202f]/g, ' ');
  check('«Закрытие месяца» открылось', mc.includes('Что проверяем'), 'открылось', 'открылось');
  check('видно, где лежат деньги', mc.includes('В сейфе') && mc.includes('В ящиках'),
    'видно', 'видно');
  check('видно недорасписанные выплаты из ящика', mc.includes('5 000'), 'видно', '5 000');
  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 5в. Отчёты открываются на живых данных */
{
  console.log('— Отчёты на живых данных');
  const { page, ctx, errs } = await open();
  await page.evaluate(() => {
    const S = window.WMStore;
    S.setSetting('reportMonth', '2026-09');
    S.setSetting('openDebtStart', 100000);
    for (let i = 1; i <= 20; i++) {
      const dd = String(i).padStart(2, '0');
      S.add('dds', { type: 'Смена', date: '2026-09-' + dd, till: 'Касса 1',
        shift: i % 2 ? 'День' : 'Ночь', cashier: i % 3 ? 'Аня' : 'Пётр',
        openCash: 5000, zCash: 20000 + i * 100, zCashless: 15000, payouts: 3000,
        factCash: 22000 + i * 100, checks: 300 + i });
      S.add('dds', { type: 'День', date: '2026-09-' + dd, goodsCash: 8000, debtPaid: 2000, debtTaken: 9000 });
    }
    S.add('dds', { type: 'Расход', date: '2026-09-05', category: 'Аренда', method: 'Перевод', amount: 110000 });
    S.add('dds', { type: 'Расход', date: '2026-09-06', category: 'Коммунальные', method: 'Перевод', amount: 35000 });
    S.add('staff', { name: 'Аня', rate: 220, rateNight: 250 });
    S.add('timesheet', { date: '2026-09-01', employee: 'Аня', shift: 'День', hoursDay: 12 });
    S.save(); window.WMUI.recompute();
  });
  const REPORTS = ['findash', 'owner', 'moneyflow', 'avgcheck', 'earners', 'ready',
    'pnl', 'bep', 'bepdays', 'taxcal', 'monthclose', 'payroll', 'timesheet', 'sched',
    'staffcards', 'reset'];
  const empty = [];
  for (const id of REPORTS) {
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(200);
    const txt = await page.textContent('#page');
    if (!txt || txt.length < 200) empty.push(id);
  }
  check('все ' + REPORTS.length + ' отчётов показали содержимое', empty.length === 0,
    empty.join(', ') || 'все с данными', 'все с данными');

  await page.evaluate(() => window.WMUI.go('avgcheck'));
  await page.waitForTimeout(300);
  const ac = await page.textContent('#page');
  check('средний чек посчитался из числа чеков', !ac.includes('Нет числа чеков'), 'посчитался', 'посчитался');

  await page.evaluate(() => window.WMUI.go('moneyflow'));
  await page.waitForTimeout(300);
  const mf = await page.textContent('#page');
  check('«Куда ушли деньги» начинается с выручки', mf.includes('Выручка'), 'да', 'да');
  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
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
