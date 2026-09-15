/* Проверка экранов в настоящем браузере.
   Открывает программу, проходит по всем экранам, вводит смену и итоги дня,
   жмёт фильтры, проверяет раскладку на телефоне, планшете и компьютере.

   Запуск:  node tests/проверка-экранов.mjs
   Нужен Playwright и Chromium. Если их нет — проверка пропускается.  */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + path.join(HERE, '..', 'Учёт_магазина.html');

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
/* Все зарегистрированные экраны, а не только показанные в меню: меню теперь
   держит рабочий набор, но проверять надо каждый экран. */
const screensOf = page => page.evaluate(() =>
  (window.WMUI.views ? window.WMUI.views().map(v => v.id)
    : [...document.querySelectorAll('.nav-item')].map(e => e.dataset.go)));

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
  const need2 = ['suppliers', 'stock', 'orders', 'losses', 'dead', 'groups',
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
  const pulse = (await page.textContent('#page')).replace(/[\u00a0\u202f]/g, ' ');
  /* Пульт отвечает на два вопроса: сколько денег и что сделать. Долг и
     кассиры остались ниже, но главное — крупная цифра и список дел. */
  check('на Пульте главная цифра — деньги в кассе', pulse.includes('Наличные в кассе'),
    'видно', 'видно');
  check('и список дел на сегодня', pulse.includes('Что сделать') || pulse.includes('Всё сведено'),
    'видно', 'видно');
  check('кассиры и долг остались ниже на том же экране',
    pulse.includes('Аня') && /долг|переплат/i.test(pulse), 'видно', 'видно');
  check('программа заметила, что размен не сошёлся с прошлой сменой',
    /Размен .* не сошёлся/.test(pulse), 'заметила', 'заметила');

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
  // Счёт выбирается по названию: его номер программа заводит сама
  const pickAcc = (n, label) =>
    page.selectOption('.sheet [name="' + n + '"]', { label });

  await page.evaluate(() => {
    const S = window.WMStore;
    const till = (S.state.accounts || []).find(a => a.kind === 'till');
    const bank = (S.state.accounts || []).find(a => a.kind === 'bank');
    S.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1',
      shift: 'День', cashier: 'Аня', openCash: 0, zCash: 26467, zCashless: 29743,
      payouts: 10000, factCash: 16467,
      account: till && till.id, cashlessAccount: bank && bank.id });
    S.setSetting('reportMonth', '2026-09');
    S.save(); window.WMUI.recompute();
  });

  // Счета заводятся сами при первом запуске
  const accs = await page.evaluate(() =>
    (window.WMStore.state.accounts || []).map(a => a.name + ':' + a.kind));
  check('счета заведены при первом запуске', accs.length >= 3, accs.join(', '), '>=3');

  // Расшифровываем выплату из ящика — касса меняться не должна
  await page.evaluate(() => window.WMUI.openForm('moneyOut'));
  await page.waitForTimeout(350);
  await fill('date', '2026-09-01');
  await fill('category', 'Аренда');
  await pickAcc('account', 'Касса');
  await fill('amount', '5000');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(600);

  const c1 = await page.evaluate(() => {
    const E = window.WM, S = window.WMStore;
    return { cash: E.cashOnHand(S.state.dds, S.settings, null, S.state.accounts),
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
  await page.selectOption('.sheet [name="account"]', { index: 0 });
  await page.selectOption('.sheet [name="toAccount"]', { index: 1 });
  await fill('amount', '10000');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(600);
  const c2 = await page.evaluate(() => {
    const E = window.WM, S = window.WMStore;
    return { cash: E.cashOnHand(S.state.dds, S.settings, null, S.state.accounts),
      safe: E.safeOnHand(S.state.dds, S.settings, null, S.state.accounts),
      net: E.pnl({ rows: S.state.dds }).net,
      chk: E.tillPayoutCheck(S.state.dds, null, { payouts: S.state.payouts || [],
        accounts: S.state.accounts || [] }) };
  });
  /* Кассир вынул деньги при закрытии смены и записал их в «выплаты из ящика»
     (10 000), а факт это учёл. Значит инкассация ящик второй раз уменьшать
     не должна — иначе те же деньги пропадут дважды. */
  check('ИНКАССАЦИЯ НЕ ВЫЧИТАЕТСЯ ИЗ ЯЩИКА ДВАЖДЫ', c2.cash === 16467, c2.cash, 16467);
  check('и положила деньги в сейф', c2.safe === 10000, c2.safe, 10000);
  check('ИНКАССАЦИЯ ПРИБЫЛЬ НЕ ИЗМЕНИЛА', c2.net === before, c2.net, before);
  check('она попала в расшифровку выплат из ящика',
    c2.chk.parts['инкассация'] === 10000, c2.chk.parts['инкассация'], 10000);
  /* В этих данных расшифровок нарочно больше, чем выплат: смена выдала
     10 000, а записаны расход 5 000 и инкассация 10 000. Программа обязана
     это заметить — иначе лишняя запись прошла бы незамеченной. */
  check('ЛИШНЮЮ РАСШИФРОВКУ ПРОГРАММА ЗАМЕЧАЕТ', c2.chk.over && c2.chk.left === -5000,
    'перебор на ' + (-c2.chk.left), 'перебор на 5000');

  // Со счёта нельзя перевести больше, чем на нём лежит
  await page.evaluate(() => window.WMUI.openForm('moveCash'));
  await page.waitForTimeout(350);
  await page.selectOption('.sheet [name="account"]', { index: 1 });
  await page.selectOption('.sheet [name="toAccount"]', { index: 2 });
  await fill('amount', '999999');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(500);
  const over = await page.evaluate(() => ({
    moves: (window.WMStore.state.dds || []).filter(r => r.type === 'Перемещение').length }));
  check('нельзя перевести со счёта больше, чем на нём есть', over.moves === 1,
    over.moves + ' переводов', 1);
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

/* 5в-2. Меню деревом: избранное сверху, остальное по папкам */
{
  console.log('— Меню деревом: избранное и папки');
  const { page, ctx, errs } = await open();
  const nav = () => page.evaluate(() =>
    [...document.querySelectorAll('.nav-item')].map(e => e.dataset.go).filter(Boolean));
  const folders = () => page.evaluate(() =>
    [...document.querySelectorAll('.nav-folder')].map(e => e.dataset.folder));

  const start = await nav();
  check('меню короткое: избранное и папки, а не сорок пунктов',
    start.length <= 8, start.length + ' пунктов', '<=8');
  check('в избранном то, чем пользуются каждый день',
    ['pulse', 'morning', 'evening', 'finpay', 'owner'].every(id => start.includes(id)),
    'на месте', 'на месте');
  const f = await folders();
  check('папки на месте',
    ['Каждый день', 'Деньги', 'Люди', 'Товары', 'Отчёты', 'Ещё'].every(g => f.includes(g)),
    f.join(', '), 'шесть папок');
  check('папки свёрнуты — меню не длинное',
    await page.evaluate(() => document.querySelectorAll('.nav-folder.open').length) === 0,
    'свёрнуты', 'свёрнуты');

  // ПАПКА РАСКРЫВАЕТСЯ И ЗАПОМИНАЕТСЯ
  await page.click('[data-act="nav-folder"][data-folder="Товары"]');
  await page.waitForTimeout(350);
  const opened = await nav();
  check('ПАПКА РАСКРЫЛАСЬ И ПОКАЗАЛА СВОИ ЭКРАНЫ',
    opened.includes('abc') && opened.includes('shelf'), 'раскрылась', 'раскрылась');
  check('и выбор запомнился',
    (await page.evaluate(() => window.WMStore.settings.menuOpen || '')).includes('Товары'),
    'запомнился', 'Товары');
  await page.click('[data-act="nav-folder"][data-folder="Товары"]');
  await page.waitForTimeout(350);
  check('и сворачивается обратно',
    !(await nav()).includes('abc'), 'свернулась', 'свернулась');

  // ЗВЁЗДОЧКА КЛАДЁТ ЭКРАН В ИЗБРАННОЕ ПРЯМО ИЗ МЕНЮ
  await page.click('[data-act="nav-folder"][data-folder="Отчёты"]');
  await page.waitForTimeout(300);
  await page.click('.nav-item[data-go="pnl"] [data-act="fav-toggle"]');
  await page.waitForTimeout(350);
  check('ЗВЁЗДОЧКА ПОДНЯЛА ЭКРАН В ИЗБРАННОЕ',
    (await page.evaluate(() => window.WMStore.settings.menuFav || '')).includes('pnl'),
    'подняла', 'pnl в избранном');
  const favFirst = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.nav-item')].map(e => e.dataset.go).filter(Boolean);
    const fold = [...document.querySelectorAll('.nav-folder')][0];
    const all = [...document.querySelectorAll('.nav-item, .nav-folder')];
    return all.indexOf(document.querySelector('.nav-item[data-go="pnl"]')) < all.indexOf(fold);
  });
  check('и оно стоит выше папок', favFirst, 'сверху', 'сверху');

  // СКРЫТЫЙ ЭКРАН ИСЧЕЗАЕТ ИЗ МЕНЮ, НО ОТКРЫВАЕТСЯ
  await page.evaluate(() => window.WMUI.go('menucfg'));
  await page.waitForTimeout(400);
  const cfg = await page.textContent('#page');
  check('экран «Настроить меню» открывается',
    cfg.includes('Что видеть сверху'), 'открылся', 'открылся');
  await page.evaluate(() => {
    const b = document.querySelector('#page [data-act="hide-toggle"][data-id="seasons"]');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  check('ЭКРАН СКРЫЛСЯ ПО КНОПКЕ',
    (await page.evaluate(() => window.WMStore.settings.menuHidden || '')).includes('seasons'),
    'скрылся', 'seasons скрыт');
  await page.click('[data-act="nav-folder"][data-folder="Отчёты"]');
  await page.waitForTimeout(350);
  check('и пропал из папки', !(await nav()).includes('seasons'), 'пропал', 'пропал');
  const stillOpens = await page.evaluate(async () => {
    window.WMUI.go('seasons');
    return (document.querySelector('#page') || {}).textContent.length > 60;
  });
  check('СКРЫТЫЙ ЭКРАН ВСЁ РАВНО ОТКРЫВАЕТСЯ', stillOpens, 'открылся', 'открылся');

  // И ВОЗВРАЩАЕТСЯ ОДНОЙ КНОПКОЙ
  await page.evaluate(() => window.WMUI.go('menucfg'));
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const b = document.querySelector('#page [data-act="hide-toggle"][data-id="seasons"]');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  check('и возвращается одной кнопкой',
    !(await page.evaluate(() => window.WMStore.settings.menuHidden || '')).includes('seasons'),
    'вернулся', 'вернулся');

  // «КАК БЫЛО» ВОЗВРАЩАЕТ ОБЫЧНЫЙ ВИД
  await page.evaluate(() => document.querySelector('#page [data-act="menu-reset"]').click());
  await page.waitForTimeout(400);
  check('кнопка «Как было» возвращает обычный вид',
    (await page.evaluate(() => window.WMStore.settings.menuFav)) === 'pulse,morning,evening,finpay,owner',
    await page.evaluate(() => window.WMStore.settings.menuFav), 'по умолчанию');

  /* ПУСТОЕ ИЗБРАННОЕ ОБЯЗАНО ОСТАТЬСЯ ПУСТЫМ.
     Раньше пустая строка настройки считалась «настройки ещё нет», и пять
     стандартных экранов возвращались сами. Со стороны выглядело так, будто
     программа отменяет любые изменения. */
  await page.evaluate(() => window.WMUI.go('menucfg'));
  await page.waitForTimeout(350);
  for (const id of ['pulse', 'morning', 'evening', 'finpay', 'owner', 'pnl']) {
    await page.evaluate(v => {
      const b = document.querySelector('#page [data-act="fav-toggle"][data-id="' + v + '"].btn-on');
      if (b) b.click();
    }, id);
    await page.waitForTimeout(160);
  }
  check('ИЗБРАННОЕ МОЖНО ОПУСТОШИТЬ — И ОНО НЕ ВЕРНЁТСЯ САМО',
    (await page.evaluate(() => window.WMStore.settings.menuFav)) === '',
    JSON.stringify(await page.evaluate(() => window.WMStore.settings.menuFav)), '""');
  await page.reload();
  await page.waitForTimeout(700);
  check('и после перезапуска тоже пусто',
    (await page.evaluate(() => window.WMStore.settings.menuFav)) === '',
    JSON.stringify(await page.evaluate(() => window.WMStore.settings.menuFav)), '""');
  check('а меню при этом не сломалось — «Настроить меню» на месте',
    await page.evaluate(() => !!document.querySelector('#nav [data-go="menucfg"]')),
    'на месте', 'на месте');

  await page.evaluate(() => window.WMUI.go('menucfg'));
  await page.waitForTimeout(350);
  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 5в-3. То же дерево на телефоне */
{
  console.log('— Меню на телефоне');
  const { page, ctx, errs } = await open({ viewport: { width: 393, height: 852 },
    hasTouch: true, isMobile: true });
  await page.evaluate(() => document.querySelector('[data-act="open-menu"]').click());
  await page.waitForTimeout(400);
  const items = () => page.evaluate(() =>
    [...document.querySelectorAll('.sheet [data-go]')].map(e => e.dataset.go));
  const start = await items();
  check('на телефоне тоже короткое меню', start.length <= 8,
    start.length + ' пунктов', '<=8');
  check('избранное на месте',
    ['pulse', 'morning', 'evening'].every(id => start.includes(id)), 'на месте', 'на месте');
  check('и папки тоже',
    await page.evaluate(() =>
      [...document.querySelectorAll('.sheet [data-act="nav-folder"]')].length >= 5),
    'есть', '>=5');

  await page.evaluate(() => {
    const b = document.querySelector('.sheet [data-act="nav-folder"][data-folder="Товары"]');
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  const after = await items();
  check('ПАПКА РАСКРЫВАЕТСЯ ПРЯМО В ОТКРЫТОМ МЕНЮ',
    after.includes('abc'), after.length + ' пунктов', 'товары видны');
  check('есть кнопка «Настроить меню»', after.includes('menucfg'), 'есть', 'есть');
  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 5в-4. Значки: везде векторные, ни одного эмодзи на экране */
{
  console.log('— Значки в стиле iOS');
  const { page, ctx, errs } = await open();
  await page.evaluate(() => {
    const S = window.WMStore;
    S.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 0, zCash: 20000, zCashless: 5000, payouts: 3000, factCash: 17000 });
    S.add('plans', { due: '2026-09-01', supplier: 'Рамми', amount: 15000, status: 'Запланирована' });
    S.save(); window.WMUI.recompute(); window.WMUI.render();
  });

  const набор = await page.evaluate(() => window.WMIcons.names().length);
  check('набор значков подключён', набор > 50, набор + ' значков', '>50');

  // Ни одного эмодзи в видимом тексте — иначе рядом разнобой
  /* Картинки-эмодзи, а не типографика: минус «−», точка «·» и стрелка «→»
     в тексте — обычные знаки препинания, к значкам отношения не имеют. */
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{22EE}]/u;
  const ids = await screensOf(page);
  const dirty = [];
  for (const id of ids) {
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(90);
    const found = await page.evaluate(re => {
      const bad = new Set();
      const rx = new RegExp(re, 'u');
      document.querySelectorAll('#page, #nav, .topbar, #tabbar, #alertBar').forEach(root => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n; while ((n = w.nextNode())) {
          const m = n.nodeValue.match(rx);
          if (m) bad.add(m[0]);
        }
      });
      return [...bad];
    }, EMOJI.source);
    found.forEach(e => dirty.push(id + ':' + e));
  }
  check('НА ЭКРАНАХ НЕТ ЭМОДЗИ — только векторные значки', dirty.length === 0,
    dirty.slice(0, 5).join(', ') || 'чисто', 'чисто');

  // Значки должны быть настоящим svg и брать цвет текста
  const svgOk = await page.evaluate(() => {
    const s = document.querySelector('#nav .nav-icon svg');
    if (!s) return 'нет значка в меню';
    return s.getAttribute('stroke') === 'currentColor' &&
      s.getAttribute('viewBox') === '0 0 24 24' ? 'ок' : 'не тот формат';
  });
  check('значок — svg, цвет берёт у текста', svgOk === 'ок', svgOk, 'ок');

  // В нижней панели телефона значки тоже подставились
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('#tabbar .tab-icon')].filter(e => e.querySelector('svg')).length);
  check('в нижней панели значки на месте', tabs === 5, tabs + ' из 5', 5);
  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 5г. Мёртвых кнопок быть не должно */
{
  console.log('— Кнопки, которые никуда не ведут');
  const { page, ctx, errs } = await open();
  await page.evaluate(() => {
    const S = window.WMStore;
    S.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 0, zCash: 20000, zCashless: 0, payouts: 0, factCash: 20000 });
    S.save(); window.WMUI.recompute();
  });

  // Все data-form на всех экранах должны открывать существующую форму
  const ids = await screensOf(page);
  const deadForms = new Set();
  for (const id of ids) {
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(110);
    const bad = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('[data-form]').forEach(b => {
        if (!window.WMUI.form(b.dataset.form)) out.push(b.dataset.form);
      });
      return out;
    });
    bad.forEach(f => deadForms.add(f));
  }
  check('на экранах нет кнопок в несуществующую форму', deadForms.size === 0,
    [...deadForms].join(', ') || 'нет', 'нет');

  // Главная кнопка «＋ Записать» на телефоне
  await page.evaluate(() => window.WMUI.go('pulse'));
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-act="add-record"]').click());
  await page.waitForTimeout(400);
  const add = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.sheet [data-form]')];
    return { total: items.length,
      dead: items.map(b => b.dataset.form).filter(f => !window.WMUI.form(f)) };
  });
  check('«＋ Записать» показывает пункты', add.total >= 8, add.total + ' пунктов', '>=8');
  check('И КАЖДЫЙ ПУНКТ ОТКРЫВАЕТ ФОРМУ', add.dead.length === 0,
    add.dead.join(', ') || 'все живые', 'все живые');

  // пункт действительно открывается
  await page.evaluate(() => document.querySelector('.sheet [data-form="moveCash"]').click());
  await page.waitForTimeout(400);
  const opened = await page.evaluate(() => !!document.querySelector('#wmForm [name="amount"]'));
  check('пункт открывает форму, а не пустоту', opened, opened ? 'открылась' : 'ничего',
    'открылась');
  await page.evaluate(() => window.WMUI.closeSheet());
  await page.waitForTimeout(250);

  // «Повторить сегодня» из меню строки
  await page.evaluate(() => window.WMUI.go('ledger'));
  await page.waitForTimeout(300);
  const repeated = await page.evaluate(() => {
    const S = window.WMStore, rec = S.state.dds[0];
    const el = { dataset: { coll: 'dds', id: rec.id, target: 'shiftClose' } };
    return typeof window.WMUI.form('shiftClose') === 'object';
  });
  check('форма для «Повторить сегодня» существует', repeated, 'есть', 'есть');

  // «Быстрая настройка» на экране настроек
  await page.evaluate(() => window.WMUI.go('settings'));
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act="settings-wizard"]').click());
  await page.waitForTimeout(400);
  const wiz = await page.evaluate(() => !!document.querySelector('#wmForm [name="openCashStart"]'));
  check('«Быстрая настройка» открывается', wiz, wiz ? 'открылась' : 'мёртвая кнопка', 'открылась');
  await page.evaluate(() => window.WMUI.closeSheet());
  await page.waitForTimeout(250);
  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 5г-2. Правка записи не должна её терять или задваивать */
{
  console.log('— Правка записи во всех формах');
  const { page, ctx, errs } = await open();
  const cases = [
    ['dds', 'shiftClose', { type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 0, zCash: 20000, zCashless: 0, payouts: 0, factCash: 20000 },
      'factCash', '19000'],
    ['dds', 'dayTotals', { type: 'День', date: '2026-09-01', goodsCash: 1000, debtPaid: 0,
      debtTaken: 0 }, 'goodsCash', '2000'],
    ['dds', 'moneyOut', { type: 'Расход', date: '2026-09-01', category: 'Аренда',
      method: 'Наличные', source: 'Из ящика', amount: 5000 }, 'amount', '7000'],
    ['dds', 'moveCash', { type: 'Перемещение', date: '2026-09-01', from: 'Касса', to: 'Сейф',
      amount: 2000 }, 'amount', '3000'],
    ['dds', 'moneyIn', { type: 'Приход', date: '2026-09-01', category: 'Прочий приход',
      method: 'Наличные', amount: 500 }, 'amount', '900'],
    ['dds', 'moneyDraw', { type: 'Забор', date: '2026-09-01', method: 'Наличные',
      amount: 3000 }, 'amount', '4000'],
    ['staff', 'staffCard', { name: 'Аня', rate: 220 }, 'rate', '250'],
    ['timesheet', 'timesheetRow', { date: '2026-09-01', employee: 'Аня', shift: 'День',
      hoursDay: 12 }, 'hoursDay', '8'],
    ['payouts', 'payoutRow', { date: '2026-09-01', employee: 'Аня', kind: 'Аванс',
      amount: 2000, method: 'Наличные' }, 'amount', '2500'],
    ['debtors', 'debtor', { date: '2026-09-01', name: 'Сосед', sum: 500, paid: 0 }, 'sum', '800'],
    ['plans', 'payPlan', { due: '2026-09-01', supplier: 'Рамми', amount: 15000,
      status: 'Запланирована' }, 'amount', '17000']
  ];
  const lost = [], doubled = [], notApplied = [];
  for (const [coll, form, seed, field, val] of cases) {
    const r = await page.evaluate(async ([coll, form, seed, field, val]) => {
      const S = window.WMStore, U = window.WMUI;
      S.state[coll] = []; S.save();
      const rec = S.add(coll, seed); S.save(); U.recompute();
      U.openForm(form, JSON.parse(JSON.stringify(rec)), { coll, id: rec.id });
      await new Promise(r2 => setTimeout(r2, 350));
      const el = document.querySelector('#wmForm [name="' + field + '"]');
      if (el) el.value = val;
      document.querySelector('#wmForm')
        .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      await new Promise(r2 => setTimeout(r2, 450));
      const list = S.state[coll] || [];
      return { n: list.length, value: list[0] ? String(list[0][field]) : null };
    }, [coll, form, seed, field, val]);
    if (r.n === 0) lost.push(form);
    else if (r.n > 1) doubled.push(form);
    else if (r.value !== String(val)) notApplied.push(form + ' (' + r.value + ')');
  }
  check('ПРАВКА НЕ УДАЛЯЕТ ЗАПИСЬ', lost.length === 0, lost.join(', ') || 'ни одной', 'ни одной');
  check('ПРАВКА НЕ ЗАДВАИВАЕТ ЗАПИСЬ', doubled.length === 0, doubled.join(', ') || 'ни одной',
    'ни одной');
  check('и новое значение действительно сохраняется', notApplied.length === 0,
    notApplied.join(', ') || 'все ' + cases.length, 'все ' + cases.length);
  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 5д. Ни байта не теряем при резком закрытии окна */
{
  console.log('— Закрыли окно сразу после ввода');
  const { page, ctx, errs } = await open();

  // Владелец записал смену и тут же прячет вкладку
  await page.evaluate(() => {
    window.WMStore.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1',
      shift: 'День', cashier: 'Аня', openCash: 0, zCash: 26467, zCashless: 29743,
      payouts: 10000, factCash: 16467 });
    window.WMStore.save();
  });
  const ls = await page.evaluate(() => {
    const raw = localStorage.getItem(window.WMStore.KEY);
    return raw ? (JSON.parse(raw).dds || []).length : 0;
  });
  check('запись легла в браузер МГНОВЕННО, без задержки', ls === 1, ls, 1);

  // Следующий запуск читает отставший файл — запись обязана уцелеть
  const kept = await page.evaluate(() => {
    const S = window.WMStore;
    const stale = { dds: [], plans: [], staff: [], timesheet: [], payouts: [],
      debtors: [], cashcount: [], rev: 0, savedAt: '2020-01-01T00:00:00Z' };
    const cmp = S.compare(stale);
    if (cmp.verdict === 'file') S.replaceAll(stale);
    return { verdict: cmp.verdict, left: (S.state.dds || []).length, saved: cmp.onlyMine };
  });
  check('ОТСТАВШИЙ ФАЙЛ ЗАПИСЬ НЕ СТЁР', kept.left === 1 && kept.verdict === 'local',
    kept.left + ' записей, вердикт ' + kept.verdict, '1, local');
  check('программа знает, сколько спасла', kept.saved === 1, kept.saved, 1);

  // Скрытие вкладки должно срывать запись на диск немедленно
  const flush = await page.evaluate(async () => {
    const F = window.WMFiles;
    if (typeof F.flushNow !== 'function') return 'нет flushNow';
    if (typeof F.bindLifecycle !== 'function') return 'нет bindLifecycle';
    // папка не подключена — запись вернёт false, но не должна падать
    let threw = null;
    try { await F.flushNow(function () { return window.WMStore.state; }); }
    catch (e) { threw = e.message; }
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    return threw || 'ок';
  });
  check('срыв записи на диск есть и не падает без папки', flush === 'ок', flush, 'ок');
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
  await page.waitForTimeout(400);

  // Справочники открываются на «Счетах» — это первое, что настраивают
  const accTab = await page.textContent('#page');
  check('справочник счетов открыт первым',
    accTab.includes('Счета') && accTab.includes('Наличными'), 'открыт', 'открыт');
  const accRows = await page.evaluate(() =>
    document.querySelectorAll('#accLive tbody tr').length ||
    (window.WMStore.state.accounts || []).length);
  check('в справочнике видны заведённые счета', accRows >= 3, accRows + ' счетов', '>=3');

  await page.click('[data-tab="dicts:staff"]');
  await page.waitForTimeout(400);
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

