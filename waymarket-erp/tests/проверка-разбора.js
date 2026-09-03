/* Проверка движка на реальных выгрузках 1С.
   Запуск:  node tests/проверка-разбора.js "путь/к/папке/Данные_1С_и_Excel"
   Без пути берётся папка «Данные_1С_и_Excel» рядом с дашбордом.
   Смысл проверки: цифры дашборда должны сходиться со строкой «Итого» самого
   отчёта 1С — именно на этом раньше выручка задваивалась. */
const path = require('path');
const fs = require('fs');
const XLSX = require(path.join(__dirname, '..', 'vendor', 'xlsx.full.min.js'));
const WM = require(path.join(__dirname, '..', 'js', 'engine.js'));
const FIN = require(path.join(__dirname, '..', 'js', 'finance.js'));
const SUP = require(path.join(__dirname, '..', 'js', 'supply.js'));
const BOOK = require(path.join(__dirname, '..', 'js', 'book.js'));
const Q = require(path.join(__dirname, '..', 'js', 'quick.js'));

const dir = process.argv[2] || path.join(__dirname, '..', 'Данные_1С_и_Excel');
if (!fs.existsSync(dir)) {
  console.log('Папка с выгрузками не найдена: ' + dir + '\nПроверка пропущена.');
  process.exit(0);
}

let failed = 0, passed = 0;
function check(name, cond, got, want) {
  if (cond) { passed++; console.log('  ✅ ' + name + (got !== undefined ? '  → ' + got : '')); }
  else { failed++; console.log('  ❌ ' + name + '  получено: ' + got + ', ожидалось: ' + want); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1 : eps); }

function readMatrix(file) {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
  return {
    matrix: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }),
    names: wb.SheetNames,
    wb: wb
  };
}
// Итоговая строка отчёта 1С — эталон для сверки
function totalRow(matrix) {
  for (let r = matrix.length - 1; r >= 0; r--) {
    const first = WM.norm((matrix[r] || [])[0]);
    if (first === 'итого' || first === 'основной склад') return matrix[r];
  }
  return null;
}
const files = fs.readdirSync(dir).filter(f => /\.(xls|xlsx|csv)$/i.test(f));
console.log('Папка: ' + dir + '\nФайлов: ' + files.length + '\n');

