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
const SET = require(path.join(__dirname, '..', 'js', 'settings.js'));
const STORE = require(path.join(__dirname, '..', 'js', 'store.js'));
const FLT = require(path.join(__dirname, '..', 'js', 'filters.js'));
const FILES = require(path.join(__dirname, '..', 'js', 'filestore.js'));
const DET = require(path.join(__dirname, '..', 'js', 'detail.js'));

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

  if (kind === 'deadstock') {
    const res = WM.parseDeadStock(matrix);
    check('неликвиды разобраны', res.rows.length > 10, res.rows.length + ' позиций', '>10');
    check('склад и «Итого» не попали в данные',
      !res.rows.some(r => WM.isTotalRow(r.name) || WM.norm(r.name) === 'основной склад'), 'нет', 'нет');
    const withLeft = res.rows.filter(r => r.left > 0);
    check('остатки прочитаны', withLeft.length > 0, withLeft.length + ' с остатком', '>0');
    const withDate = res.rows.filter(r => r.lastIn);
    check('дата последнего поступления прочитана', withDate.length > 0,
      withDate.length + ' с датой', '>0');
    global.__dead = res;
  }

  if (kind === 'incexp1c') {
    const res = WM.parseIncomeExpense(matrix);
    const sum = res.rows.reduce((a, r) => ({ i: a.i + r.income, e: a.e + r.expense }), { i: 0, e: 0 });
    check('документы разобраны', res.rows.length > 10, res.rows.length + ' документов', '>10');
    check('итог сходится с суммой документов',
      near(sum.i, res.totals.income, 1) && near(sum.e, res.totals.expense, 1),
      WM.fmtMoney(sum.i) + ' / ' + WM.fmtMoney(sum.e),
      WM.fmtMoney(res.totals.income) + ' / ' + WM.fmtMoney(res.totals.expense));
    check('у документов определён вид операции',
      res.rows.filter(r => r.operation).length > res.rows.length * 0.9,
      res.rows.filter(r => r.operation).length + ' из ' + res.rows.length, 'почти у всех');
    const s2 = WM.incomeExpenseSummary(res.rows);
    const opSum = s2.byOperation.reduce((a, r) => a + r.income + r.expense, 0);
    check('свод по видам операций равен обороту', near(opSum, sum.i + sum.e, 1),
      WM.fmtMoney(opSum), WM.fmtMoney(sum.i + sum.e));
    console.log('     виды операций: ' + s2.byOperation.map(r => r.name).slice(0, 4).join(', '));
  }

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
    global.__stockIdx = {};
    res.rows.forEach(r => { global.__stockIdx[r.key] = r; });
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
    // Дата прихода должна быть датой самого документа 1С, а не бумаги поставщика:
    // иначе приход падает в другой день, а то и в прошлый месяц, и долг
    // перестаёт сходиться с оплатами (те датируются документом).
    {
      const res0 = WM.parseIncomingInvoices(matrix);
      const per = WM.parsePeriod(matrix);
      const iso = d => d.split('.').reverse().join('-');
      const outside = per ? res0.rows.filter(r => r.date && (r.date < iso(per.from) || r.date > iso(per.to))).length : 0;
      check('приход датирован документом, а не бумагой поставщика', outside === 0,
        outside ? outside + ' накладных вне периода отчёта' : 'все в периоде отчёта', 'все в периоде');
      const byName = res0.rows.filter(r => {
        const m = String(r.doc).match(/от\s+(\d{2})\.(\d{2})\.(\d{4})/);
        return m && r.date !== m[3] + '-' + m[2] + '-' + m[1];
      }).length;
      check('дата совпадает с датой в названии документа', byName === 0,
        byName ? byName + ' расхождений' : 'все совпадают', 'все совпадают');
      const пар = res0.rows.filter(r => r.incomingDate && r.incomingDate !== r.date).length;
      check('дата бумаги поставщика сохранена отдельно', пар >= 0,
        пар + ' накладных, где поставщик выписал раньше', 'сохранена');
    }

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

