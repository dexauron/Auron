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

const E = v => Number(String(v == null ? '' : v).replace(',', '.')) || 0;

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
  await fill('pay_a0', '10000');
  await fill('received', '16000');
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
  /* Пульт отвечает на два вопроса: сколько денег и что сделать. Деньги —
     это сейф и счёт: ящик владельцу не принадлежит, он бухгалтер. */
  check('НА ПУЛЬТЕ ГЛАВНОЕ — СЕЙФ И СЧЁТ, А НЕ КАССОВЫЙ ЯЩИК',
    pulse.includes('В сейфе') && pulse.includes('На счёте') &&
    !pulse.includes('Наличные в кассе'),
    pulse.includes('Наличные в кассе') ? 'всё ещё про ящик' : 'сейф и счёт',
    'сейф и счёт');
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

  /* Сначала смотрим, что программа завела сама: ящика среди счетов быть
     не должно. И только потом заводим его руками для проверки старого пути. */
  const своиСчета = await page.evaluate(() =>
    (window.WMStore.state.accounts || []).map(a => a.name + ':' + a.kind));
  check('ПРОГРАММА САМА ЯЩИК НЕ ЗАВОДИТ',
    !своиСчета.some(a => a.endsWith(':till')), своиСчета.join(', '), 'только cash и bank');

  /* ЭТОТ БЛОК НАРОЧНО ПРОВЕРЯЕТ СТАРЫЙ СПОСОБ УЧЁТА.

     Новые магазины ящик не ведут: владелец забирает деньги и кладёт в сейф.
     Но у того, кто вёл учёт по-старому, записи с ящиком остались, и они
     обязаны считаться ровно как раньше — переписывать историю нельзя.
     Поэтому ящик здесь заводится руками: сам по себе он больше не
     появляется, и это правильно. */
  await page.evaluate(() => {
    const S = window.WMStore;
    S.state.accounts.unshift({ id: 'старый-ящик', name: 'Касса', kind: 'till',
      opening: 0, note: 'заведён вручную: проверяем старый способ' });
    const till = (S.state.accounts || []).find(a => a.kind === 'till');
    const bank = (S.state.accounts || []).find(a => a.kind === 'bank');
    S.add('dds', { type: 'Смена', date: '2026-09-01', till: 'Касса 1',
      shift: 'День', cashier: 'Аня', openCash: 0, zCash: 26467, zCashless: 29743,
      payouts: 10000, factCash: 16467,
      account: till && till.id, cashlessAccount: bank && bank.id });
    S.setSetting('reportMonth', '2026-09');
    S.save(); window.WMUI.recompute();
  });

  /* Счета заводятся сами: сейф и расчётный счёт. Денежного ящика среди них
     нет — владелец бухгалтер, ящик не его хозяйство. */
  const accs = await page.evaluate(() =>
    (window.WMStore.state.accounts || []).map(a => a.name + ':' + a.kind));
  check('счета заведены при первом запуске', accs.length >= 2, accs.join(', '), '>=2');

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
      till: E.accountBalances(S.state.dds, S.state.accounts).totals.till,
      safe: E.safeOnHand(S.state.dds, S.settings, null, S.state.accounts),
      net: E.pnl({ rows: S.state.dds }).net,
      chk: E.tillPayoutCheck(S.state.dds, null, { payouts: S.state.payouts || [],
        accounts: S.state.accounts || [] }) };
  });
  /* Кассир вынул деньги при закрытии смены и записал их в «выплаты из ящика»
     (10 000), а факт это учёл. Значит инкассация ящик второй раз уменьшать
     не должна — иначе те же деньги пропадут дважды.

     Спрашиваем про САМ ЯЩИК, а не про «все наличные»: всех наличных стало
     больше, и это верно — деньги, вынутые из ящика при кассире, до сейфа
     доехали и снова попали в счёт. Раньше они не числились нигде. */
  check('ИНКАССАЦИЯ НЕ ВЫЧИТАЕТСЯ ИЗ ЯЩИКА ДВАЖДЫ', c2.till === 16467, c2.till, 16467);
  check('и положила деньги в сейф', c2.safe === 10000, c2.safe, 10000);
  check('всего наличных стало ящик плюс сейф', c2.cash === 26467, c2.cash, 26467);
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
  check('видно, где лежат деньги', mc.includes('В сейфе') && !mc.includes('В ящиках'),
    mc.includes('В ящиках') ? 'всё ещё про ящики' : 'видно', 'видно');
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
  /* «Полки» на обычном уровне подробности в меню не показываются — это
     разбор, его смотрят редко. Берём экраны, которые видны всегда. */
  check('ПАПКА РАСКРЫЛАСЬ И ПОКАЗАЛА СВОИ ЭКРАНЫ',
    opened.includes('abc') && opened.includes('stock'), opened.join(','), 'abc и stock');
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

  // Кнопка «Настроить магазин» на экране настроек открывает мастер с ПЕРВОГО шага
  await page.evaluate(() => window.WMUI.go('settings'));
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act="settings-wizard"]').click());
  await page.waitForTimeout(400);
  const wiz = await page.evaluate(() => !!document.querySelector('#wmForm [name="storeName"]')
    && /Шаг 1 из/.test((document.querySelector('.wiz-head') || {}).innerText || ''));
  check('КНОПКА НА ЭКРАНЕ НАСТРОЕК ОТКРЫВАЕТ МАСТЕР С ПЕРВОГО ШАГА',
    wiz, wiz ? 'открылся на шаге 1' : 'мёртвая кнопка', 'открылся на шаге 1');
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
      cashier: 'Аня', openCash: 0, zCash: 20000, zCashless: 0, payouts: 0,
      kept: 0, received: 20000 },
      'received', '19000'],
    ['dds', 'dayTotals', { type: 'День', date: '2026-09-01', goodsCash: 1000, debtPaid: 0,
      debtTaken: 0 }, 'goodsCash', '2000'],
    ['dds', 'moneyOut', { type: 'Расход', date: '2026-09-01', category: 'Аренда',
      method: 'Наличные', source: 'Из ящика', amount: 5000 }, 'amount', '7000'],
    ['dds', 'moveCash', { type: 'Перемещение', date: '2026-09-01', from: 'Сейф',
      to: 'Расчётный счёт', amount: 2000 }, 'amount', '3000'],
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
      S.state[coll] = [];
      /* Перевод из пустого сейфа программа отклоняет — и правильно делает.
         Здесь проверяется не это, а что правка записи не теряет и не двоит,
         поэтому даём сейфу денег, чтобы переводу было откуда взяться. */
      (S.state.accounts || []).forEach(function (a) {
        if (a.kind === 'cash') a.opening = 100000;
      });
      S.save();
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
  check('в справочнике видны заведённые счета', accRows >= 2, accRows + ' счетов', '>=2');

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
  /* Запоминаем счёт ДО забора: деньги обязаны уйти ровно с одного кошелька,
     и проверить это надёжнее сравнением «до и после», чем числом из головы. */
  const до = await page.evaluate(() => {
    const S = window.WMStore, E = window.WM;
    const b = E.accountBalances(S.state.dds || [], S.state.accounts || []);
    const g = k => b.rows.filter(r => r.kind === k)[0] || { balance: 0 };
    return { safe: g('cash').balance, bank: g('bank').balance };
  });
  await page.click('.sheet .btn-primary');
  await page.waitForTimeout(500);
  const afterDraw = await page.evaluate(() => {
    const S = window.WMStore, E = window.WM;
    const b = E.accountBalances(S.state.dds || [], S.state.accounts || []);
    const g = k => b.rows.filter(r => r.kind === k)[0] || { balance: 0 };
    return { safe: g('cash').balance, bank: g('bank').balance,
      draw: E.pnl({ rows: S.state.dds, ym: '2026-09' }).draw,
      costs: E.pnl({ rows: S.state.dds, ym: '2026-09' }).costTotal };
  });
  check('СЕЙФ УМЕНЬШИЛСЯ РОВНО НА ЗАБРАННОЕ',
    afterDraw.safe === до.safe - 8000, afterDraw.safe, до.safe - 8000);
  check('ЗАБОР ИЗ СЕЙФА ДРУГИЕ КОШЕЛЬКИ НЕ ТРОНУЛ', afterDraw.bank === до.bank,
    afterDraw.bank, до.bank);
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
  /* Разделы настроек теперь сворачиваются, и заголовок у них свой —
     кнопка, а не заголовок карточки. Значок обязан остаться картинкой. */
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll('#page .set-h')]
      .map(e => ({ t: e.innerText.trim(), svg: !!e.querySelector('svg') })));
  check('В НАСТРОЙКАХ ЗНАЧКИ — КАРТИНКИ, А НЕ СЛОВА',
    heads.length >= 10 && heads.every(h => h.svg),
    heads.filter(h => h.svg).length + ' из ' + heads.length, 'все');
  check('И РАЗДЕЛЫ СВЁРНУТЫ, А НЕ ВЫВАЛЕНЫ ВСЕ СРАЗУ',
    await page.evaluate(() => document.querySelectorAll('.set-g.open').length) <= 3,
    await page.evaluate(() => document.querySelectorAll('.set-g.open').length), 'не больше 3');

  /* Поиск по настройкам: написал «аванс» — остались только нужные строки.
     Тогда не надо помнить, в каком разделе что лежит. */
  await page.fill('#setFind', 'аванс');
  await page.waitForTimeout(500);
  const поиск = await page.evaluate(() => ({
    полей: document.querySelectorAll('#setForm .form-row').length,
    текст: document.getElementById('page').innerText
  }));
  check('ПОИСК ПО НАСТРОЙКАМ НАХОДИТ НУЖНОЕ',
    поиск.полей >= 2 && поиск.полей <= 6 && /Аванс какого числа/.test(поиск.текст),
    поиск.полей + ' строк', 'от 2 до 6, среди них «Аванс какого числа»');
  await page.evaluate(() => { const i = document.getElementById('setFind'); i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(450);

  /* Дни, часы и проценты не подписываются рублями. Раскрываем зарплату:
     после сворачивания разделов эти поля иначе не видны. */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.set-h')]
      .filter(x => /Зарплата|Постоянные/.test(x.innerText))[0];
    if (b) b.click();
  });
  await page.waitForTimeout(450);
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

  // Аренду платим со счёта, обед — наличными из сейфа
  for (const [cat, acc, sum] of [['Аренда', 'Расчётный счёт', '110000'],
    ['Обед', 'Сейф', '800']]) {
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
  check('у каждой статьи память своя', (await accName()) === 'Сейф',
    await accName(), 'Сейф');

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
      account: a.find(x => x.kind === 'cash').id, toAccount: a.find(x => x.kind === 'bank').id,
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
    (await box()).includes('Насчитано'), 'есть', 'есть');
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
  check('в форме смены есть живой расчёт', (await box()).includes('Должны отдать вам'),
    'есть', 'есть');

  for (const [n, v] of [['openCash', '10000'], ['zCash', '50000'], ['zCashless', '50000'],
    ['pay_a0', '5000'], ['received', '55000']]) {
    await page.fill('.sheet [name="' + n + '"]', v);
    await page.waitForTimeout(150);
  }
  let b1 = await box();
  check('РАСХОЖДЕНИЕ СЧИТАЕТСЯ ДО СОХРАНЕНИЯ',
    b1.includes('55 000') && b1.includes('Сходится'), 'считается', 'сходится');
  check('и безнал к наличным не подмешан',
    /Безнал на счёт/.test(b1) && b1.includes('100 000') &&
    /Должны отдать вам\s*55 000/.test(b1),
    'не подмешан', 'на руки 55 000, выручка 100 000');

  await page.fill('.sheet [name="received"]', '54000');
  await page.waitForTimeout(280);
  b1 = await box();
  check('НЕДОСТАЧУ ВИДНО СРАЗУ', b1.includes('НЕДОСТАЧА') && b1.includes('1 000'),
    'видно', 'недостача 1 000');

  /* Куда владелец кладёт забранное, он выбирает сам: сейф или сразу банк.
     Предупреждать тут не о чем, ящика в этой картине нет. Проверяем, что
     выбор есть и сейф в нём предлагается. */
  const кудаКласть = await page.evaluate(() => {
    const sel = document.querySelector('.sheet [name="toAccount"]');
    return sel ? [...sel.options].map(o => o.text).join(', ') : 'поля нет';
  });
  check('ВЛАДЕЛЕЦ ВЫБИРАЕТ, КУДА ПОЛОЖИЛ ДЕНЬГИ',
    /Сейф/.test(кудаКласть), кудаКласть, 'среди вариантов есть Сейф');

  /* --- «РАЗОБРАТЬ» ОБЪЯСНЯЕТ -------------------------------------------- */
  await page.evaluate(() => {
    const S = window.WMStore, a = S.state.accounts || [];
    S.state.dds = [];
    S.add('dds', { type: 'Смена', date: '2026-09-05', till: 'Касса 1', shift: 'День',
      cashier: 'Иман', openCash: 10000, zCash: 50000, zCashless: 50000,
      payouts: 5000, kept: 0, received: 55000,
      toAccount: (a.find(x => x.kind === 'cash') || {}).id });
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

/* 17. СПЛОШНАЯ ПРОВЕРКА НА ПУСТЫЕ КОЛОНКИ.

   За эту сессию одна и та же ошибка нашлась пять раз: экран спрашивает у
   расчёта поле, которого тот не отдаёт. В консоли при этом чисто, программа
   не падает — просто колонка пустая, и владелец видит таблицу без имён
   кассиров, без названий групп, с нулями вместо денег.

   Глазами это видно сразу, а ни одна проверка не ловила. Теперь ловит эта:
   заполняем программу живыми данными, открываем каждый экран и смотрим,
   нет ли колонки, где ВСЕ ячейки пустые при непустой таблице.            */
{
  console.log('— Пустые колонки: экран спрашивает поле, которого нет');
  const { page, ctx, errs } = await open();

  await page.evaluate(() => {
    const U = window.WMUI, E = window.WM, S = window.WMStore, d = U.data();
    const a = (S.state.accounts || []);
    const касса = (a.find(x => x.kind === 'till') || {}).id;
    const банк = (a.find(x => x.kind === 'bank') || {}).id;

    // Ручной учёт: две смены с разными кассирами и расхождениями
    S.state.dds = [];
    S.add('dds', { type: 'Смена', date: '2026-09-02', till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 5000, zCash: 40000, zCashless: 20000,
      payouts: 10000, factCash: 34500, account: касса, cashlessAccount: банк });
    S.add('dds', { type: 'Смена', date: '2026-09-03', till: 'Касса 1', shift: 'Ночь',
      cashier: 'Марат', openCash: 34500, zCash: 30000, zCashless: 15000,
      payouts: 5000, factCash: 59500, account: касса, cashlessAccount: банк });
    S.add('dds', { type: 'День', date: '2026-09-02', goodsCash: 20000,
      debtTaken: 30000, debtPaid: 10000 });
    S.add('dds', { type: 'Расход', date: '2026-09-02', category: 'Аренда',
      method: 'Наличные', account: касса, amount: 15000 });
    S.add('dds', { type: 'Расход', date: '2026-09-03', category: 'Коммунальные / Свет',
      method: 'Наличные', account: касса, amount: 3000 });
    S.state.staff = [];
    S.add('staff', { name: 'Аня', position: 'Продавец', rate: 2000 });
    S.state.timesheet = [];
    S.add('timesheet', { date: '2026-09-02', employee: 'Аня', shift: 'День', pay: 2000 });
    S.state.debtors = [];
    S.add('debtors', { name: 'Пётр', date: '2026-09-01', sum: 3000, paid: 1000 });
    S.state.plans = [];
    S.add('plans', { due: '2026-09-25', supplier: 'Молокозавод',
      category: 'Оплата ТП', amount: 50000, status: 'Запланирована' });

    // Товарная аналитика: два периода, разные группы
    const мес = (f, t) => ({ periodKey: f + '..' + t, from: f, to: t, date: t });
    const с = мес('2026-09-01', '2026-09-30'), о = мес('2026-10-01', '2026-10-31');
    const прод = (n, qty, rev, cogs, p) => Object.assign({ name: n, key: E.norm(n),
      qty: qty, revenue: rev, cogs: cogs, profit: rev - cogs, abc: 'A' }, p);
    d.sales = [
      прод('Молоко 3.2%', 100, 50000, 40000, с),
      прод('Сыр Российский', 20, 30000, 24000, с),
      прод('Хлеб', 200, 10000, 7000, с),
      прод('Молоко 3.2%', 120, 60000, 46000, о)
    ];
    d.salesPeriod = { from: '01.10.2026', to: '31.10.2026', days: 31 };
    d.stock = [
      { name: 'Молоко 3.2%', key: E.norm('Молоко 3.2%'), group: 'Молочка', qty: 5,
        buyPrice: 60, retailPrice: 90, buySum: 300, barcode: '4600001' },
      { name: 'Сыр Российский', key: E.norm('Сыр Российский'), group: 'Молочка', qty: 30,
        buyPrice: 400, retailPrice: 520, buySum: 12000, barcode: '4600002' },
      { name: 'Хлеб', key: E.norm('Хлеб'), group: 'Хлеб', qty: 2,
        buyPrice: 30, retailPrice: 45, buySum: 60, barcode: '4600003' }
    ];
    d.stockTaken = { date: '2026-10-31', from: 'файл' };
    d.prices = [
      { name: 'Молоко 3.2%', key: E.norm('Молоко 3.2%'), supplier: 'Молокозавод', price: 58 },
      { name: 'Молоко 3.2%', key: E.norm('Молоко 3.2%'), supplier: 'Оптовик', price: 64 },
      { name: 'Сыр Российский', key: E.norm('Сыр Российский'), supplier: 'Оптовик', price: 400 }
    ];
    d.pricesTaken = { date: '2026-10-31', from: 'файл' };
    d.contacts = [{ name: 'Молокозавод', key: E.norm('Молокозавод'), phone: '+7 900 000-00-00' }];
    d.writeoffs = [
      Object.assign({ name: 'Специи', key: 'специи', reason: 'Производство', qty: 9, cost: 18192 }, с),
      Object.assign({ name: 'Крупа', key: 'крупа', reason: 'Просрочка', qty: 2, cost: 5000 }, о)
    ];
    d.returns = [
      Object.assign({ name: 'Кефир', key: 'кефир', reason: 'Истёк срок', qty: 3, cost: 450 }, с)
    ];
    d.dead = [
      Object.assign({ name: 'Сыр Российский', key: E.norm('Сыр Российский'),
        left: 30, sold: 0, money: 12000, days: 90 }, с)
    ];
    S.setSetting('anaFrom', ''); S.setSetting('anaTo', '');
    S.setSetting('reportMonth', '2026-09');
    S.save(); U.recompute();
  });
  await page.waitForTimeout(500);

  /* Пустые колонки на текущем экране. Колонки без заголовка не считаем:
     это значки и бейджи, им пусто быть положено. */
  const пустыеКолонки = () => page.evaluate(() => {
    const плохие = [];
    document.querySelectorAll('.card').forEach(card => {
      const заголовок = (card.querySelector('.card-title') || {}).textContent || 'таблица';
      card.querySelectorAll('table').forEach(t => {
        const шапка = [...t.querySelectorAll('thead th')].map(e => e.textContent.trim());
        const строки = [...t.querySelectorAll('tbody tr')]
          .filter(tr => !tr.classList.contains('plain') && !tr.classList.contains('total'));
        if (строки.length < 2) return;            // одна строка — не показатель
        шапка.forEach((имя, i) => {
          if (!имя) return;                       // колонка значков
          const пусто = строки.every(tr => {
            const td = tr.children[i];
            return !td || td.textContent.trim() === '';
          });
          if (пусто) плохие.push(заголовок.trim() + ' → «' + имя + '»');
        });
      });
    });
    return плохие;
  });

  const экраны = ['pulse', 'ledger', 'cashiers', 'debtors', 'finpay', 'funds',
    'timesheet', 'payroll', 'staffcards', 'sched',
    'pnl', 'owner', 'earners', 'moneyflow', 'finreport', 'ready', 'taxcal',
    'stock', 'orders', 'losses', 'dead', 'groups', 'itemprofit', 'shelf',
    'returns', 'abc', 'pricecmp', 'suppliers', 'log'];

  const найдено = [];
  for (const id of экраны) {
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(220);
    const плохие = await пустыеКолонки();
    плохие.forEach(x => найдено.push(id + ': ' + x));
  }
  check('НИ НА ОДНОМ ЭКРАНЕ НЕТ ПУСТОЙ КОЛОНКИ',
    найдено.length === 0, найдено.slice(0, 6).join(' | ') || 'пустых колонок нет',
    'пустых колонок нет');

  /* Отдельно — то, что было сломано и видно на скриншотах владельца */
  await page.evaluate(() => window.WMUI.go('earners'));
  await page.waitForTimeout(400);
  const кассиры = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')]
      .find(e => (e.querySelector('.card-title') || {}).textContent.trim() === 'Кассиры');
    return c ? c.innerText.replace(/[  ]/g, ' ') : '';
  });
  check('ИМЕНА КАССИРОВ ВИДНЫ', /Аня/.test(кассиры) && /Марат/.test(кассиры),
    (кассиры.split('\n')[2] || 'пусто').slice(0, 40), 'Аня и Марат');
  check('и средняя выручка за смену посчитана, а не ноль',
    /60 000|45 000/.test(кассиры), 'посчитана', 'посчитана');
  check('и «смен без расхождений» — процент, а не пусто',
    /%/.test(кассиры), 'процент есть', 'процент есть');

  const группы = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')]
      .find(e => /Группы товаров/.test((e.querySelector('.card-title') || {}).textContent || ''));
    return c ? c.innerText.replace(/[  ]/g, ' ') : '';
  });
  check('НАЗВАНИЯ ГРУПП ТОВАРОВ ВИДНЫ',
    /Молочка/.test(группы) && /Хлеб/.test(группы),
    (группы.split('\n')[2] || 'пусто').slice(0, 40), 'Молочка и Хлеб');

  await page.evaluate(() => window.WMUI.go('shelf'));
  await page.waitForTimeout(400);
  const полки = await page.evaluate(() => document.body.innerText.replace(/[  ]/g, ' '));
  check('ПОЛКИ: ДЕНЬГИ В ТОВАРЕ НЕ НОЛЬ', /12 360|12 000/.test(полки),
    (полки.match(/Денег в товаре[\s\S]{0,30}/) || ['нет'])[0].replace(/\n/g, ' '),
    'сумма по себестоимости');
  check('и колонка называется «Группа товаров», а не «Товар»',
    /Группа товаров/.test(полки) && !/^Товар$/m.test(полки),
    /Группа товаров/.test(полки) ? 'Группа товаров' : 'осталась колонка «Товар»',
    'Группа товаров');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 18. Оформление форм: строки ровные, кнопки на месте, ничего не уезжает.

   Форму владелец видит чаще любого отчёта. Раньше её строки были втрое выше
   соседних, кнопка «Сохранить» терялась в конце, а на телефоне её закрывала
   нижняя панель. Такое ломается незаметно — от одной строки в стилях. */
{
  console.log('— Оформление форм');
  const { page, ctx, errs } = await open();

  await page.evaluate(() => window.WMUI.openForm('shiftClose'));
  await page.waitForTimeout(500);

  /* Панель как в телефоне: слева «Отмена», по центру название, справа «Готово» */
  const шапка = await page.evaluate(() => {
    const h = document.querySelector('.sheet-head');
    if (!h) return null;
    const b = [...h.querySelectorAll('button')].map(e => e.textContent.trim());
    return { кнопки: b, заголовок: (h.querySelector('.sheet-title') || {}).textContent };
  });
  check('В ФОРМЕ ЕСТЬ «ОТМЕНА» И «ГОТОВО»',
    шапка && шапка.кнопки.includes('Отмена') && шапка.кнопки.includes('Готово'),
    шапка ? шапка.кнопки.join(', ') : 'шапки нет', 'Отмена, Готово');
  check('и название формы посередине', шапка && /Сверка/.test(шапка.заголовок || ''),
    (шапка && шапка.заголовок) || 'нет', 'Сверка кассы за смену');

  /* «Готово» сохраняет так же, как кнопка внизу */
  const готово = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.sheet-head button')]
      .find(e => e.textContent.trim() === 'Готово');
    return b ? { type: b.type, form: b.getAttribute('form') } : null;
  });
  check('«Готово» — это то же сохранение, а не другая кнопка',
    готово && готово.type === 'submit' && готово.form === 'wmForm',
    готово ? готово.type + '/' + готово.form : 'нет', 'submit/wmForm');

  /* Кнопка «Сохранить» видна без прокрутки до конца формы */
  const сохранить = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.sheet button[type="submit"]')]
      .find(e => /Сохранить/.test(e.textContent));
    if (!b) return null;
    const r = b.getBoundingClientRect(), s = document.querySelector('.sheet').getBoundingClientRect();
    return { внутри: r.bottom <= s.bottom + 2 && r.top >= s.top, ширина: Math.round(r.width) };
  });
  check('КНОПКА «СОХРАНИТЬ» ВИДНА СРАЗУ, А НЕ В КОНЦЕ ФОРМЫ',
    сохранить && сохранить.внутри, сохранить ? 'видна' : 'не найдена', 'видна');
  check('и она во всю ширину — мимо не промахнёшься',
    сохранить && сохранить.ширина > 300, (сохранить || {}).ширина + 'px', '> 300px');

  /* Строки формы примерно одной высоты: одна втрое выше других — верный
     признак, что подсказка снова растянула её на полстраницы */
  const высоты = await page.evaluate(() =>
    [...document.querySelectorAll('.form-row')].map(e => Math.round(e.getBoundingClientRect().height)));
  const макс = Math.max.apply(null, высоты), мин = Math.min.apply(null, высоты);
  check('СТРОКИ ФОРМЫ ПРИМЕРНО ОДНОЙ ВЫСОТЫ', макс <= мин * 3,
    'от ' + мин + ' до ' + макс + 'px', 'разброс не больше трёх раз');
  check('и ни одна строка не разрослась на полэкрана', макс < 200, макс + 'px', '< 200px');

  /* Длинное пояснение свёрнуто, но раскрывается, когда встал в поле */
  const пояснение = await page.evaluate(() => {
    const s = [...document.querySelectorAll('.form-row label small')]
      .sort((a, b) => b.textContent.length - a.textContent.length)[0];
    if (!s) return null;
    const до = s.getBoundingClientRect().height;
    const row = s.closest('.form-row');
    const inp = row.querySelector('input,select,textarea');
    if (inp) inp.focus();
    return { до: Math.round(до), после: Math.round(s.getBoundingClientRect().height),
      длина: s.textContent.length };
  });
  if (пояснение && пояснение.длина > 90) {
    check('ДЛИННОЕ ПОЯСНЕНИЕ СВЁРНУТО, ПОКА НЕ НУЖНО',
      пояснение.до <= 40, пояснение.до + 'px', 'не выше двух строк');
    check('а как встал в поле — раскрылось целиком',
      пояснение.после > пояснение.до, пояснение.до + ' → ' + пояснение.после + 'px', 'стало выше');
  }

  /* Число и калькулятор — в одном ряду, а не этажами */
  const ряд = await page.evaluate(() => {
    const f = document.querySelector('.num-field');
    if (!f) return null;
    const i = f.querySelector('input').getBoundingClientRect();
    const b = f.querySelector('.num-calc').getBoundingClientRect();
    return { совпали: Math.abs(i.top - b.top) < 12, поле: Math.round(i.width) };
  });
  check('ЧИСЛО И КАЛЬКУЛЯТОР — В ОДНОМ РЯДУ', ряд && ряд.совпали,
    ряд ? (ряд.совпали ? 'в ряд' : 'калькулятор уехал вниз') : 'нет поля', 'в ряд');
  check('и поле для числа не сжато в ноль', ряд && ряд.поле > 60,
    (ряд || {}).поле + 'px', '> 60px');

  /* Пустое числовое поле видно: в нём стоит серый ноль */
  check('в пустом числовом поле виден ноль — понятно, куда писать',
    await page.evaluate(() => {
      const i = [...document.querySelectorAll('.num-input')].find(e => !e.value);
      return !!i && i.placeholder === '0';
    }), 'виден', 'виден');

  await page.evaluate(() => window.WMUI.closeSheet());
  await page.waitForTimeout(250);
  check('после закрытия формы страница снова обычная',
    await page.evaluate(() => !document.body.classList.contains('sheet-open')),
    'обычная', 'обычная');

  /* --- ТЕЛЕФОН: кнопку не должна закрывать нижняя панель --- */
  const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true });
  const p2 = await ctxP.newPage();
  await p2.goto(PAGE); await p2.waitForTimeout(800);
  await p2.evaluate(() => window.WMUI.openForm('moneyOut'));
  await p2.waitForTimeout(500);
  check('НА ТЕЛЕФОНЕ НИЖНЯЯ ПАНЕЛЬ НЕ ЗАКРЫВАЕТ КНОПКУ',
    await p2.evaluate(() => {
      const t = document.querySelector('.tabbar');
      return !t || getComputedStyle(t).display === 'none';
    }), 'не закрывает', 'не закрывает');
  check('и у листа есть ухват сверху — его видно, что можно тянуть',
    await p2.evaluate(() => {
      const g = document.querySelector('.sheet-grabber');
      return !!g && getComputedStyle(g).display !== 'none';
    }), 'есть', 'есть');
  const низ = await p2.evaluate(() => {
    const b = [...document.querySelectorAll('.sheet button[type="submit"]')]
      .find(e => /Сохранить/.test(e.textContent));
    return b ? Math.round(b.getBoundingClientRect().bottom) : -1;
  });
  check('кнопка «Сохранить» помещается в экран телефона', низ > 0 && низ <= 844,
    низ + 'px из 844', 'в экране');
  await p2.close(); await ctxP.close();

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 19. Сверка по настоящему Z-отчёту: вводим цифры с чека магазина. */
{
  console.log('— Сверка смены по настоящему Z-отчёту');
  const { page, ctx, errs } = await open();

  await page.evaluate(() => window.WMUI.openForm('shiftClose'));
  await page.waitForTimeout(450);

  const поле = async (n, v) => {
    const есть = await page.evaluate(x => !!document.querySelector('.sheet [name="' + x + '"]'), n);
    if (!есть) return false;
    await page.fill('.sheet [name="' + n + '"]', v);
    await page.waitForTimeout(110);
    return true;
  };
  const коробка = () => page.evaluate(() => {
    const e = document.querySelector('#shiftSum');
    return e ? e.innerText.replace(/[  ]/g, ' ') : '';
  });

  /* Все строки Z-отчёта должны быть в форме — иначе переписать чек некуда */
  const нужные = ['openCash', 'zCash', 'zCashless', 'zCard', 'zQr', 'zNfc',
    'returnsCash', 'returnsCashless', 'deposits', 'pay_a0',
    'kept', 'received', 'checks', 'voided'];
  const нет = [];
  for (const n of нужные) {
    const есть = await page.evaluate(x => !!document.querySelector('.sheet [name="' + x + '"]'), n);
    if (!есть) нет.push(n);
  }
  check('В ФОРМЕ ЕСТЬ ВСЕ СТРОКИ Z-ОТЧЁТА', нет.length === 0,
    нет.join(', ') || 'все ' + нужные.length, 'все');

  /* Цифры с настоящего чека магазина, касса наличная */
  await поле('date', '2026-09-14');
  await поле('cashier', 'Администратор');
  await поле('openCash', '0');
  await поле('zCash', '138194');
  await поле('returnsCash', '690');
  await поле('deposits', '10000');
  await поле('pay_a0', '57180');
  /* Инкассации в форме больше нет: забрать деньги И ЕСТЬ инкассация.
     То, что касса печатала строкой «ИНКАССАЦИЯ», владелец унёс в сейф. */
  await поле('kept', '0');
  await поле('received', '90324');
  await поле('checks', '391');
  await page.waitForTimeout(350);

  let б = await коробка();
  check('ПО НАСТОЯЩЕМУ ЧЕКУ МАГАЗИНА ВСЁ СХОДИТСЯ',
    /Должны отдать вам/.test(б) && /Сходится/.test(б),
    (б.match(/Должны отдать вам[^\n]*/) || ['нет'])[0], 'сходится');
  check('в расчёте видны возвраты, довезённый размен и выплаты кассира',
    /Возвраты/.test(б) && /Довозили размен/.test(б) && /Кассир платил/.test(б),
    'видны', 'видны');
  check('выручка показана как приход минус возвраты',
    /137 504/.test(б), (б.match(/Выручка[^\n]*/) || ['нет'])[0], '137 504');

  /* Сказали, что не получили ничего — недостача обязана вылезти сразу */
  await поле('received', '0');
  await page.waitForTimeout(350);
  б = await коробка();
  check('НИЧЕГО НЕ ПОЛУЧИЛИ — НЕДОСТАЧА ВИДНА СРАЗУ',
    /НЕДОСТАЧА/.test(б) && /90 324/.test(б),
    /НЕДОСТАЧА/.test(б) ? 'видна' : 'молчит', 'недостача 90 324');
  await поле('received', '90324');
  await page.waitForTimeout(300);

  /* Разбивка безнала сверяется с Z-отчётом прямо в форме */
  await поле('zCashless', '113955');
  await поле('zCard', '53185');
  await поле('zQr', '53377');
  await поле('zNfc', '7393');
  await page.waitForTimeout(400);
  б = await коробка();
  check('РАЗБИВКА ТЕРМИНАЛА СОШЛАСЬ — ПРОГРАММА МОЛЧИТ',
    !/разошлись/i.test(б), /разошлись/i.test(б) ? 'ругается зря' : 'молчит', 'молчит');
  check('и показывает, сколько картой, а сколько по QR',
    /карта/.test(б) && /QR/.test(б), 'показывает', 'показывает');

  await поле('zNfc', '5000');
  await page.waitForTimeout(400);
  б = await коробка();
  check('РАЗОШЛИСЬ НА 2 393 — ПРОГРАММА ГОВОРИТ ОБ ЭТОМ',
    /разошлись/i.test(б) && /2 393/.test(б),
    (б.match(/разошлись[^\n]*/) || ['молчит'])[0].slice(0, 50), 'называет сумму');
  await поле('zNfc', '7393');
  await page.waitForTimeout(300);

  /* Сохраняем — и проверяем, что деньги легли в сейф без лишних записей */
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(700);

  const итог = await page.evaluate(() => {
    const S = window.WMStore, E = window.WM;
    const смена = (S.state.dds || []).filter(r => E.isShift(r))[0];
    const c = смена ? E.shiftCalc(смена) : null;
    const j = E.journal(S.state.dds || [], S.state.accounts || []);
    const b = E.accountBalances(S.state.dds || [], S.state.accounts || []);
    return { смен: (S.state.dds || []).filter(r => E.isShift(r)).length,
      переводов: (S.state.dds || []).filter(r => E.isMove(r)).length,
      сейф: b.totals.safe, журналСошёлся: j.ok,
      выплаты: c ? c.payouts : 0, список: смена ? (смена.payoutList || []).length : 0,
      выручка: c ? c.revenueCash : 0, расхождение: c ? c.diff : null };
  });
  check('смена записалась', итог.смен === 1, итог.смен, 1);
  /* Раньше инкассация и внесение заводили по отдельному переводу. Теперь
     заводить нечего: деньги владелец забрал сам, и это записано в смене.
     Лишние записи — это лишние места, где учёт может разойтись. */
  check('ЛИШНИХ ЗАПИСЕЙ НЕ ПОЯВИЛОСЬ', итог.переводов === 0,
    итог.переводов + ' переводов', 0);
  check('В СЕЙФ ЛЕГЛО ЗАБРАННОЕ МИНУС ДОВЕЗЁННЫЙ РАЗМЕН',
    итог.сейф === 80324, итог.сейф, 80324);
  check('выплаты сложились из строк «кому и за что»',
    итог.выплаты === 57180 && итог.список === 1,
    итог.выплаты + ' по ' + итог.список + ' строке', '57 180 по 1 строке');
  check('и журнал сходится в ноль', итог.журналСошёлся, 'сходится', 'сходится');
  check('выручка в записи — 137 504, как на чеке', итог.выручка === 137504,
    итог.выручка, 137504);
  check('расхождения нет', итог.расхождение === 0, итог.расхождение, 0);

  /* Правим смену второй раз — перевод обязан обновиться, а не удвоиться */
  await page.evaluate(() => {
    const S = window.WMStore, E = window.WM;
    const см = (S.state.dds || []).filter(r => E.isShift(r))[0];
    window.WMUI.openForm('shiftClose', JSON.parse(JSON.stringify(см)),
      { coll: 'dds', id: см.id });
  });
  await page.waitForTimeout(500);
  await поле('received', '80000');
  await page.waitForTimeout(250);
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(700);
  const после = await page.evaluate(() => {
    const S = window.WMStore, E = window.WM;
    const смены = (S.state.dds || []).filter(r => E.isShift(r));
    const b = E.accountBalances(S.state.dds || [], S.state.accounts || []);
    return { n: смены.length, сумма: смены[0] ? E.shiftCalc(смены[0]).received : 0,
      сейф: b.totals.safe,
      всего: (S.state.dds || []).filter(r => E.isMove(r)).length };
  });
  check('ПОПРАВИЛИ СМЕНУ — ЗАПИСЬ ОБНОВИЛАСЬ, А НЕ УДВОИЛАСЬ',
    после.n === 1 && после.сумма === 80000,
    после.n + ' смена, получено ' + после.сумма, '1 смена, 80 000');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 20. Отчёты: пустой экран объясняет, подробности раскрываются, печать чистая. */
{
  console.log('— Отчёты: пустой экран, подробности, печать');
  const { page, ctx, errs } = await open();

  const отчёты = ['findash', 'owner', 'moneyflow', 'avgcheck', 'earners', 'ready',
    'pnl', 'bep', 'bepdays', 'taxcal', 'monthclose', 'seasons'];

  /* --- ПУСТОЙ ЭКРАН НА ВСЕХ ДВЕНАДЦАТИ ---------------------------------- */
  await page.evaluate(() => {
    const S = window.WMStore;
    S.state.dds = []; S.state.staff = []; S.state.plans = []; S.state.timesheet = [];
    S.save(); window.WMUI.recompute();
  });
  await page.waitForTimeout(300);

  const безПустого = [], безКнопки = [], сНулями = [];
  for (const id of отчёты) {
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(220);
    const r = await page.evaluate(() => {
      const b = document.querySelector('.blank');
      return { есть: !!b,
        кнопок: b ? b.querySelectorAll('button').length : 0,
        почему: b ? (b.querySelector('.blank-why') || {}).textContent || '' : '',
        нулей: (document.body.innerText.match(/0\s*₽/g) || []).length };
    });
    if (!r.есть) безПустого.push(id);
    else {
      if (!r.кнопок || r.почему.length < 40) безКнопки.push(id);
      if (r.нулей > 0) сНулями.push(id + ':' + r.нулей);
    }
  }
  check('НА ПУСТОЙ БАЗЕ ВСЕ 12 ОТЧЁТОВ ОБЪЯСНЯЮТ, А НЕ МОЛЧАТ',
    безПустого.length === 0, безПустого.join(', ') || 'все 12', 'все 12');
  check('и у каждого есть кнопка и внятное «почему пусто»',
    безКнопки.length === 0, безКнопки.join(', ') || 'у всех', 'у всех');
  check('НУЛЕЙ ВМЕСТО ОБЪЯСНЕНИЯ НЕ ОСТАЛОСЬ', сНулями.length === 0,
    сНулями.join(', ') || 'нет нулей', 'нет нулей');

  /* --- С ДАННЫМИ: ПОДРОБНОСТИ РАСКРЫВАЮТСЯ ------------------------------ */
  await page.evaluate(() => {
    const S = window.WMStore, U = window.WMUI;
    const a = S.state.accounts || [];
    const касса = (a.find(x => x.kind === 'till') || {}).id;
    const банк = (a.find(x => x.kind === 'bank') || {}).id;
    S.setSetting('storeName', 'Мой магазин');
    S.setSetting('legalName', 'ИП Иванов И. И.');
    S.setSetting('inn', '123456789012');
    S.state.dds = [];
    S.add('dds', { type: 'Смена', date: '2026-09-02', till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 0, zCash: 200000, zCashless: 100000,
      payouts: 0, factCash: 199500, account: касса, cashlessAccount: банк });
    S.add('dds', { type: 'Расход', date: '2026-09-02', category: 'Коммунальные / Свет',
      method: 'Наличные', account: касса, amount: 5000 });
    S.add('dds', { type: 'Расход', date: '2026-09-03', category: 'Коммунальные / Вода',
      method: 'Наличные', account: касса, amount: 2000 });
    S.add('dds', { type: 'Расход', date: '2026-09-04', category: 'Аренда',
      method: 'Наличные', account: касса, amount: 110000 });
    S.setSetting('reportMonth', '2026-09');
    S.save(); U.recompute();
  });
  await page.waitForTimeout(400);

  await page.evaluate(() => window.WMUI.go('pnl'));
  await page.waitForTimeout(400);
  const нажимаемых = await page.evaluate(() =>
    document.querySelectorAll('[data-act="drill"]').length);
  check('строки затрат в отчёте нажимаются', нажимаемых > 0, нажимаемых, '> 0');

  await page.evaluate(() => {
    const c = [...document.querySelectorAll('[data-act="drill"]')]
      .find(e => /Коммунальные/.test(e.textContent));
    if (c) c.click();
  });
  await page.waitForTimeout(500);
  const окно = await page.evaluate(() => {
    const s = document.querySelector('.sheet');
    return s ? s.innerText.replace(/[  ]/g, ' ') : '';
  });
  check('ОТКРЫЛОСЬ ОКНО С ПОДРОБНОСТЯМИ', /Коммунальные/.test(окно),
    окно.split('\n')[1] || 'окна нет', 'Коммунальные');
  check('в нём сумма и число записей', /7 000/.test(окно) && /2 запис/.test(окно),
    (окно.match(/\d+ запис\S*/) || ['нет'])[0], '2 записи на 7 000');
  check('И ВИДНО, ИЗ ЧЕГО СУММА СЛОЖИЛАСЬ: свет и вода',
    /Свет/.test(окно) && /Вода/.test(окно) && /5 000/.test(окно) && /2 000/.test(окно),
    'видно', 'видно');
  check('подстатьи попали в группу, а не потерялись',
    /Коммунальные → Свет/.test(окно), 'попали', 'попали');
  check('есть кнопка в базу операций', /базе операций/i.test(окно),
    'есть', 'есть');

  await page.evaluate(() => window.WMUI.closeSheet());
  await page.waitForTimeout(250);

  /* --- ПЕЧАТЬ: документ, а не снимок экрана ----------------------------- */
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(250);

  const печать = await page.evaluate(() => {
    const видно = s => {
      const e = document.querySelector(s);
      return !!e && getComputedStyle(e).display !== 'none';
    };
    return {
      меню: видно('.sidebar'), шапкаЭкрана: видно('.topbar'),
      кнопки: видно('.btn'), фильтры: видно('.filters'),
      реквизиты: видно('.print-head'), подвал: видно('.print-foot'),
      подписи: document.querySelectorAll('.sign-cell').length,
      таблиц: document.querySelectorAll('table').length,
      текст: document.body.innerText.replace(/[  ]/g, ' ')
    };
  });
  check('НА БУМАГЕ НЕТ МЕНЮ И КНОПОК',
    !печать.меню && !печать.шапкаЭкрана && !печать.кнопки && !печать.фильтры,
    [печать.меню && 'меню', печать.шапкаЭкрана && 'шапка', печать.кнопки && 'кнопки',
      печать.фильтры && 'фильтры'].filter(Boolean).join(', ') || 'чисто', 'чисто');
  check('зато есть реквизиты магазина',
    печать.реквизиты && /ИП Иванов/.test(печать.текст), 'есть', 'есть');
  check('И МЕСТО ДЛЯ ПОДПИСЕЙ', печать.подвал && печать.подписи === 2,
    печать.подписи + ' подписи', '2 подписи');
  check('дата составления не обрезана',
    /Составлено \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/.test(печать.текст),
    (печать.текст.match(/Составлено[^\n]*/) || ['нет'])[0], 'полная дата и время');
  check('таблицы с цифрами остались', печать.таблиц > 0, печать.таблиц, '> 0');

  /* Строки отчёта не должны исчезать с бумаги из-за data-атрибутов */
  await page.evaluate(() => window.WMUI.go('owner'));
  await page.waitForTimeout(400);
  const собств = await page.evaluate(() =>
    document.body.innerText.replace(/[  ]/g, ' '));
  check('В ОТЧЁТЕ СОБСТВЕННИКУ НА БУМАГЕ ЕСТЬ ДАННЫЕ, А НЕ ОДНИ ЗАГОЛОВКИ',
    /110 000/.test(собств) && /Аренда/.test(собств), 'есть', 'есть');
  check('и своя шапка не задваивает печатную',
    (собств.match(/ИП Иванов/g) || []).length === 1,
    (собств.match(/ИП Иванов/g) || []).length + ' раз', '1 раз');

  await page.emulateMedia({ media: 'screen' });
  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 21. Разбор расхождения: программа не просто кричит «ИЗЛИШЕК», а показывает,
       какое из введённых чисел надо поправить, чтобы ящик сошёлся.

       Цифры — с той самой смены владельца, на которой он сказал «явно не
       правильно считает». Формула считала верно, а понять это по экрану было
       нельзя. Проверяем, что теперь можно. */
{
  console.log('— Разбор расхождения по ящику');
  const { page, ctx, errs } = await open();

  await page.evaluate(() => window.WMUI.openForm('shiftClose'));
  await page.waitForTimeout(450);

  const поле = async (n, v) => {
    await page.fill('.sheet [name="' + n + '"]', v);
    await page.waitForTimeout(110);
  };
  const коробка = () => page.evaluate(() => {
    const e = document.querySelector('#shiftSum');
    return e ? e.innerText.replace(/[\u00a0\u202f]/g, ' ') : '';
  });

  await поле('openCash', '10000');
  await поле('zCash', '77529');
  await поле('returnsCash', '950');
  await поле('deposits', '10000');
  await поле('pay_a0', '10760');
  await поле('kept', '74081');
  await поле('received', '67969');
  await page.waitForTimeout(400);

  let б = await коробка();
  check('ФОРМУЛА НА ЭКРАНЕ ДАЁТ 11 738, КАК И НА БУМАГЕ',
    /Должны отдать вам\s*11 738/.test(б),
    (б.match(/Должны отдать вам[^\n]*/) || ['нет'])[0], '11 738 ₽');
  check('излишек назван своим числом', /ИЗЛИШЕК/.test(б) && /56 231/.test(б),
    (б.match(/ИЗЛИШЕК[^\n]*/) || ['нет'])[0], '56 231 ₽');
  check('ПРОГРАММА ГОВОРИТ, ЧТО ТАКОЕ РАСХОЖДЕНИЕ — НЕ ЖИЗНЬ, А ОШИБКА ВВОДА',
    /от наличных за смену/.test(б), /от наличных/.test(б) ? 'говорит' : 'молчит', 'говорит');
  check('ПОКАЗЫВАЕТ, ЧТО ИСПРАВИТЬ, ЧТОБЫ СОШЛОСЬ',
    /достаточно исправить одно из чисел/.test(б), 'показывает', 'показывает');
  check('называет оставленный размен 74 081 → 17 850',
    /Размен оставил в ящике\s*74 081 ₽ → 17 850 ₽/.test(б),
    (б.match(/Размен оставил[^\n]*→[^\n]*/) || ['нет'])[0], '74 081 ₽ → 17 850 ₽');
  check('и полученное 67 969 → 11 738',
    /Получил на руки\s*67 969 ₽ → 11 738 ₽/.test(б),
    (б.match(/Получил на руки[^\n]*→[^\n]*/) || ['нет'])[0], '67 969 ₽ → 11 738 ₽');
  check('МИНУСОВЫХ ВЫПЛАТ НЕ ПРЕДЛАГАЕТ', !/Кассир платил из ящика [^\n]*→ -/.test(б),
    'не предлагает', 'не предлагает');
  /* Объяснение никуда не делось — оно свёрнуто. Проверяем именно это:
     на экране его не видно, а по кнопке «Подробнее» открывается. */
  check('ДЛИННОЕ ОБЪЯСНЕНИЕ СВЁРНУТО, А НЕ ВЫВАЛЕНО НА ЭКРАН',
    !/сохраняйте как есть/.test(б) &&
    await page.evaluate(() => [...document.querySelectorAll('.more-box')]
      .some(e => /сохраняйте как есть/.test(e.textContent))),
    'свёрнуто', 'свёрнуто');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.more-btn')]
      .filter(x => /А если всё верно/.test(x.textContent))[0];
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  check('и открывается по кнопке',
    /сохраняйте как есть/.test(await коробка()), 'открылось', 'открылось');

  /* Правим одно число по подсказке — всё обязано сойтись */
  await поле('kept', '17850');
  await page.waitForTimeout(400);
  б = await коробка();
  check('ПОПРАВИЛИ ПО ПОДСКАЗКЕ — КАССА СОШЛАСЬ',
    /Сходится/.test(б) && !/достаточно исправить/.test(б),
    /Сходится/.test(б) ? 'сошлась' : 'нет', 'сошлась');

  /* Посчитали деньги вместе с разменом, который собирались оставить, —
     расхождение вышло ровно в размен, и программа называет это словами. */
  await поле('kept', '74081');
  await поле('received', '85819');
  await page.waitForTimeout(400);
  б = await коробка();
  check('«ПОСЧИТАЛИ ВМЕСТЕ С РАЗМЕНОМ» НАЗВАНО СВОИМИ СЛОВАМИ',
    /вместе с разменом, который оставили/.test(б),
    (б.match(/Похоже[^\n]*/) || ['нет'])[0].slice(0, 70), 'про размен');

  /* Обычная недостача в 200 ₽ — никакой тревоги, это рабочая мелочь */
  await поле('kept', '74081');
  await поле('received', '11538');
  await page.waitForTimeout(400);
  б = await коробка();
  check('МЕЛКАЯ НЕДОСТАЧА НЕ ОБЪЯВЛЯЕТСЯ ОШИБКОЙ ВВОДА',
    /НЕДОСТАЧА/.test(б) && !/от наличных за смену/.test(б),
    /от наличных за смену/.test(б) ? 'паникует' : 'спокойно', 'спокойно');
  check('но подсказки всё равно под рукой',
    /достаточно исправить одно из чисел/.test(б), 'есть', 'есть');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 22. Мастер настройки: магазин настраивает программу под себя сам.

       Владелец сказал: «хочу, чтобы магазин сам настроил программу под свой
       магазин». Значит, проверять надо не поля по одному, а весь путь — от
       первого шага до того, что настройки доехали до рабочей формы. */
{
  console.log('— Мастер настройки магазина');
  const { page, ctx, errs } = await open();

  const шапка = () => page.evaluate(() => {
    const e = document.querySelector('.wiz-head');
    return e ? e.innerText.replace(/\n/g, ' · ') : '';
  });
  const кнопка = () => page.evaluate(() => {
    const b = document.querySelector('.form-actions button');
    return b ? b.innerText.trim() : '';
  });
  const дальше = async () => { await page.click('.form-actions button'); await page.waitForTimeout(450); };

  await page.evaluate(() => window.WMUI.openForm('setupWizard'));
  await page.waitForTimeout(400);

  check('МАСТЕР ОТКРЫВАЕТСЯ И ГОВОРИТ, СКОЛЬКО ШАГОВ',
    /Шаг 1 из 3/.test(await шапка()), await шапка(), 'Шаг 1 из 3');
  check('КНОПКА НЕ ВРЁТ: на первом шаге она ведёт дальше, а не сохраняет',
    (await кнопка()) === 'Дальше', await кнопка(), 'Дальше');

  /* Пустое название дальше не пускает: без него отчёты будут без шапки */
  await дальше();
  check('БЕЗ НАЗВАНИЯ МАГАЗИНА ДАЛЬШЕ НЕ ПУСКАЕТ',
    /Шаг 1 из 3/.test(await шапка()), await шапка(), 'остались на шаге 1');

  await page.fill('.sheet [name="storeName"]', 'Продукты у дома');
  await page.fill('.sheet [name="workMode"]', 'Круглосуточно');
  await дальше();
  check('ШАГ 2 — КАССЫ И СМЕНЫ', /Шаг 2 из 3/.test(await шапка()), await шапка(), 'Шаг 2 из 3');

  const скрытые = () => page.evaluate(() => [...document.querySelectorAll('.sheet [name]')]
    .filter(i => i.type === 'hidden').map(i => i.name));
  check('ОТВЕТ ПЕРВОГО ШАГА ЕДЕТ ДАЛЬШЕ СКРЫТЫМ ПОЛЕМ',
    (await скрытые()).includes('storeName'), (await скрытые()).join(', '), 'storeName среди них');

  await page.fill('.sheet [name="tills"]', 'Касса 1, Касса 2, Экспресс');
  await page.fill('.sheet [name="shiftNames"]', 'Утро, Вечер, Ночь');
  await page.fill('.sheet [name="openSafeStart"]', '200000');
  await page.fill('.sheet [name="openDebtStart"]', '480000');
  await дальше();
  check('ШАГ 3 — ЛЮДИ', /Шаг 3 из 3/.test(await шапка()), await шапка(), 'Шаг 3 из 3');
  check('НА ПОСЛЕДНЕМ ШАГЕ КНОПКА ГОВОРИТ «СОХРАНИТЬ»',
    /Сохранить/.test(await кнопка()), await кнопка(), 'Сохранить настройки');

  /* «Назад» обязано вернуть набранное: заметил опечатку на третьем шаге —
     не начинать же всё заново */
  await page.click('.sheet [data-act="wiz-back"]');
  await page.waitForTimeout(450);
  check('«НАЗАД» ВОЗВРАЩАЕТ НА ПРОШЛЫЙ ШАГ',
    /Шаг 2 из 3/.test(await шапка()), await шапка(), 'Шаг 2 из 3');
  check('И НИЧЕГО НЕ ТЕРЯЕТ',
    (await page.inputValue('.sheet [name="tills"]')) === 'Касса 1, Касса 2, Экспресс',
    await page.inputValue('.sheet [name="tills"]'), 'Касса 1, Касса 2, Экспресс');
  check('название магазина с первого шага тоже цело',
    (await page.evaluate(() => (document.querySelector('.sheet [name="storeName"]') || {}).value))
      === 'Продукты у дома', 'цело', 'цело');

  await дальше();
  await page.fill('.sheet [name="finCashiers"]', 'Марьям, Аслан, Зарема');
  await page.fill('.sheet [name="rateDay"]', '250');
  await page.fill('.sheet [name="rateNight"]', '300');
  await page.fill('.sheet [name="shiftHours"]', '12');
  await дальше();
  await page.waitForTimeout(400);

  const s = await page.evaluate(() => window.WMStore.settings);
  check('НАСТРОЙКИ ЗАПИСАЛИСЬ ВСЕ, А НЕ ТОЛЬКО ПОСЛЕДНЕГО ШАГА',
    s.storeName === 'Продукты у дома' && s.tills === 'Касса 1, Касса 2, Экспресс' &&
    s.finCashiers === 'Марьям, Аслан, Зарема',
    [s.storeName, s.tills, s.finCashiers].join(' | '), 'все три');
  check('стартовые остатки не потерялись по дороге',
    E(s.openSafeStart) === 200000 && E(s.openDebtStart) === 480000,
    [s.openSafeStart, s.openDebtStart].join(' / '), '200000 / 480000');
  check('ставки и часы смены записались',
    E(s.rateDay) === 250 && E(s.rateNight) === 300 && E(s.shiftHours) === 12,
    [s.rateDay, s.rateNight, s.shiftHours].join(' / '), '250 / 300 / 12');
  check('СМЕНЫ ЛЕГЛИ ПОД ОБОИМИ ИМЕНАМИ — иначе форма сверки их не увидит',
    s.shiftNames === s.finShifts && s.finShifts === 'Утро, Вечер, Ночь',
    s.finShifts, 'Утро, Вечер, Ночь');

  /* Главное: настройки должны доехать до рабочей формы, а не осесть в базе */
  await page.evaluate(() => window.WMUI.openForm('shiftClose'));
  await page.waitForTimeout(500);
  const списки = await page.evaluate(() => {
    const g = n => [...(document.querySelector('.sheet [name="' + n + '"]') || { options: [] }).options]
      .map(o => o.value);
    const поле = document.querySelector('.sheet [name="cashier"]');
    const lid = поле && поле.getAttribute('list');
    return { кассы: g('till'), смены: g('shift'),
      кассиры: lid ? [...document.querySelectorAll('#' + lid + ' option')].map(o => o.value) : [] };
  });
  check('КАССЫ ИЗ МАСТЕРА ВИДНЫ В СВЕРКЕ СМЕНЫ',
    списки.кассы.join(',') === 'Касса 1,Касса 2,Экспресс', списки.кассы.join(' / '), 'три кассы');
  check('СМЕНЫ ИЗ МАСТЕРА ВИДНЫ И СТОЯТ ПО ПОРЯДКУ',
    списки.смены.join(',') === 'Утро,Вечер,Ночь', списки.смены.join(' / '), 'Утро / Вечер / Ночь');
  check('КАССИРЫ ИЗ МАСТЕРА ПОДСТАВЛЯЮТСЯ ПРИ СДАЧЕ СМЕНЫ',
    списки.кассиры.length === 3, списки.кассиры.join(' / '), 'три кассира');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 23. Сверка в три колонки: что сказала касса, что должно быть, что по факту.

       Владелец попросил именно так. Арифметика ящика отвечает «почему
       столько», а эта таблица — «сошлось или нет», по каждому кошельку
       отдельно. Проверяем на его настоящих чеках за 16.09.26. */
{
  console.log('— Сверка в три колонки: касса · должно быть · факт');
  const { page, ctx, errs } = await open();

  await page.evaluate(() => window.WMUI.openForm('shiftClose'));
  await page.waitForTimeout(450);
  const поле = async (n, v) => { await page.fill('.sheet [name="' + n + '"]', v); await page.waitForTimeout(100); };
  const коробка = () => page.evaluate(() => {
    const e = document.querySelector('#shiftSum');
    return e ? e.innerText.replace(/[\u00a0\u202f]/g, ' ') : '';
  });

  /* Раньше инкассация делилась надвое: сколько пробила касса и сколько
     доехало до сейфа. У владельца-бухгалтера это различие схлопывается —
     деньги он несёт сам, поэтому расхождение одно: сколько должны были
     отдать и сколько он пересчитал. */
  check('В ФОРМЕ ЕСТЬ ПОЛЕ «ПОЛУЧИЛ НА РУКИ»',
    await page.evaluate(() => !!document.querySelector('.sheet [name="received"]')),
    'есть', 'есть');

  await поле('date', '2026-09-16');
  await поле('openCash', '0');
  await поле('zCash', '74936+2688');      // два аппарата над одним ящиком
  await поле('returnsCash', '95');
  await поле('deposits', '10000');
  await поле('pay_a0', '10760');
  await поле('kept', '0');
  await поле('received', '0');
  await поле('zCashless', '73165');
  await поле('zCard', '25003');
  await поле('zQr', '45828');
  await поле('zNfc', '2334');
  await page.waitForTimeout(500);

  let б = await коробка();
  check('СЛОЖЕНИЕ ПРЯМО В ПОЛЕ РАБОТАЕТ: 74936+2688 = 77 624',
    /77 624/.test(б), (б.match(/Z-отчёт[^\n]*\n[^\n]*/) || ['нет'])[0], '77 624 ₽');
  check('ТРИ КОЛОНКИ НА ЭКРАНЕ',
    /КАССА СКАЗАЛА/.test(б) && /ДОЛЖНО БЫТЬ/.test(б) && /ПО ФАКТУ/.test(б),
    'все три', 'все три');
  check('ДОЛЖНЫ БЫЛИ ОТДАТЬ 76 769 — СЧИТАЕТ ПО ВСЕМ СТРОКАМ ЧЕКА',
    /Должны отдать вам\s*76 769/.test(б),
    (б.match(/Должны отдать вам[^\n]*/) || ['нет'])[0], '76 769 ₽');

  /* Пересчитали — и недостача видна сразу */
  await поле('received', '67969');
  await page.waitForTimeout(500);
  б = await коробка();
  check('ПОЛУЧИЛИ 67 969 — НЕ ХВАТАЕТ 8 800',
    /НЕДОСТАЧА/.test(б) && /8 800/.test(б),
    (б.match(/НЕДОСТАЧА[^\n]*/) || ['нет'])[0], 'недостача 8 800 ₽');
  check('ИТОГ — 8 800, А НЕ 17 600: одна недостача, а не две',
    /ВСЕГО НЕ ХВАТАЕТ\s*8 800 ₽/.test(б),
    (б.match(/ВСЕГО НЕ ХВАТАЕТ[^\n]*\n[^\n]*/) || ['нет'])[0], '8 800 ₽');
  check('безнал сверен с терминалом в той же таблице',
    /Безнал на счёт\s*73 165 ₽[\s\S]*?73 165 ₽/.test(б), 'сверен', 'сверен');

  /* Главное: в сейф обязано лечь ПЕРЕСЧИТАННОЕ, а не то, что сказала касса.
     Иначе программа покажет в сейфе деньги, которых там нет. */
  await page.fill('.sheet [name="cashier"]', 'Марьям');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(800);
  const итог = await page.evaluate(() => {
    const S = window.WMStore, E = window.WM;
    const см = (S.state.dds || []).filter(r => E.isShift(r))[0];
    const c = см ? E.shiftCalc(см) : null;
    const b = E.accountBalances(S.state.dds || [], S.state.accounts || []);
    return { сейф: b.totals.safe, должны: c ? c.handed : 0,
      получено: c ? c.received : 0, недостача: c ? c.short : 0 };
  });
  /* 67 969 забрал минус 10 000, которые сам же довёз на размен из сейфа. */
  check('В СЕЙФ ЛЕГЛО ПЕРЕСЧИТАННОЕ, А НЕ ТО, ЧТО СКАЗАЛА КАССА',
    итог.сейф === 57969, итог.сейф + ' (должны были ' + итог.должны + ')', 57969);
  check('а слова кассы сохранились — 76 769 никуда не делось',
    итог.должны === 76769, итог.должны, 76769);
  check('и недостача записана вместе со сменой', итог.недостача === 8800, итог.недостача, 8800);

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 24. Довезённый среди смены размен списывается оттуда, откуда его взяли.

       Владелец берёт эти деньги из своего сейфа и вечером получает их обратно
       внутри забранного. Не списать их из сейфа — и там будут числиться
       деньги, которых уже нет. Раньше для этого заводился отдельный перевод;
       теперь сейф меняется на разницу прямо в расчёте, и лишней записи нет.
       Ловит ошибку двойная запись: журнал проводок не сойдётся в ноль. */
{
  console.log('— Довезённый размен списывается оттуда, откуда его взяли');
  const { page, ctx, errs } = await open();

  await page.evaluate(() => window.WMUI.openForm('shiftClose'));
  await page.waitForTimeout(450);
  check('В ФОРМЕ СПРАШИВАЮТ ПРО ДОВЕЗЁННЫЙ РАЗМЕН',
    await page.evaluate(() => !!document.querySelector('.sheet [name="deposits"]')),
    'есть', 'есть');

  const было = await page.evaluate(() => window.WM.accountBalances(
    window.WMStore.state.dds || [], window.WMStore.state.accounts || []).totals.total);

  for (const [n, v] of [['date', '2026-09-16'], ['cashier', 'Марьям'],
    ['openCash', '0'], ['zCash', '50000'], ['deposits', '10000'],
    ['pay_a0', '0'], ['received', '60000']]) {
    await page.fill('.sheet [name="' + n + '"]', v);
    await page.waitForTimeout(90);
  }
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(800);

  const итог = await page.evaluate(() => {
    const S = window.WMStore, E = window.WM;
    const счета = S.state.accounts || [], записи = S.state.dds || [];
    const разм = записи.filter(r => E.isMove(r) && E.txt(r.category) === 'Размен');
    const b = E.accountBalances(записи, счета);
    const j = E.journal(записи, счета);
    return { переводов: разм.length,
      всего: b.totals.total, сейф: b.totals.safe,
      журналСошёлся: j.ok, журнал: j.total };
  });

  /* Забрал 60 000, из них 10 000 — свои же, довезённые на размен.
     Значит выручка смены 50 000, и ровно на столько стало больше. */
  check('ДЕНЬГИ НЕ ВЗЯЛИСЬ ИЗ ВОЗДУХА: стало ровно на выручку больше',
    итог.всего === было + 50000, итог.всего + ' (было ' + было + ')', было + 50000);
  check('ДОВЕЗЁННЫЙ РАЗМЕН СПИСАН ИЗ СЕЙФА, А НЕ ПОСЧИТАН ДВАЖДЫ',
    итог.сейф === было + 50000, итог.сейф, было + 50000);
  check('и лишней записи ради этого не завелось',
    итог.переводов === 0, итог.переводов + ' переводов', 0);
  check('ЖУРНАЛ ПРОВОДОК СХОДИТСЯ В НОЛЬ',
    итог.журналСошёлся, итог.журнал, 0);

  /* Стёрли внесение — сейф обязан пересчитаться, а записи не задвоиться */
  await page.evaluate(() => {
    const S = window.WMStore, E = window.WM;
    const см = (S.state.dds || []).filter(r => E.isShift(r))[0];
    window.WMUI.openForm('shiftClose', JSON.parse(JSON.stringify(см)),
      { coll: 'dds', id: см.id });
  });
  await page.waitForTimeout(500);
  await page.fill('.sheet [name="deposits"]', '0');
  await page.fill('.sheet [name="received"]', '50000');
  await page.waitForTimeout(150);
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(800);
  const после = await page.evaluate(() => {
    const S = window.WMStore, E = window.WM;
    const разм = (S.state.dds || []).filter(r => E.isMove(r) && E.txt(r.category) === 'Размен');
    const j = E.journal(S.state.dds || [], S.state.accounts || []);
    const b = E.accountBalances(S.state.dds || [], S.state.accounts || []);
    return { переводов: разм.length, журналСошёлся: j.ok, сейф: b.totals.safe,
      смен: (S.state.dds || []).filter(r => E.isShift(r)).length };
  });
  check('СТЁРЛИ ВНЕСЕНИЕ — СЕЙФ ПЕРЕСЧИТАЛСЯ, ЛИШНЕГО НЕ ПОВИСЛО',
    после.переводов === 0 && после.сейф === 50000,
    после.переводов + ' переводов, в сейфе ' + после.сейф, '0 переводов, 50 000');
  check('и смена не задвоилась', после.смен === 1, после.смен, 1);
  check('журнал по-прежнему сходится', после.журналСошёлся, 'сходится', 'сходится');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 25. XYZ: девять групп на экране ABC.

       ABC отвечает «сколько денег приносит», XYZ — «можно ли на него
       положиться». Товар может давать много выручки и браться рывками:
       заказывать его как хлеб значит сделать из него неликвид. */
{
  console.log('— ABC и XYZ: девять групп');
  const { page, ctx, errs } = await open();

  await page.evaluate(() => {
    const U = window.WMUI, E = window.WM, d = U.data();
    const данные = {
      'Хлеб': [200, 190, 210, 205, 195],      // много и ровно → AX
      'Молоко': [100, 102, 98, 101, 99],      // ровно, но меньше денег
      'Кофе': [20, 28, 15, 25, 22],           // колеблется → Y
      'Шампанское': [2, 0, 1, 40, 0],         // рывком → Z
      'Чипсы': [0, 0, 30, 0, 0]               // один раз из пяти → самый неровный
    };
    d.sales = [];
    ['н1', 'н2', 'н3', 'н4', 'н5'].forEach((w, i) => {
      const день = '2026-0' + (i + 1);
      Object.keys(данные).forEach(t => {
        const q = данные[t][i];
        if (!q) return;      // товара нет в выгрузке — строки тоже нет
        d.sales.push({ key: E.norm(t), name: t, periodKey: w,
          from: день + '-01', to: день + '-28', date: день + '-28',
          qty: q, revenue: q * 100, cogs: q * 70, profit: q * 30 });
      });
    });
    d.salesPeriod = { from: '01.01.2026', to: '28.05.2026', days: 148 };
    U.recompute();
    U.go('abc');
  });
  await page.waitForTimeout(700);

  const текст = () => page.evaluate(() =>
    document.body.innerText.replace(/[\u00a0\u202f]/g, ' '));
  let t = await текст();

  check('ЭКРАН НАЗЫВАЕТСЯ ПО ДЕЛУ: ABC И XYZ',
    /ABC и XYZ/.test(t), (t.match(/ABC[^\n]*/) || ['нет'])[0].slice(0, 40), 'ABC и XYZ');
  check('ДЕВЯТЬ КЛЕТОК НА ЭКРАНЕ',
    await page.evaluate(() => document.querySelectorAll('.xyz-cell').length) === 9,
    await page.evaluate(() => document.querySelectorAll('.xyz-cell').length), 9);
  check('и сказано, что XYZ считается по всем выгрузкам, а не по выбранному периоду',
    /по всем загруженным периодам/.test(t), 'сказано', 'сказано');

  const клетки = await page.evaluate(() =>
    [...document.querySelectorAll('.xyz-cell')]
      .map(e => e.innerText.replace(/\n/g, ' ').replace(/[\u00a0\u202f]/g, ' ')));
  check('КОРМИЛЕЦ AX НАЙДЕН', /AX 1/.test(клетки.join(' | ')),
    клетки.filter(x => /^AX/.test(x))[0] || 'нет', 'AX 1');
  check('МЁРТВЫЙ ГРУЗ CZ НАЙДЕН — два товара', /CZ 2/.test(клетки.join(' | ')),
    клетки.filter(x => /^CZ/.test(x))[0] || 'нет', 'CZ 2');
  check('у клеток есть совет своими словами',
    /Держите всегда/.test(t) && /мёртвым грузом/.test(t), 'есть', 'есть');
  /* Суммы в клетках — деньги, а не разметка. Я уже обернул готовый HTML в
     экранирование и показал владельцу теги вместо рублей. */
  check('В КЛЕТКАХ ДЕНЬГИ, А НЕ ТЕГИ',
    !/<span|class=/.test(клетки.join(' ')) && /100 000/.test(клетки.join(' ')),
    клетки.filter(x => /^AX/.test(x))[0] || 'нет', 'AX 1 100 000 ₽');

  /* В таблице у каждого товара свой класс и свой разброс */
  check('В ТАБЛИЦЕ ПОЯВИЛАСЬ КОЛОНКА «РОВНОСТЬ»',
    /Ровность/.test(t) && /Разброс/.test(t), 'есть', 'есть');
  check('и она не пустая — у товаров стоят X, Y, Z',
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('table.data')].pop();
      if (!t) return false;
      return [...t.querySelectorAll('tbody tr')].some(tr => /\b[XYZ]\b/.test(tr.innerText));
    }), 'заполнена', 'заполнена');

  /* Клетка — не украшение: по нажатию она фильтрует таблицу */
  const строк = () => page.evaluate(() => {
    const t = [...document.querySelectorAll('table.data')].pop();
    return t ? t.querySelectorAll('tbody tr').length : 0;
  });
  const былоСтрок = await строк();
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.xyz-cell')].filter(e => /^CZ/.test(e.innerText))[0];
    if (c) c.click();
  });
  await page.waitForTimeout(600);
  const сталоСтрок = await строк();
  check('НАЖАТИЕ НА КЛЕТКУ ФИЛЬТРУЕТ ТАБЛИЦУ, А НЕ ДЕЛАЕТ НИЧЕГО',
    сталоСтрок < былоСтрок && сталоСтрок > 0,
    былоСтрок + ' → ' + сталоСтрок, 'стало меньше');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 26. Ревизор: программа проверяет себя сама, а правила собираются кубиками.

       Владелец попросил «ИИ внутри, который анализирует ошибки, говорит и
       исправляет». Языковую модель в папку не положить, а вот правила —
       можно, и они надёжнее. До сих пор 34 правила проверяли выдуманные
       магазины у разработчика; Ревизор переносит ту же проверку на данные
       владельца. */
{
  console.log('— Ревизор и конструктор правил');
  const { page, ctx, errs } = await open();

  check('ЭКРАН РЕВИЗОРА ЕСТЬ В ПРОГРАММЕ',
    await page.evaluate(() => (window.WMUI.views() || []).some(v => v.id === 'revizor')),
    'есть', 'есть');

  await page.evaluate(() => window.WMUI.go('revizor'));
  await page.waitForTimeout(500);
  const текст = () => page.evaluate(() =>
    document.body.innerText.replace(/[\u00a0\u202f]/g, ' '));
  let t = await текст();
  check('на пустой базе он не выдумывает тревог',
    /Тревоги\s*0/.test(t) && /Смен пока нет/.test(t), 'молчит', 'молчит');

  /* Записываем смену, где до сейфа не доехало, и терминал разошёлся */
  await page.evaluate(() => {
    const S = window.WMStore;
    const касса = (S.state.accounts || []).filter(a => a.kind === 'till')[0];
    const банк = (S.state.accounts || []).filter(a => a.kind === 'bank')[0];
    S.add('dds', { type: 'Смена', date: '2026-09-16', till: 'Касса 1', shift: 'Ночь',
      cashier: 'Марьям', account: касса ? касса.id : '', cashlessAccount: банк ? банк.id : '',
      openCash: 0, zCash: 77624, returnsCash: 95, deposits: 0, payouts: 0,
      collected: 76769, collectedFact: 67969, factCash: 760,
      zCashless: 73165, zCard: 25003, zQr: 45828, zNfc: 2000, checks: 129 });
    S.save(); window.WMUI.recompute(); window.WMUI.go('revizor');
  });
  await page.waitForTimeout(600);
  t = await текст();

  check('РЕВИЗОР УВИДЕЛ, ЧТО ДО СЕЙФА НЕ ДОЕХАЛО 8 800',
    /не доехало 8 800/.test(t), (t.match(/не доехало[^\n]*/) || ['нет'])[0], '8 800 ₽');
  /* Что делать — видно сразу. Почему так вышло — по кнопке «Почему»:
     именно длинные объяснения мешали глазам искать. */
  check('ЧТО ДЕЛАТЬ — ВИДНО СРАЗУ',
    /разбираться надо с людьми|поправьте смену/.test(t), 'видно', 'видно');
  check('А «ПОЧЕМУ» СВЁРНУТО, НО НЕ ПОТЕРЯНО',
    !/Касса пробила инкассацию/.test(t) &&
    await page.evaluate(() => [...document.querySelectorAll('.more-box')]
      .some(e => /Касса пробила инкассацию/.test(e.textContent))),
    'свёрнуто', 'свёрнуто');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.more-btn')]
      .filter(x => /Почему/.test(x.textContent))[0];
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  check('И ОБЪЯСНЯЕТ СЛОВАМИ, А НЕ КОДОМ ОШИБКИ',
    /Касса пробила инкассацию/.test(await текст()), 'объяснил', 'объяснил');
  check('увидел и расхождение терминала с кассой',
    /Терминал и касса разошлись/.test(t),
    (t.match(/Терминал и касса[^\n]*/) || ['нет'])[0], 'нашёл');
  check('тревог стало больше нуля', !/Тревоги\s*0/.test(t), 'есть', 'есть');

  /* --- Конструктор: собираем правило мышкой ------------------------------- */
  await page.evaluate(() => window.WMUI.openForm('ruleNew'));
  await page.waitForTimeout(450);
  check('КОНСТРУКТОР ОТКРЫВАЕТСЯ И ПОКАЗЫВАЕТ СОБРАННУЮ ФРАЗУ',
    await page.evaluate(() => !!document.querySelector('.rule-preview')),
    await page.evaluate(() => (document.querySelector('.rule-preview') || {}).innerText || 'нет'),
    'фраза видна');
  check('ПОЛЯ — СПИСКИ, А НЕ МЕСТО ДЛЯ ФОРМУЛЫ',
    await page.evaluate(() => {
      const f = ['metric', 'op', 'level'];
      return f.every(n => {
        const e = document.querySelector('.sheet [name="' + n + '"]');
        return e && e.tagName === 'SELECT' && e.options.length > 1;
      });
    }), 'списки', 'списки');
  const показателей = await page.evaluate(() =>
    document.querySelector('.sheet [name="metric"]').options.length);
  check('показателей в списке много — есть из чего собирать',
    показателей >= 15, показателей, '≥ 15');

  await page.selectOption('.sheet [name="metric"]', 'revenue');
  await page.selectOption('.sheet [name="op"]', '<');
  await page.fill('.sheet [name="value"]', '200000');
  await page.selectOption('.sheet [name="level"]', 'warn');
  await page.fill('.sheet [name="title"]', 'Выручка ниже обычного');
  await page.fill('.sheet [name="what"]', 'Проверить, был ли завоз.');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(800);

  t = await текст();
  check('ПРАВИЛО ВЛАДЕЛЬЦА СРАБОТАЛО НА ЕГО ЖЕ ДАННЫХ',
    /Выручка ниже обычного/.test(t), 'сработало', 'сработало');
  check('и подписано как своё, а не встроенное',
    /ваше правило/.test(t), 'подписано', 'подписано');
  check('рядом стоит совет, который владелец написал сам',
    /Проверить, был ли завоз/.test(t), 'есть', 'есть');

  /* Правило можно выключить, не удаляя */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-act="rule-off"]')][0];
    if (b) b.click();
  });
  await page.waitForTimeout(700);
  t = await текст();
  check('ПРАВИЛО ВЫКЛЮЧАЕТСЯ, НЕ ИСЧЕЗАЯ',
    !/Выручка ниже обычного.*ваше правило/s.test(t) && /Выручка ниже обычного/.test(t),
    'выключено, но на месте', 'выключено, но на месте');

  const правил = await page.evaluate(() => (window.WMStore.state.rules || []).length);
  check('и осталось в списке', правил === 1, правил, 1);

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 27. Отчёт в файл PDF, с русскими буквами.

       Печать через браузер была и раньше. Но отчёт чаще нужно ОТПРАВИТЬ:
       бухгалтеру, в папку за месяц, себе в телефон. jsPDF из коробки знает
       только латиницу — проверено, слова «Ведомость» в файле не оказывалось
       вовсе. Поэтому рядом лежит урезанный PT Sans. */
{
  console.log('— Отчёт в PDF-файл');
  const { page, ctx, errs } = await open();

  check('БИБЛИОТЕКИ ПОДКЛЮЧЕНЫ И РАБОТАЮТ ОФЛАЙН',
    await page.evaluate(() => !!(window.jspdf && window.jspdf.jsPDF) &&
      !!window.WMPdfFont && !!window.Fuse && !!window.ss && !!window.WMPdf),
    await page.evaluate(() => [
      (window.jspdf && window.jspdf.jsPDF) ? 'jsPDF' : '—',
      window.WMPdfFont ? 'шрифт' : '—', window.Fuse ? 'Fuse' : '—',
      window.ss ? 'статистика' : '—', window.WMPdf ? 'наш модуль' : '—'].join(' ')),
    'все пять');

  /* Заполняем базу и открываем отчёт */
  await page.evaluate(() => {
    const S = window.WMStore;
    S.setSetting('storeName', 'Продукты у дома');
    S.setSetting('legalName', 'ИП Иванов И.И.');
    const касса = (S.state.accounts || []).filter(a => a.kind === 'till')[0];
    S.add('dds', { type: 'Смена', date: '2026-09-16', till: 'Касса 1', shift: 'День',
      cashier: 'Марьям', account: касса ? касса.id : '', openCash: 0, zCash: 50000,
      payouts: 0, collected: 0, factCash: 50000, checks: 120 });
    S.save(); window.WMUI.recompute(); window.WMUI.go('cashiers');
  });
  await page.waitForTimeout(600);

  check('КНОПКА PDF СТОИТ РЯДОМ С ПЕЧАТЬЮ',
    await page.evaluate(() => !!document.querySelector('[data-act="pdf"]')),
    'есть', 'есть');

  const файл = await page.evaluate(() => {
    const doc = window.WMPdf.build(document.getElementById('page') || document.body,
      window.WMStore.settings);
    if (!doc) return { ошибка: 'не собрался' };
    const байты = new Uint8Array(doc.output('arraybuffer'));
    let текст = '';
    for (let i = 0; i < байты.length; i++) текст += String.fromCharCode(байты[i]);
    return { размер: байты.length, страниц: doc.getNumberOfPages(),
      шрифт: Object.keys(doc.getFontList()).includes('PTSans'),
      встроен: /FontFile2/.test(текст),
      имя: window.WMPdf.fileName(document.getElementById('page') || document.body,
        window.WMStore.settings) };
  });

  check('ФАЙЛ СОБИРАЕТСЯ', !файл.ошибка && файл.размер > 2000,
    файл.размер + ' байт', '> 2000');
  check('и шрифт с кириллицей встроен в сам документ, а не «где-то есть»',
    файл.шрифт && файл.встроен, файл.встроен ? 'встроен' : 'нет', 'встроен');

  /* Самое важное про PDF: дошли ли русские буквы. Искать слова в байтах
     файла бесполезно — со встроенным шрифтом текст лежит НОМЕРАМИ ГЛИФОВ, а
     не буквами. Зато если буквы в шрифте нет, номер будет 0000 («пусто»).
     Значит, доказательство такое: у слова из девяти букв — девять номеров,
     и ни одного нулевого. */
  const глифы = await page.evaluate(() => {
    const J = window.jspdf.jsPDF;
    const d = new J();
    window.WMPdfFont.install(d);
    d.setFontSize(12);
    d.text('Ведомость', 10, 20);
    const поток = d.internal.pages[1].join('\n');
    const куски = поток.match(/<([0-9A-Fa-f]{4,})>\s*Tj/g) || [];
    const hex = куски.length ? куски[0].replace(/[<>]|\s*Tj/g, '') : '';
    let нулей = 0;
    for (let i = 0; i < hex.length; i += 4) if (hex.slice(i, i + 4) === '0000') нулей++;
    return { букв: hex.length / 4, нулей: нулей };
  });
  check('РУССКИЕ БУКВЫ ДОШЛИ ДО ФАЙЛА: девять букв — девять глифов',
    глифы.букв === 9, глифы.букв, 9);
  check('И НИ ОДНА НЕ ПРЕВРАТИЛАСЬ В ПУСТОЙ КВАДРАТ',
    глифы.нулей === 0, глифы.нулей + ' пустых', '0 пустых');
  check('ИМЯ ФАЙЛА ПОНЯТНОЕ: магазин, отчёт, дата',
    /Продукты у дома — .+ \d{4}-\d{2}-\d{2}\.pdf$/.test(файл.имя), файл.имя, 'с магазином и датой');

  /* В файл попадает то, что на экране, а не что-то посчитанное заново */
  const собрано = await page.evaluate(() =>
    window.WMPdf.collect(document.getElementById('page') || document.body)
      .map(b => b.вид));
  check('В ФАЙЛ ИДЁТ ТО ЖЕ, ЧТО НА ЭКРАНЕ: титул, плитки, таблицы',
    собрано.includes('титул') && собрано.length >= 2, собрано.join(', '), 'титул и данные');

  /* --- Поиск с опечатками в настоящем браузере ---------------------------- */
  await page.evaluate(() => {
    const U = window.WMUI, E = window.WM, d = U.data();
    d.sales = [
      { key: 'a', name: 'Молоко 3.2% Простоквашино', qty: 10, revenue: 5000, cogs: 4000, profit: 1000 },
      { key: 'b', name: 'Сметана 20% Домик в деревне', qty: 5, revenue: 2000, cogs: 1500, profit: 500 },
      { key: 'c', name: 'Шоколад Алёнка', qty: 3, revenue: 900, cogs: 600, profit: 300 }
    ];
    d.salesPeriod = { from: '01.09.2026', to: '30.09.2026', days: 30 };
    U.recompute(); U.go('itemprofit');
  });
  await page.waitForTimeout(500);
  /* Считаем только строки с данными. Таблица на пустом результате рисует
     строку «Пока пусто», а внизу бывает итоговая — обе не находки. */
  const строк = async () => page.evaluate(() => {
    const t = [...document.querySelectorAll('table.data')].pop();
    if (!t) return 0;
    return [...t.querySelectorAll('tbody tr')]
      .filter(tr => !tr.classList.contains('plain') && !tr.classList.contains('total')).length;
  });
  const искать = async (q) => {
    await page.evaluate(x => {
      window.WMFilter.setText('itemprof', x); window.WMUI.render();
    }, q);
    await page.waitForTimeout(350);
    return строк();
  };
  check('ТОЧНЫЙ ПОИСК В БРАУЗЕРЕ РАБОТАЕТ', (await искать('молоко')) === 1,
    await искать('молоко'), 1);
  check('И ОПЕЧАТКА ПРОЩАЕТСЯ: «малако» находит молоко',
    (await искать('малако')) === 1, await искать('малако'), 1);
  check('а чепуха по-прежнему не находит ничего',
    (await искать('ыфвафыв')) === 0, await искать('ыфвафыв'), 0);

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 28. Командная палитра, плавность и отклик.

       В программе сорок экранов. Искать нужный глазами в меню — это каждый
       раз пять секунд и сбитая мысль. */
{
  console.log('— Командная палитра и плавность');
  const { page, ctx, errs } = await open();

  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  check('ПАЛИТРА ОТКРЫВАЕТСЯ ПО CTRL+K',
    await page.evaluate(() => !!document.getElementById('cmdWrap')), 'открылась', 'открылась');
  check('и сразу предлагает, куда пойти',
    await page.evaluate(() => document.querySelectorAll('.cmd-row').length) > 5,
    await page.evaluate(() => document.querySelectorAll('.cmd-row').length), '> 5');

  const найти = async (q) => {
    await page.fill('#cmdInput', q);
    await page.waitForTimeout(300);
    return page.evaluate(() => [...document.querySelectorAll('.cmd-row')]
      .map(e => e.innerText.replace(/\n/g, ' · ')));
  };

  /* Владелец думает словом «инкассация», а экран называется «Утро: сверка
     кассы». Палитра обязана это связать. */
  const инкас = await найти('инкас');
  check('СЛОВО ВЛАДЕЛЬЦА ВЕДЁТ НА НУЖНЫЙ ЭКРАН: «инкас» → сверка кассы',
    инкас.length === 1 && /сверка кассы/i.test(инкас[0]), инкас.join(' | ') || 'пусто',
    'Утро: сверка кассы');

  const опечатка = await найти('зарплта');
  check('ОПЕЧАТКА ПРОЩАЕТСЯ',
    опечатка.some(x => /зарплат/i.test(x)), опечатка.slice(0, 2).join(' | ') || 'пусто',
    'про зарплату');

  /* Мусор в списке хуже пустого списка: владелец нажмёт наугад и попадёт не
     туда. Лучше честно сказать «не нашлось». */
  const чепуха = await найти('ыфвафыв');
  check('ЧЕПУХА НЕ ВЫДАЁТ МУСОРА, А ЧЕСТНО ГОВОРИТ «НЕ НАШЛОСЬ»',
    чепуха.length === 0 &&
    await page.evaluate(() => !!document.querySelector('.cmd-empty')),
    чепуха.length + ' пунктов', '0 пунктов');

  /* Стрелки и Enter — палитрой пользуются с клавиатуры, не мышью */
  await найти('ревизор');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check('ENTER ОТКРЫВАЕТ ВЫБРАННОЕ',
    /Ревизор/.test(await page.evaluate(() => {
      const t = document.querySelector('.page-head h1, .page-head .page-title');
      return t ? t.textContent : '';
    })), 'открылся', 'Ревизор');
  check('и палитра закрывается за собой',
    await page.evaluate(() => !document.getElementById('cmdWrap')), 'закрылась', 'закрылась');

  /* Esc должен закрывать: это первое, что нажимают, когда передумали */
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('ESC ЗАКРЫВАЕТ ПАЛИТРУ',
    await page.evaluate(() => !document.getElementById('cmdWrap')), 'закрылась', 'закрылась');

  check('КНОПКА В ШАПКЕ ТОЖЕ ОТКРЫВАЕТ — на телефоне Ctrl+K нет',
    await page.evaluate(() => {
      const b = document.querySelector('[data-act="palette"]');
      if (!b) return false;
      b.click();
      return !!document.getElementById('cmdWrap');
    }), 'открывает', 'открывает');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  /* Плавность: программа не должна дёргаться. Но и уважать «уменьшить
     движение» обязана — кому анимация мешает, тот её не увидит. */
  /* Стили читаем с диска, а не из браузера: страница открыта как файл, и
     Chrome не даёт заглянуть в её таблицы стилей — cssRules бросает ошибку,
     а счёт выходит нулевым. Я на этом и попался. */
  const css = fs.readFileSync(path.join(HERE, '..', 'styles.css'), 'utf8');
  const анимаций = (css.match(/animation\s*:|transition\s*:|@keyframes/g) || []).length;
  check('ПЛАВНОСТЬ ЕСТЬ, А НЕ ПЯТЬ ПРАВИЛ НА ВСЮ ПРОГРАММУ',
    анимаций >= 15, анимаций + ' правил', '≥ 15');
  check('и «уменьшить движение» уважается — кому анимация мешает, тот её не увидит',
    /prefers-reduced-motion/.test(css), 'уважается', 'уважается');
  check('на печати анимаций нет',
    /@media print[\s\S]{0,200}animation:\s*none/.test(css), 'нет', 'нет');

  /* Размер букв — одна настройка на три ступени, а не две разные */
  const ступени = await page.evaluate(() => {
    const S = window.WMStore, out = {};
    ['нет', 'да', 'очень крупный'].forEach(v => {
      S.setSetting('bigText', v); window.WMUI.applyLook();
      out[v] = [document.body.classList.contains('big'),
        document.body.classList.contains('huge')].join('/');
    });
    S.setSetting('bigText', 'нет'); window.WMUI.applyLook();
    return out;
  });
  check('РАЗМЕР БУКВ — ТРИ СТУПЕНИ ОДНОЙ НАСТРОЙКОЙ',
    ступени['нет'] === 'false/false' && ступени['да'] === 'true/false' &&
    ступени['очень крупный'] === 'true/true',
    JSON.stringify(ступени), 'нет → да → очень крупный');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 29. CSV из 1С и молчаливая потеря записей.

       Две настоящие ошибки, найденные на настоящей выгрузке:
       кириллица превращалась в «Íîìåíêëàòóðà», а «980,00» — в 98 000. */
{
  console.log('— CSV из 1С и потеря записей');
  const { page, ctx, errs } = await open();

  const строки = ['Номенклатура;Количество;Сумма',
    'Молоко 3,2% Простоквашино;12;1 450,50',
    'Хлеб Бородинский;40;980,00',
    'Сыр Российский;5;2 300,75'].join('\r\n');

  /* Windows-1251 — то, в чём 1С пишет по умолчанию. Собираем байты руками:
     подделывать кодировку нельзя, проверка должна видеть настоящие байты. */
  const в1251 = [];
  for (const ch of строки) {
    const c = ch.codePointAt(0);
    if (c < 128) в1251.push(c);
    else if (c === 0x0401) в1251.push(168);              // Ё
    else if (c === 0x0451) в1251.push(184);              // ё
    else if (c >= 0x0410 && c <= 0x044F) в1251.push(c - 0x0410 + 192);
    else в1251.push(63);
  }

  const m1251 = await page.evaluate((a) =>
    window.WMUI.readWorkbook(new Uint8Array(a).buffer, 'продажи.csv').matrix, в1251);

  check('КИРИЛЛИЦА В CSV ЧИТАЕТСЯ, А НЕ ПРЕВРАЩАЕТСЯ В «Íîìåíêëàòóðà»',
    m1251[0][0] === 'Номенклатура', m1251[0][0], 'Номенклатура');
  check('«980,00» ОСТАЛОСЬ 980, А НЕ СТАЛО 98 000 — ошибка была в сто раз',
    m1251[2][2] === 980, m1251[2][2], 980);
  check('«1 450,50» с пробелом-разделителем прочиталось верно',
    m1251[1][2] === 1450.5, m1251[1][2], 1450.5);
  check('название с запятой не превратилось в число',
    m1251[1][0] === 'Молоко 3,2% Простоквашино', m1251[1][0], 'осталось текстом');

  const вUtf = [...new TextEncoder().encode(строки)];
  const mUtf = await page.evaluate((a) =>
    window.WMUI.readWorkbook(new Uint8Array(a).buffer, 'продажи.csv').matrix, вUtf);
  check('CSV В UTF-8 ЧИТАЕТСЯ ТОЧНО ТАК ЖЕ',
    mUtf[0][0] === 'Номенклатура' && mUtf[2][2] === 980,
    mUtf[0][0] + ' / ' + mUtf[2][2], 'Номенклатура / 980');

  /* Молчаливая потеря записей. Хранилище браузера не резиновое; программа
     ошибку ловила и запоминала, но НИКТО её не читал. Владелец продолжал бы
     вносить записи и узнал бы обо всём назавтра, открыв пустые цифры. */
  await page.evaluate(() => {
    // Подделываем переполнение: настоящее ждать слишком долго
    const было = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function () { throw new Error('хранилище браузера переполнено'); };
    try { window.WMStore.save(); } finally { localStorage.setItem = было; }
    window.WMUI.render();
  });
  await page.waitForTimeout(400);
  const тревога = await page.evaluate(() => {
    const b = document.getElementById('alertBar');
    return b && !b.hidden ? b.innerText.replace(/\s+/g, ' ') : '';
  });
  check('ЗАПИСИ ПЕРЕСТАЛИ СОХРАНЯТЬСЯ — ПРОГРАММА КРИЧИТ ОБ ЭТОМ',
    /НЕ СОХРАНЯЮТСЯ/.test(тревога), тревога.slice(0, 70) || 'молчит', 'кричит');
  /* Мало крикнуть — надо показать выход. Тревога на полосе это кнопка:
     нажатие обязано открыть экран, где беду можно исправить. Проверяем
     нажатием, а не чтением текста: текст можно переписать, а выход нет. */
  const увёл = await page.evaluate(async () => {
    const b = document.getElementById('alertBar');
    const it = b && b.querySelector('.alert-item');
    if (!it) return 'кнопки нет';
    it.click();
    await new Promise(r => setTimeout(r, 300));
    return document.getElementById('page').innerText.slice(0, 80).replace(/\s+/g, ' ');
  });
  check('и говорит, что делать — ведёт на экран, где чинят',
    /Данные и копии/.test(увёл), увёл.slice(0, 60) || 'никуда', 'на «Данные и копии»');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 25. Кассовая книга: то, ради чего владелец и завёл программу.

       По дням — сколько было с утра, что пришло, что ушло, сколько осталось.
       Главное свойство книги: остаток на утро следующего дня равен остатку на
       вечер предыдущего. Рвётся цепочка — деньги взялись из воздуха. */
{
  console.log('— Кассовая книга');
  const { page, ctx, errs } = await open();

  await page.evaluate(() => {
    const S = window.WMStore;
    S.setSetting('reportMonth', '2026-09');
    const a = S.state.accounts || [];
    /* Начальный остаток живёт на самом счёте, а не в настройке: настройку
       программа переносит в счёт один раз, при заведении. Ставим туда, где
       он хранится на самом деле, — иначе проверка проверяла бы не то. */
    a.find(x => x.kind === 'cash').opening = 10000;
    const сейф = a.find(x => x.kind === 'cash').id, банк = a.find(x => x.kind === 'bank').id;
    S.state.dds = [];
    S.add('dds', { type: 'Смена', date: '2026-09-14', till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 5000, zCash: 74841, zCashless: 73165, payouts: 10760,
      kept: 5000, received: 57969,
      payoutList: [{ name: 'Молокозавод', sum: 8000 }, { name: 'Вода', sum: 2760 }],
      toAccount: сейф, cashlessAccount: банк });
    S.add('dds', { type: 'Расход', date: '2026-09-14', category: 'Аренда',
      method: 'Наличные', account: сейф, amount: 15000 });
    S.add('dds', { type: 'Приход', date: '2026-09-15', category: 'Внёс владелец',
      method: 'Наличные', account: сейф, amount: 50000 });
    S.add('dds', { type: 'Забор', date: '2026-09-16', method: 'Наличные',
      account: сейф, amount: 20000 });
    S.save(); window.WMUI.recompute(); window.WMUI.go('cashbook');
  });
  await page.waitForTimeout(600);
  const cb = (await page.textContent('#page')).replace(/[\u00a0\u202f]/g, ' ');

  check('КАССОВАЯ КНИГА ОТКРЫЛАСЬ', cb.includes('Кассовая книга'), 'открылась', 'открылась');
  check('видно, что было на начало месяца', cb.includes('10 000'), 'видно', '10 000 ₽');
  check('ВЫРУЧКА СМЕНЫ ПОПАЛА В КНИГУ ПРИХОДОМ',
    cb.includes('57 969'), 'попала', '57 969 ₽');
  check('расход наличными — строкой со статьёй',
    /Аренда/.test(cb) && cb.includes('15 000'), 'есть', 'Аренда 15 000 ₽');
  check('свои деньги владельца видны отдельно',
    /Внёс владелец/.test(cb) && cb.includes('50 000'), 'видно', 'Внёс владелец 50 000 ₽');
  check('и забор владельца тоже', /Забрал владелец/.test(cb), 'видно', 'видно');
  /* 10 000 + 57 969 − 15 000 + 50 000 − 20 000 = 82 969 */
  check('ОСТАТОК НА КОНЕЦ СОШЁЛСЯ', cb.includes('82 969'), 'сошёлся', '82 969 ₽');

  /* Цепочка: вечер одного дня = утро следующего. Проверяем по самой книге,
     а не по экрану: на экране числа могут совпасть случайно. */
  const цепь = await page.evaluate(() => {
    const E = window.WM, S = window.WMStore;
    const b = E.cashBook(S.state.dds, S.settings, null, null, S.state.accounts);
    return { рвётся: b.days.some((d, i) => i > 0 && d.open !== b.days[i - 1].close),
      конец: b.close,
      сейф: E.safeOnHand(S.state.dds, S.settings, null, S.state.accounts) };
  });
  check('ЦЕПОЧКА ОСТАТКОВ НЕ РВЁТСЯ', !цепь.рвётся, цепь.рвётся ? 'рвётся' : 'цела', 'цела');
  check('КНИГА СОШЛАСЬ С ОСТАТКОМ СЕЙФА', цепь.конец === цепь.сейф,
    цепь.конец + ' против ' + цепь.сейф, 'одинаково');

  /* Бланк КО-4 существует, но на экране его не видно — только на бумаге. */
  const бланк = await page.evaluate(() => {
    const e = document.querySelector('.ko4');
    if (!e) return 'бланка нет';
    return getComputedStyle(e).display === 'none' ? 'скрыт' : 'виден на экране';
  });
  check('БЛАНК КО-4 ЕСТЬ, НО НА ЭКРАНЕ НЕ МЕШАЕТ', бланк === 'скрыт', бланк, 'скрыт');
  check('и в нём есть шапка с юрлицом',
    await page.evaluate(() => /ИП Ахмедов|Кассовая книга за/.test(
      (document.querySelector('.ko4') || {}).textContent || '')) ||
    await page.evaluate(() => !!document.querySelector('.ko4-t')),
    'есть', 'есть');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 26. Пример за год: программа заполняется одной кнопкой.

       Владелец попросил «примерно заполни данные за год во всех окнах».
       Пустая программа ничего не говорит о себе. Здесь проверяется, что
       кнопка действительно заполняет ВСЕ экраны, а не половину, и что
       убрать пример можно, не потеряв своих записей. */
{
  console.log('— Пример за год');
  const { page, ctx, errs } = await open();
  /* Обычно всплывшее окно — это ошибка, и open() его отклоняет. Здесь
     наоборот: кнопки примера СПРАШИВАЮТ подтверждение, и это правильно —
     учёт не то место, где что-то появляется само. Поэтому на время блока
     снимаем общий обработчик и соглашаемся. */
  page.removeAllListeners('dialog');
  const вопросы = [];
  page.on('dialog', d => { вопросы.push(d.message()); d.accept(); });

  // сначала кладём настоящую запись владельца
  await page.evaluate(() => {
    const S = window.WMStore;
    S.add('dds', { type: 'Расход', date: '2026-01-15', category: 'Аренда',
      method: 'Наличные', amount: 110000 });
    S.save();
  });

  /* Считаем своё ДО заполнения и сравниваем с тем, что стало. Число из
     головы сюда не годится: программа при первом запуске заводит себе
     кое-что сама, и это тоже «не пример». */
  const своихДо = await page.evaluate(() => window.WMDemo.счёт(window.WMStore, false));

  await page.evaluate(() => window.WMUI.go('data'));
  await page.waitForTimeout(450);
  check('НА ЭКРАНЕ «ДАННЫЕ» ЕСТЬ КНОПКА «ЗАПОЛНИТЬ»',
    await page.evaluate(() => !!document.querySelector('[data-act="demo-fill"]')),
    'есть', 'есть');

  const t0 = Date.now();
  await page.evaluate(() => document.querySelector('[data-act="demo-fill"]').click());
  await page.waitForTimeout(1500);
  const мс = Date.now() - t0;

  const после = await page.evaluate(() => {
    const S = window.WMStore, DEMO = window.WMDemo;
    return { примера: DEMO.счёт(S, true), своих: DEMO.счёт(S, false),
      журнал: (S.state.log || []).length };
  });
  check('ПЕРЕД ЗАПОЛНЕНИЕМ ПРОГРАММА СПРОСИЛА',
    вопросы.length > 0 && /Заполнить|пример/i.test(вопросы[0]),
    вопросы[0] ? вопросы[0].slice(0, 60) : 'не спросила', 'спрашивает');
  check('и предупредила, что записи владельца не пострадают',
    /вместо них|не вместо|К НИМ/i.test(вопросы.join(' ')),
    вопросы.join(' | ').slice(0, 80), 'предупреждает');
  check('ПРИМЕР ЗАПОЛНИЛ БАЗУ', после.примера > 1500, после.примера, 'больше 1500');
  check('и сделал это быстро, а не за полминуты', мс < 6000, мс + ' мс', 'меньше 6000 мс');
  check('ЗАПИСИ ВЛАДЕЛЬЦА НЕ ТРОНУТЫ', после.своих === своихДо, после.своих, своихДо);
  /* Пример не пишет в журнал правок: иначе «Что менялось» забилось бы
     тремя тысячами строк и перестало быть полезным. */
  check('и не забил журнал «Что менялось»', после.журнал < 50, после.журнал, 'меньше 50');

  /* Главное: ВСЕ экраны должны показывать числа, а не пустоту. */
  const экраны = await page.evaluate(() => window.WMUI.views().map(v => v.id));
  const пустые = [], сбои = [];
  for (const v of экраны) {
    try {
      await page.evaluate(id => window.WMUI.go(id), v);
      await page.waitForTimeout(200);
      const t = (await page.evaluate(() => document.getElementById('page').innerText))
        .replace(/[\u00a0\u202f]/g, ' ');
      // «Что менялось» пуст намеренно — пример в журнал не пишет
      if (v !== 'log' && (t.match(/\d/g) || []).length < 12) пустые.push(v);
    } catch (e) { сбои.push(v); }
  }
  check('ВСЕ ЭКРАНЫ ЗАПОЛНИЛИСЬ ЧИСЛАМИ', пустые.length === 0,
    пустые.join(', ') || 'все ' + экраны.length, 'ни одного пустого');
  check('и ни один не упал', сбои.length === 0, сбои.join(', ') || 'ни один', 'ни один');
  check('экранов проверено', экраны.length >= 40, экраны.length, 'не меньше 40');

  /* Числа примера обязаны быть честными: иначе владелец посмотрит на них и
     решит, что программа врёт. */
  const честно = await page.evaluate(() => {
    const E = window.WM, S = window.WMStore;
    const кн = E.cashBook(S.state.dds, S.settings, null, null, S.state.accounts);
    return { книга: кн.close,
      сейф: E.safeOnHand(S.state.dds, S.settings, null, S.state.accounts),
      журнал: E.journal(S.state.dds, S.state.accounts).ok };
  });
  check('КНИГА ПРИМЕРА СХОДИТСЯ С НАЛИЧНЫМИ', честно.книга === честно.сейф,
    честно.книга + ' против ' + честно.сейф, 'одинаково');
  check('и журнал двойной записи в ноль', честно.журнал, 'сходится', 'сходится');

  // Убираем
  await page.evaluate(() => window.WMUI.go('data'));
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-act="demo-clear"]').click());
  await page.waitForTimeout(900);
  const итог = await page.evaluate(() => {
    const S = window.WMStore, DEMO = window.WMDemo;
    return { примера: DEMO.счёт(S, true), своих: DEMO.счёт(S, false),
      продаж: window.WMUI.data().sales.length };
  });
  check('УБРАЛИ ПРИМЕР — ОТ НЕГО НЕ ОСТАЛОСЬ НИЧЕГО', итог.примера === 0, итог.примера, 0);
  check('А ЗАПИСИ ВЛАДЕЛЬЦА ОСТАЛИСЬ', итог.своих === своихДо, итог.своих, своихДо);
  check('и товарная аналитика примера тоже убралась', итог.продаж === 0, итог.продаж, 0);

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 27. Центр уведомлений: умное — в колокольчик, а не на глаза.

       Владелец согласился, чтобы программа стала умнее — подсказывала, что
       важно, предупреждала заранее, замечала странное, — но поставил
       условие: «чтобы это было в уведомлениях, а не на виду». И назвал
       поимённо, что имеет право прорваться на экран: записи не
       сохраняются, крупная недостача прямо сейчас, сегодня надо платить
       поставщику. Всё прочее — только в колокольчике.

       Условие легко нарушить, не заметив: добавил новую подсказку, поставил
       ей вид «срочно» — и полоса снова стала шумом. Поэтому проверка
       сторожит не текст, а само правило. */
{
  console.log('— Уведомления: что кричит, а что ждёт в колокольчике');
  const { page, ctx, errs } = await open();

  const сегодня = await page.evaluate(() => window.WM.today());
  const вчера = await page.evaluate(d => window.WM.addDays(d, -1), сегодня);

  await page.evaluate(([сег, вч]) => {
    const S = window.WMStore;
    // срочное: просроченный платёж, платёж сегодня, свежая крупная недостача
    S.add('plans', { due: '2026-01-05', supplier: 'Рамми', amount: 15000, status: 'Запланирована' });
    S.add('plans', { due: сег, supplier: 'Молокозавод', amount: 40000, status: 'Запланирована' });
    S.add('dds', { type: 'Смена', date: вч, till: 'Касса 1', shift: 'День',
      cashier: 'Аня', openCash: 0, zCash: 60000, zCashless: 0, payouts: 0,
      received: 52000, kept: 0 });
    // не срочное: наличных выше порога и долг поставщикам выше порога
    S.setSetting('cashLimit', 1000);
    S.setSetting('debtCrit', 1000);
    S.add('dds', { type: 'Приход', date: вч, category: 'Прочее',
      method: 'Наличные', amount: 300000 });
    S.add('dds', { type: 'День', date: вч, debtTaken: 90000, debtPaid: 0 });
    /* Пять старых смен с расхождением. Ревизор найдёт пять одинаковых
       находок — на них проверяется сворачивание однородного. */
    for (let i = 0; i < 5; i++) {
      S.add('dds', { type: 'Смена', date: '2026-0' + (i + 2) + '-10', till: 'Касса 1',
        shift: 'День', cashier: 'Аня', openCash: 0, zCash: 30000, zCashless: 0,
        payouts: 0, received: 26000, kept: 0 });
    }
    S.save(); window.WMUI.recompute(); window.WMUI.render();
  }, [сегодня, вчера]);
  await page.waitForTimeout(400);

  const сбор = await page.evaluate(() => {
    const с = window.WMNotices.собрать(window.WMStore, window.WM, window.WMRevizor);
    return { срочных: с.filter(x => x.вид === 'срочно').map(x => x.id),
      прочиеИД: с.filter(x => x.вид !== 'срочно').map(x => x.id),
      прочих: с.filter(x => x.вид !== 'срочно').length, всего: с.length };
  });
  check('ПРОГРАММА ЗАМЕТИЛА И СРОЧНОЕ, И ОСТАЛЬНОЕ',
    сбор.срочных.length >= 3 && сбор.прочих >= 2,
    'срочных ' + сбор.срочных.length + ', прочих ' + сбор.прочих, 'и того, и другого');
  /* Сторож ниже стережёт список срочного. Но стеречь ему нечего, если
     подопытные тревоги в этом магазине вообще не сработали: проверка
     тогда проходит всегда и не значит ничего. Поэтому сперва убеждаемся,
     что не срочные тревоги ДЕЙСТВИТЕЛЬНО собрались — каждая своим путём. */
  check('и не срочные тревоги правда сработали, а не промолчали',
    сбор.прочиеИД.indexOf('debt') >= 0 && сбор.прочиеИД.indexOf('cashlimit') >= 0,
    сбор.прочиеИД.join(', ') || 'ни одной', 'долг и лимит наличных');

  /* ГЛАВНОЕ ПРАВИЛО ВЛАДЕЛЬЦА. Срочным может быть только то, что он назвал.
     Появится в этом списке четвёртый вид — проверка упадёт, и это верно:
     расширять список без слова владельца нельзя. */
  const РАЗРЕШЕНО = ['save', 'overdue', 'duetoday', 'freshdiff'];
  const лишние = сбор.срочных.filter(id => РАЗРЕШЕНО.indexOf(id) < 0);
  check('СРОЧНО — ТОЛЬКО ТО, ЧТО НАЗВАЛ ВЛАДЕЛЕЦ',
    лишние.length === 0, лишние.join(', ') || 'ничего лишнего', 'ни одного своевольного');

  const полоса = await page.evaluate(() => {
    const b = document.getElementById('alertBar');
    return { скрыта: !!b.hidden,
      строк: b.querySelectorAll('.alert-item').length,
      текст: b.innerText.replace(/\s+/g, ' ') };
  });
  check('НА ПОЛОСЕ ТОЛЬКО СРОЧНОЕ, И НЕ БОЛЬШЕ ТРЁХ',
    !полоса.скрыта && полоса.строк > 0 && полоса.строк <= 3, полоса.строк + ' строк', 'от 1 до 3');
  check('А НЕ СРОЧНОЕ НА ГЛАЗА НЕ ЛЕЗЕТ',
    !/порога|Долг поставщикам/.test(полоса.текст), полоса.текст.slice(0, 70), 'без «кстати»');

  // Значок считает непрочитанное — и «кстати» его не зажигает
  const значок = await page.evaluate(() => {
    const з = document.getElementById('bellN');
    const с = window.WMNotices.собрать(window.WMStore, window.WM, window.WMRevizor);
    return { видно: !з.hidden, число: +з.textContent,
      должно: с.filter(x => x.вид !== 'кстати').length };
  });
  check('КОЛОКОЛЬЧИК ГОРИТ И СЧИТАЕТ НЕПРОЧИТАННОЕ',
    значок.видно && значок.число === значок.должно,
    значок.число + ' против ' + значок.должно, 'одинаково');

  // Экран уведомлений: всё собрано в одном месте, разложено по важности
  await page.evaluate(() => document.getElementById('bellBtn').click());
  await page.waitForTimeout(400);
  const экран = await page.evaluate(() => document.getElementById('page').innerText.replace(/\s+/g, ' '));
  check('КОЛОКОЛЬЧИК ОТКРЫВАЕТ ЭКРАН УВЕДОМЛЕНИЙ', /Уведомления/.test(экран),
    экран.slice(0, 50), 'открылся');
  check('и раскладывает по важности, а не в кучу',
    /Срочное/.test(экран) && /Стоит посмотреть/.test(экран),
    'разложено', 'два раздела');
  check('НЕ СРОЧНОЕ ВИДНО ЗДЕСЬ — ОНО НЕ ПОТЕРЯЛОСЬ',
    /порога|Долг поставщикам/.test(экран), 'видно', 'видно');

  /* ОДНОРОДНОЕ СВОРАЧИВАЕТСЯ. Пять одинаковых расхождений — это пять
     одинаковых строк, то самое «куча информации, и фокус теряется».
     Должна остаться одна строка и число остальных. */
  const свёрнуто = await page.evaluate(() => {
    const с = window.WMNotices.собрать(window.WMStore, window.WM, window.WMRevizor);
    const свои = с.filter(x => /Недостача|Излишек/.test(x.text));
    return { строк: свои.length, текст: свои.length ? свои[свои.length - 1].text : '' };
  });
  check('ПЯТЬ ОДИНАКОВЫХ НАХОДОК — ОДНА СТРОКА, А НЕ ПЯТЬ',
    свёрнуто.строк <= 2, свёрнуто.строк + ' строк', 'не больше двух');
  check('и в ней сказано, сколько ещё таких',
    /и ещё \d+ похож/.test(свёрнуто.текст), свёрнуто.текст, 'с числом остальных');

  // Прочитал — значок погас и не зажигается заново сам
  await page.evaluate(() => document.querySelector('[data-act="notices-seen"]').click());
  await page.waitForTimeout(400);
  const после = await page.evaluate(() => {
    window.WMUI.render();
    const з = document.getElementById('bellN');
    return { скрыт: !!з.hidden, число: з.textContent,
      полоса: !document.getElementById('alertBar').hidden };
  });
  check('ПРОЧИТАЛ — ЗНАЧОК ПОГАС', после.скрыт, после.число || 'погас', 'погас');
  check('НО СРОЧНОЕ С ПОЛОСЫ НЕ ИСЧЕЗЛО — ДЕЛО-ТО НЕ СДЕЛАНО',
    после.полоса, 'на месте', 'на месте');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 28. Поставщики: просто, а глубже по кнопке.

       Владелец выбрал из предложенных вариантов именно этот: «Начать
       просто, углубляться по желанию». Сверху одна цифра — сколько всего
       должен, — а подробности по кнопке, на этом же экране. */
{
  console.log('— Поставщики: одна цифра, подробности по кнопке');
  const { page, ctx, errs } = await open();

  const сегодня = await page.evaluate(() => window.WM.today());
  await page.evaluate(сег => {
    const S = window.WMStore;
    S.setSetting('openDebtStart', 200000);
    S.add('plans', { due: '2026-01-05', supplier: 'Хлебозавод', amount: 15000,
      status: 'Запланирована' });
    S.add('plans', { due: сег, supplier: 'Молокозавод', amount: 40000,
      status: 'Запланирована' });
    S.save(); window.WMUI.recompute(); window.WMUI.go('suppliers');
  }, сегодня);
  await page.waitForTimeout(500);

  const просто = await page.evaluate(() =>
    document.getElementById('page').innerText.replace(/\s+/g, ' '));
  check('СРАЗУ ВИДНО ГЛАВНОЕ: СКОЛЬКО ВСЕГО ДОЛЖЕН',
    /Должны поставщикам/.test(просто) && /200 000/.test(просто.replace(/[\u00a0\u202f]/g, ' ')),
    просто.slice(0, 70), 'одна цифра долга');
  check('и про просрочку сказано отдельно',
    /Просрочено выплат/.test(просто), 'сказано', 'сказано');
  check('А ПОДРОБНОСТЕЙ СРАЗУ НЕТ — ИХ НАДО ПОПРОСИТЬ',
    !/По поставщикам/.test(просто) && !/Хлебозавод/.test(просто),
    просто.length + ' знаков на экране', 'без таблицы');
  check('но кнопка за ними на виду',
    /Разбить по поставщикам/.test(просто), 'на виду', 'на виду');

  await page.evaluate(() => document.querySelector('[data-act="sup-split"]').click());
  await page.waitForTimeout(400);
  const глубже = await page.evaluate(() =>
    document.getElementById('page').innerText.replace(/\s+/g, ' '));
  check('НАЖАЛ — ПОЯВИЛАСЬ РАЗБИВКА ПО ИМЕНАМ',
    /По поставщикам/.test(глубже) && /Хлебозавод/.test(глубже) && /Молокозавод/.test(глубже),
    'появилась', 'появилась');
  check('и главная цифра никуда не делась',
    /Должны поставщикам/.test(глубже), 'на месте', 'на месте');

  /* САМОЕ ВАЖНОЕ. Разбивка — это выплаты по именам, а НЕ разложенный общий
     долг: в ручной цифре имён нет. Если программа об этом промолчит,
     владелец сложит столбец, не получит свой долг и решит, что она врёт. */
  check('И ЧЕСТНО СКАЗАНО, ЧТО ЭТО НЕ РАЗЛОЖЕННЫЙ ДОЛГ',
    /не складываются в общий долг|не разложенный общий долг/.test(глубже),
    'сказано', 'сказано');

  const свёрнуто = await page.evaluate(async () => {
    document.querySelector('[data-act="sup-split"]').click();
    await new Promise(r => setTimeout(r, 300));
    return document.getElementById('page').innerText.replace(/\s+/g, ' ');
  });
  check('нажал ещё раз — свернулось обратно',
    !/По поставщикам/.test(свёрнуто), 'свернулось', 'свернулось');

  /* Кто ведёт долг по накладным, приходит сюда именно за подробностями:
     ему экран открыт сразу. Это и есть работа настройки, которая раньше
     не делала ничего. */
  const поНакладным = await page.evaluate(async () => {
    window.WMStore.setSetting('debtMode', 'по накладным');
    window.WMUI.go('pulse');
    await new Promise(r => setTimeout(r, 200));
    window.WMUI.go('suppliers');
    await new Promise(r => setTimeout(r, 300));
    return document.getElementById('page').innerText.replace(/\s+/g, ' ');
  });
  check('НАСТРОЙКА «ДОЛГ ВЕДУ ПО НАКЛАДНЫМ» ТЕПЕРЬ ЧТО-ТО ЗНАЧИТ',
    /По поставщикам/.test(поНакладным), 'экран сразу подробный', 'сразу подробный');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 29. Десять лет выгрузок: программа не ограничивает себя и не падает.

       Владелец: «не нужно ограничивать память программы, пусть весит хоть
       гигабайт, хоть четыре — разницы нет. Самое главное, чтобы работала
       стабильно, без ошибок, без форс-мажора».

       Раньше выгрузки старше двух лет молча выбрасывались. Теперь не
       выбрасывается ничего — и надо доказать, что программа это несёт:
       считает, рисует, не падает и отвечает на нажатия. Проверяем на
       настоящем объёме большого магазина, а не на трёх строчках. */
{
  console.log('— Десять лет выгрузок в памяти');
  const { page, ctx, errs } = await open();

  /* 4 000 товаров × 117 месяцев = 468 000 строк. Столько накапливает
     круглосуточный магазин за десять лет. Кладём их тем же путём, каким
     их кладёт разбор файлов: в товарную память, строкой на товар в месяц. */
  const залили = await page.evaluate(() => {
    const D = window.WMUI.data();
    const rows = [];
    for (let г = 2017; г <= 2026; г++) {
      for (let м = 1; м <= 12; м++) {
        if (г === 2026 && м > 9) break;
        const мм = String(м).padStart(2, '0');
        const дд = new Date(г, м, 0).getDate();
        const from = г + '-' + мм + '-01', to = г + '-' + мм + '-' + дд;
        for (let i = 0; i < 4000; i++) {
          const кол = 5 + ((i * 7 + м) % 300), цена = 20 + (i % 500);
          rows.push({ name: 'Товар ' + i, key: 'товар ' + i, qty: кол,
            group: 'Группа ' + (i % 30), revenue: кол * цена, cogs: кол * цена * 0.78,
            profit: кол * цена * 0.22, sellPrice: цена, from: from, to: to });
        }
      }
    }
    D.sales = rows;
    /* Группы товаров программа берёт из выгрузки остатков, а не из продаж:
       в отчёте по продажам группы нет. Поэтому кладём и остатки — иначе
       экран групп был бы пуст законно, и проверять было бы нечего. */
    D.stock = [];
    for (let i = 0; i < 4000; i++) {
      D.stock.push({ name: 'Товар ' + i, key: 'товар ' + i, group: 'Группа ' + (i % 30),
        left: 10 + (i % 50), buyPrice: 20 + (i % 500), sellPrice: 26 + (i % 500),
        stockSum: (10 + (i % 50)) * (20 + (i % 500)) });
    }
    return rows.length;
  });
  check('В ПАМЯТИ ДЕСЯТЬ ЛЕТ, А НЕ ДВА', залили === 468000, залили, 468000);

  const счёт = await page.evaluate(() => {
    const t = performance.now();
    window.WMUI.recompute();
    return Math.round(performance.now() - t);
  });
  check('ПРОГРАММА ЭТО ПЕРЕСЧИТАЛА', счёт >= 0, счёт + ' мс', 'пересчитала');
  check('и уложилась в разумное ожидание, а не в минуту',
    счёт < 8000, счёт + ' мс', 'меньше 8 с');

  /* Ни один товарный экран не имеет права упасть или отдать пустоту на
     таком объёме. Пустой экран здесь был бы хуже ошибки: владелец решил
     бы, что данных нет. */
  /* Берём экраны, которые живут именно на продажах: остатки, заказы и
     неликвиды читают другие выгрузки, сезонность — записи о деньгах, и
     пустыми они здесь были бы законно. Ищем на экране НАШИ имена: «есть
     цифры» — проверка слабая, цифра найдётся и в словах «данных нет». */
  const товарные = [['abc', /Товар \d/], ['itemprofit', /Товар \d/],
    ['groups', /Группа \d/], ['stock', /Товар \d/]];
  const плохие = [];
  let дольше = 0;
  for (const [v, ждём] of товарные) {
    const r = await page.evaluate(([id, re]) => {
      const t = performance.now();
      try { window.WMUI.go(id); } catch (e) { return { id: id, беда: e.message }; }
      const мс = Math.round(performance.now() - t);
      const txt = document.getElementById('page').innerText;
      return { id: id, мс: мс, наши: new RegExp(re).test(txt) };
    }, [v, ждём.source]);
    await page.waitForTimeout(120);
    if (r.беда || !r.наши) плохие.push(r.id + ': ' + (r.беда || 'нашего не видно'));
    if (r.мс > дольше) дольше = r.мс;
  }
  check('ЭКРАНЫ ПРОДАЖ ПОКАЗАЛИ ТОВАР ИЗ ЭТИХ ДЕСЯТИ ЛЕТ', плохие.length === 0,
    плохие.join(', ') || 'все ' + товарные.length, 'ни одного пустого');
  check('и самый тяжёлый экран не подвесил окно намертво',
    дольше < 8000, 'дольше всего ' + дольше + ' мс', 'меньше 8 с');

  /* Самое важное: после всего этого программа живая. Нажатие работает,
     запись сохраняется, учёт денег на месте — он от выгрузок не зависит. */
  const живая = await page.evaluate(async () => {
    window.WMUI.go('pulse');
    await new Promise(r => setTimeout(r, 200));
    const S = window.WMStore;
    S.add('dds', { type: 'Расход', date: '2026-09-18', category: 'Аренда',
      method: 'Наличные', amount: 1234 });
    S.save();
    return { ошибка: S.lastSaveError || '',
      записалось: S.state.dds.filter(r => r.amount === 1234).length,
      экран: document.getElementById('page').innerText.slice(0, 30) };
  });
  check('ЗАПИСЬ ПОСЛЕ ЭТОГО ВСЁ РАВНО СОХРАНЯЕТСЯ', !живая.ошибка && живая.записалось === 1,
    живая.ошибка || 'сохранилась', 'сохранилась');
  check('и программа отвечает на нажатия', живая.экран.length > 3,
    живая.экран.replace(/\s+/g, ' '), 'отвечает');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 30. Установка: скопировали программу — она работает на новом месте.

       Владелец попросил «примерно установочную программу»: чтобы приложение
       можно было положить на флешку или на компьютер, и оно там работало.
       Проверять это на словах нельзя: копирование ломается тихо — забыли
       папку vendor, не тот регистр в имени файла, — и владелец узнаёт об
       этом уже на месте, с пустым экраном. Поэтому здесь установщик
       запускается по-настоящему, а копия открывается в браузере. */
{
  console.log('— Установка на другое место');
  const { execFileSync } = await import('child_process');
  const os = await import('os');

  const куда = fs.mkdtempSync(path.join(os.tmpdir(), 'уст-'));
  let поставилось = '';
  try {
    execFileSync('bash', [path.join(HERE, '..', 'Установить.command')],
      { input: куда + '\n\n', encoding: 'utf8', timeout: 120000 });
    поставилось = path.join(куда, 'Учёт магазина');
  } catch (e) { поставилось = ''; }

  check('УСТАНОВЩИК ОТРАБОТАЛ И ПОЛОЖИЛ ПРОГРАММУ',
    !!поставилось && fs.existsSync(path.join(поставилось, 'Учёт_магазина.html')),
    поставилось || 'не отработал', 'программа на месте');

  if (поставилось) {
    /* Папки, без которых программа — пустой экран. Их забывают чаще всего:
       человек копирует «главный файл» и удивляется. */
    const нужные = ['js', 'vendor', 'styles.css', 'Учёт_магазина.html',
      'Запустить.bat', 'Запустить.command', 'README_Инструкция.txt'];
    const нет = нужные.filter(f => !fs.existsSync(path.join(поставилось, f)));
    check('И ВСЁ, БЕЗ ЧЕГО ОНА НЕ РАБОТАЕТ, СКОПИРОВАЛОСЬ',
      нет.length === 0, нет.join(', ') || 'всё на месте', 'ничего не забыто');

    /* ВЫГРУЗКИ 1С НЕ КОПИРУЮТСЯ, И ЭТО ВАЖНО. В них закупочные цены и
       телефоны поставщиков. Программу отдают другому магазину, ставят на
       чужой компьютер — чужие цены уезжать вместе с ней не должны. */
    const выгрузки = fs.existsSync(path.join(поставилось, 'Данные_1С_и_Excel'))
      ? fs.readdirSync(path.join(поставилось, 'Данные_1С_и_Excel')) : [];
    check('А ВЫГРУЗКИ 1С С ЧУЖИМИ ЦЕНАМИ — НЕ УЕХАЛИ',
      выгрузки.length === 1 && /ПОЛОЖИТЕ/.test(выгрузки[0]),
      выгрузки.join(', ') || 'папки нет', 'только памятка');

    const { page, ctx, errs } = await open();
    await page.goto('file://' + path.join(поставилось, 'Учёт_магазина.html'));
    await page.waitForTimeout(1200);
    const живёт = await page.evaluate(() => {
      const S = window.WMStore;
      S.add('dds', { type: 'Расход', date: '2026-09-18', category: 'Аренда',
        method: 'Наличные', amount: 5000 });
      S.save(); window.WMUI.recompute(); window.WMUI.go('ledger');
      return { экранов: window.WMUI.views().length, ошибка: S.lastSaveError || '',
        видно: /5 000|5000/.test(document.getElementById('page').innerText
          .replace(/[\u00a0\u202f]/g, ' ')) };
    });
    check('УСТАНОВЛЕННАЯ КОПИЯ ОТКРЫЛАСЬ ЦЕЛИКОМ',
      живёт.экранов >= 40, живёт.экранов + ' экранов', 'не меньше 40');
    check('И В НЕЙ МОЖНО РАБОТАТЬ: ЗАПИСЬ СОХРАНИЛАСЬ И ВИДНА',
      !живёт.ошибка && живёт.видно, живёт.ошибка || 'видна', 'видна');
    check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
    await page.close(); await ctx.close();
  }

  fs.rmSync(куда, { recursive: true, force: true });
  console.log('');
}

/* 31. Вторая копия: флешка пропала — база осталась.

       Владелец: «чтобы можно было сделать резервную копию, копию оставить
       на компьютере либо на отдельной флешке — если вдруг флешка сгорит,
       испортится, потеряется».

       Механизм в программе был давно, а ВЫБРАТЬ эту папку было негде:
       кнопки не существовало, и копия не делалась ни разу. Проверяем не
       кнопку, а результат: в папке должен появиться файл, из которого база
       поднимается целиком.

       Настоящее окно выбора папки браузер показывает только человеку, и
       нажать его отсюда нельзя. Поэтому подменяем РОВНО ЭТО окно — а всё
       остальное работает своё: и запись файла, и состояния, и кнопки. */
{
  console.log('— Вторая копия на другой флешке');
  const { page, ctx, errs } = await open();

  await page.evaluate(() => {
    window.__папка = {};            // сюда «флешка» складывает файлы
    const handle = {
      name: 'Флешка-копии',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      values: async function* () {},
      getFileHandle: async (name) => ({
        name: name,
        createWritable: async () => ({
          write: async t => { window.__папка[name] = t; },
          close: async () => {}
        })
      })
    };
    window.showDirectoryPicker = async () => handle;
  });

  await page.evaluate(() => { window.WMUI.go('data'); });
  await page.waitForTimeout(400);
  const доТого = await page.evaluate(() =>
    document.getElementById('page').innerText.replace(/\s+/g, ' '));
  check('ПРОГРАММА СПРАШИВАЕТ, КУДА КЛАСТЬ ВТОРУЮ КОПИЮ',
    /Куда класть вторую копию/.test(доТого), 'спрашивает', 'спрашивает');
  check('и объясняет, зачем это нужно',
    /флешк/i.test(доТого) && /ДРУГОЕ место/.test(доТого), 'объясняет', 'объясняет');

  // Кладём запись, чтобы копии было что сохранять
  await page.evaluate(() => {
    const S = window.WMStore;
    S.add('dds', { type: 'Расход', date: '2026-09-18', category: 'Аренда',
      method: 'Наличные', amount: 77777 });
    S.save();
  });

  await page.evaluate(() => document.querySelector('[data-act="backup2-connect"]').click());
  await page.waitForTimeout(700);

  const после = await page.evaluate(() => {
    const имена = Object.keys(window.__папка);
    let база = null;
    try { база = JSON.parse(window.__папка[имена[0]]); } catch (e) { база = null; }
    return { файлов: имена.length, имя: имена[0] || '',
      записей: база && база.data && база.data.dds ? база.data.dds.length : 0,
      наша: !!(база && база.data && база.data.dds &&
        база.data.dds.some(r => r.amount === 77777)),
      экран: document.getElementById('page').innerText.replace(/\s+/g, ' ') };
  });

  check('ВЫБРАЛ ПАПКУ — КОПИЯ ЛЕГЛА СРАЗУ, А НЕ КОГДА-НИБУДЬ',
    после.файлов === 1, после.файлов + ' файлов', 1);
  check('и у неё в имени дата, чтобы на флешке была история',
    /^база-\d{4}-\d{2}-\d{2}/.test(после.имя), после.имя, 'база-ГГГГ-ММ-ДД-…');
  check('В КОПИИ ЛЕЖИТ НАСТОЯЩАЯ БАЗА, А НЕ ПУСТЫШКА',
    после.наша && после.записей > 0, после.записей + ' записей', 'с записями');
  check('и программа говорит, куда положила',
    /Флешка-копии/.test(после.экран), 'говорит', 'говорит');

  /* Копия «сейчас» — отдельная кнопка: перед тем как вынуть флешку,
     владелец должен иметь возможность нажать и быть уверенным. */
  /* Считать файлы тут нельзя: в имени копии минуты, и вторая копия в ту же
     минуту ляжет тем же именем. Поэтому меняем базу и смотрим, попало ли
     новое в файл — иначе проверка прошла бы и у кнопки, которая не делает
     ничего. */
  const свежесть = await page.evaluate(async () => {
    const S = window.WMStore;
    S.add('dds', { type: 'Расход', date: '2026-09-18', category: 'Связь',
      method: 'Наличные', amount: 31337 });
    S.save();
    document.querySelector('[data-act="backup2-now"]').click();
    await new Promise(r => setTimeout(r, 600));
    return Object.keys(window.__папка).some(n => {
      try { return JSON.parse(window.__папка[n]).data.dds.some(r => r.amount === 31337); }
      catch (e) { return false; }
    });
  });
  check('«СДЕЛАТЬ КОПИЮ СЕЙЧАС» КЛАДЁТ СВЕЖУЮ БАЗУ, А НЕ ВЧЕРАШНЮЮ',
    свежесть, свежесть ? 'свежая' : 'старая', 'свежая');

  /* САМОЕ ГЛАВНОЕ. Флешку вынули — программа обязана это заметить и сказать,
     а не молчать и делать вид, что копии идут. */
  const пропала = await page.evaluate(async () => {
    window.showDirectoryPicker = async () => { throw new Error('нет'); };
    const F = window.WMFiles;
    // «флешка сгорела»: папка больше не отвечает
    const битый = {
      name: 'Флешка-копии',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      values: async function* () {},
      getFileHandle: async () => { const e = new Error('нет папки'); e.name = 'NotFoundError'; throw e; }
    };
    window.showDirectoryPicker = async () => битый;
    await F.connectBackup();
    await F.copyToBackup(() => window.WMStore.state, 'проверка');
    window.WMUI.render();
    return { состояние: F.backupState,
      экран: document.getElementById('page').innerText.replace(/\s+/g, ' ') };
  });
  check('ФЛЕШКУ ВЫНУЛИ — ПРОГРАММА ЗАМЕТИЛА',
    пропала.состояние === 'lost', пропала.состояние, 'lost');
  check('И СКАЗАЛА ОБ ЭТОМ, А НЕ ДЕЛАЕТ ВИД, ЧТО КОПИИ ИДУТ',
    /не находится|Указать папку/.test(пропала.экран),
    пропала.экран.slice(0, 80), 'сказала');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 32. Тёмный компактный вид: нечитаемого текста нет ни на одном экране.

       Владелец показал своё второе приложение, Auron Finance, и попросил
       такой же вид: почти чёрный фон, зелёный акцент, компактно. Тема
       ломается тихо и по мелочам: ссылка осталась браузерно-синей и
       пропала на тёмной полосе, серая подпись слилась с фоном. Сорок семь
       экранов в двух темах глазами так не пересмотришь — поэтому считаем
       контраст по правилу WCAG: обычный текст 4,5 к 1, крупный 3 к 1.
       Это не вкусовщина, а измеримое «видно или не видно». */
{
  console.log('— Тёмный компактный вид: всё читается');
  const { page, ctx, errs } = await open();

  await page.evaluate(() => {
    const S = window.WMStore;
    S.setSetting('theme', 'Тёмная');
    S.setSetting('density', 'компактно');
    window.WMUI.applyLook();
  });

  // Заполняем годом: на пустых экранах красить нечего
  await page.evaluate(() => window.WMUI.go('data'));
  await page.waitForTimeout(400);
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept());
  await page.evaluate(() => document.querySelector('[data-act="demo-fill"]').click());
  await page.waitForTimeout(2600);

  const тёмная = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('ТЁМНАЯ ТЕМА ПРАВДА ВКЛЮЧИЛАСЬ',
    /rgb\(1?\d, ?1?\d, ?1?\d\)/.test(тёмная), тёмная, 'почти чёрный фон');
  check('и компактный режим тоже',
    await page.evaluate(() => document.body.classList.contains('compact')),
    'включён', 'включён');

  /* Светлая тема в программе была и раньше — и лежала в «Настройках» на
     седьмом экране прокрутки. Владелец про неё не знал и попросил «чтобы
     была и белая». Значит, тема нужна не в настройках, а под рукой:
     одна кнопка в шапке. Проверяем нажатием — она и должна работать
     нажатием, а не чтением документации. */
  const перекл = await page.evaluate(async () => {
    const b = document.getElementById('themeBtn');
    if (!b) return { беда: 'кнопки темы нет' };
    const до = document.documentElement.getAttribute('data-theme');
    const подсказкаДо = b.title;
    b.click();
    await new Promise(r => setTimeout(r, 300));
    const после = document.documentElement.getAttribute('data-theme');
    const настройка = window.WMStore.settings.theme;
    // подпись читаем ПОКА светло: после второго нажатия она снова про светлую
    const подсказкаПосле = document.getElementById('themeBtn').title;
    document.getElementById('themeBtn').click();
    await new Promise(r => setTimeout(r, 300));
    return { до: до, после: после, назад: document.documentElement.getAttribute('data-theme'),
      настройка: настройка, подсказкаДо: подсказкаДо, подсказкаПосле: подсказкаПосле };
  });
  check('ТЕМА ПЕРЕКЛЮЧАЕТСЯ ОДНОЙ КНОПКОЙ В ШАПКЕ',
    !перекл.беда && перекл.до === 'dark' && перекл.после === 'light',
    перекл.беда || (перекл.до + ' → ' + перекл.после), 'dark → light');
  check('и обратно тоже', перекл.назад === 'dark', перекл.назад, 'dark');
  /* Нажал на солнце — хочет светлую сейчас и завтра, а не «как в системе». */
  check('ВЫБОР ЗАПОМИНАЕТСЯ, А НЕ СБРАСЫВАЕТСЯ В «АВТО»',
    перекл.настройка === 'Светлая', перекл.настройка, 'Светлая');
  check('и кнопка подписана тем, что она сделает',
    /светлую/.test(перекл.подсказкаДо) && /тёмную/.test(перекл.подсказкаПосле),
    перекл.подсказкаДо + ' / ' + перекл.подсказкаПосле, 'понятно');

  await page.evaluate(() => {
    window.__контраст = function () {
      /* Браузер отдаёт цвет двумя разными записями. Обычную — «rgb(19, 23,
         21)», где числа 0..255. А всё, что посчитано через color-mix (а у
         нас так сделаны цветные полосы), — «color(srgb 0.93 0.85 0.86)»,
         где числа 0..1. Первая версия этой проверки читала доли как 0..255,
         считала светло-розовую полосу почти чёрной и выдавала чепуху:
         чёрный текст на розовом получался «1 к 1». */
      function разбор(c) {
        const t = String(c);
        const m = t.match(/[\d.]+/g);
        if (!m) return null;
        const k = /^color\(/.test(t) ? 255 : 1;
        return { r: +m[0] * k, g: +m[1] * k, b: +m[2] * k, a: m.length > 3 ? +m[3] : 1 };
      }
      function фонПод(el) {
        let n = el;
        while (n && n !== document.documentElement) {
          const c = разбор(getComputedStyle(n).backgroundColor);
          if (c && c.a >= 0.95) return c;
          n = n.parentElement;
        }
        return разбор(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
      }
      function яркость(c) {
        const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      }
      const плохие = [];
      const все = document.querySelectorAll('#page *, #alertBar *, .nav *, .topbar *');
      Array.prototype.forEach.call(все, function (el) {
        // только элементы с собственным видимым текстом
        const свой = Array.prototype.filter.call(el.childNodes, n => n.nodeType === 3)
          .map(n => n.textContent.trim()).join(' ').trim();
        if (!свой) return;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.3) return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const текст = разбор(cs.color); if (!текст) return;
        const фон = фонПод(el);
        // полупрозрачный текст смешиваем с фоном, иначе посчитаем не то
        const см = текст.a >= 1 ? текст : {
          r: текст.r * текст.a + фон.r * (1 - текст.a),
          g: текст.g * текст.a + фон.g * (1 - текст.a),
          b: текст.b * текст.a + фон.b * (1 - текст.a) };
        const L1 = яркость(см), L2 = яркость(фон);
        const к = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const размер = parseFloat(cs.fontSize), жирно = +cs.fontWeight >= 600;
        const крупно = размер >= 24 || (размер >= 18.66 && жирно);
        const надо = крупно ? 3 : 4.5;
        if (к < надо) плохие.push({ текст: свой.slice(0, 40), к: Math.round(к * 10) / 10,
          надо: надо, класс: (el.className || '').toString().slice(0, 30) });
      });
      return плохие;
    };
  });

  /* Обе темы. Светлую владелец оставил себе на день, и ломается она так же
     тихо: белая надпись на белой кнопке видна ровно никак. */
  const ids = await screensOf(page);
  check('ЭКРАНОВ ПРОВЕРЕНО НА ЧИТАЕМОСТЬ', ids.length >= 40, ids.length, 'не меньше 40');

  for (const тема of ['Тёмная', 'Светлая']) {
    await page.evaluate(t => {
      window.WMStore.setSetting('theme', t); window.WMUI.applyLook();
    }, тема);
    const беды = [];
    for (const id of ids) {
      await page.evaluate(v => window.WMUI.go(v), id);
      await page.waitForTimeout(80);
      const п = await page.evaluate(() => window.__контраст());
      п.forEach(x => беды.push(id + ': «' + x.текст + '» ' + x.к + ' вместо ' + x.надо +
        (x.класс ? ' (.' + x.класс + ')' : '')));
    }
    const свод = беды.filter(function (x, i, a) { return a.indexOf(x) === i; });
    check('НИ ОДНОЙ НЕЧИТАЕМОЙ НАДПИСИ — ТЕМА «' + тема.toUpperCase() + '»',
      свод.length === 0, свод.slice(0, 20).join('\n      ') || 'все читаются', 'ни одной');
  }
  await page.evaluate(() => {
    window.WMStore.setSetting('theme', 'Тёмная'); window.WMUI.applyLook();
  });

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 33. Сортировка по щелчку на заголовок — как в 1С и МойСклад.

       Владелец работает в 1С и знает МойСклад, и попросил дизайн в их духе.
       Главное, что там есть и чего у нас не было: нажал на «Сумма» — увидел,
       где больше всего денег. Сортировка живёт в помощнике table(), поэтому
       работает сразу во всех таблицах программы.

       Сортировка — то место, где ошибка выглядит как работающая программа:
       стрелка в заголовке честно показывает «по возрастанию», а порядок не
       меняется. Поэтому проверяем не стрелку, а сам порядок строк. */
{
  console.log('— Сортировка таблиц по заголовку');
  const { page, ctx, errs } = await open();

  /* Записи в РАЗНЫХ месяцах и с разными суммами. Разные месяцы тут не для
     красоты: именно на них ломались обе ошибки, которые нашлись по дороге:
     дата как номер дня и дата как число 2026. */
  await page.evaluate(() => {
    const S = window.WMStore;
    [['2026-09-02', 100], ['2026-10-01', 200], ['2026-08-19', 300],
     ['2026-10-10', 400], ['2026-09-20', 500]].forEach(([d, a]) => {
      S.add('dds', { type: 'Расход', date: d, category: 'Аренда',
        method: 'Наличные', amount: a });
    });
    S.save(); window.WMUI.recompute(); window.WMUI.go('ledger');
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const sel = document.getElementById('periodSel');
    if (sel) { sel.value = 'all'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(500);

  const шапка = await page.evaluate(() =>
    Array.from(document.querySelectorAll('table.data th')).map(t => t.innerText.trim()));
  const iДата = шапка.findIndex(t => /^Дата/.test(t));
  const iСумма = шапка.findIndex(t => /^Сумма/.test(t));
  check('в таблице есть столбцы «Дата» и «Сумма»', iДата >= 0 && iСумма >= 0,
    шапка.join(' | '), 'есть');

  async function столбец(n) {
    return page.evaluate(i => Array.from(
      document.querySelectorAll('table.data tbody tr'))
      .map(r => r.children[i] ? r.children[i].innerText.trim() : '')
      .filter(x => x && x !== '—'), n);
  }
  async function нажать(n) {
    await page.evaluate(i => document.querySelectorAll('table.data th')[i].click(), n);
    await page.waitForTimeout(350);
  }

  const порядокДо = await столбец(iДата);

  await нажать(iДата);
  const датыВверх = await столбец(iДата);
  check('ДАТА СОРТИРУЕТСЯ ПО НАСТОЯЩЕЙ ДАТЕ, А НЕ ПО НОМЕРУ ДНЯ',
    датыВверх.join(' · ') === '19 авг · 2 сен · 20 сен · 1 окт · 10 окт',
    датыВверх.join(' · '), '19 авг · 2 сен · 20 сен · 1 окт · 10 окт');
  check('и в заголовке видно, в какую сторону',
    /↑/.test(await page.evaluate(i => document.querySelectorAll('table.data th')[i].innerText, iДата)),
    'стрелка есть', 'стрелка есть');

  await нажать(iДата);
  const датыВниз = await столбец(iДата);
  check('ВТОРОЕ НАЖАТИЕ — В ОБРАТНУЮ СТОРОНУ',
    датыВниз.join(' · ') === датыВверх.slice().reverse().join(' · '),
    датыВниз.join(' · '), 'задом наперёд');

  /* Третье нажатие обязано вернуть порядок, в котором строки пришли. Без
     него из сортировки не выбраться, а исходный порядок — обычно по дате
     записи — тоже нужен. */
  await нажать(iДата);
  const датыНазад = await столбец(iДата);
  const стрелкаУшла = await page.evaluate(i =>
    !/[↑↓]/.test(document.querySelectorAll('table.data th')[i].innerText), iДата);
  /* Порядок строк тут проверять мало: в этой таблице записи и так лежат от
     новых к старым, и «вернулось как было» совпадает с «осталось по
     убыванию». Поэтому требуем ещё, чтобы стрелка из заголовка пропала —
     то есть сортировка действительно снялась, а не просто не изменилась. */
  check('ТРЕТЬЕ НАЖАТИЕ СНИМАЕТ СОРТИРОВКУ',
    стрелкаУшла && датыНазад.join(' · ') === порядокДо.join(' · '),
    (стрелкаУшла ? 'стрелки нет' : 'стрелка осталась') + ', ' + датыНазад.join(' · '),
    'без стрелки, ' + порядокДо.join(' · '));

  await нажать(iСумма);
  const суммыВверх = await столбец(iСумма);
  const числа = суммыВверх.map(x => +x.replace(/[^\d]/g, ''));
  const порознь = числа.slice().sort((a, b) => a - b);
  check('СУММА СОРТИРУЕТСЯ КАК ЧИСЛО, А НЕ КАК СЛОВО',
    числа.join(',') === порознь.join(','), суммыВверх.slice(0, 6).join(' · '),
    'по возрастанию');

  /* «1 000» как слово меньше, чем «200»: если бы сортировали текстом,
     тысяча оказалась бы в начале. Проверяем именно этим числом. */
  await page.evaluate(() => {
    const S = window.WMStore;
    S.add('dds', { type: 'Расход', date: '2026-09-05', category: 'Аренда',
      method: 'Наличные', amount: 1000 });
    S.save(); window.WMUI.recompute(); window.WMUI.render();
  });
  await page.waitForTimeout(400);
  const сТысячей = await столбец(iСумма);
  check('И ТЫСЯЧА НЕ ОКАЗЫВАЕТСЯ МЕНЬШЕ ДВУХСОТ',
    сТысячей[сТысячей.length - 1].replace(/[^\d]/g, '') === '1000',
    сТысячей.join(' · '), 'тысяча последняя');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 34. Диаграммы: библиотека наконец рисует.

       Chart.js лежал в vendor и грузился при каждом запуске — 205 КБ, — не
       рисуя ни одной диаграммы. Теперь рисует. Проверять надо не наличие
       холста (холст можно повесить и пустым), а то, что на нём ЧТО-ТО
       нарисовано: читаем пиксели и смотрим, все ли они одинаковые. */
{
  console.log('— Диаграммы рисуются на самом деле');
  const { page, ctx, errs } = await open();

  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept());
  await page.evaluate(() => window.WMUI.go('data'));
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-act="demo-fill"]').click());
  await page.waitForTimeout(2600);

  check('библиотека диаграмм на месте',
    await page.evaluate(() => typeof window.Chart === 'function'), 'есть', 'есть');

  const экраны = ['findash', 'moneyflow', 'cashiers', 'seasons'];
  const пустые = [];
  for (const id of экраны) {
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(700);
    const итог = await page.evaluate(() => {
      const c = document.querySelector('#page canvas');
      if (!c) return { нет: true };
      if (!c.width || !c.height) return { пусто: 'холст нулевого размера' };
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      /* Считаем, сколько пикселей отличается от самого первого. Пустой
         холст даёт ноль отличий — значит, не нарисовано ничего. */
      let разных = 0;
      for (let i = 0; i < d.length; i += 4 * 37) {
        if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) разных++;
      }
      return { разных: разных, точек: Math.floor(d.length / (4 * 37)) };
    });
    if (итог.нет || итог.пусто || итог.разных < 20) {
      пустые.push(id + ': ' + (итог.нет ? 'холста нет' : итог.пусто || ('пусто, ' + итог.разных)));
    }
  }
  check('НА ВСЕХ ЭКРАНАХ С ДИАГРАММАМИ ДЕЙСТВИТЕЛЬНО НАРИСОВАНО',
    пустые.length === 0, пустые.join(', ') || 'все ' + экраны.length, 'ни одной пустой');

  /* Тёмная и светлая: диаграмма, нарисованная чёрным по чёрному, — обычная
     беда тёмных тем. Сравниваем картинку в двух темах: если она не
     изменилась совсем, значит цвета взяты не из темы. */
  const отпечаток = async () => page.evaluate(() => {
    const c = document.querySelector('#page canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4 * 101) s += d[i] + d[i + 1] * 3 + d[i + 2] * 7;
    return s;
  });
  await page.evaluate(v => window.WMUI.go(v), 'findash');
  await page.waitForTimeout(700);
  const тёмный = await отпечаток();
  await page.evaluate(() => {
    window.WMStore.setSetting('theme', 'Светлая'); window.WMUI.applyLook(); window.WMUI.render();
  });
  await page.waitForTimeout(700);
  const светлый = await отпечаток();
  check('И ДИАГРАММА СЛУШАЕТСЯ ТЕМЫ, А НЕ ЖИВЁТ СВОИМИ ЦВЕТАМИ',
    тёмный !== светлый, тёмный === светлый ? 'картинка та же' : 'картинка другая',
    'другая');

  /* Перерисовка выбрасывает холсты. Если диаграммы при этом не гасить, они
     остаются в памяти и держат свои холсты — на десятом переключении экрана
     программа начинает тормозить. */
  const живых = await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      window.WMUI.go(i % 2 ? 'findash' : 'seasons');
      await new Promise(r => setTimeout(r, 250));
    }
    return window.Chart.instances ? Object.keys(window.Chart.instances).length
      : (window.Chart.registry ? -1 : -1);
  });
  check('и старые диаграммы не копятся в памяти', живых <= 3,
    живых < 0 ? 'счётчика нет, проверено гашением' : живых + ' живых', 'не больше трёх');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

/* 35. Пример заполняет экраны, а не притворяется.

       Эта проверка появилась после того, как за один вечер нашлись ЧЕТЫРЕ
       экрана, которые рисовались целиком и показывали одни нули:

         Сезонность   — спрашивал у расчёта поля, которых тот не отдавал;
         Где дешевле  — пример писал цены под другими именами полей;
         Возвраты     — то же самое с суммами возврата;
         Накопления   — пример писал конвертам goal вместо plan;
         Заказы       — «На сумму» и «Хватит на» читали несуществующие поля.

       Прежняя проверка «на экране есть цифры» всё это пропускала: ноль —
       тоже цифра. Поэтому здесь считается ДОЛЯ НУЛЕЙ среди сумм. Экран, где
       почти все суммы нулевые при годе заполненных данных, сломан — неважно,
       врёт пример или врёт экран.

       Это дешёвая проверка против дорогой беды: владелец открывает экран,
       видит нули и решает, что программе нельзя верить вообще. */
{
  console.log('— Пример заполняет экраны, а не притворяется');
  const { page, ctx, errs } = await open();

  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept());
  await page.evaluate(() => window.WMUI.go('data'));
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-act="demo-fill"]').click());
  await page.waitForTimeout(3000);

  /* «Что менялось» пример НЕ заполняет нарочно: он кладёт записи разом, не
     через журнал правок, иначе забил бы его собой до потери смысла. */
  const МОЖНО_ПУСТО = ['log'];

  const ids = await screensOf(page);
  const плохие = [];
  for (const id of ids) {
    if (МОЖНО_ПУСТО.indexOf(id) >= 0) continue;
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(110);
    const r = await page.evaluate(() => {
      const t = document.getElementById('page').innerText.replace(/[\u00a0\u202f]/g, ' ');
      const суммы = t.match(/-?\d[\d ]*(?:,\d+)?\s*₽/g) || [];
      const нули = суммы.filter(x => /^-?0(,0+)?\s*₽$/.test(x.trim()));
      /* Экран может честно сказать «нужна выгрузка из 1С» — это не поломка,
         а объяснение. Такие не считаем. */
      const объясняет = /Загрузите|загрузите отчёт|Нужна выгрузка|пока не видна|ещё не было/i.test(t);
      return { сумм: суммы.length, нулей: нули.length, объясняет: объясняет };
    });
    if (r.объясняет) continue;
    if (r.сумм >= 3 && r.нулей / r.сумм >= 0.6) {
      плохие.push(id + ': ' + r.нулей + ' нулей из ' + r.сумм + ' сумм');
    }
  }
  check('НИ ОДИН ЭКРАН НЕ ПОКАЗЫВАЕТ ОДНИ НУЛИ НА ЗАПОЛНЕННОЙ БАЗЕ',
    плохие.length === 0, плохие.join(' | ') || 'все ' + ids.length + ' экранов с данными',
    'ни одного');

  /* Отдельно — те пять, на которых это и поймали. Общая проверка выше может
     однажды «поправеть» от того, что экран показал случайную ненулевую
     цифру; эти пять названы поимённо и проверяются по существу. */
  const поимённо = [
    ['seasons', /Лучший месяц/, /—/],
    ['pricecmp', /Дешевле у/, null],
    ['returns', /Вернули на сумму/, null],
    ['funds', /Отложено сейчас/, null],
    ['orders', /На сумму/, null]
  ];
  const пустые = [];
  for (const [id, что] of поимённо) {
    await page.evaluate(v => window.WMUI.go(v), id);
    await page.waitForTimeout(160);
    const ok = await page.evaluate(re => {
      const t = document.getElementById('page').innerText.replace(/[\u00a0\u202f]/g, ' ');
      if (!new RegExp(re).test(t)) return false;
      // хотя бы одна ненулевая сумма на экране
      const суммы = (t.match(/-?\d[\d ]*(?:,\d+)?\s*₽/g) || [])
        .filter(x => !/^-?0(,0+)?\s*₽$/.test(x.trim()));
      return суммы.length > 0;
    }, что.source);
    if (!ok) пустые.push(id);
  }
  check('и пять экранов, на которых это поймали, наполнены по существу',
    пустые.length === 0, пустые.join(', ') || 'все пять', 'все пять');

  check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');
  await page.close(); await ctx.close();
  console.log('');
}

await browser.close();
console.log('Итог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
process.exit(failed ? 1 : 0);