for (const f of files) {
  const full = path.join(dir, f);
  const { matrix, names } = readMatrix(full);
  const kind = WM.detectKind(f, matrix, names);
  console.log('— ' + f + '  [' + kind + ']');

  if (kind === 'sales') {
    const res = WM.parseSales(matrix);
    const t = WM.salesTotals(res.rows);
    const tr = totalRow(matrix);
    const wantRev = WM.num(tr[res.cols.revenue]);
    const wantCogs = WM.num(tr[res.cols.cogs]);
    check('строк продаж разобрано', res.rows.length > 100, res.rows.length, '>100');
    check('выручка = «Итого» отчёта', near(t.revenue, wantRev, 1), WM.fmtMoney(t.revenue), WM.fmtMoney(wantRev));
    check('себестоимость = «Итого» отчёта', near(t.cogs, wantCogs, 1), WM.fmtMoney(t.cogs), WM.fmtMoney(wantCogs));
    check('строка «Итого» не попала в данные', !res.rows.some(r => WM.isTotalRow(r.name)), 'нет', 'нет');
    console.log('     маржа: ' + WM.fmtPct(t.margin) + ', наценка: ' + WM.fmtPct(t.markup) +
      ', период: ' + (res.period ? res.period.from + '–' + res.period.to + ' (' + res.period.days + " дн.)" : 'не указан'));
    global.__sales = res;
  }
  if (kind === 'stock') {
    const res = WM.parseStock(matrix);
    const t = WM.stockTotals(res.rows);
    const tr = totalRow(matrix);
    const wantBuy = WM.num(tr[res.cols.buySum]);
    const wantQty = WM.num(tr[res.cols.qty]);
    check('SKU разобрано', t.sku > 1000, t.sku, '>1000');
    check('склад по себестоимости = «Итого»', near(t.buySum, wantBuy, 1), WM.fmtMoney(t.buySum), WM.fmtMoney(wantBuy));
    check('количество = «Итого»', near(t.qty, wantQty, 1), WM.fmtNum(t.qty, 2), WM.fmtNum(wantQty, 2));
    check('строка склада-итога отброшена', !res.rows.some(r => WM.norm(r.name) === 'основной склад'), 'да', 'да');
    global.__stock = res;
  }
  if (kind === 'prices') {
    const res = WM.parsePrices(matrix);
    check('цен разобрано', res.rows.length > 1000, res.rows.length, '>1000');
    check('поставщик заполнен', res.rows.every(r => r.supplier !== undefined), 'да', 'да');
    const best = WM.bestPriceIndex(res.rows);
    check('индекс лучших цен построен', Object.keys(best).length > 100, Object.keys(best).length, '>100');
    global.__prices = res;
  }
  if (kind === 'contacts') {
    const res = WM.parseContacts(matrix);
    const withPhone = res.rows.filter(r => r.phone).length;
    check('контрагентов разобрано', res.rows.length > 100, res.rows.length, '>100');
    check('телефоны найдены', withPhone > 50, withPhone, '>50');
    global.__contacts = res;
  }
  if (kind === 'pricelist') {
    const res = WM.parsePricelist(matrix);
    const groups = new Set(res.rows.map(r => r.group));
    check('позиций прайса разобрано', res.rows.length > 1000, res.rows.length, '>1000');
    check('группы распознаны', groups.size > 5, groups.size, '>5');
    check('в товары не попали строки-группы', res.rows.every(r => r.buy > 0 || r.retail > 0 || r.barcode), 'да', 'да');
  }
  if (kind === 'barcodes') {
    const res = WM.parseBarcodes(matrix);
    check('штрихкодов разобрано', res.rows.length > 1000, res.rows.length, '>1000');
  }
  if (kind === 'units') {
    const res = WM.parseUnits(matrix);
    check('единиц измерения разобрано', res.rows.length > 100, res.rows.length, '>100');
  }
  if (kind === 'writeoffs1c') {
    const res = WM.parseWriteoffs1C(matrix);
    const tr = totalRow(matrix);
    const wantCost = WM.num(tr[res.cols.cost]);
    const wantQty = WM.num(tr[res.cols.qty]);
    const sum = res.rows.reduce((a, r) => a + r.cost, 0);
    const qty = res.rows.reduce((a, r) => a + r.qty, 0);
    check('строк списаний разобрано', res.rows.length > 100, res.rows.length, '>100');
    check('сумма списаний = «Итого» отчёта', near(sum, wantCost, 1), WM.fmtMoney(sum), WM.fmtMoney(wantCost));
    check('количество списаний = «Итого»', near(qty, wantQty, 0.01), WM.fmtNum(qty, 3), WM.fmtNum(wantQty, 3));
    const reasons = WM.byReason(res.rows);
    check('причины списания сгруппированы', reasons.length > 2, reasons.length + ' причин, топ: ' + reasons[0].reason, '>2');
    check('период отчёта прочитан', !!res.period, res.period && (res.period.from + '–' + res.period.to + ', ' + res.period.days + ' дн.'), 'есть');
    console.log('     в пересчёте на месяц: ' + WM.fmtMoney(WM.perMonth(sum, res.period ? res.period.days : 30)));
  }
  if (kind === 'returns') {
    const res = WM.parseReturns(matrix);
    const tr = totalRow(matrix);
    const wantCost = WM.num(tr[res.cols.cost]);
    const sum = res.rows.reduce((a, r) => a + r.cost, 0);
    check('строк возвратов разобрано', res.rows.length > 100, res.rows.length, '>100');
    check('сумма возвратов = «Итого» отчёта', near(sum, wantCost, 1), WM.fmtMoney(sum), WM.fmtMoney(wantCost));
    const reasons = WM.byReason(res.rows);
    check('причины возврата сгруппированы', reasons.length >= 1, reasons.map(r => r.reason).join(', '), '>=1');
  }
  if (kind === 'invoices1c') {
    const res = WM.parseIncomingInvoices(matrix);
    const tr = totalRow(matrix);
    const want = WM.num(tr[res.cols.sum]);
    const sum = res.rows.reduce((a, r) => a + r.sum, 0);
    check('накладных разобрано', res.rows.length > 10, res.rows.length, '>10');
    check('сумма поставок = «Итого» отчёта', near(sum, want, 1), WM.fmtMoney(sum), WM.fmtMoney(want));
    check('дата документа прочитана', res.rows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date)), res.rows[0].date, 'ГГГГ-ММ-ДД');
    global.__inv1c = res.rows;
  }
  if (kind === 'cashout' || kind === 'cashin') {
    const res = WM.parseCashOrders(matrix, kind === 'cashin' ? 'in' : 'out');
    const tr = totalRow(matrix);
    const want = WM.num(tr[res.cols.sum]);
    const sum = res.rows.reduce((a, r) => a + r.sum, 0);
    check('кассовых ордеров разобрано', res.rows.length > 10, res.rows.length, '>10');
    check('сумма по кассе = «Итого» отчёта', near(sum, want, 1), WM.fmtMoney(sum), WM.fmtMoney(want));
    const cs = WM.cashSummary(res.rows);
    check('статьи ДДС разложены', cs.byArticle.length > 1, cs.byArticle.slice(0, 3).map(a => a.name).join(', '), '>1');
    global.__cash = res.rows;
  }
  if (kind === 'owner_book') {
    const { wb } = readMatrix(full);
    const sheet = n => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) : null;
    const ddsName = wb.SheetNames.find(n => WM.norm(n) === 'ддс');
    if (ddsName) {
      const od = WM.parseOwnerDaily(sheet(ddsName));
      const t = WM.ownerTotals(od.rows);
      check('смен в книге разобрано', od.rows.length > 10, od.rows.length, '>10');
      check('оборот сходится с суммой смен (нал + онлайн + перевод)',
        near(t.revenue, t.shiftSum, 1), WM.fmtMoney(t.revenue), WM.fmtMoney(t.shiftSum));
      check('долг поставщикам прочитан', t.debt > 0,
        WM.fmtMoney(t.debt) + ' на ' + t.debtDate + ' (входящий ' + WM.fmtMoney(od.openingDebt) + ')', '>0');
      console.log('     расходы: зарплата ' + WM.fmtMoney(t.salary) + ', аренда ' + WM.fmtMoney(t.rent) +
        ', коммуналка ' + WM.fmtMoney(t.utilities) + ', налог ' + WM.fmtMoney(t.tax) +
        '; прибыль по книге ' + WM.fmtMoney(t.profit));
    }
    const opName = wb.SheetNames.find(n => WM.norm(n) === 'оплата');
    if (opName) {
      const pay = WM.parseOwnerPayments(sheet(opName)).rows;
      const sum = pay.reduce((a, r) => a + r.paidCash + r.paidDebt, 0);
      check('оплаты поставщикам разобраны', pay.length > 10, pay.length + ' строк, налом+долг ' + WM.fmtMoney(sum), '>10');
    }
    const plName = wb.SheetNames.find(n => WM.norm(n).indexOf('платежка') >= 0);
    if (plName) {
      const pr = WM.parseOwnerPayroll(sheet(plName)).rows;
      check('платёжная ведомость разобрана', pr.length > 0,
        pr.length + ' человек, ставка ' + WM.fmtMoney(pr[0].rate) + ' за смену', '>0');
    }
  }
  if (kind === 'finance_book') {
    const { wb } = readMatrix(full);
    const sheet = n => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) : null;
    const base = sheet('БАЗА_ДДС') ? FIN.parseDdsBase(sheet('БАЗА_ДДС')).rows : [];
    const plans = sheet('Запись_Выплат') ? FIN.parsePayPlan(sheet('Запись_Выплат')).rows : [];
    const cfg = sheet('Настройки') ? FIN.parseFinSettings(sheet('Настройки')) : null;
    const t = FIN.totals(base);
    const bal = FIN.balances(base, cfg ? cfg.opening : {});
    check('операций разобрано', base.length > 10, base.length, '>10');
    check('выплат разобрано', plans.length > 0, plans.length, '>0');
    check('справочники прочитаны', cfg && cfg.dict.categories.length > 3 && cfg.dict.cashiers.length > 0,
      cfg && (cfg.dict.cashiers.length + ' кассиров, ' + cfg.dict.categories.length + ' категорий'), 'есть');
    check('прибыль = приход − расход', near(t.profit, t.income - t.expense, 1),
      WM.fmtMoney(t.profit), WM.fmtMoney(t.income - t.expense));
    check('остатки по способам = прибыль', near(bal.total, t.profit + (cfg ? cfg.opening.cash + cfg.opening.card + cfg.opening.transfer : 0), 1),
      WM.fmtMoney(bal.total), WM.fmtMoney(t.profit));
    check('долг = взято в долг − погашено', near(t.debtNow, t.debtTaken - t.debtPaid, 1),
      WM.fmtMoney(t.debtNow), WM.fmtMoney(t.debtTaken - t.debtPaid));
    check('маржа считается по закупу', t.margin > 0 && t.margin < 100, WM.fmtPct(t.margin), '0–100%');
    const cats = FIN.byCategory(base);
    const catSum = cats.reduce((a, c) => a + c.sum, 0);
    check('расходы по категориям = общий расход', near(catSum, t.expense, 1), WM.fmtMoney(catSum), WM.fmtMoney(t.expense));
    const meth = FIN.byMethodIncome(base);
    const methSum = meth.reduce((a, m) => a + m.sum, 0);
    check('выручка по способам = общая выручка', near(methSum, t.income, 1), WM.fmtMoney(methSum), WM.fmtMoney(t.income));
    const wd = FIN.byWeekday(base);
    check('выручка по дням недели сходится', near(wd.reduce((a, d) => a + d.sum, 0), t.income, 1),
      wd.length + ' дней недели', 'сходится');
    const months = [...new Set(base.map(r => r.date.slice(0, 7)))].sort();
    if (months.length > 1) {
      const rep = FIN.monthReport(base, months[months.length - 1]);
      check('отчёт за месяц строится', rep.finance.length > 5 && rep.cur.income >= 0,
        rep.title + ': выручка ' + WM.fmtMoney(rep.cur.income), 'есть');
    }
    const day = base[0] && base[0].date;
    if (day) {
      const dr = FIN.dayReport(base, day, cfg ? cfg.opening : {});
      check('отчёт за день строится', dr.totals.tx > 0,
        day + ': операций ' + dr.totals.tx + ', выручка ' + WM.fmtMoney(dr.totals.income), '>0');
    }
    const pt = FIN.planTotals(plans, '2025-12-31');
    check('план выплат считается', pt.count === plans.length,
      'оплачено ' + WM.fmtMoney(pt.paid) + ', просрочено ' + WM.fmtMoney(pt.overdue), 'все платежи');
    const cal = FIN.calendarMonth(plans, plans[0] ? plans[0].due.slice(0, 7) : '2025-01', '2025-12-31');
    check('календарь выплат строится', cal.weeks.length >= 4, cal.title + ', недель ' + cal.weeks.length, '>=4');
  }
  if (kind === 'journal_shifts') {
    const { wb } = readMatrix(full);
    const sh = XLSX.utils.sheet_to_json(wb.Sheets['Журнал_Смен_24_7'], { header: 1, raw: true, defval: '' });
    const inv = XLSX.utils.sheet_to_json(wb.Sheets['Накладные_и_Выплаты'], { header: 1, raw: true, defval: '' });
    const shifts = WM.parseShiftJournalSheet(sh);
    const invoices = WM.parseInvoiceSheet(inv);
    const st = WM.shiftsTotals(shifts), it = WM.invoicesTotals(invoices);
    check('смен из журнала', shifts.length === 5, shifts.length, 5);
    check('расхождение по кассе', st.diff === -50, WM.fmtMoney(st.diff), '-50 ₽');
    check('накладных из журнала', invoices.length === 6, invoices.length, 6);
    check('общий долг поставщикам', it.debt === 66000, WM.fmtMoney(it.debt), '66 000 ₽');
  }
  if (kind === 'journal_staff') {
    const { wb } = readMatrix(full);
    const ts = XLSX.utils.sheet_to_json(wb.Sheets['Табель_Смен_24_7'], { header: 1, raw: true, defval: '' });
    const po = XLSX.utils.sheet_to_json(wb.Sheets['Выплаты_и_Авансы'], { header: 1, raw: true, defval: '' });
    const timesheet = WM.parseTimesheetSheet(ts);
    const payouts = WM.parsePayoutSheet(po);
    const summary = WM.payrollSummary(timesheet, payouts);
    check('смен в табеле', timesheet.length === 6, timesheet.length, 6);
    check('выплат в журнале', payouts.length === 5, payouts.length, 5);
    const anna = summary.find(s => /Иванова/.test(s.employee));
    check('Иванова: начислено 2 смены × 12ч × 200 ₽ + премии 800', anna && anna.accrued === 5600, anna && anna.accrued, 5600);
    check('Иванова: остаток к выплате = начислено − аванс 15 000', anna && anna.left === -9400, anna && anna.left, -9400);
  }
  console.log('');
}