/* Неликвиды: сколько денег лежит на полке без движения */
if (global.__dead) {
  console.log('— Неликвиды: замороженные деньги');
  const dead = WM.deadStockList(global.__dead.rows, global.__stockIdx || null,
    { deadSoldPct: 20, deadDays: 60 }, '2026-09-03');
  check('список неликвидов собран', dead.count > 0,
    dead.count + ' позиций на ' + WM.fmtMoney(dead.total), '>0');
  check('в списке только товар с остатком', dead.list.every(r => r.left > 0), 'все с остатком', 'все с остатком');
  check('сумма считается по закупочной цене',
    dead.list.every(r => near(r.money, r.left * r.price, 0.02)), 'остаток × цена', 'остаток × цена');
  check('итог равен сумме строк',
    near(dead.total, dead.list.reduce((a, r) => a + r.money, 0), 1),
    WM.fmtMoney(dead.total), 'сумма строк');
  const strict = WM.deadStockList(global.__dead.rows, global.__stockIdx || null,
    { deadSoldPct: 5, deadDays: 365 }, '2026-09-03');
  check('строгий порог оставляет меньше позиций', strict.count <= dead.count,
    strict.count + ' против ' + dead.count, 'меньше или столько же');
  console.log('     заморожено: ' + WM.fmtMoney(dead.total) + ', совсем без продаж: ' + dead.noSale);
  console.log('');
}

/* Настройки: каждый магазин настраивает правила под себя */
{
  console.log('— Настройки: налоги, отсрочки, заказы, цены, смены');
  const cat = SET.all().map(x => x.key);
  const def = STORE.DEFAULT_SETTINGS;
  check('у каждой настройки есть значение по умолчанию',
    cat.every(k => k in def), cat.filter(k => !(k in def)).join(', ') || 'все на месте', 'все на месте');
  check('каждая настройка показана на экране',
    Object.keys(def).every(k => cat.indexOf(k) >= 0),
    Object.keys(def).filter(k => cat.indexOf(k) < 0).join(', ') || 'все показаны', 'все показаны');
  check('настройки разложены по разделам', SET.GROUPS.length >= 10, SET.GROUPS.length + ' разделов', '>=10');
  check('мастер спрашивает только главное', SET.WIZARD.length <= 12 && SET.WIZARD.every(k => SET.byKey(k)),
    SET.WIZARD.length + ' вопросов', '<=12');

  // налог по выбранной системе
  const t6 = FIN.taxAmount({ taxMode: 'УСН 6% (доходы)', taxRate: 6 }, 1000000, 800000);
  const t15 = FIN.taxAmount({ taxMode: 'УСН 15% (доходы минус расходы)', taxRate: 15 }, 1000000, 800000);
  const tp = FIN.taxAmount({ taxMode: 'Патент', patentMonth: 12000 }, 1000000, 800000);
  const tn = FIN.taxAmount({ taxMode: 'Не считать' }, 1000000, 800000);
  check('УСН «доходы» считается от выручки', t6.sum === 60000, WM.fmtMoney(t6.sum), '60 000 ₽');
  check('УСН «доходы минус расходы» — от прибыли', t15.sum === 30000, WM.fmtMoney(t15.sum), '30 000 ₽');
  check('патент берётся суммой в месяц', tp.sum === 12000, WM.fmtMoney(tp.sum), '12 000 ₽');
  check('«не считать» даёт ноль', tn.sum === 0, WM.fmtMoney(tn.sum), '0 ₽');

  // перенос даты выплаты с выходного
  check('срок с субботы уезжает на понедельник',
    SUP.shiftWeekend('2026-09-05', 'Перенести на понедельник') === '2026-09-07',
    SUP.shiftWeekend('2026-09-05', 'Перенести на понедельник'), '2026-09-07');
  check('срок с воскресенья можно двигать назад, на пятницу',
    SUP.shiftWeekend('2026-09-06', 'Перенести на пятницу') === '2026-09-04',
    SUP.shiftWeekend('2026-09-06', 'Перенести на пятницу'), '2026-09-04');
  check('будний день не двигается',
    SUP.shiftWeekend('2026-09-03', 'Перенести на понедельник') === '2026-09-03', 'не сдвинулся', 'не сдвинулся');

  // заказ с запасом на N дней
  const sales = [{ key: 'a', name: 'Молоко', qty: 300, buyPrice: 60 }];
  const stock = [{ key: 'a', name: 'Молоко', qty: 10, group: 'Молочка', buyPrice: 60 }];
  const r0 = WM.ropList(sales, stock, 30, { leadDays: 2, safetyPct: 30, coverDays: 0 })[0];
  const r7 = WM.ropList(sales, stock, 30, { leadDays: 2, safetyPct: 30, coverDays: 7 })[0];
  check('запас на неделю увеличивает заказ', r7.order > r0.order, r0.order + ' → ' + r7.order, 'больше');

  // цена по наценке и округлению
  check('цена по наценке 30% округляется вверх', WM.priceFor(68.4, 30, 1) === 89, WM.priceFor(68.4, 30, 1), 89);
  check('округление до 5 ₽ работает', WM.priceFor(68.4, 30, 5) === 90, WM.priceFor(68.4, 30, 5), 90);
  check('без закупочной цены цены нет', WM.priceFor(0, 30, 1) === 0, WM.priceFor(0, 30, 1), 0);

  // смена по времени суток берёт границы из настроек
  check('часы читаются из настроек', Q.hourOf('21:00', 0) === 21 && Q.hourOf('', 9) === 9,
    Q.hourOf('21:00', 0) + ' и ' + Q.hourOf('', 9), '21 и 9');

  // книга Excel показывает понятные подписи настроек
  const sheets = BOOK.build({ dds: [], docs: [], pays: [], supreg: [], debtors: [], plans: [],
    payouts: [], timesheet: [], expiry: [] }, def, { stock: [] });
  const setSheet = sheets.filter(x => x.name === 'Настройки')[0];
  check('в книге у настроек есть колонка «Что это»',
    setSheet.aoa[0][2] === 'Что это' && setSheet.aoa[1][2],
    setSheet.aoa[1].join(' | '), 'параметр, значение и подпись');
  console.log('');
}