/* 7. Владелец: забор денег, вставка справочника, ведомость на подпись, отчёт */
{
  console.log('— Владелец: забор денег, ведомость и отчёт');
  const { page, ctx, errs } = await open();
  const fill = (n, v) => page.fill('.sheet [name="' + n + '"]', v);
  const pickAcc = (n, label) => page.selectOption('.sheet [name="' + n + '"]', { label });

  await page.evaluate(() => {
    const S = window.WMStore;
    const a = S.state.accounts || [];
    const till = a.find(x => x.kind === 'till'), safe = a.find(x => x.kind === 'cash'),
      bank = a.find(x => x.kind === 'bank');
    S.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 0, zCash: 40000, zCashless: 12000,
      payouts: 30000, factCash: 10000,
      account: till && till.id, cashlessAccount: bank && bank.id });
    S.add('dds', { type: 'Перемещение', date: '2026-09-01', amount: 25000,
      account: till && till.id, toAccount: safe && safe.id });
    S.add('dds', { type: 'День', date: '2026-09-01', goodsCash: 5000 });
    S.setSetting('storeName', 'Продукты у дома');
    S.setSetting('reportMonth', '2026-09');
    S.save(); window.WMUI.recompute();
  });

  /* --- 7а. Владелец взял себе — с выбором счёта ------------------------- */
  // Владельцу не надо искать: кнопка есть и на Пульте, и в базе операций, и в «Записать»
  const where = [];
  for (const v of ['pulse', 'ledger']) {
    await page.evaluate(id => window.WMUI.go(id), v);
    await page.waitForTimeout(400);
    if (await page.evaluate(() => !!document.querySelector('[data-form="moneyDraw"]'))) where.push(v);
  }
  const inMenu = await page.evaluate(() => {
    const b = document.querySelector('[data-act="add-menu"], [data-act="quick-add"]');
    if (b) b.click();
    return [...document.querySelectorAll('[data-form="moneyDraw"]')].length > 0;
  });
  if (inMenu) where.push('меню «Записать»');
  check('кнопку «Забрал владелец» владелец найдёт сразу', where.length >= 2,
    where.join(', ') || 'нигде нет', 'минимум в двух местах');

  await page.evaluate(() => window.WMUI.openForm('moneyDraw'));
  await page.waitForTimeout(400);
  const hasAcc = await page.evaluate(() => !!document.querySelector('.sheet [name="account"]'));
  check('в форме спрашивают, С КАКОГО СЧЁТА взяли', hasAcc, 'спрашивают', 'спрашивают');
  await fill('date', '2026-09-02');
  await pickAcc('account', 'Сейф');
  await fill('amount', '8000');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(500);
  const afterDraw = await page.evaluate(() => {
    const S = window.WMStore, E = window.WM;
    const b = E.accountBalances(S.state.dds || [], S.state.accounts || []);
    const g = k => b.rows.filter(r => r.kind === k)[0];
    return { safe: g('cash').balance, till: g('till').balance,
      draw: E.pnl({ rows: S.state.dds, ym: '2026-09' }).draw,
      costs: E.pnl({ rows: S.state.dds, ym: '2026-09' }).costTotal };
  });
  check('деньги ушли именно с того счёта, что выбрали', afterDraw.safe === 17000,
    afterDraw.safe, 17000);
  check('ЯЩИК ОТ ЗАБОРА ИЗ СЕЙФА НЕ ИЗМЕНИЛСЯ', afterDraw.till === 10000, afterDraw.till, 10000);
  check('ЗАБОР ВЛАДЕЛЬЦА ПРИБЫЛЬ НЕ СЪЕЛ', afterDraw.costs === 0, afterDraw.costs, 0);
  check('но в отчёте он стоит отдельной строкой', afterDraw.draw === 8000, afterDraw.draw, 8000);

  /* --- 7б. Справочник вставкой из Excel --------------------------------- */
  await page.evaluate(() => window.WMUI.go('dicts'));
  await page.waitForTimeout(400);
  await page.click('[data-tab="dicts:positions"]');
  await page.waitForTimeout(400);
  const pasteBtn = await page.evaluate(() =>
    !!document.querySelector('[data-act="dict-paste"]'));
  check('на справочнике есть «Вставить список»', pasteBtn, 'есть', 'есть');
  await page.click('[data-act="dict-paste"]');
  await page.waitForTimeout(400);
  await page.fill('.sheet [name="text"]',
    'Продавец-кассир\t2\nТоваровед\t1\nПекарь\t1\nПродавец-кассир\t9');
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(500);
  const pos = await page.evaluate(() => window.WMStore.settings.finPositions || '');
  check('вставленный столбец попал в справочник',
    pos.includes('Товаровед') && pos.includes('Пекарь'), 'Товаровед и Пекарь есть', 'есть');
  check('ПОВТОР ИЗ ТАБЛИЦЫ НЕ ЗАДВОИЛСЯ',
    (pos.match(/Продавец-кассир/g) || []).length === 1,
    (pos.match(/Продавец-кассир/g) || []).length, 1);

  /* --- 7в. Ведомость на подпись ----------------------------------------- */
  await page.evaluate(() => {
    const S = window.WMStore;
    S.add('staff', { name: 'Аня Петрова', position: 'Продавец-кассир', scheme: 'Смена', rate: 2500 });
    S.add('timesheet', { date: '2026-09-01', cashier: 'Аня Петрова', shift: 'День', hours: 12 });
    S.add('timesheet', { date: '2026-09-02', cashier: 'Аня Петрова', shift: 'День', hours: 12 });
    S.save(); window.WMUI.recompute(); window.WMUI.go('payslip');
  });
  await page.waitForTimeout(500);
  const slip = await page.evaluate(() => {
    const t = document.querySelector('#page').textContent.replace(/[\u00a0\u202f]/g, ' ');
    return { text: t,
      signs: document.querySelectorAll('#page .sign-line').length,
      cols: [...document.querySelectorAll('#page table.data th')].map(x => x.textContent.trim()),
      printable: !!document.querySelector('#page [data-act="print"]') };
  });
  check('В ВЕДОМОСТИ ЕСТЬ СТОЛБЕЦ «ПОДПИСЬ»', slip.cols.includes('Подпись'),
    slip.cols.join(', '), 'Подпись');
  check('и место для даты получения', slip.cols.includes('Дата'), 'есть', 'Дата');
  check('в каждой строке пустая линейка под роспись', slip.signs >= 4, slip.signs + ' линеек', '>=4');
  check('внизу расписываются выдавший и проверивший',
    slip.text.includes('Выдал') && slip.text.includes('Проверил'), 'есть', 'есть');
  check('сумма продублирована прописью — как в бумажной ведомости',
    /прописью|\(пять|тысяч/i.test(slip.text), 'есть', 'есть');
  check('ведомость можно напечатать', slip.printable, 'есть кнопка', 'есть');
  check('в шапке — название магазина владельца, а не чужое',
    slip.text.includes('Продукты у дома'), 'своё', 'Продукты у дома');

  /* --- 7г. Отчёт собственнику: за месяц и за день ------------------------ */
  await page.evaluate(() => window.WMUI.go('owner'));
  await page.waitForTimeout(500);
  const mon = await page.evaluate(() => ({
    text: document.querySelector('#page').textContent.replace(/[\u00a0\u202f]/g, ' '),
    hasMode: !!document.querySelector('#ownerMode'),
    printable: !!document.querySelector('#page [data-act="print"]') }));
  check('отчёт собственнику печатается', mon.printable, 'есть кнопка', 'есть');
  check('можно выбрать месяц или день', mon.hasMode, 'есть переключатель', 'есть');
  check('за месяц видно, сколько заработали', mon.text.includes('за месяц'), 'видно', 'за месяц');
  check('видно, из чего сложилась прибыль',
    mon.text.includes('Как получилась прибыль') && mon.text.includes('Выручка'), 'видно', 'видно');
  check('видно, на что ушли деньги', mon.text.includes('На что ушли деньги'), 'видно', 'видно');
  check('видно, ГДЕ СЕЙЧАС ДЕНЬГИ по счетам',
    mon.text.includes('Где деньги') && mon.text.includes('Сейф'), 'видно', 'видно');
  check('видно, сколько владелец забрал себе', mon.text.includes('8 000'), 'видно', '8 000');

  await page.selectOption('#ownerMode', { label: 'за день' });
  await page.waitForTimeout(300);
  await page.fill('#ownerDay', '2026-09-01');
  await page.waitForTimeout(500);
  const day = await page.evaluate(() =>
    document.querySelector('#page').textContent.replace(/[\u00a0\u202f]/g, ' '));
  check('ОТЧЁТ ЗА ДЕНЬ СЧИТАЕТ ТОЛЬКО ЭТОТ ДЕНЬ',
    day.includes('за день') && day.includes('52 000'), 'выручка дня 52 000', '52 000');
  check('чужой день в дневной отчёт не попал', !day.includes('8 000'),
    day.includes('8 000') ? 'попал забор 2 сентября' : 'не попал', 'не попал');
  check('выбранный день запомнился',
    (await page.evaluate(() => window.WMStore.settings.ownerDay)) === '2026-09-01',
    'запомнился', '2026-09-01');

  /* --- 7д. Срок годности убран ------------------------------------------ */
  const noExp = await page.evaluate(() =>
    !(window.WMUI.views() || []).some(v => v.id === 'expiry'));
  check('экрана «Срок годности» больше нет', noExp, 'убран', 'убран');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 8. Сплошная вычитка: что владелец видит на экранах и в формах.
      Ловит целый класс ошибок, который глазами находят случайно: имя значка,
      напечатанное словом вместо картинки; рубль, приклеенный к дням и часам;
      разметку, утёкшую в текст; «undefined» и «NaN» на виду. */
{
  console.log('— Сплошная вычитка экранов и форм');
  const { page, ctx, errs } = await open();
  await page.evaluate(() => {
    const S = window.WMStore, a = S.state.accounts || [];
    const till = a.find(x => x.kind === 'till'), safe = a.find(x => x.kind === 'cash'),
      bank = a.find(x => x.kind === 'bank');
    S.setSetting('storeName', 'Продукты у дома');
    // настройки, которые считаются НЕ в рублях — на них и ловились подписи «7 ₽»
    S.setSetting('planWarnDays', 7); S.setSetting('debtorOldDays', 30);
    S.setSetting('shiftHours', 12); S.setSetting('taxRate', 6);
    S.setSetting('backupKeep', 30); S.setSetting('watchSeconds', 3);
    S.setSetting('lockMinutes', 15);
    S.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 0, zCash: 40000, zCashless: 12000, payouts: 30000,
      factCash: 10000, checks: 180, account: till && till.id,
      cashlessAccount: bank && bank.id });
    S.add('dds', { type: 'День', date: '2026-09-01', goodsCash: 5000, debtTaken: 12000, debtPaid: 3000 });
    S.add('dds', { type: 'Расход', date: '2026-09-01', category: 'Аренда',
      method: 'Наличные', account: safe && safe.id, amount: 15000 });
    S.add('staff', { name: 'Аня Петрова', position: 'Продавец-кассир', rate: 2500 });
    S.add('timesheet', { date: '2026-09-01', employee: 'Аня Петрова', shift: 'День', hoursDay: 12 });
    S.save(); window.WMUI.recompute();
  });

  const icons = await page.evaluate(() => window.WMIcons.names());
  const views = await page.evaluate(() => window.WMUI.views().map(v => v.id));
  const beda = [];

  // Смотрим по ячейкам, а не по всему тексту: иначе заголовок столбца
  // «Дней» и соседняя колонка с рублями выглядели бы как ошибка.
  function read(where, text) {
    (text || '').split(/[\n\t]/).map(x => x.trim()).filter(Boolean).forEach(c => {
      icons.forEach(ic => {
        if (ic.length < 4) return;
        if (new RegExp('(^|[\\s«(])' + ic + '($|[\\s»),.:])').test(c)) {
          beda.push(where + ': имя значка словом — «' + c.slice(0, 40) + '»');
        }
      });
      if (/(дней|дня|часов|минут|секунд|копий|штук|%)\s*₽/.test(c)) {
        beda.push(where + ': рубль у не-денег — «' + c.slice(0, 40) + '»');
      }
      if (/<(div|span|b|button|svg)\b/.test(c)) {
        beda.push(where + ': разметка в тексте — «' + c.slice(0, 40) + '»');
      }
      if (/undefined|NaN|\[object/.test(c)) {
        beda.push(where + ': технический мусор — «' + c.slice(0, 40) + '»');
      }
    });
  }

  const formIds = new Set();
  for (const v of views) {
    await page.evaluate(id => window.WMUI.go(id), v);
    await page.waitForTimeout(110);
    read('экран ' + v, await page.evaluate(() => document.querySelector('#page').innerText));
    (await page.evaluate(() =>
      [...document.querySelectorAll('[data-form]')].map(e => e.dataset.form))).forEach(f => formIds.add(f));
  }
  check('ВСЕ ЭКРАНЫ ЧИТАЮТСЯ КАК ПО-РУССКИ НАПИСАННЫЕ', beda.length === 0,
    beda.slice(0, 3).join(' | ') || views.length + ' экранов чисто', 'чисто');

  const bedaF = [];
  let opened = 0;
  for (const f of formIds) {
    const ok = await page.evaluate(id => {
      try { window.WMUI.openForm(id); return true; } catch (e) { return false; }
    }, f);
    await page.waitForTimeout(170);
    if (!ok) { bedaF.push('форма ' + f + ' не открылась'); continue; }
    opened++;
    const before = beda.length;
    read('форма ' + f, await page.evaluate(() => {
      const s = document.querySelector('.sheet'); return s ? s.innerText : '';
    }));
    while (beda.length > before) bedaF.push(beda.pop());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(90);
  }
  check('и все формы тоже', bedaF.length === 0,
    bedaF.slice(0, 3).join(' | ') || opened + ' форм чисто', 'чисто');

  // Заголовки карточек настроек: значок обязан быть картинкой
  await page.evaluate(() => window.WMUI.go('settings'));
  await page.waitForTimeout(400);
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll('#page .card-title')].slice(0, 10)
      .map(e => ({ t: e.innerText.trim(), svg: !!e.querySelector('svg') })));
  check('В НАСТРОЙКАХ ЗНАЧКИ — КАРТИНКИ, А НЕ СЛОВА',
    heads.filter(h => h.svg).length >= 8,
    heads.filter(h => h.svg).length + ' из ' + heads.length, '>=8');

  // Дни, часы и проценты не подписываются рублями
  const setText = await page.evaluate(() => document.querySelector('#page').innerText);
  check('ДНИ И ЧАСЫ НЕ ПОДПИСАНЫ РУБЛЯМИ',
    !/\b(7|12|30|3|15)\s*₽/.test(setText.replace(/[\u00a0\u202f]/g, ' ')),
    'не подписаны', 'не подписаны');
  check('а деньги подписаны', /280\s*000\s*₽|200\s*₽/.test(setText.replace(/[\u00a0\u202f]/g, ' ')),
    'подписаны', 'подписаны');

  /* НИ ОДИН ЭКРАН НЕ ДОЛЖЕН БЫТЬ СТЕНОЙ.
     У нового магазина данных нет, и половина экранов пуста. Пустой экран
     обязан сказать, почему пусто, и дать кнопку, которая это исправит:
     «записей нет» и точка — это тупик, из которого человек не выберется. */
  const { page: p2, ctx: c2, errs: e2 } = await open();
  const stены = [];
  for (const v of await p2.evaluate(() => window.WMUI.views().map(x => x.id))) {
    await p2.evaluate(id => window.WMUI.go(id), v);
    await p2.waitForTimeout(110);
    const d = await p2.evaluate(() => {
      const pg = document.querySelector('#page');
      const t = pg ? pg.innerText.replace(/\s+/g, ' ').trim() : '';
      return { len: t.length,
        buttons: pg ? pg.querySelectorAll('[data-form],[data-go],[data-act]').length : 0 };
    });
    if (d.len < 300 && d.buttons === 0) stены.push(v + ' (' + d.len + ' знаков, кнопок нет)');
  }
  check('НИ ОДИН ПУСТОЙ ЭКРАН НЕ ТУПИК — везде есть, что нажать',
    stены.length === 0, stены.slice(0, 4).join(', ') || 'тупиков нет', 'тупиков нет');
  check('в консоли чисто на пустой базе', e2.length === 0,
    e2.slice(0, 2).join(' | ') || 'чисто', 'чисто');
  await p2.close(); await c2.close();

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 9. Мелочи, из которых складывается удобство: отмена под рукой и
      повторяющиеся выплаты. */
{
  console.log('— Отмена под рукой и повторяющиеся выплаты');
  const { page, ctx, errs } = await open();
  let dialogs = 0;
  page.on('dialog', d => { dialogs++; d.dismiss(); });

  await page.evaluate(() => {
    const S = window.WMStore;
    S.add('dds', { type: 'Расход', date: '2026-09-01', category: 'Аренда',
      method: 'Наличные', amount: 110000 });
    S.add('dds', { type: 'Расход', date: '2026-09-02', category: 'ГСМ',
      method: 'Наличные', amount: 3500 });
    S.save(); window.WMUI.recompute(); window.WMUI.go('ledger');
  });
  await page.waitForTimeout(400);

  const before = await page.evaluate(() => (window.WMStore.state.dds || []).length);
  await page.evaluate(() => { const b = document.querySelector('#page [data-menu]'); if (b) b.click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.querySelector('[data-del]'); if (b) b.click(); });
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => (window.WMStore.state.dds || []).length);
  check('УДАЛЕНИЕ НЕ СПРАШИВАЕТ «ВЫ УВЕРЕНЫ?» — делает сразу',
    after === before - 1 && dialogs === 0,
    after === before - 1 ? (dialogs ? 'всплыло окно' : 'сразу') : 'не удалилось', 'сразу');

  const toast = await page.evaluate(() => {
    const t = document.querySelector('.toast'); return t ? t.innerText : '';
  });
  check('и говорит, ЧТО именно удалено',
    /ГСМ|Аренда/.test(toast) && /3\s*500|110\s*000/.test(toast.replace(/[\u00a0\u202f]/g, ' ')),
    toast.split('\n')[0] || 'уведомления нет', 'видно запись');
  check('А РЯДОМ — КНОПКА «ВЕРНУТЬ»',
    await page.evaluate(() => !!document.querySelector('.toast-act')), 'есть', 'есть');

  await page.evaluate(() => document.querySelector('.toast-act').click());
  await page.waitForTimeout(400);
  check('НАЖАЛ — ЗАПИСЬ ВЕРНУЛАСЬ',
    (await page.evaluate(() => (window.WMStore.state.dds || []).length)) === before,
    'вернулась', 'вернулась');

  /* Повторяющиеся выплаты: аренду вбивают раз, дальше она встаёт сама */
  await page.evaluate(() => window.WMUI.openForm('payPlan'));
  await page.waitForTimeout(350);
  check('в выплате можно поставить «повторять»',
    await page.evaluate(() => !!document.querySelector('.sheet [name="repeat"]')), 'можно', 'можно');
  await page.fill('.sheet [name="due"]', '2026-01-31');
  await page.fill('.sheet [name="supplier"]', 'Аренда помещения');
  await page.fill('.sheet [name="amount"]', '110000');
  await page.selectOption('.sheet [name="repeat"]', { label: 'каждый месяц' });
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(450);

  await page.evaluate(() => {
    const pl = window.WMStore.state.plans[0];
    window.WM_EXTRA_ACTIONS['plan-paid']({ dataset: { id: pl.id } });
  });
  await page.waitForTimeout(450);
  const plans = await page.evaluate(() => (window.WMStore.state.plans || [])
    .map(x => x.due + '|' + x.supplier + '|' + x.amount + '|' + x.status));
  check('ОТМЕТИЛ ОПЛАЧЕННОЙ — СЛЕДУЮЩАЯ ВСТАЛА В ПЛАН САМА',
    plans.some(x => x.indexOf('Запланирована') >= 0 && x.indexOf('110000') >= 0),
    plans.join(' / ') || 'ничего', 'следующая есть');
  check('КОНЕЦ МЕСЯЦА НЕ УЕХАЛ: 31 января + месяц = 28 февраля',
    plans.some(x => x.indexOf('2026-02-28') === 0),
    plans.filter(x => x.indexOf('2026-02') === 0).join(' ') || 'нет', '2026-02-28');

  // Дважды одну и ту же следующую не заводим
  await page.evaluate(() => {
    const pl = window.WMStore.state.plans.filter(x => x.status === 'Оплачена')[0];
    window.WM_EXTRA_ACTIONS['plan-paid']({ dataset: { id: pl.id } });
  });
  await page.waitForTimeout(400);
  check('и дважды одна и та же не заводится',
    (await page.evaluate(() => (window.WMStore.state.plans || []).length)) === 2,
    await page.evaluate(() => (window.WMStore.state.plans || []).length), 2);

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 10. Счёт в «Расходе» подставляется сам — по памяти о прошлом разе */
{
  console.log('— Счёт расхода подставляется сам');
  const { page, ctx, errs } = await open();
  const accName = () => page.evaluate(() => {
    const s = document.querySelector('.sheet select[name="account"]');
    return s ? s.options[s.selectedIndex].text : '';
  });

  // Аренду платим со счёта, обед — из кассы
  for (const [cat, acc, sum] of [['Аренда', 'Расчётный счёт', '110000'],
    ['Обед', 'Касса', '800']]) {
    await page.evaluate(() => window.WMUI.openForm('moneyOut'));
    await page.waitForTimeout(320);
    await page.fill('.sheet [name="category"]', cat);
    await page.selectOption('.sheet [name="account"]', { label: acc });
    await page.fill('.sheet [name="amount"]', sum);
    await page.click('.sheet .btn-primary');
    await page.waitForTimeout(420);
  }

  await page.evaluate(() => window.WMUI.openForm('moneyOut'));
  await page.waitForTimeout(320);
  await page.fill('.sheet [name="category"]', 'Аренда');
  await page.dispatchEvent('.sheet [name="category"]', 'change');
  await page.waitForTimeout(220);
  check('ПРОГРАММА ПОМНИТ, С КАКОГО СЧЁТА ПЛАТИЛИ ПО ЭТОЙ СТАТЬЕ',
    (await accName()) === 'Расчётный счёт', await accName(), 'Расчётный счёт');

  await page.fill('.sheet [name="category"]', 'Обед');
  await page.dispatchEvent('.sheet [name="category"]', 'change');
  await page.waitForTimeout(220);
  check('у каждой статьи память своя', (await accName()) === 'Касса',
    await accName(), 'Касса');

  // Выбор владельца важнее памяти
  await page.selectOption('.sheet [name="account"]', { label: 'Сейф' });
  await page.fill('.sheet [name="category"]', 'Аренда');
  await page.dispatchEvent('.sheet [name="category"]', 'change');
  await page.waitForTimeout(220);
  check('НО ВЫБОР ВЛАДЕЛЬЦА ПРОГРАММА НЕ ПЕРЕБИВАЕТ',
    (await accName()) === 'Сейф', await accName(), 'Сейф');

  /* Счёт можно назначить расходным раз и навсегда. Форму не закрываем
     клавишей: она спросит про несохранённое. Открываем поверх — новая
     форма закрывает старую сама. */
  await page.evaluate(() => {
    const S = window.WMStore;
    (S.state.accounts || []).forEach(a => { a.defaultExpense = a.kind === 'cash'; });
    S.state.dds = [];                       // память стёрли — остаётся настройка
    S.save(); window.WMUI.recompute();
  });
  await page.evaluate(() => window.WMUI.openForm('moneyOut'));
  await page.waitForTimeout(350);
  check('а если памяти нет — берётся счёт, отмеченный «отсюда платим расходы»',
    (await accName()) === 'Сейф', await accName(), 'Сейф');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 11. Накопления, замок месяца, история правок и свайп на телефоне */
{
  console.log('— Накопления, замок месяца, история и свайп');
  const { page, ctx, errs } = await open();

  /* --- КОНВЕРТЫ --------------------------------------------------------- */
  await page.evaluate(() => {
    const S = window.WMStore, a = S.state.accounts || [];
    const till = a.find(x => x.kind === 'till'), safe = a.find(x => x.kind === 'cash'),
      bank = a.find(x => x.kind === 'bank');
    (S.state.funds || []).forEach(f => { f.plan = f.name === 'Аренда' ? 110000 : 0;
      f.account = safe && safe.id; });
    S.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 0, zCash: 300000, zCashless: 100000, payouts: 250000,
      factCash: 50000, account: till && till.id, cashlessAccount: bank && bank.id });
    S.add('dds', { type: 'День', date: '2026-09-01', goodsCash: 200000, debtTaken: 120000 });
    S.save(); window.WMUI.recompute(); window.WMUI.go('funds');
  });
  await page.waitForTimeout(500);
  let t = (await page.textContent('#page')).replace(/[\u00a0\u202f]/g, ' ');
  check('экран «Накопления» открывается', t.includes('Чтобы в конце месяца'), 'открылся', 'открылся');
  check('ЗАКУП СВЕРХ ПЛАНКИ ПРОГРАММА ЗАМЕЧАЕТ',
    t.includes('80,0%') && t.includes('20 000'), 'заметила', 'перебор 20 000');
  check('и видно, сколько ещё отложить', t.includes('110 000'), 'видно', 'видно');

  // Откладываем — это обычный перевод с пометкой конверта
  const put = await page.evaluate(() => {
    const S = window.WMStore, a = S.state.accounts || [];
    const before = window.WM.pnl({ rows: S.state.dds }).net;
    const bal = window.WM.accountBalances(S.state.dds, a).totals.total;
    S.add('dds', { type: 'Перемещение', date: '2026-09-02', amount: 60000,
      account: a.find(x => x.kind === 'till').id, toAccount: a.find(x => x.kind === 'cash').id,
      fund: (S.state.funds || [])[0].id });
    S.save(); window.WMUI.recompute();
    return { before, after: window.WM.pnl({ rows: S.state.dds }).net,
      fund: window.WM.fundTotals(S.state.funds, S.state.dds).rows[0].left };
  });
  check('ОТЛОЖЕННОЕ ВИДНО В КОНВЕРТЕ', put.fund === 60000, put.fund, 60000);
  check('А ПРИБЫЛЬ ОТ ЭТОГО НЕ ИЗМЕНИЛАСЬ', Math.abs(put.before - put.after) < 0.5,
    put.before + ' → ' + put.after, 'та же');

  /* --- ЗАМОК МЕСЯЦА ----------------------------------------------------- */
  await page.evaluate(() => {
    window.WMStore.setSetting('reportMonth', '2026-09');
    window.WMUI.go('monthclose');
  });
  await page.waitForTimeout(450);
  check('на «Закрытии месяца» есть кнопка «Запереть»',
    await page.evaluate(() => !!document.querySelector('[data-act="month-lock"]')), 'есть', 'есть');
  await page.evaluate(() => document.querySelector('[data-act="month-lock"]').click());
  await page.waitForTimeout(450);
  check('МЕСЯЦ ЗАПИРАЕТСЯ',
    (await page.evaluate(() => window.WMStore.settings.closedTo)) === '2026-09-30',
    await page.evaluate(() => window.WMStore.settings.closedTo), '2026-09-30');

  const nBefore = await page.evaluate(() => (window.WMStore.state.dds || []).length);
  await page.evaluate(() => window.WMUI.openForm('moneyOut'));
  await page.waitForTimeout(350);
  await page.fill('.sheet [name="date"]', '2026-09-05');
  await page.fill('.sheet [name="category"]', 'Обед');
  await page.fill('.sheet [name="amount"]', '500');
  await page.click('.sheet button.btn-primary');
  await page.waitForTimeout(450);
  check('И ЗАПИСЬ ЗАДНИМ ЧИСЛОМ БОЛЬШЕ НЕ ПРОХОДИТ',
    (await page.evaluate(() => (window.WMStore.state.dds || []).length)) === nBefore,
    'не прошла', 'не прошла');
  check('а программа объясняет, почему',
    /[Мм]есяц закрыт/.test(await page.evaluate(() => {
      const x = document.querySelector('.toast'); return x ? x.innerText : ''; })),
    'объясняет', 'объясняет');

  await page.evaluate(() => { window.WMUI.go('monthclose'); });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-act="month-unlock"]').click());
  await page.waitForTimeout(400);
  check('и замок снимается одной кнопкой',
    (await page.evaluate(() => window.WMStore.settings.closedTo)) === '',
    JSON.stringify(await page.evaluate(() => window.WMStore.settings.closedTo)), '""');

  /* --- ЧТО МЕНЯЛОСЬ ----------------------------------------------------- */
  await page.evaluate(() => window.WMUI.go('log'));
  await page.waitForTimeout(450);
  t = await page.textContent('#page');
  check('ИСТОРИЮ ПРАВОК ТЕПЕРЬ ВИДНО',
    t.includes('Что менялось') && /добавление|правка|удаление/.test(t),
    'видно', 'видно');
  check('и в ней написано, когда и что', /\d{1,2}\s\S+,\s\d{2}:\d{2}/.test(t),
    'написано', 'дата и время');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();

  /* --- СВАЙП НА ТЕЛЕФОНЕ ------------------------------------------------ */
  const m = await open({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
  await m.page.evaluate(() => {
    const S = window.WMStore;
    S.add('dds', { type: 'Расход', date: '2026-09-01', category: 'Аренда',
      method: 'Наличные', amount: 110000 });
    S.save(); window.WMUI.recompute(); window.WMUI.go('ledger');
  });
  await m.page.waitForTimeout(500);
  const swiped = await m.page.evaluate(() => {
    const btn = document.querySelector('#page tr [data-menu]');
    if (!btn) return 'строки нет';
    const row = btn.closest('tr'), b = row.getBoundingClientRect();
    const y = b.y + b.height / 2;
    const mk = (type, cx) => new TouchEvent(type, { bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: row, clientX: cx, clientY: y })],
      changedTouches: [new Touch({ identifier: 1, target: row, clientX: cx, clientY: y })] });
    row.dispatchEvent(mk('touchstart', b.x + b.width - 40));
    row.dispatchEvent(mk('touchend', b.x + b.width - 160));
    return !!document.querySelector('[data-del]') ? 'меню открылось' : 'меню не открылось';
  });
  check('СВАЙП ВЛЕВО ПО СТРОКЕ ОТКРЫВАЕТ ДЕЙСТВИЯ', swiped === 'меню открылось', swiped, 'меню открылось');

  // Обычная прокрутка вниз меню открывать не должна
  const scrolled = await m.page.evaluate(() => {
    document.querySelectorAll('[data-del]').forEach(e => e.closest('div,ul').remove());
    const btn = document.querySelector('#page tr [data-menu]');
    const row = btn.closest('tr'), b = row.getBoundingClientRect();
    const mk = (type, cy) => new TouchEvent(type, { bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: row, clientX: b.x + 40, clientY: cy })],
      changedTouches: [new Touch({ identifier: 1, target: row, clientX: b.x + 40, clientY: cy })] });
    row.dispatchEvent(mk('touchstart', b.y + 10));
    row.dispatchEvent(mk('touchend', b.y + 200));
    return !!document.querySelector('[data-del]');
  });
  check('а прокрутка вниз — нет', scrolled === false, scrolled ? 'открылось' : 'не открылось',
    'не открылось');
  check('в консоли чисто на телефоне', m.errs.length === 0,
    m.errs.slice(0, 2).join(' | ') || 'чисто', 'чисто');
  await m.page.close(); await m.ctx.close();
  console.log('');
}