/* Долг поставщикам из связки «накладные + кассовые ордера» */
if (global.__inv1c && global.__cash) {
  console.log('— Долги поставщикам по документам 1С');
  const mp = WM.matchPayments(global.__inv1c, global.__cash);
  const bal = WM.supplierBalance(global.__inv1c, global.__cash);
  check('поставки + оплаты сведены', mp.totalSum > 0 && mp.totalLeft >= 0,
    'поставки ' + WM.fmtMoney(mp.totalSum) + ', оплачено ' + WM.fmtMoney(mp.totalPaid) + ', в долг ' + WM.fmtMoney(mp.totalLeft), '>0');
  check('остаток в долг = поставки − оплаты + переплаты по отдельным документам',
    near(mp.totalLeft - mp.overpaid, mp.totalSum - mp.totalPaid, 1),
    WM.fmtMoney(mp.totalLeft) + ' (переплат ' + WM.fmtMoney(mp.overpaid) + ')', WM.fmtMoney(mp.totalSum - mp.totalPaid));
  check('погашение старых долгов выделено', mp.oldDebtPaid > 0, WM.fmtMoney(mp.oldDebtPaid), '>0');
  check('свод по поставщикам построен', bal.length > 10, bal.length + ' поставщиков, максимальный долг ' + WM.fmtMoney(bal[0].debt), '>10');
  console.log('');
}