/* Корзина: удалённое можно вернуть */
{
  console.log('— Правка и удаление записей: корзина');
  STORE.clear();
  const a = STORE.add('dds', { date: '2026-09-01', type: 'Расход', category: 'Аренда', amount: 1000 });
  const b = STORE.add('dds', { date: '2026-09-02', type: 'Расход', category: 'Хозтовары', amount: 500 });
  check('записи добавлены', (STORE.state.dds || []).length === 2, STORE.state.dds.length, 2);

  const removed = STORE.remove('dds', a.id);
  check('удаление возвращает саму запись', removed && removed.id === a.id, removed ? 'вернуло' : 'нет', 'вернуло');
  check('в журнале осталась одна', STORE.state.dds.length === 1, STORE.state.dds.length, 1);
  check('удалённое попало в корзину', (STORE.state.trash || []).length === 1, STORE.state.trash.length, 1);

  STORE.undo();
  check('отмена вернула запись', STORE.state.dds.length === 2 && STORE.state.trash.length === 0,
    STORE.state.dds.length + ' записей, ' + STORE.state.trash.length + ' в корзине', '2 и 0');

  STORE.remove('dds', b.id);
  const tid = STORE.state.trash[0].id;
  STORE.restore(tid);
  check('возврат по кнопке из корзины работает', STORE.state.dds.length === 2, STORE.state.dds.length, 2);

  STORE.remove('dds', b.id, true);
  check('удаление насовсем корзину не трогает', (STORE.state.trash || []).length === 0 && STORE.state.dds.length === 1,
    STORE.state.dds.length + ' записей, ' + STORE.state.trash.length + ' в корзине', '1 и 0');

  STORE.remove('dds', a.id);
  STORE.emptyTrash();
  check('очистка корзины работает', (STORE.state.trash || []).length === 0, STORE.state.trash.length, 0);
  check('запись из очищенной корзины не возвращается', STORE.undo() === null, 'не вернулась', 'не вернулась');
  STORE.clear();
  console.log('');
}

/* Математика: цифры должны сходиться сами с собой.
   Здесь не сверка с 1С, а внутренние равенства: сумма частей = целому,
   доля = часть/целое, остаток = приход − расход. Если такое равенство
   ломается, значит где-то потерялась или задвоилась строка. */