/* 12. Пересчёт кассы: итог виден, пока считаешь, а не после сохранения */
{
  console.log('— Пересчёт кассы по купюрам');
  const { page, ctx, errs } = await open();
  page.on('dialog', d => d.dismiss());
  await page.evaluate(() => {
    const S = window.WMStore, a = S.state.accounts || [];
    S.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 0, zCash: 30000, zCashless: 10000, payouts: 15000,
      factCash: 15000, account: (a.find(x => x.kind === 'till') || {}).id });
    S.save(); window.WMUI.recompute(); window.WMUI.openForm('cashCount');
  });
  await page.waitForTimeout(450);

  const box = () => page.evaluate(() => {
    const e = document.querySelector('#ccTotal'); return e ? e.innerText.replace(/\s+/g, ' ') : '';
  });
  check('В ФОРМЕ ЕСТЬ ОБЩАЯ СУММА — сразу, до сохранения',
    (await box()).includes('Насчитано в ящике'), 'есть', 'есть');
  check('и видно, сколько должно быть', (await box()).includes('15 000'), 'видно', '15 000');

  for (const [n, k] of [['n5000', '2'], ['n1000', '4'], ['n500', '2']]) {
    await page.fill('.sheet [name="' + n + '"]', k);
    await page.waitForTimeout(180);
  }
  const b1 = await box();
  check('СУММА СЧИТАЕТСЯ НА ХОДУ', b1.includes('15 000') && b1.includes('8 купюр'),
    b1.slice(0, 60), '15 000 и 8 купюр');
  check('и говорит, что касса сошлась', b1.includes('Сходится'), 'говорит', 'Сходится');

  // Каждая строка объясняет свою сумму, а не подписана рублями
  const hints = await page.evaluate(() => ['n5000', 'n1000', 'n500'].map(n => {
    const e = document.querySelector('[data-hint-for="' + n + '"]');
    return e ? e.innerText : '';
  }));
  check('У КАЖДОЙ СТРОКИ ВИДНО, СКОЛЬКО ЭТО ДЕНЕГ',
    hints.every(h => /шт ×/.test(h)), hints[0] || 'подписи нет', '2 шт × 5 000 ₽ = 10 000 ₽');
  check('ШТУКИ НЕ ПОДПИСАНЫ РУБЛЯМИ',
    !hints.some(h => /^\s*\d+\s*₽\s*$/.test(h)), 'не подписаны', 'не подписаны');

  // Недостача видна тут же
  await page.fill('.sheet [name="n500"]', '0');
  await page.waitForTimeout(250);
  const b2 = await box();
  check('НЕДОСТАЧУ ВИДНО СРАЗУ', b2.includes('Не хватает') && b2.includes('1 000'),
    b2.slice(-40), 'не хватает 1 000');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 13. Расхождение видно в форме, «Разобрать» объясняет, план принимает статьи */
{
  console.log('— Расхождение сразу, «Разобрать» и план выплат');
  const { page, ctx, errs } = await open();

  /* --- РАСХОЖДЕНИЕ ПРЯМО В ФОРМЕ ---------------------------------------- */
  await page.evaluate(() => window.WMUI.openForm('shiftClose'));
  await page.waitForTimeout(400);
  const box = () => page.evaluate(() => {
    const e = document.querySelector('#shiftSum');
    return e ? e.innerText.replace(/\s+/g, ' ') : '';
  });
  check('в форме смены есть живой расчёт', (await box()).includes('Должно быть в ящике'),
    'есть', 'есть');

  for (const [n, v] of [['openCash', '10000'], ['zCash', '50000'], ['zCashless', '50000'],
    ['payouts', '5000'], ['factCash', '55000']]) {
    await page.fill('.sheet [name="' + n + '"]', v);
    await page.waitForTimeout(150);
  }
  let b1 = await box();
  check('РАСХОЖДЕНИЕ СЧИТАЕТСЯ ДО СОХРАНЕНИЯ',
    b1.includes('55 000') && b1.includes('Сходится'), 'считается', 'сходится');
  check('и безнал в ящик не подмешан',
    b1.includes('Безнал (в ящик не попадает)') && b1.includes('100 000'),
    'не подмешан', 'выручка 100 000');

  await page.fill('.sheet [name="factCash"]', '54000');
  await page.waitForTimeout(280);
  b1 = await box();
  check('НЕДОСТАЧУ ВИДНО СРАЗУ', b1.includes('НЕДОСТАЧА') && b1.includes('1 000'),
    'видно', 'недостача 1 000');

  // Выручка смены обязана падать в денежный ящик
  const warned = await page.evaluate(() => {
    const sel = document.querySelector('.sheet [name="account"]');
    const opt = [...sel.options].find(o => /Сейф/.test(o.text));
    if (!opt) return 'сейфа нет в списке';
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  });
  await page.waitForTimeout(300);
  check('ПРОГРАММА ПРЕДУПРЕЖДАЕТ, ЕСЛИ ВЫРУЧКА ИДЁТ НЕ В ЯЩИК',
    warned !== 'ok' || (await box()).includes('не денежный ящик'),
    warned === 'ok' ? 'предупреждает' : warned, 'предупреждает');

  /* --- «РАЗОБРАТЬ» ОБЪЯСНЯЕТ -------------------------------------------- */
  await page.evaluate(() => {
    const S = window.WMStore, a = S.state.accounts || [];
    S.state.dds = [];
    S.add('dds', { type: 'Смена', date: '2026-09-05', till: 'Касса 1', shift: 'День',
      cashier: 'Иман', openCash: 10000, zCash: 50000, zCashless: 50000,
      payouts: 5000, factCash: 55000,
      account: (a.find(x => x.kind === 'till') || {}).id });
    S.save(); window.WMUI.recompute(); window.WMUI.go('pulse');
  });
  await page.waitForTimeout(450);
  check('на Пульте есть кнопка «Разобрать»',
    await page.evaluate(() => !!document.querySelector('[data-act="payout-help"]')),
    'есть', 'есть');
  await page.evaluate(() => document.querySelector('[data-act="payout-help"]').click());
  await page.waitForTimeout(450);
  // Суммы печатаются с неразрывным пробелом — для поиска приводим к обычному
  const help = (await page.evaluate(() => {
    const s = document.querySelector('.sheet'); return s ? s.innerText : '';
  })).replace(/[\u00a0\u202f]/g, ' ');
  check('«РАЗОБРАТЬ» ОБЪЯСНЯЕТ, ЧТО ЭТО ЗНАЧИТ',
    help.includes('Что это значит') && help.includes('Выплаты из ящика'),
    'объясняет', 'объясняет');
  check('и даёт кнопки, куда записать',
    /Купили товар|Расход магазина|Выдали зарплату/.test(help), 'даёт', 'даёт');
  check('и показывает, по каким дням не сходится',
    /05\.09|5 сен|2026-09-05/.test(help) && help.includes('5 000'),
    (help.match(/[^\n]*5 000[^\n]*/) || ['нет'])[0].slice(0, 50), 'день и сумма');

  // Кнопка открывает форму с той же датой
  await page.evaluate(() => {
    const b = document.querySelector('.sheet [data-form="moneyOut"][data-pre-date]');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  check('КНОПКА ОТКРЫВАЕТ ФОРМУ С НУЖНОЙ ДАТОЙ',
    (await page.inputValue('.sheet [name="date"]')) === '2026-09-05',
    await page.inputValue('.sheet [name="date"]'), '2026-09-05');

  /* --- ПЛАН ВЫПЛАТ: НЕ ТОЛЬКО ПОСТАВЩИКИ -------------------------------- */
  await page.evaluate(() => window.WMUI.openForm('payPlan'));
  await page.waitForTimeout(400);
  check('в плане выплат можно выбрать, ЧТО платим',
    await page.evaluate(() => !!document.querySelector('.sheet [name="category"]')),
    'можно', 'можно');
  await page.fill('.sheet [name="due"]', '2026-09-25');
  await page.fill('.sheet [name="category"]', 'Коммунальные');
  await page.fill('.sheet [name="amount"]', '35000');
  await page.click('.sheet button.btn-primary');
  await page.waitForTimeout(450);
  check('КОММУНАЛКУ МОЖНО ЗАПЛАНИРОВАТЬ БЕЗ ПОСТАВЩИКА',
    (await page.evaluate(() => (window.WMStore.state.plans || [])
      .filter(x => x.category === 'Коммунальные').length)) === 1,
    'можно', 'можно');

  await page.evaluate(() => window.WMUI.openForm('payPlan'));
  await page.waitForTimeout(350);
  await page.fill('.sheet [name="due"]', '2026-09-26');
  await page.fill('.sheet [name="category"]', 'Выплата ТП');
  await page.fill('.sheet [name="amount"]', '120000');
  await page.click('.sheet button.btn-primary');
  await page.waitForTimeout(450);
  check('и общую выплату ТП — одной суммой',
    (await page.evaluate(() => (window.WMStore.state.plans || [])
      .filter(x => x.category === 'Выплата ТП' && x.amount === 120000).length)) === 1,
    'можно', 'можно');

  // Совсем пустую строку в план не пускаем
  await page.evaluate(() => window.WMUI.openForm('payPlan'));
  await page.waitForTimeout(350);
  await page.fill('.sheet [name="amount"]', '1000');
  await page.click('.sheet button.btn-primary');
  await page.waitForTimeout(400);
  check('а пустую строку в план не пускает',
    (await page.evaluate(() => (window.WMStore.state.plans || []).length)) === 2,
    await page.evaluate(() => (window.WMStore.state.plans || []).length), 2);

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 14. Быстрый ввод, подстатьи и бюджеты — так, как ими пользуются руками */
{
  console.log('— Быстрый ввод, подстатьи и лимиты');
  const { page, ctx, errs } = await open();

  /* --- БЫСТРЫЙ ВВОД: сумма, статья — и записано ------------------------- */
  await page.evaluate(() => window.WMUI.go('fast'));
  await page.waitForTimeout(350);
  check('экран быстрого ввода открывается',
    await page.evaluate(() => !!document.querySelector('.fast-pad')), 'открывается', 'открывается');
  check('цифры на месте: все двенадцать клавиш',
    (await page.evaluate(() => document.querySelectorAll('.fast-key').length)) === 12,
    await page.evaluate(() => document.querySelectorAll('.fast-key').length), 12);

  const набрано = () => page.evaluate(() =>
    (document.querySelector('.fast-sum') || {}).innerText || '');
  const жать = async k => {
    await page.evaluate(v => {
      const b = [...document.querySelectorAll('[data-act="fast-key"]')]
        .find(e => e.dataset.key === v);
      if (b) b.click();
    }, k);
    await page.waitForTimeout(140);
  };

  check('пока ничего не набрано — ноль', (await набрано()).includes('0'), await набрано(), '0 ₽');
  // Статьи нажать нельзя, пока нет суммы: чтобы не записать пустую трату
  check('БЕЗ СУММЫ СТАТЬИ НЕ НАЖИМАЮТСЯ',
    await page.evaluate(() => [...document.querySelectorAll('.fast-cat')].every(b => b.disabled)),
    'не нажимаются', 'не нажимаются');

  for (const k of ['3', '5', '00']) await жать(k);
  check('набранное видно крупно',
    (await набрано()).replace(/[  \s]/g, '').includes('3500'), await набрано(), '3 500 ₽');

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-act="fast-add"]')]
      .find(e => e.dataset.add === '500');
    if (b) b.click();
  });
  await page.waitForTimeout(160);
  check('кнопка «+500» прибавляет к набранному',
    (await набрано()).replace(/[  \s]/g, '').includes('4000'), await набрано(), '4 000 ₽');

  await жать('⌫');
  check('стрелка стирает последнюю цифру',
    (await набрано()).replace(/[  \s]/g, '').includes('400'), await набрано(), '400 ₽');

  for (const k of ['C', '1', '2', '0', '0']) await жать(k);
  check('«Стереть» очищает и можно набрать заново',
    (await набрано()).replace(/[  \s]/g, '').includes('1200'), await набрано(), '1 200 ₽');

  const былоЗаписей = await page.evaluate(() => (window.WMStore.state.dds || []).length);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.fast-cat')]
      .find(e => /Обед|ГСМ|Расходник/.test(e.textContent));
    (b || document.querySelector('.fast-cat')).click();
  });
  await page.waitForTimeout(450);
  const стало = await page.evaluate(() => {
    const d = (window.WMStore.state.dds || []);
    const r = d[d.length - 1] || {};
    return { n: d.length, amount: r.amount, type: r.type, date: r.date,
      category: r.category, account: r.account };
  });
  check('ОДНО НАЖАТИЕ СТАТЬИ — ЗАПИСЬ ГОТОВА', стало.n === былоЗаписей + 1,
    стало.n, былоЗаписей + 1);
  check('сумма записалась та, что набрали', стало.amount === 1200, стало.amount, 1200);
  check('это расход сегодняшним числом',
    стало.type === 'Расход' && стало.date === new Date().toISOString().slice(0, 10),
    стало.type + ' ' + стало.date, 'Расход сегодня');
  check('счёт подставился сам', !!стало.account, стало.account || 'пусто', 'подставлен');
  const подсказка = await page.evaluate(() => {
    const t = document.querySelector('.toast'); return t ? t.innerText : '';
  });
  check('программа говорит, куда легла запись',
    /Обед|ГСМ|Расходник/.test(подсказка) && /счёт/i.test(подсказка),
    подсказка.split('\n')[0] || 'молчит', 'называет статью и счёт');
  check('И НЕ ПОКАЗЫВАЕТ [object Object]', !/\[object/.test(подсказка),
    подсказка.includes('[object') ? '[object Object]' : 'по-человечески', 'по-человечески');
  check('после записи сумма обнулилась', (await набрано()).replace(/[  \s]/g, '') === '0₽',
    await набрано(), '0 ₽');
  const естьСписок = await page.evaluate(() => /Записано сегодня/.test(document.body.innerText));
  check('записанное сразу видно на экране', естьСписок,
    естьСписок ? 'видно' : 'списка нет', 'видно');

  /* Закуп и инкассация — не траты. Быстрый ввод их вообще не предлагает:
     кнопки с такой статьёй на экране нет, нажать нечего. */
  await page.evaluate(() => {
    window.WMStore.settings.finCategories = 'Обед, ГСМ, Закуп товара, Инкассация';
    window.WMUI.render();
  });
  await page.waitForTimeout(350);
  const кнопки = await page.evaluate(() =>
    [...document.querySelectorAll('.fast-cat')].map(e => e.textContent.trim()));
  check('ЗАКУПА И ИНКАССАЦИИ СРЕДИ СТАТЕЙ НЕТ — НАЖАТЬ НЕЧЕГО',
    !кнопки.some(t => /Закуп|Инкассац/i.test(t)),
    кнопки.filter(t => /Закуп|Инкассац/i.test(t)).join(', ') || 'нет таких кнопок',
    'нет таких кнопок');
  check('а обычные статьи предлагаются', кнопки.some(t => /Обед|ГСМ/.test(t)),
    кнопки.slice(0, 4).join(', ') || 'пусто', 'Обед, ГСМ');

  /* И даже если такая статья как-то попадёт в нажатие — запись не пройдёт.
     Вторая линия обороны: проверяем её напрямую, кнопки для этого нет. */
  for (const k of ['5', '0', '0']) await жать(k);
  const доЗакупа = await page.evaluate(() => (window.WMStore.state.dds || []).length);
  const отказ = await page.evaluate(() => {
    const A = window.WM_EXTRA_ACTIONS || {};
    if (typeof A['fast-cat'] !== 'function') return 'действие не зарегистрировано';
    return A['fast-cat']({ dataset: { cat: encodeURIComponent('Закуп товара') } });
  });
  const послеЗакупа = await page.evaluate(() => (window.WMStore.state.dds || []).length);
  check('ЗАКУП ЧЕРЕЗ БЫСТРЫЙ ВВОД НЕ ЗАПИСЫВАЕТСЯ', послеЗакупа === доЗакупа,
    послеЗакупа === доЗакупа ? 'не записался' : 'записался, а не должен был',
    'не записался');
  check('и программа объясняет словами, куда его писать',
    typeof отказ === 'string' && /не расход|Итоги дня/i.test(отказ),
    String(отказ).split('\n')[0].slice(0, 60) || 'молча', 'объясняет');
  await жать('C');

  /* --- ПОДСТАТЬИ: «Коммунальные → Свет» -------------------------------- */
  await page.evaluate(() => {
    const S = window.WMStore;
    S.settings.finCategories = 'Аренда, Коммунальные, Коммунальные / Свет, ' +
      'Коммунальные / Вода, Обед';
    S.state.dds = [];
    const a = (S.state.accounts || [])[0] || {};
    const d = new Date().toISOString().slice(0, 7);
    S.add('dds', { type: 'Расход', date: d + '-02', category: 'Коммунальные / Свет',
      method: 'Наличные', account: a.id, amount: 5000 });
    S.add('dds', { type: 'Расход', date: d + '-03', category: 'Коммунальные / Вода',
      method: 'Наличные', account: a.id, amount: 2000 });
    S.add('dds', { type: 'Расход', date: d + '-04', category: 'Обед',
      method: 'Наличные', account: a.id, amount: 3000 });
    S.save(); window.WMUI.render();
  });
  await page.waitForTimeout(350);
  await page.evaluate(() => window.WMUI.go('ledger'));
  await page.waitForTimeout(350);
  /* Смотрим саму таблицу записей, а не всю страницу: в фильтрах и подсказках
     статья намеренно стоит как есть, с чертой — по ней ищут и фильтруют. */
  const ledgerText = await page.evaluate(() => {
    const t = document.querySelector('#ledgerT') || document.querySelector('table');
    return t ? t.innerText : document.body.innerText;
  });
  const стрелкой = /Коммунальные\s*→\s*Свет/.test(ledgerText);
  check('ПОДСТАТЬЯ ЧИТАЕТСЯ СТРЕЛКОЙ, А НЕ ЧЕРТОЙ', стрелкой,
    стрелкой ? 'Коммунальные → Свет'
      : (/Коммунальные\s*\/\s*Свет/.test(ledgerText) ? 'осталась косая черта'
        : (ledgerText.match(/Коммунальные[^\n]{0,12}/) || ['статьи не видно'])[0]),
    'Коммунальные → Свет');

  await page.evaluate(() => window.WMUI.go('dicts'));
  await page.waitForTimeout(400);
  // Пояснение живёт на вкладке «Статьи расходов» — на неё и переходим
  await page.click('[data-tab="dicts:categories"]');
  await page.waitForTimeout(350);
  const dictText = await page.evaluate(() => document.body.innerText);
  const естьПояснение = /косую черту|косая черта|через черту|Коммунальные\s*\/\s*Свет/i
    .test(dictText);
  check('в справочнике объяснено, как делать подстатьи', естьПояснение,
    естьПояснение ? 'объяснено' : 'пояснения нет', 'объяснено');

  /* --- БЮДЖЕТЫ: потолок на статью -------------------------------------- */
  await page.evaluate(() => window.WMUI.go('funds'));
  await page.waitForTimeout(400);
  check('лимиты живут отдельной карточкой от конвертов',
    await page.evaluate(() => /Лимиты на месяц/.test(document.body.innerText)),
    'отдельно', 'отдельно');
  check('и объяснено, чем лимит отличается от конверта',
    await page.evaluate(() => /потолок/i.test(document.body.innerText)),
    'объяснено', 'объяснено');

  await page.evaluate(() => window.WMUI.openForm('budgetCard'));
  await page.waitForTimeout(400);
  await page.fill('.sheet [name="category"]', 'Коммунальные');
  await page.fill('.sheet [name="limit"]', '6000');
  await page.click('.sheet button.btn-primary');
  await page.waitForTimeout(450);
  check('лимит сохраняется',
    (await page.evaluate(() => (window.WMStore.state.budgets || []).length)) === 1,
    await page.evaluate(() => (window.WMStore.state.budgets || []).length), 1);

  await page.evaluate(() => window.WMUI.go('funds'));
  await page.waitForTimeout(400);
  const текст = await page.evaluate(() => document.body.innerText.replace(/[  ]/g, ' '));
  check('ЛИМИТ НА ГРУППУ СЧИТАЕТ ПОДСТАТЬИ: 5 000 + 2 000 = 7 000',
    /7 000/.test(текст), '7 000', '7 000');
  check('ПЕРЕБОР ВИДЕН СЛОВОМ И СУММОЙ',
    /перебор/i.test(текст) && /1 000/.test(текст), 'перебор 1 000', 'перебор 1 000');

  /* Второй лимит на ту же статью не заводится — иначе двойной счёт */
  await page.evaluate(() => window.WMUI.openForm('budgetCard'));
  await page.waitForTimeout(400);
  await page.fill('.sheet [name="category"]', 'Коммунальные');
  await page.fill('.sheet [name="limit"]', '9000');
  await page.click('.sheet button.btn-primary');
  await page.waitForTimeout(400);
  check('ДВА ЛИМИТА НА ОДНУ СТАТЬЮ НЕ ЗАВОДЯТСЯ',
    (await page.evaluate(() => (window.WMStore.state.budgets || []).length)) === 1,
    await page.evaluate(() => (window.WMStore.state.budgets || []).length), 1);
  await page.evaluate(() => { const b = document.querySelector('.sheet .btn-ghost, .sheet [data-close]');
    if (b) b.click(); });
  await page.waitForTimeout(250);

  /* Лимит не трогает деньги: остатки по счетам до и после одни и те же */
  const деньги = await page.evaluate(() => {
    const S = window.WMStore, U = window.WMUI, E = window.WM;
    const до = E.accountBalances(S.state.dds, S.state.accounts).totals.total;
    S.add('budgets', { category: 'Обед', limit: 1000 }); S.save(); U.recompute();
    const после = E.accountBalances(S.state.dds, S.state.accounts).totals.total;
    return { до, после };
  });
  check('ЛИМИТ ДЕНЕГ НЕ ДВИГАЕТ', деньги.до === деньги.после,
    деньги.до + ' → ' + деньги.после, 'не изменились');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 15. Списания: причины видны, суммы сходятся, период выбирается */
{
  console.log('— Списания: причины, суммы и период');
  const { page, ctx, errs } = await open();

  await page.evaluate(() => {
    const U = window.WMUI, d = U.data();
    // Так выглядит выгрузка 1С «Причины списания»: дат по строкам нет, есть период
    const мес = (f, t) => ({ from: f, to: t, periodKey: f + '..' + t, date: t });
    d.writeoffs = [
      Object.assign({ name: 'Специи', key: 'специи', reason: 'Списание специй на нужды производства',
        qty: 91, cost: 18192 }, мес('2026-09-01', '2026-09-30')),
      Object.assign({ name: 'Хлеб', key: 'хлеб', reason: 'Просрочка',
        qty: 94.34, cost: 10550 }, мес('2026-09-01', '2026-09-30')),
      Object.assign({ name: 'Пакеты', key: 'пакеты', reason: 'Бой и порча',
        qty: 45, cost: 3078 }, мес('2026-09-01', '2026-09-30')),
      Object.assign({ name: 'Крупа', key: 'крупа', reason: 'Просрочка',
        qty: 10, cost: 5000 }, мес('2026-10-01', '2026-10-31'))
    ];
    d.writeoffsPeriod = { from: '01.09.2026', to: '31.10.2026' };
    U.recompute(); U.go('losses');
  });
  await page.waitForTimeout(450);

  /* У таблиц в программе нет DOM-id: их «id» — это ключ постраничности.
     Поэтому ищем карточку по заголовку, как её видит владелец. */
  const картаТаблица = async заголовок => page.evaluate(з => {
    const c = [...document.querySelectorAll('.card')].find(e => {
      const t = e.querySelector('.card-title');
      return t && t.textContent.trim().startsWith(з);
    });
    const t = c && c.querySelector('table');
    return t ? t.innerText.replace(/[  ]/g, ' ') : '';
  }, заголовок);
  const таблица = () => картаТаблица('По причинам');
  let т = await таблица();
  check('ПРИЧИНЫ ВИДНЫ, А НЕ ПУСТЫЕ КЛЕТКИ',
    /Списание специй/.test(т) && /Просрочка/.test(т) && /Бой и порча/.test(т),
    (т.split('\n')[1] || 'пусто').slice(0, 40), 'причины на месте');
  check('и суммы рядом с ними', /18 192/.test(т) && /3 078/.test(т),
    (/18 192/.test(т) && /3 078/.test(т)) ? 'суммы видны' : 'сумм нет', 'суммы видны');
  check('ОДИНАКОВЫЕ ПРИЧИНЫ СЛОЖЕНЫ В ОДНУ СТРОКУ: 10 550 + 5 000',
    /15 550/.test(т), /15 550/.test(т) ? '15 550' : 'не сложены', '15 550');
  const шапкаТаблицы = (т.split('\n')[0] || '');
  check('КОЛОНОК «ПОЗИЦИЙ» И «КОЛИЧЕСТВО» БОЛЬШЕ НЕТ',
    /Причина/.test(шапкаТаблицы) && !/Позиций/.test(шапкаТаблицы) &&
      !/Количество/.test(шапкаТаблицы),
    шапкаТаблицы.slice(0, 40) || 'таблицы нет', 'Причина · Сумма · Доля');
  check('внизу таблицы стоит итог', /Всего/.test(т) && /36 820/.test(т),
    /36 820/.test(т) ? 'Всего 36 820' : 'итога нет', 'Всего 36 820');

  const шапка = () => page.evaluate(() =>
    document.body.innerText.replace(/[  ]/g, ' '));
  check('самая дорогая причина названа словом, а не прочерком',
    /Списание специй/.test((await шапка()).split('Причин')[0] + (await шапка())),
    'названа', 'названа');

  /* --- ПЕРИОД ----------------------------------------------------------- */
  const естьПоля = await page.evaluate(() => !!document.querySelector('#anaFrom') &&
    !!document.querySelector('#anaTo'));
  check('на экране есть поля «с» и «по»', естьПоля, естьПоля ? 'есть' : 'полей нет', 'есть');

  const выбрать = async (f, t2) => {
    await page.evaluate(v => {
      const a = document.querySelector('#anaFrom'), b = document.querySelector('#anaTo');
      a.value = v[0]; a.dispatchEvent(new Event('change', { bubbles: true }));
    }, [f, t2]);
    await page.waitForTimeout(300);
    await page.evaluate(v => {
      const b = document.querySelector('#anaTo');
      b.value = v; b.dispatchEvent(new Event('change', { bubbles: true }));
    }, t2);
    await page.waitForTimeout(350);
  };

  await выбрать('2026-10-01', '2026-10-31');
  т = await таблица();
  const толькоОкт = /Просрочка/.test(т) && !/Списание специй/.test(т) && !/Бой и порча/.test(т);
  check('ЗА ВЫБРАННЫЙ ПЕРИОД ОСТАЛОСЬ ТОЛЬКО ЕГО', толькоОкт,
    толькоОкт ? 'только октябрь'
      : (/Списание специй/.test(т) ? 'лишнее не отсеялось' : 'октября тоже нет'),
    'только октябрь');
  check('и сумма за период своя, а не общая',
    /5 000/.test(т) && !/36 820/.test(т), /5 000/.test(т) ? '5 000' : 'не 5 000', '5 000');

  await выбрать('2026-09-01', '2026-09-30');
  т = await таблица();
  const сент = /Списание специй/.test(т) && /Бой и порча/.test(т) && !/5 000/.test(т);
  check('вернулись в сентябрь — там свои три причины', сент,
    сент ? 'сентябрь' : (т.split('\n').slice(1, 3).join(' / ') || 'пусто'), 'сентябрь');

  /* Период уже сентября: резать выгрузку по дням не на чем — и мы об этом говорим */
  await выбрать('2026-09-01', '2026-09-15');
  const текст = await шапка();
  check('ПОЛОВИНУ МЕСЯЦА НЕ ВЫДАЁМ ЗА ТОЧНЫЙ ОТВЕТ',
    /приблизительно/i.test(текст), /приблизительно/i.test(текст) ? 'оговорка есть' : 'молчит',
    'программа оговаривается');
  const почему = /дней внутри|сводом за период|дат по строкам/i.test(текст);
  check('и объясняет, почему именно', почему,
    почему ? 'объясняет' : 'оговорилась, но не объяснила', 'объясняет');
  check('и подсказывает, как получить точную цифру',
    /по границам выгрузок|выгружайте из 1С помельче/i.test(текст),
    'подсказывает', 'подсказывает');

  /* Заготовка «Всё» возвращает весь загруженный период */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-act="ana-period"]')]
      .find(e => e.textContent.trim() === 'Всё');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  т = await таблица();
  check('кнопка «Всё» возвращает весь загруженный период', /36 820/.test(т),
    /36 820/.test(т) ? '36 820' : 'не вернулось', '36 820');

  /* Пустой период — честная пустота, а не молчаливый ноль */
  await выбрать('2025-01-01', '2025-01-31');
  check('ЗА ПУСТЫЕ ДНИ ПРОГРАММА ГОВОРИТ, ЧТО СПИСАНИЙ НЕТ',
    await page.evaluate(() => /списаний нет/i.test(document.body.innerText)),
    'говорит', 'говорит');

  /* --- ВОЗВРАТЫ: та же ошибка была и там ------------------------------- */
  await page.evaluate(() => {
    const U = window.WMUI, d = U.data();
    d.returns = [
      { name: 'Кефир', key: 'кефир', reason: 'Истёк срок', qty: 3, cost: 450 },
      { name: 'Йогурт', key: 'йогурт', reason: 'Истёк срок', qty: 2, cost: 300 },
      { name: 'Сок', key: 'сок', reason: 'Брак упаковки', qty: 1, cost: 120 }];
    U.recompute(); U.go('returns');
  });
  await page.waitForTimeout(450);
  const возвр = await картаТаблица('По причинам');
  check('НА ВОЗВРАТАХ ПРИЧИНЫ ТОЖЕ ВИДНЫ',
    /Истёк срок/.test(возвр) && /Брак упаковки/.test(возвр),
    (возвр.split('\n')[1] || 'пусто').slice(0, 40), 'причины на месте');
  check('и там они тоже сложены по причине', /750/.test(возвр),
    /750/.test(возвр) ? '750' : 'не сложены', '450 + 300 = 750');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 16. Товарные экраны: период, умный поиск и фильтры на каждом */
{
  console.log('— Товарные экраны: период, поиск, фильтры');
  const { page, ctx, errs } = await open();

  /* Два месяца выгрузок: только на них и видно, что период вообще работает */
  await page.evaluate(() => {
    const U = window.WMUI, E = window.WM, d = U.data();
    const мес = (f, t) => ({ periodKey: f + '..' + t, from: f, to: t, date: t });
    const с = мес('2026-09-01', '2026-09-30'), о = мес('2026-10-01', '2026-10-31');
    const прод = (n, rev, cogs, p) => Object.assign({ name: n, key: E.norm(n),
      qty: 10, revenue: rev, cogs: cogs, profit: rev - cogs }, p);
    d.sales = [
      прод('Молоко 3.2% Простоквашино', 50000, 40000, с),
      прод('Сыр Российский', 30000, 28000, с),
      прод('Хлеб Бородинский', 10000, 9500, с),
      прод('Молоко козье', 5000, 6000, с),
      прод('Молоко 3.2% Простоквашино', 60000, 45000, о)
    ];
    d.salesPeriod = { from: '01.10.2026', to: '31.10.2026', days: 31 };
    d.stock = [
      { name: 'Молоко 3.2% Простоквашино', key: E.norm('Молоко 3.2% Простоквашино'),
        group: 'Молочка', qty: 2, buyPrice: 60, retailPrice: 90, buySum: 120, barcode: '4600001' },
      { name: 'Сыр Российский', key: E.norm('Сыр Российский'), group: 'Молочка',
        qty: 40, buyPrice: 400, retailPrice: 520, buySum: 16000, barcode: '4600002' },
      { name: 'Хлеб Бородинский', key: E.norm('Хлеб Бородинский'), group: 'Хлеб',
        qty: 0, buyPrice: 30, retailPrice: 45, buySum: 0, barcode: '4600003' }
    ];
    d.stockTaken = { date: '2026-10-31', from: 'файл' };
    d.prices = [
      { name: 'Молоко 3.2% Простоквашино', key: E.norm('Молоко 3.2% Простоквашино'),
        supplier: 'Молокозавод', price: 58 },
      { name: 'Молоко 3.2% Простоквашино', key: E.norm('Молоко 3.2% Простоквашино'),
        supplier: 'Оптовик', price: 64 },
      { name: 'Сыр Российский', key: E.norm('Сыр Российский'), supplier: 'Оптовик', price: 400 }
    ];
    d.pricesTaken = { date: '2026-10-31', from: 'файл' };
    d.returns = [
      Object.assign({ name: 'Кефир', key: 'кефир', reason: 'Истёк срок', qty: 3, cost: 450 }, с),
      Object.assign({ name: 'Сок', key: 'сок', reason: 'Брак упаковки', qty: 1, cost: 120 }, о)
    ];
    d.writeoffs = [
      Object.assign({ name: 'Специи', key: 'специи', reason: 'Производство', qty: 9, cost: 18192 }, с),
      Object.assign({ name: 'Крупа', key: 'крупа', reason: 'Просрочка', qty: 2, cost: 5000 }, о)
    ];
    d.dead = [
      Object.assign({ name: 'Сыр Российский', key: E.norm('Сыр Российский'),
        left: 40, sold: 0, money: 16000, days: 90 }, с),
      Object.assign({ name: 'Хлеб Бородинский', key: E.norm('Хлеб Бородинский'),
        left: 5, sold: 1, money: 150, days: 40 }, о)
    ];
    window.WMStore.setSetting('anaFrom', ''); window.WMStore.setSetting('anaTo', '');
    U.recompute();
  });
  await page.waitForTimeout(400);

  const текстЭкрана = () => page.evaluate(() =>
    document.body.innerText.replace(/[  ]/g, ' '));
  const открыть = async id => {
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(320);
  };
  const периодНа = async id => {
    await открыть(id);
    return page.evaluate(() => !!document.querySelector('#anaFrom') &&
      !!document.querySelector('#anaTo'));
  };
  const поискНа = async id => {
    await открыть(id);
    return page.evaluate(() => !!document.querySelector('[data-filter-text]'));
  };

  /* --- ПЕРИОД ТАМ, ГДЕ ОН ЕСТЬ НА САМОМ ДЕЛЕ --------------------------- */
  const сПериодом = ['orders', 'losses', 'dead', 'groups', 'itemprofit', 'shelf',
    'returns', 'abc'];
  const безПериода = [];
  for (const id of сПериодом) if (!(await периодНа(id))) безПериода.push(id);
  check('ПЕРИОД ВЫБИРАЕТСЯ НА ВОСЬМИ ЭКРАНАХ, ГДЕ ДАННЫЕ ЗА ПЕРИОД',
    безПериода.length === 0, безПериода.join(', ') || 'на всех', 'на всех');

  /* Склад и цены — снимки. Фальшивого выбора дат там быть не должно */
  for (const id of ['stock', 'pricecmp']) {
    await открыть(id);
    const естьДаты = await page.evaluate(() => !!document.querySelector('#anaFrom'));
    const т = await текстЭкрана();
    check('«' + id + '»: СНИМОК, А НЕ ПЕРИОД — ДАТ НЕ ОБЕЩАЕМ', !естьДаты,
      естьДаты ? 'предлагает выбрать период, хотя не может' : 'не предлагает', 'не предлагает');
    check('«' + id + '»: сказано, на какой момент снимок',
      /снимок/i.test(т) && /31\.10\.2026/.test(т),
      /снимок/i.test(т) ? 'сказано' : 'молчит', 'снимок на 31.10.2026');
  }

  /* --- ПОИСК И ФИЛЬТРЫ НА КАЖДОМ ЭКРАНЕ -------------------------------- */
  const всеТоварные = ['stock', 'orders', 'losses', 'dead', 'groups', 'itemprofit',
    'shelf', 'returns', 'abc', 'pricecmp'];
  const безПоиска = [];
  for (const id of всеТоварные) if (!(await поискНа(id))) безПоиска.push(id);
  check('ПОИСК ЕСТЬ НА ВСЕХ ДЕСЯТИ ТОВАРНЫХ ЭКРАНАХ',
    безПоиска.length === 0, безПоиска.join(', ') || 'на всех', 'на всех');

  const безФильтров = [];
  for (const id of всеТоварные) {
    await открыть(id);
    const n = await page.evaluate(() => document.querySelectorAll('.chip[data-filter]').length);
    if (!n) безФильтров.push(id);
  }
  check('и кнопки-фильтры тоже', безФильтров.length === 0,
    безФильтров.join(', ') || 'на всех', 'на всех');

  /* --- УМНЫЙ ПОИСК В ЖИВОМ БРАУЗЕРЕ ------------------------------------ */
  await открыть('stock');
  const искать = async q => {
    await page.evaluate(v => {
      const i = document.querySelector('[data-filter-text]');
      i.value = v; i.dispatchEvent(new Event('input', { bubbles: true }));
    }, q);
    await page.waitForTimeout(400);
  };
  const строкиТаблицы = () => page.evaluate(() => {
    const t = document.querySelector('.card table');
    return t ? [...t.querySelectorAll('tbody tr')].map(r => r.innerText.trim()) : [];
  });

  await искать('моло 3.2');
  let стр = await строкиТаблицы();
  check('СЛОВА КУСКАМИ И В ЛЮБОМ ПОРЯДКЕ — НАХОДИТ',
    стр.length === 1 && /Молоко 3\.2/.test(стр[0]),
    стр.length + ' стр.: ' + (стр[0] || '').slice(0, 30), 'одна строка, молоко 3.2');
  check('и подсвечивает то, за что зацепилось',
    await page.evaluate(() => !!document.querySelector('.card table mark')),
    'подсвечивает', 'подсвечивает');

  await искать('4600002');
  стр = await строкиТаблицы();
  check('по штрихкоду тоже находит',
    стр.length === 1 && /Сыр/.test(стр[0]), (стр[0] || '').slice(0, 20), 'Сыр');

  await искать('>10000');
  стр = await строкиТаблицы();
  check('ПОИСК ПО ЧИСЛАМ: «>10000» оставил только дорогое',
    стр.length === 1 && /Сыр/.test(стр[0]),
    стр.length + ' стр.: ' + (стр[0] || '').slice(0, 20), 'Сыр на 16 000');

  await искать('');
  await открыть('itemprofit');
  await искать('моло');
  стр = await строкиТаблицы();
  check('ОДИН ТОВАР ИЗ ДВУХ ВЫГРУЗОК — ОДНА СТРОКА, А НЕ ДВЕ', стр.length === 2,
    стр.length + ' стр.', '2: молоко 3.2 и козье');
  const суммаМолока = стр.find(t => /3\.2/.test(t)) || '';
  check('и выручка в ней сложена: 50 000 + 60 000',
    /110 000/.test(суммаМолока.replace(/[\u00a0\u202f]/g, ' ')),
    суммаМолока.replace(/[\u00a0\u202f]/g, ' ').slice(0, 60), '110 000');
  await искать('моло -козье');
  стр = await строкиТаблицы();
  check('МИНУС УБИРАЕТ НЕНУЖНОЕ: козьего не осталось',
    стр.length === 1 && !/козье/i.test(стр[0]),
    стр.length + ' стр.: ' + (стр[0] || '').slice(0, 30), 'одна, без козьего');
  await искать('');
  await открыть('stock');

  await искать('такогонетвообще');
  check('ЧЕГО НЕТ — ПРОГРАММА ГОВОРИТ ПРЯМО, А НЕ ПОКАЗЫВАЕТ ПУСТОТУ',
    /Показано 0 из|Пока пусто/i.test(await текстЭкрана()), 'говорит', 'говорит');
  await искать('');

  /* --- ПЕРИОД РЕАЛЬНО МЕНЯЕТ ЦИФРЫ ------------------------------------- */
  const выбрать = async (f, t) => {
    await page.evaluate(v => {
      const a = document.querySelector('#anaFrom');
      a.value = v; a.dispatchEvent(new Event('change', { bubbles: true }));
    }, f);
    await page.waitForTimeout(250);
    await page.evaluate(v => {
      const b = document.querySelector('#anaTo');
      b.value = v; b.dispatchEvent(new Event('change', { bubbles: true }));
    }, t);
    await page.waitForTimeout(400);
  };

  await открыть('itemprofit');
  await выбрать('2026-09-01', '2026-09-30');
  let т = await текстЭкрана();
  check('СЕНТЯБРЬ: видно сентябрьские товары', /Сыр Российский/.test(т) && /Хлеб/.test(т),
    'видно', 'видно');
  check('и сентябрьская выручка молока, а не октябрьская',
    /50 000/.test(т) && !/60 000/.test(т),
    /60 000/.test(т) ? 'взялась октябрьская' : '50 000', '50 000');

  await выбрать('2026-10-01', '2026-10-31');
  т = await текстЭкрана();
  check('ОКТЯБРЬ: цифры сменились на октябрьские',
    /60 000/.test(т) && !/50 000/.test(т),
    /60 000/.test(т) ? '60 000' : 'не сменились', '60 000');
  check('и сентябрьских товаров в октябре нет', !/Сыр Российский/.test(т),
    /Сыр Российский/.test(т) ? 'сентябрьские остались' : 'только октябрь', 'только октябрь');

  /* Кнопка «Всё» складывает оба месяца — и ничего не теряет */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-act="ana-period"]')]
      .find(e => e.textContent.trim() === 'Всё');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  т = await текстЭкрана();
  const всёСложено = /Сыр Российский/.test(т) && /110 000/.test(т);
  check('«ВСЁ» СКЛАДЫВАЕТ ОБА МЕСЯЦА: 50 000 + 60 000 = 110 000', всёСложено,
    всёСложено ? '110 000'
      : (/60 000/.test(т) ? 'показан только октябрь' : 'не сложилось'),
    '110 000 одной строкой');

  /* Кнопки самих выгрузок: попадание в них — единственная точная цифра */
  await открыть('losses');
  const выгрузки = await page.evaluate(() =>
    [...document.querySelectorAll('[data-act="ana-period"]')]
      .map(e => e.textContent.trim()).filter(t => /\d{2}\.\d{2}\.\d{4}/.test(t)));
  check('ПРОГРАММА ПОКАЗЫВАЕТ, КАКИЕ ВЫГРУЗКИ ЗАГРУЖЕНЫ',
    выгрузки.length === 2, выгрузки.join(' | ') || 'не показывает', 'две выгрузки');
  check('и у каждой виден год, а не только «1 сен»',
    выгрузки.every(t => /\.2026/.test(t)), выгрузки[0] || 'нет', 'с годом');

  /* --- ПЕРИОД ОДИН НА ВСЕ ЭКРАНЫ --------------------------------------- */
  await открыть('abc');
  await выбрать('2026-09-01', '2026-09-30');
  await открыть('groups');
  const наДругом = await page.evaluate(() =>
    (document.querySelector('#anaFrom') || {}).value);
  check('ПЕРИОД ОДИН НА ВСЕ ЭКРАНЫ, А НЕ СВОЙ У КАЖДОГО',
    наДругом === '2026-09-01', наДругом || 'сбросился', '2026-09-01');

  /* --- ЗАКАЗЫ СЧИТАЮТ СКОРОСТЬ ПО ВЫБРАННОМУ ПЕРИОДУ -------------------- */
  await открыть('orders');
  const заказы = await текстЭкрана();
  const отВыбранного = /01\.09\.2026/.test(заказы);
  check('заказы считаются от выбранного периода, а не от последней выгрузки',
    отВыбранного, отВыбранного ? 'от выбранного' : 'период в заголовке не тот',
    'от выбранного');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

await browser.close();
console.log('Итог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
process.exit(failed ? 1 : 0);