/* Сквозные расчёты на связке продажи + остатки + цены */
if (global.__sales && global.__stock) {
  console.log('— Сквозные расчёты');
  const idx = WM.groupIndex(global.__stock.rows, global.__prices ? global.__prices.rows : []);
  const byGroup = WM.salesByGroup(global.__sales.rows, idx);
  const t = WM.salesTotals(global.__sales.rows);
  const sumGroups = byGroup.reduce((a, g) => a + g.revenue, 0);
  check('выручка по группам = общая выручка', near(sumGroups, t.revenue, 1), WM.fmtMoney(sumGroups), WM.fmtMoney(t.revenue));
  check('группы определились', byGroup.length > 5, byGroup.length + ' групп', '>5');
  const abc = WM.abcClassify(global.__sales.rows.slice());
  const a = abc.filter(r => r.abc === 'A').length;
  check('ABC-классы посчитаны', a > 0 && a < abc.length, 'A: ' + a + ' из ' + abc.length, 'часть позиций');
  const days = global.__sales.period ? global.__sales.period.days : 30;
  const rop = WM.ropList(global.__sales.rows, global.__stock.rows, days,
    { leadDays: 2, safetyPct: 30 }, global.__prices ? WM.bestPriceIndex(global.__prices.rows) : null);
  check('автозаказ ROP посчитан', rop.length > 0, rop.length + ' позиций к заказу', '>0');
  const b = WM.bep(465000, t.margin, t.revenue);
  check('BEP считается', b.month > 0, WM.fmtMoney(b.month) + ' (выполнение ' + WM.fmtPct(b.done) + ')', '>0');
  console.log('');
}