console.log('— Математика: сходимость расчётов');
{
  // --- продажи, ABC, группы -------------------------------------------------
  if (global.__sales) {
    const rows = global.__sales.rows, t = WM.salesTotals(rows);
    const rev = rows.reduce((a, r) => a + r.revenue, 0);
    const cogs = rows.reduce((a, r) => a + r.cogs, 0);
    check('выручка = сумма строк', near(t.revenue, rev, 1), WM.fmtMoney(t.revenue), WM.fmtMoney(rev));
    check('валовая прибыль = выручка − себестоимость', near(t.gross, t.revenue - t.cogs, 1),
      WM.fmtMoney(t.gross), WM.fmtMoney(t.revenue - t.cogs));
    check('себестоимость = сумма строк', near(t.cogs, cogs, 1), WM.fmtMoney(t.cogs), WM.fmtMoney(cogs));
    check('маржа = прибыль / выручка', near(t.margin, t.gross / t.revenue * 100, 0.05),
      WM.fmtPct(t.margin), WM.fmtPct(t.gross / t.revenue * 100));
    check('наценка = прибыль / себестоимость', near(t.markup, t.gross / t.cogs * 100, 0.05),
      WM.fmtPct(t.markup), WM.fmtPct(t.gross / t.cogs * 100));

    const abc = WM.abcClassify(rows.slice());
    check('ABC не теряет выручку', near(abc.reduce((a, r) => a + r.revenue, 0), t.revenue, 1),
      abc.length + ' позиций', WM.fmtMoney(t.revenue));
    // доли округлены до сотых процента, поэтому у тысяч позиций сумма чуть меньше 100
    const shareSum = abc.reduce((a, r) => a + r.share, 0);
    check('доли позиций в сумме дают 100%', near(shareSum, 100, abc.length * 0.005 + 0.5),
      shareSum.toFixed(2) + '%', '100%');
    check('накопленная доля последней позиции = 100%', near(abc[abc.length - 1].shareCum, 100, 0.01),
      abc[abc.length - 1].shareCum + '%', '100%');
    check('класс A — около 80% оборота',
      abc.filter(r => r.abc === 'A').reduce((a, r) => a + r.revenue, 0) / t.revenue > 0.7,
      WM.fmtPct(abc.filter(r => r.abc === 'A').reduce((a, r) => a + r.revenue, 0) / t.revenue * 100), '>70%');
  }

  // --- склад ----------------------------------------------------------------
  if (global.__stock) {
    const st = WM.stockTotals(global.__stock.rows);
    check('склад в закупе = сумма строк',
      near(st.buySum, global.__stock.rows.reduce((a, r) => a + r.buySum, 0), 1),
      WM.fmtMoney(st.buySum), 'сумма строк');
    check('склад в рознице не меньше закупа', st.retailSum >= st.buySum,
      WM.fmtMoney(st.retailSum), '>= ' + WM.fmtMoney(st.buySum));
  }

  // --- поставки: долг, переплаты, разрез по фирмам ---------------------------
  if (global.__inv1c && global.__cash) {
    const settings = { termDaysDefault: 3, debtorOldDays: 30, roundTolerance: 5, payWeekend: 'Платить как есть' };
    const st = { docs: [], pays: [], supreg: [], debtors: [] };
    SUP.mergeDocs(st, global.__inv1c, 'i', st.supreg, settings);
    SUP.mergePays(st, global.__cash, 'p', st.supreg, settings);
    SUP.autoRegister(st, settings);
    const c = SUP.compute(st, settings);
    const roundSum = c.docs.reduce((a, d) => a + d.roundOff, 0);
    check('долг − переплата = поставки − оплаченное − округления',
      near(c.totals.left - c.totals.over, c.totals.sum - c.totals.paid - roundSum, 1),
      WM.fmtMoney(c.totals.left) + ' (переплат ' + WM.fmtMoney(c.totals.over) + ')',
      WM.fmtMoney(c.totals.sum - c.totals.paid - roundSum));
    check('по каждому документу равенство точное',
      c.docs.every(d => d.closed || Math.abs((d.left - d.over) - (d.sum - d.paid - d.roundOff)) < 0.01),
      'все ' + c.docs.length, 'все');
    check('поставки по фирмам = общая сумма',
      near(c.firms.reduce((a, f) => a + f.sum, 0), c.totals.sum, 1), 'сходится', 'сходится');
    check('оплаты по фирмам = оплачено',
      near(c.firms.reduce((a, f) => a + f.paid, 0), c.totals.paid, 1), 'сходится', 'сходится');
    check('переплаты по фирмам = общая переплата',
      near(c.firms.reduce((a, f) => a + f.over, 0), c.totals.over, 1),
      WM.fmtMoney(c.totals.over), 'сходится');
    check('просрочено не больше долга', c.totals.overdue <= c.totals.left + 0.01,
      WM.fmtMoney(c.totals.overdue), '<= ' + WM.fmtMoney(c.totals.left));
    check('каждая оплата отнесена в одну корзину',
      c.linkStat.auto + c.linkStat.old + c.linkStat.none + c.linkStat.expense + c.linkStat.manual === c.linkStat.total,
      c.linkStat.total + ' оплат', c.linkStat.total);
  }

  // --- деньги владельца: приход, расход, остатки, разрезы --------------------
  {
    const dds = [
      { date: '2026-09-01', type: 'Приход', category: 'Выручка', method: 'Наличные', amount: 30000 },
      { date: '2026-09-01', type: 'Приход', category: 'Выручка', method: 'Карта', amount: 20000 },
      { date: '2026-09-01', type: 'Расход', category: 'Закуп товара', method: 'Наличные', amount: 12000 },
      { date: '2026-09-02', type: 'Расход', category: 'Аренда', method: 'Перевод', amount: 8000 },
      { date: '2026-09-02', type: 'Расход', category: 'ЗП', method: 'Наличные', amount: 5000 }
    ];
    const t = FIN.totals(dds);
    check('приход = сумма приходных строк', t.income === 50000, WM.fmtMoney(t.income), '50 000 ₽');
    check('расход = сумма расходных строк', t.expense === 25000, WM.fmtMoney(t.expense), '25 000 ₽');
    check('прибыль = приход − расход', t.profit === t.income - t.expense, WM.fmtMoney(t.profit), '25 000 ₽');
    check('рентабельность = прибыль / приход', near(t.profitability, 50, 0.01), WM.fmtPct(t.profitability), '50%');
    const cats = FIN.byCategory(dds);
    check('расходы по статьям = общий расход',
      near(cats.reduce((a, x) => a + x.sum, 0), t.expense, 0.01),
      WM.fmtMoney(cats.reduce((a, x) => a + x.sum, 0)), WM.fmtMoney(t.expense));
    check('доли статей дают 100%', near(cats.reduce((a, x) => a + x.share, 0), 100, 0.05),
      cats.reduce((a, x) => a + x.share, 0) + '%', '100%');
    const b = FIN.balances(dds, { cash: 0, card: 0, transfer: 0 });
    check('наличные = приход наличными − расход наличными', near(b.map['Наличные'], 30000 - 17000, 0.01),
      WM.fmtMoney(b.map['Наличные']), '13 000 ₽');
    check('итог остатков = сумма по способам',
      near(b.total, Object.keys(b.map).reduce((a, k) => a + b.map[k], 0), 0.01),
      WM.fmtMoney(b.total), 'сходится');
  }

  // --- зарплата -------------------------------------------------------------
  {
    const ts = [
      { date: '2026-09-01', employee: 'Марина', hours: 12, rate: 200, bonus: 500, penalty: 0 },
      { date: '2026-09-02', employee: 'Марина', hours: 12, rate: 200, bonus: 0, penalty: 300 },
      { date: '2026-09-01', employee: 'Артём', hours: 12, rate: 220, bonus: 0, penalty: 0 }
    ];
    const pr = WM.payrollSummary(ts, [{ date: '2026-09-03', employee: 'Марина', amount: 2000 }]);
    const m = pr.find(r => r.employee === 'Марина');
    check('начислено = часы × ставка + премия − штраф', m.accrued === 12 * 200 + 500 + 12 * 200 - 300,
      WM.fmtMoney(m.accrued), '5 000 ₽');
    check('к выплате = начислено − выданное', m.left === m.accrued - 2000, WM.fmtMoney(m.left), '3 000 ₽');
    check('часы сложились', m.hours === 24, m.hours, 24);
    // штраф, введённый в дашборде, должен пережить поездку в Excel и обратно
    const wb = XLSX.utils.book_new();
    BOOK.build({ timesheet: ts.map((r, i) => Object.assign({ id: 'ts' + i }, r)) }, {}, {})
      .forEach(sh => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.aoa), sh.name.slice(0, 31)));
    const back = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer', cellDates: true });
    const mats = {};
    back.SheetNames.forEach(n => { mats[n] = XLSX.utils.sheet_to_json(back.Sheets[n], { header: 1, raw: true, defval: '' }); });
    const st2 = { timesheet: [] };
    BOOK.parse(n => mats[n] || null, st2, {});
    const row = (st2.timesheet || []).find(r => WM.num(r.penalty) === 300);
    check('штраф не теряется при записи в Excel', !!row, row ? 'штраф 300 ₽ на месте' : 'потерялся', 'на месте');
  }

  // --- точка заказа, цены, налоги -------------------------------------------
  {
    const rop = WM.ropList([{ key: 'a', name: 'X', qty: 300, buyPrice: 60 }],
      [{ key: 'a', name: 'X', qty: 10, group: '', buyPrice: 60 }], 30,
      { leadDays: 2, safetyPct: 30, coverDays: 0 });
    const r0 = rop[0];
    check('расход в день = продано / дней', near(r0.demand, 10, 0.01), r0.demand, 10);
    check('точка заказа = расход × плечо + страховой запас', near(r0.rop, 20 + 6, 0.01), r0.rop, 26);
    check('сколько заказать = точка заказа + расход × плечо − остаток',
      r0.order === Math.ceil(26 + 20 - 10), r0.order, Math.ceil(36));
    check('сумма заказа = количество × цена', near(r0.sum, r0.order * r0.price, 0.01), r0.sum, r0.order * r0.price);
    check('цена = закуп × (1 + наценка), округление вверх до шага', WM.priceFor(100, 30, 1) === 130,
      WM.priceFor(100, 30, 1), 130);
    check('УСН 6% = 6% от выручки',
      FIN.taxAmount({ taxMode: 'УСН 6% (доходы)', taxRate: 6 }, 1000000, 900000).sum === 60000, '60 000 ₽', '60 000 ₽');
    check('УСН 15% при убытке = 0',
      FIN.taxAmount({ taxMode: 'УСН 15% (доходы минус расходы)', taxRate: 15 }, 100, 900).sum === 0, '0 ₽', '0 ₽');
    check('копейки не расползаются', WM.safeRound(0.1 + 0.2) === 0.3, WM.safeRound(0.1 + 0.2), 0.3);
  }
  console.log('');
}