/* Ручной учёт: накладные и оплаты, которые владелец вводит в дашборде */
console.log('— Ручной учёт поставок и оплат');
{
  const inv = [
    { id: 'a', date: '2026-08-20', doc: 'НАКЛ-1', supplier: 'Молоко Юг', total: 28000 },
    { id: 'b', date: '2026-08-20', doc: 'НАКЛ-2', supplier: 'Молоко Юг', total: 12000 },
    { id: 'c', date: '2026-08-19', doc: 'НАКЛ-3', supplier: 'Пекарня', total: 4500, paidCash: 4500 }
  ];
  const pay = [
    { date: '2026-08-20', supplier: 'Молоко Юг', doc: 'НАКЛ-1', amount: 15000, kind: 'оплата сразу при приёмке' },
    { date: '2026-08-21', supplier: 'Молоко Юг', doc: '', amount: 5000, kind: 'погашение долга' }
  ];
  const t = WM.manualTotals(inv, pay);
  const bal = WM.manualBalance(inv, pay);
  const docs = WM.manualDocs(inv, pay);
  check('поставки сложились', t.supplies === 44500, WM.fmtMoney(t.supplies), '44 500 ₽');
  check('оплаты учтены (включая «отдали сразу»)', t.paid === 24500, WM.fmtMoney(t.paid), '24 500 ₽');
  check('долг = поставки − оплаты', t.debt === 20000, WM.fmtMoney(t.debt), '20 000 ₽');
  check('долг по поставщику', bal[0].supplier === 'Молоко Юг' && bal[0].debt === 20000,
    bal[0].supplier + ' ' + WM.fmtMoney(bal[0].debt), 'Молоко Юг 20 000 ₽');
  check('оплата привязалась к накладной', docs.find(d => d.doc === 'НАКЛ-1').left === 13000,
    WM.fmtMoney(docs.find(d => d.doc === 'НАКЛ-1').left), '13 000 ₽');
  check('накладная с полной оплатой закрыта', docs.find(d => d.doc === 'НАКЛ-3').status === 'paid',
    docs.find(d => d.doc === 'НАКЛ-3').statusText, 'Оплачено');
}
console.log('');

/* Поставки: постоянная база документов, справочник фирм и разбор оплат */
if (global.__inv1c && global.__cash) {
  console.log('— Поставки: база документов, фирмы, разбор оплат');
  const settings = { termDaysDefault: 3, debtorOldDays: 30 };
  const st = { docs: [], pays: [], supreg: [], debtors: [] };
  const s1 = SUP.mergeDocs(st, global.__inv1c, 'накладные.xlsx', st.supreg, settings);
  const s2 = SUP.mergePays(st, global.__cash, 'рко.xlsx', st.supreg, settings);
  SUP.autoRegister(st, settings);
  const c = SUP.compute(st, settings);
  const mp = WM.matchPayments(global.__inv1c, global.__cash);

  check('накладные легли в базу', s1.added === global.__inv1c.length, s1.added, global.__inv1c.length);
  check('оплаты легли в базу', s2.added === global.__cash.length, s2.added, global.__cash.length);
  check('сумма поставок как в прежнем расчёте', near(c.totals.sum, mp.totalSum, 0.01),
    WM.fmtMoney(c.totals.sum), WM.fmtMoney(mp.totalSum));
  check('долг поставщикам как в прежнем расчёте', near(c.totals.left, mp.totalLeft, 0.01),
    WM.fmtMoney(c.totals.left), WM.fmtMoney(mp.totalLeft));
  check('оплаты по старым накладным не потерялись', near(c.linkStat.oldSum, mp.oldDebtPaid, 0.01),
    WM.fmtMoney(c.linkStat.oldSum), WM.fmtMoney(mp.oldDebtPaid));

  // повторная загрузка тех же файлов не должна создавать вторые строки
  const r1 = SUP.mergeDocs(st, global.__inv1c, 'накладные.xlsx', st.supreg, settings);
  const r2 = SUP.mergePays(st, global.__cash, 'рко.xlsx', st.supreg, settings);
  const c2 = SUP.compute(st, settings);
  check('повторная загрузка не создаёт дублей', r1.added === 0 && r2.added === 0 &&
    c2.totals.docs === c.totals.docs, 'накладных ' + c2.totals.docs, 'накладных ' + c.totals.docs);
  check('долг после повторной загрузки не изменился', near(c2.totals.left, c.totals.left, 0.01),
    WM.fmtMoney(c2.totals.left), WM.fmtMoney(c.totals.left));

  // изменившаяся сумма документа обновляет строку, а не добавляет новую
  const one = JSON.parse(JSON.stringify(global.__inv1c.slice(0, 1)));
  one[0].sum = WM.num(one[0].sum) + 100;
  const r3 = SUP.mergeDocs(st, one, 'накладные.xlsx', st.supreg, settings);
  const c3 = SUP.compute(st, settings);
  check('изменённый документ обновляется на месте', r3.updated === 1 && r3.added === 0,
    'обновлено ' + r3.updated, 'обновлено 1');
  check('долг вырос ровно на разницу', near(c3.totals.left - c.totals.left, 100, 0.01),
    WM.fmtMoney(c3.totals.left - c.totals.left), '100 ₽');

  // имена поставщиков: «Фирма ТП Иванов» считается той же фирмой
  check('фирм меньше, чем написаний имён', c.firms.length <= c.totals.docs,
    c.firms.length + ' фирм', 'не больше числа накладных');
  const withReps = c.firms.filter(f => f.reps.length).length;
  check('торговые представители привязаны к фирмам', withReps >= 0, withReps + ' фирм с представителями', '>=0');

  // очереди
  check('каждая оплата куда-то отнесена',
    c.linkStat.auto + c.linkStat.old + c.linkStat.none + c.linkStat.expense + c.linkStat.manual === c.linkStat.total,
    c.linkStat.auto + '+' + c.linkStat.old + '+' + c.linkStat.none + '+' + c.linkStat.expense,
    c.linkStat.total);
  check('в разбор попали только спорные', c.recon.length <= c.linkStat.none + c.linkStat.expense + c.totals.docs,
    c.recon.length + ' записей', 'не больше спорных');
  check('к подтверждению — только неоплаченные',
    c.confirm.every(x => x.sum > 0), c.confirm.length + ' накладных', 'все с остатком долга');
  console.log('     фирм: ' + c.firms.length + ', имён к решению: ' + c.newNames.length +
    ', разбор: ' + c.recon.length + ', подтвердить: ' + c.confirm.length);
  console.log('');
}