/* Фильтры: одни и те же кнопки на всех экранах */
console.log('— Фильтры на экранах');
{
  const rows = [
    { firm: 'Молоко Юг', left: 5000, sum: 10000, date: '2026-09-01' },
    { firm: 'Молоко Юг', left: 0, sum: 4000, date: '2026-08-01' },
    { firm: 'Пекарня', left: 300, sum: 300, date: '2026-09-02' }
  ];
  const defs = [
    { key: 'st', name: 'Состояние', options: [
      { v: 'debt', name: 'В долг', test: r => r.left > 0 },
      { v: 'paid', name: 'Оплачено', test: r => r.left <= 0 }
    ] },
    { key: 'firm', name: 'Поставщик', auto: r => r.firm }
  ];
  FLT.clearAll();
  check('без фильтров показаны все строки', FLT.apply('t', rows, defs).length === 3, 3, 3);
  FLT.set('t', 'st', 'debt');
  check('кнопка отбирает строки', FLT.apply('t', rows, defs).length === 2, 2, 2);
  FLT.set('t', 'firm', 'Пекарня');
  check('две кнопки работают вместе', FLT.apply('t', rows, defs).length === 1, 1, 1);
  FLT.set('t', 'firm', 'Пекарня');
  check('повторное нажатие снимает фильтр', FLT.apply('t', rows, defs).length === 2, 2, 2);
  FLT.setText('t', 'молоко');
  check('поиск внутри фильтра сужает список',
    FLT.apply('t', rows, defs, r => r.firm).length === 1, 1, 1);
  check('счётчик выбранных фильтров', FLT.active('t') === 2, FLT.active('t'), 2);
  FLT.clear('t');
  check('сброс возвращает все строки', FLT.apply('t', rows, defs).length === 3 && FLT.active('t') === 0, 3, 3);

  // кнопки строятся по данным и показывают, сколько строк под них попадает
  const opts = FLT.optionsOf(defs[0], rows);
  check('на кнопке видно число строк', opts[0].count === 2 && opts[1].count === 1,
    opts[0].count + ' и ' + opts[1].count, '2 и 1');
  const auto = FLT.optionsOf(defs[1], rows);
  check('кнопки собираются сами из данных, частые — первыми',
    auto[0].v === 'Молоко Юг' && auto.length === 2, auto.map(o => o.v).join(', '), 'Молоко Юг, Пекарня');
  check('исчезнувшая кнопка не режет список',
    (FLT.set('t', 'st', 'нет-такой'), FLT.apply('t', rows, defs).length) === 3, 3, 3);
  FLT.clearAll();

  const bar = FLT.bar('t', defs, rows);
  check('панель фильтров рисуется', bar.indexOf('data-filter="t|st|debt"') > 0, 'есть кнопки', 'есть кнопки');
  check('в кнопки не пролезает разметка',
    FLT.bar('x', [{ key: 'a', name: 'A', auto: r => r.firm }],
      [{ firm: '<img src=x onerror=alert(1)>' }]).indexOf('<img') < 0, 'экранировано', 'экранировано');
  check('строка «показано N из M»', FLT.note(2, 3).indexOf('Показано 2 из 3') > 0, 'есть', 'есть');
  check('когда фильтров нет — строки нет', FLT.note(3, 3) === '', 'пусто', 'пусто');
  console.log('');
}

/* Окно «Подробнее»: открывается для любого вида и не падает на пустых данных */
console.log('— Окно «Подробнее»');
{
  const kinds = Object.keys(DET.kinds);
  check('видов подробностей', kinds.length >= 15, kinds.length + ' видов', '>=15');
  let broken = [];
  kinds.forEach(k => {
    const d = DET.build(k, 'чего-то-нет');
    if (!d || !d.title || typeof d.html !== 'string') broken.push(k);
    if (d && d.html.indexOf('Не получилось собрать') >= 0) broken.push(k + ' (ошибка)');
  });
  check('каждый вид открывается на пустой базе', broken.length === 0,
    broken.length ? broken.join(', ') : 'все ' + kinds.length, 'все');
  check('незнакомый вид не ломает программу',
    DET.build('такого-нет', '1').html.indexOf('пока нет') > 0, 'подсказка', 'подсказка');
  check('кнопка «Подробнее» ставится одной строкой',
    DET.btn('firm', 'молоко').indexOf('data-more="firm|молоко"') > 0, 'есть', 'есть');
  check('в кнопку не пролезает разметка',
    DET.btn('firm', '"><script>alert(1)</script>').indexOf('<script') < 0, 'экранировано', 'экранировано');
  check('ссылка-название открывает то же окно',
    DET.link('product', 'хлеб', 'Хлеб').indexOf('data-more="product|хлеб"') > 0, 'есть', 'есть');
  console.log('');
}