/* Отсрочки и подтверждение дат выплат */
{
  console.log('— Отсрочки, даты выплат и долги покупателей');
  const settings = { termDaysDefault: 3, debtorOldDays: 30 };
  const st = { docs: [], pays: [], supreg: [], debtors: [] };
  SUP.mergeDocs(st, [
    { doc: 'ПН-1', date: '2026-08-01', supplier: 'Рамми ТП Гутаев', sum: 10000, retail: 13000 },
    { doc: 'ПН-2', date: '2026-08-02', supplier: 'Рамми ТП Асланбек', sum: 5000, retail: 6500 },
    { doc: 'ПН-3', date: '2026-08-03', supplier: 'Юсуп Фрукты', sum: 31720, retail: 37764 }
  ], 'файл.xlsx', st.supreg, settings);
  SUP.mergePays(st, [
    { doc: 'РКО-1', date: '2026-08-03', supplier: 'Юсуп Фрукты', basis: 'ПН-3',
      operation: 'Выплата контрагенту', article: 'Оплата поставщику', sum: 31498.72, cashbox: 'Наличка' }
  ], 'файл.xlsx', st.supreg, settings);
  SUP.autoRegister(st, settings);
  const reg = st.supreg;
  SUP.findFirm(reg, 'Рамми').termDays = 7;
  const yusup = SUP.findFirm(reg, 'Юсуп Фрукты'); yusup.termDays = 0;
  st.docs.forEach(d => { d.payDate = SUP.addDays(d.date, SUP.termDaysFor(d.firm, reg, settings)); });
  const c = SUP.compute(st, settings);
  const byFirm = {}; c.firms.forEach(f => { byFirm[f.firm] = f; });

  check('«ТП» не плодит фирмы', !!byFirm['Рамми'] && byFirm['Рамми'].docs === 2,
    'Рамми: ' + (byFirm['Рамми'] ? byFirm['Рамми'].docs : 0) + ' накладные', 'Рамми: 2 накладные');
  check('долг фирмы сложился', byFirm['Рамми'].left === 15000, WM.fmtMoney(byFirm['Рамми'].left), '15 000 ₽');
  const pn1 = c.docs.find(d => d.doc === 'ПН-1');
  check('дата выплаты = дата накладной + отсрочка', pn1.due === '2026-08-08', pn1.due, '2026-08-08');
  check('неподтверждённая накладная ждёт решения', c.confirm.some(x => x.doc === 'ПН-1'),
    c.confirm.length + ' в очереди', 'ПН-1 в очереди');
  const pn3 = c.docs.find(d => d.doc === 'ПН-3');
  check('оплата встала к накладной по основанию', near(pn3.paid, 31498.72, 0.01),
    WM.fmtMoney(pn3.paid), '31 498,72 ₽');
  check('недоплата видна как остаток', near(pn3.left, 221.28, 0.01), WM.fmtMoney(pn3.left), '221,28 ₽');
  check('недоплата у поставщика «оплата сразу» попала в разбор',
    c.recon.some(r => r.kind === 'underpay'), c.recon.map(r => r.problem).join(', '), 'Недоплата');

  // округление закрывает копеечный остаток
  const doc3 = st.docs.find(d => d.doc === 'ПН-3');
  doc3.roundOff = 221.28; doc3.underpayKeep = true;
  const c2 = SUP.compute(st, settings);
  check('округление закрывает остаток', c2.docs.find(d => d.doc === 'ПН-3').left === 0, '0 ₽', '0 ₽');

  // долги покупателей
  st.debtors = [
    { id: '1', date: '2026-07-01', name: 'Ахмед', sum: 1240, paid: false },
    { id: '2', date: '2026-08-30', name: 'Иса', sum: 800, paid: false },
    { id: '3', date: '2026-08-01', name: 'Хеда', sum: 500, paid: true }
  ];
  const d = SUP.debtorsList(st.debtors, { debtorOldDays: 30 });
  check('погашенные долги не считаются', d.total === 2040, WM.fmtMoney(d.total), '2 040 ₽');
  check('старые долги выделены', d.old === 1240, WM.fmtMoney(d.old), '1 240 ₽');

  // забор денег владельцем: деньги уходят, прибыль не меняется
  const rows = [
    { date: '2026-08-01', type: 'Приход', category: 'Продажи', method: 'Наличные', amount: 100000 },
    { date: '2026-08-02', type: 'Расход', category: 'Аренда', method: 'Наличные', amount: 20000 },
    { date: '2026-08-03', type: 'Забор', category: 'Забор владельца', method: 'Наличные', amount: 50000 }
  ];
  const t = FIN.totals(rows), b = FIN.balances(rows, {});
  check('забор не уменьшает прибыль', t.profit === 80000, WM.fmtMoney(t.profit), '80 000 ₽');
  check('забор уменьшает деньги в кассе', b.map['Наличные'] === 30000, WM.fmtMoney(b.map['Наличные']), '30 000 ₽');
  check('забор виден отдельной строкой', t.draw === 50000, WM.fmtMoney(t.draw), '50 000 ₽');
  console.log('');
}

/* Книга «Бухгалтерия.xlsx»: база уезжает в Excel и возвращается без потерь */
if (global.__inv1c && global.__cash) {
  console.log('— Книга «Бухгалтерия»: запись в Excel и чтение обратно');
  const settings = { termDaysDefault: 3, debtorOldDays: 30, storeName: 'ВАЙ МАРКЕТ', fot: 280000 };
  const st = { docs: [], pays: [], supreg: [], debtors: [], dds: [], plans: [], payouts: [], timesheet: [], expiry: [] };
  SUP.mergeDocs(st, global.__inv1c, 'накладные.xlsx', st.supreg, settings);
  SUP.mergePays(st, global.__cash, 'рко.xlsx', st.supreg, settings);
  SUP.autoRegister(st, settings);
  st.supreg[0].termDays = 7;
  st.dds = [
    { id: 'd1', date: '2026-08-01', shift: 'День', cashier: 'Марина', type: 'Приход',
      category: 'Продажи', method: 'Наличные', amount: 38400, diff: 0, note: '' },
    { id: 'd2', date: '2026-08-01', type: 'Расход', category: 'Аренда', method: 'Перевод', amount: 168000 },
    { id: 'd3', date: '2026-08-02', type: 'Забор', category: 'Забор владельца', method: 'Наличные', amount: 50000 }
  ];
  st.debtors = [{ id: 'x1', date: '2026-08-01', name: 'Ахмед', sum: 1240, paid: false }];
  const before = SUP.compute(st, settings);

  // пишем настоящий xlsx и читаем его обратно
  const wb = XLSX.utils.book_new();
  const sheets = BOOK.build(st, settings, { stock: global.__stock ? global.__stock.rows : [] });
  sheets.forEach(sh => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.aoa), sh.name.slice(0, 31)));
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  const back = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const mats = {};
  back.SheetNames.forEach(n => { mats[n] = XLSX.utils.sheet_to_json(back.Sheets[n], { header: 1, raw: true, defval: '' }); });

  const st2 = { docs: [], pays: [], supreg: [], debtors: [], dds: [], plans: [], payouts: [], timesheet: [], expiry: [] };
  const settings2 = { termDaysDefault: 0, debtorOldDays: 0, storeName: '', fot: 0 };
  const rep = BOOK.parse(n => mats[n] || null, st2, settings2);
  const after = SUP.compute(st2, settings2);

  check('в книге все листы на месте', back.SheetNames.length === sheets.length,
    back.SheetNames.length + ' листов', sheets.length + ' листов');
  check('накладные вернулись все', st2.docs.length === st.docs.length, st2.docs.length, st.docs.length);
  check('оплаты вернулись все', st2.pays.length === st.pays.length, st2.pays.length, st2.pays.length);
  check('операции кассы вернулись', st2.dds.length === st.dds.length, st2.dds.length, st.dds.length);
  check('долг после круга через Excel не изменился', near(after.totals.left, before.totals.left, 0.01),
    WM.fmtMoney(after.totals.left), WM.fmtMoney(before.totals.left));
  check('оплаты снова привязались к накладным', after.linkStat.auto === before.linkStat.auto,
    after.linkStat.auto, before.linkStat.auto);
  check('очередь разбора та же', after.recon.length === before.recon.length, after.recon.length, before.recon.length);
  check('очередь подтверждения та же', after.confirm.length === before.confirm.length,
    after.confirm.length, before.confirm.length);
  check('заданная отсрочка пережила запись', SUP.findFirm(st2.supreg, st.supreg[0].name).termDays === 7,
    SUP.findFirm(st2.supreg, st.supreg[0].name).termDays, 7);
  check('незаданная отсрочка не превратилась в ноль',
    st2.supreg.filter(f => f.termDays === null).length === st.supreg.filter(f => f.termDays === null).length,
    st2.supreg.filter(f => f.termDays === null).length + ' без отсрочки',
    st.supreg.filter(f => f.termDays === null).length + ' без отсрочки');
  check('настройки прочитались из книги', settings2.termDaysDefault === 3 && settings2.storeName === 'ВАЙ МАРКЕТ',
    settings2.termDaysDefault + ' / ' + settings2.storeName, '3 / ВАЙ МАРКЕТ');
  check('долг покупателя вернулся', st2.debtors.length === 1 && st2.debtors[0].sum === 1240,
    WM.fmtMoney(st2.debtors[0] ? st2.debtors[0].sum : 0), '1 240 ₽');
  check('забор владельца не стал расходом', FIN.totals(st2.dds).draw === 50000,
    WM.fmtMoney(FIN.totals(st2.dds).draw), '50 000 ₽');

  // расчётные листы
  const monthsSheet = mats['Отчёт_по_месяцам'] || [];
  const kudirSheet = mats['Доходы_и_расходы'] || [];
  check('лист «Отчёт по месяцам» заполнен', monthsSheet.length > 1, monthsSheet.length - 1 + ' строк', '>0');
  const total = kudirSheet[kudirSheet.length - 1] || [];
  check('в «Доходы и расходы» есть итог', String(total[1]) === 'ИТОГО', total[1], 'ИТОГО');
  check('доход в итоге совпадает с кассой', near(WM.num(total[3]), FIN.totals(st.dds).income, 0.01),
    WM.fmtMoney(WM.num(total[3])), WM.fmtMoney(FIN.totals(st.dds).income));

  // пустой лист не должен стирать данные
  const mats2 = JSON.parse(JSON.stringify(mats));
  mats2['Долги_покупателей'] = [mats2['Долги_покупателей'][0]];
  const st3 = JSON.parse(JSON.stringify(st2));
  BOOK.parse(n => mats2[n] || null, st3, {});
  check('пустой лист не стирает журнал', st3.debtors.length === 1, st3.debtors.length, 1);
  console.log('     листов: ' + sheets.length + ', строк прочитано: ' + rep.rows);
  console.log('');
}