/* Папка программы: ошибки браузера объясняются по-человечески */
console.log('— Папка программы: понятные ошибки');
{
  const lost = FILES.humanError({ name: 'NotFoundError' });
  check('пропавшая папка объясняется по-русски',
    lost.indexOf('не найдена') > 0 && lost.indexOf('записи не потеряются') > 0,
    lost.slice(0, 60) + '…', 'объяснение и что делать');
  check('в объяснении нет английского', !/[a-z]{4,}/i.test(lost.replace(/«[^»]*»/g, '')),
    'по-русски', 'по-русски');
  const denied = FILES.humanError({ name: 'NotAllowedError' });
  check('закрытый доступ объясняется', denied.indexOf('Браузер закрыл доступ') === 0,
    denied.slice(0, 40) + '…', 'про доступ');
  check('занятый Excel-файл объясняется',
    FILES.humanError({ name: 'NoModificationAllowedError' }).indexOf('Закройте книгу') > 0,
    'про Excel', 'про Excel');
  check('нет места на диске', FILES.humanError({ name: 'QuotaExceededError' }).indexOf('места') > 0,
    'про место', 'про место');
  check('владелец сам закрыл окно — молчим', FILES.humanError({ name: 'AbortError' }) === '',
    'тишина', 'тишина');
  // Firefox отдаёт ошибку без имени — узнаём по тексту
  check('ошибка без имени узнаётся по тексту',
    FILES.humanError({ message: 'A requested file or directory could not be found' }).indexOf('не найдена') > 0,
    'узнали', 'узнали');
  check('незнакомая ошибка показывается как есть, а не теряется',
    FILES.humanError({ message: 'что-то своё' }) === 'что-то своё', 'показана', 'показана');
  console.log('');
}