/* Ручной ввод: справочники, подстановки и подсказки */
{
  console.log('— Ручной ввод: справочники, подстановки, подсказки');
  const settings = { finCategories: 'Аренда, ЗП', finCashiers: '', finShifts: 'День 09:00–21:00, Ночь 21:00–09:00',
    finMethods: 'Наличные, Карта, Перевод', finEmployees: '', finReasons: 'Просрочка' };
  const state = {
    dds: [
      { date: '2026-08-01', type: 'Расход', category: 'Аренда', method: 'Перевод', amount: 168000, cashier: 'Марина', shift: 'День 09:00–21:00' },
      { date: '2026-08-02', type: 'Расход', category: 'Хозтовары', method: 'Наличные', amount: 1200, cashier: 'Марина' },
      { date: '2026-08-03', type: 'Расход', category: 'Хозтовары', method: 'Наличные', amount: 900, cashier: 'Артём' }
    ],
    payouts: [{ date: '2026-08-02', employee: 'Артём', amount: 15000, form: 'Наличные из кассы' }],
    debtors: [], supreg: [{ name: 'Рамми' }], plans: [], timesheet: [], inventory: []
  };
  const d = Q.dicts(state, settings);
  check('справочник собрал и настройки, и записанное',
    d.categories.includes('Аренда') && d.categories.includes('Хозтовары'),
    d.categories.slice(0, 4).join(', '), 'Аренда и Хозтовары внутри');
  check('частое значение стоит первым', d.categories[0] === 'Хозтовары', d.categories[0], 'Хозтовары');
  check('кассиры собрались из записей', d.cashiers.includes('Марина') && d.cashiers.includes('Артём'),
    d.cashiers.join(', '), 'Марина, Артём');
  check('сотрудники собрались из выплат', d.employees.includes('Артём'), d.employees.join(', '), 'Артём');
  check('поставщики собрались из справочника фирм', d.suppliers.includes('Рамми'), d.suppliers.join(', '), 'Рамми');

  const s2 = JSON.parse(JSON.stringify(settings));
  check('новое слово запоминается', Q.learn(s2, 'categories', 'Вывоз мусора') && s2.finCategories.includes('Вывоз мусора'),
    s2.finCategories, 'с «Вывоз мусора»');
  check('дважды одно и то же не добавляется', Q.learn(s2, 'categories', 'аренда') === false,
    'нет', 'нет');

  const pre = Q.defaults(state, settings, 'ddsExpense');
  check('подставляется последняя категория', pre.category === 'Хозтовары', pre.category, 'Хозтовары');
  check('подставляется последний способ оплаты', pre.method === 'Наличные', pre.method, 'Наличные');
  check('подставляется сегодняшняя дата', pre.date === new Date().toISOString().slice(0, 10), pre.date, 'сегодня');
  const preP = Q.defaults(state, settings, 'payout');
  check('в зарплате подставляется последний сотрудник', preP.employee === 'Артём', preP.employee, 'Артём');

  const dup = Q.duplicate(state, 'dds', { date: '2026-08-02', amount: 1200, category: 'Хозтовары' });
  check('похожая запись за день находится', !!dup, dup ? 'нашлась' : 'нет', 'нашлась');
  check('другая сумма — не дубль', !Q.duplicate(state, 'dds', { date: '2026-08-02', amount: 1300, category: 'Хозтовары' }),
    'не дубль', 'не дубль');
  check('дата в будущем предупреждает', Q.warnings({ date: '2099-01-01', amount: 100 }).length === 1,
    Q.warnings({ date: '2099-01-01', amount: 100 }).join(', '), 'дата в будущем');

  const m = Q.shiftMath({ zCash: 38400, fCash: 38400, zCard: 61100, fCard: 61100, payout: 32000 });
  check('выручка смены = все способы', m.revenue === 99500, WM.fmtMoney(m.revenue), '99 500 ₽');
  check('касса сходится при равных Z и факте', m.status === 'сходится' && m.diff === 0, m.status, 'сходится');
  check('наличных останется = факт − выдано', m.cash === 6400, WM.fmtMoney(m.cash), '6 400 ₽');
  const m2 = Q.shiftMath({ zCash: 38400, fCash: 37000, payout: 32000 });
  check('недостача видна до сохранения', m2.status === 'недостача' && m2.diff === -1400,
    m2.status + ' ' + WM.fmtMoney(m2.diff), 'недостача −1 400 ₽');
  console.log('');
}

console.log('Итог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
process.exit(failed ? 1 : 0);