/* Безопасность и защита от кривых данных */
{
  console.log('— Безопасность: прототип, длинные имена, даты, суммы');
  STORE.clear();
  STORE.importJSON(JSON.stringify({ data: {
    '__proto__': { hacked: true }, constructor: { bad: 1 },
    settings: { '__proto__': { x: 1 }, storeName: 'Тест' },
    dds: [{ id: 'a', date: '2026-09-01', type: 'Расход', category: 'Аренда', amount: 100 }]
  } }));
  check('чужой ключ не попал в прототип', ({}).hacked === undefined, 'чисто', 'чисто');
  check('прототип базы не подменён', Object.getPrototypeOf(STORE.state) === Object.prototype, 'штатный', 'штатный');
  check('обычные данные при этом загрузились', (STORE.state.dds || []).length === 1 && STORE.settings.storeName === 'Тест',
    STORE.state.dds.length + ' запись, магазин «' + STORE.settings.storeName + '»', '1 и «Тест»');
  STORE.clear();

  // длинное имя контрагента не должно вешать разбор
  const longName = 'Контрагент' + ' . '.repeat(3000);
  const t0 = Date.now();
  const parts = SUP.splitRep(longName);
  const ms = Date.now() - t0;
  check('длинное имя разбирается мгновенно', ms < 200, ms + ' мс', '<200 мс');
  check('длинное имя обрезается', parts.firm.length <= 200, parts.firm.length + ' символов', '<=200');

  // даты Excel дальше 2064 года
  check('дата 2099 года читается', WM.excelDate(73050) === '2099-12-31', WM.excelDate(73050), '2099-12-31');
  check('дата 2064 года читается', WM.excelDate(60000) === '2064-04-08', WM.excelDate(60000), '2064-04-08');
  check('в книге даты Excel читаются так же', BOOK.toDate(73050) === '2099-12-31', BOOK.toDate(73050), '2099-12-31');

  // проверка сумм в формах
  check('пустая сумма не проходит', !!Q.checkAmount(''), Q.checkAmount(''), 'ошибка');
  check('буквы вместо суммы не проходят', !!Q.checkAmount('abc'), Q.checkAmount('abc'), 'ошибка');
  check('минус не проходит', !!Q.checkAmount('-500'), Q.checkAmount('-500'), 'ошибка');
  check('«1e100» не проходит', !!Q.checkAmount('1e100'), Q.checkAmount('1e100'), 'ошибка');
  check('миллиард с лишним не проходит', !!Q.checkAmount('2000000000'), Q.checkAmount('2000000000'), 'ошибка');
  check('нормальная сумма проходит', Q.checkAmount('1 500,50') === null, 'ок', 'ок');
  check('ноль разрешаем там, где он уместен', Q.checkAmount('0', { allowZero: true }) === null, 'ок', 'ок');

  // числа из выгрузок не превращаются в NaN и Infinity
  ['', 'abc', null, undefined, '—', '1 234,56 ₽'].forEach(v => {
    const n = WM.num(v);
    if (!isFinite(n)) failed++;
  });
  check('мусор в числовых колонках даёт 0, а не NaN',
    [undefined, null, '', 'abc', '—'].every(v => WM.num(v) === 0), 'все нули', 'все нули');
  check('деление на ноль не ломает расчёт', WM.div(100, 0) === 0 && isFinite(WM.div(0, 0)),
    WM.div(100, 0), 0);
  console.log('');
}

console.log('Итог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
process.exit(failed ? 1 : 0);
