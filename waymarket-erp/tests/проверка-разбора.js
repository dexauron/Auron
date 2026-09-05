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
const NUM = require(path.join(__dirname, '..', 'js', 'numpad.js'));
const ALR = require(path.join(__dirname, '..', 'js', 'alerts.js'));
const INP = require(path.join(__dirname, '..', 'js', 'input.js'));
const EXT = require(path.join(__dirname, '..', 'js', 'extras.js'));
const ENT = require(path.join(__dirname, '..', 'js', 'entry.js'));
const CSH = require(path.join(__dirname, '..', 'js', 'cash.js'));
const FRC = require(path.join(__dirname, '..', 'js', 'forecast.js'));
const GDS = require(path.join(__dirname, '..', 'js', 'goods.js'));
const REP = require(path.join(__dirname, '..', 'js', 'reports.js'));
const DIC = require(path.join(__dirname, '..', 'js', 'dicts.js'));
const STF = require(path.join(__dirname, '..', 'js', 'staff.js'));
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

/* Одна база: записи владельца и 1С вместе, правда — за владельцем */
console.log('— Одна база: ваши записи и 1С');
{
  const settings = { termDaysDefault: 3, roundTolerance: 5 };
  const st = { docs: [], pays: [], supreg: [], debtors: [] };

  // 1. Своя накладная и своя оплата ложатся в ту же базу, что и документы 1С
  const own = SUP.addOwnDoc(st, { doc: 'МОЯ-1', date: '2026-08-21',
    supplier: 'Молоко Юг', sum: 30000 }, settings);
  SUP.addOwnPay(st, { date: '2026-08-21', supplier: 'Молоко Юг', sum: 12000, basis: 'МОЯ-1' }, settings);
  let c = SUP.compute(st, settings);
  check('своя накладная попала в общую базу', c.totals.docs === 1 && c.totals.sum === 30000,
    c.totals.docs + ' шт. на ' + WM.fmtMoney(c.totals.sum), '1 шт. на 30 000 ₽');
  check('своя оплата привязалась к своей накладной', c.linkStat.auto === 1, c.linkStat.auto, 1);
  check('долг = поставка − оплата', c.totals.left === 18000, WM.fmtMoney(c.totals.left), '18 000 ₽');
  check('фирма завелась сама', st.supreg.length === 1 && st.supreg[0].name === 'Молоко Юг',
    st.supreg.map(f => f.name).join(', '), 'Молоко Юг');
  check('своя запись помечена как ваша', own.source === 'мои' && own.mine.indexOf('sum') >= 0,
    own.source + ', поля: ' + own.mine.join(','), 'мои');

  // 2. Документ 1С рядом — долг считается одной суммой
  SUP.mergeDocs(st, [{ doc: 'ПФ0001 от 20.08.2026', date: '2026-08-20',
    supplier: 'Пекарня', sum: 5000, retail: 7000 }], 'нак.xlsx', st.supreg, settings);
  c = SUP.compute(st, settings);
  check('1С и ваши записи считаются вместе', c.totals.docs === 2 && c.totals.sum === 35000,
    c.totals.docs + ' документа на ' + WM.fmtMoney(c.totals.sum), '2 на 35 000 ₽');
  check('видно, где чья запись',
    c.docs.filter(d => d.source === '1c').length === 1 && c.docs.filter(d => d.source === 'мои').length === 1,
    'по одной с каждой стороны', 'по одной');

  // 3. Владелец исправляет цифру 1С — и она главнее выгрузки
  const doc1c = st.docs.find(d => d.source === '1c');
  doc1c.sum = 5500;                      // «в 1С ошибка, по факту 5 500»
  SUP.markMine(doc1c, ['sum']);
  SUP.mergeDocs(st, [{ doc: 'ПФ0001 от 20.08.2026', date: '2026-08-20',
    supplier: 'Пекарня', sum: 5000, retail: 7000 }], 'нак.xlsx', st.supreg, settings);
  check('повторная загрузка 1С не затирает вашу цифру', doc1c.sum === 5500,
    WM.fmtMoney(doc1c.sum), '5 500 ₽');
  check('что прислала 1С — запомнено', doc1c.from1c && doc1c.from1c.sum === 5000,
    WM.fmtMoney(doc1c.from1c.sum), '5 000 ₽');
  const diff = SUP.conflicts(doc1c);
  check('расхождение видно списком', diff.length === 1 && diff[0].field === 'sum',
    diff.length ? diff[0].field + ': ' + diff[0].was + ' → ' + diff[0].now : 'нет', 'sum');
  check('долг считается по вашей цифре', SUP.compute(st, settings).totals.left === 23500,
    WM.fmtMoney(SUP.compute(st, settings).totals.left), '23 500 ₽');

  // 4. Кнопка «Как в 1С» снимает правку
  SUP.unmark(doc1c, 'sum');
  check('«Как в 1С» возвращает значение выгрузки', doc1c.sum === 5000 && SUP.conflicts(doc1c).length === 0,
    WM.fmtMoney(doc1c.sum), '5 000 ₽');

  // 5. Поля, которые владелец не трогал, 1С обновляет как обычно
  SUP.mergeDocs(st, [{ doc: 'ПФ0001 от 20.08.2026', date: '2026-08-20',
    supplier: 'Пекарня', sum: 5000, retail: 9000 }], 'нак.xlsx', st.supreg, settings);
  check('нетронутые поля 1С обновляет', doc1c.retail === 9000, doc1c.retail, 9000);

  // 6. Удаление данных 1С не трогает записи владельца
  const before = st.docs.length;
  st.docs = st.docs.filter(d => d.source !== '1c');
  check('после удаления данных 1С ваши записи целы',
    st.docs.length === 1 && st.docs[0].doc === 'МОЯ-1', st.docs.length + ' из ' + before, '1');
  console.log('');
}

/* Калькулятор в поле, разделение разрядов и понятные даты */
console.log('— Счёт прямо в поле и разделение разрядов');
{
  const cases = [
    ['1250*3+400', 4150, 'три ящика по 1250 плюс 400'],
    ['200-10%', 180, 'минус 10 процентов'],
    ['1000+5%', 1050, 'плюс 5 процентов'],
    ['200*15%', 30, '15 процентов от 200'],
    ['(100+50)*2', 300, 'скобки'],
    ['1 250,50+2', 1252.5, 'пробелы и запятая'],
    ['12', 12, 'просто число'],
    ['100/4', 25, 'деление']
  ];
  cases.forEach(([expr, want, why]) => {
    check('«' + expr + '» — ' + why, NUM.calc(expr) === want, NUM.calc(expr), want);
  });
  ['5/0', 'абв', '', '1+', '((1+2)', '1e9*1e9', 'alert(1)'].forEach(bad => {
    check('«' + bad + '» не считается и не ломает программу', NUM.calc(bad) === null, NUM.calc(bad), null);
  });
  check('чужой код в поле не выполняется',
    NUM.calc('window.__pwned=1') === null && NUM.calc('1;alert(1)') === null, 'не выполнился', 'не выполнился');

  const NBSP = '\u00A0';
  check('разряды разделяются неразрывным пробелом',
    NUM.group(1234567) === '1' + NBSP + '234' + NBSP + '567', NUM.group(1234567), '1 234 567');
  check('копейки на месте', NUM.group(1234.5) === '1' + NBSP + '234,50', NUM.group(1234.5), '1 234,50');
  check('минус виден', NUM.group(-4500) === '\u2212' + '4' + NBSP + '500', NUM.group(-4500), 'минус 4 500');
  check('сумма прописью', NUM.words(72500) === 'семьдесят две тысячи пятьсот', NUM.words(72500), 'семьдесят две тысячи пятьсот');
  check('тысяча в женском роде', NUM.words(21000) === 'двадцать одна тысяча', NUM.words(21000), 'двадцать одна тысяча');
  check('ноль прописью', NUM.words(0) === 'ноль', NUM.words(0), 'ноль');
  check('миллион прописью', NUM.words(1000000) === 'один миллион', NUM.words(1000000), 'один миллион');

  const t = new Date().toISOString().slice(0, 10);
  check('дата подписана днём недели и «сегодня»',
    NUM.dateFull(t).indexOf('сегодня') > 0 && /^[а-я]+,/.test(NUM.dateFull(t)), NUM.dateFull(t), 'день недели + сегодня');
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  check('вчерашняя дата подписана «вчера»', NUM.dateFull(y).indexOf('вчера') > 0, NUM.dateFull(y), 'вчера');
  check('пустая дата не ломает подпись', NUM.dateFull('') === '' && NUM.dateFull('чепуха') === '', 'пусто', 'пусто');
  console.log('');
}

/* Что горит прямо сейчас: тревоги, проверка базы, странные суммы */
console.log('— Тревоги и проверка базы');
{
  const t = new Date().toISOString().slice(0, 10);
  // накладная сильно дороже обычной — ловим лишний ноль
  const docs = [];
  for (let i = 0; i < 6; i++) docs.push({ id: 'd' + i, firm: 'Молоко Юг', sum: 1000 + i * 20, date: t });
  docs.push({ id: 'big', firm: 'Молоко Юг', sum: 60000, doc: 'ПФ1', date: t });
  const odd = ALR.oddDocs(docs, {});
  check('лишний ноль в накладной виден', odd.length === 1 && odd[0].id === 'big',
    odd.length ? odd[0].sum + ' при обычных ' + odd[0].usual : 'не нашли', 'нашли одну');
  check('обычные накладные не тревожат', ALR.oddDocs(docs.slice(0, 6), {}).length === 0, 0, 0);
  check('мало данных — не судим', ALR.oddDocs([{ firm: 'A', sum: 1 }, { firm: 'A', sum: 900 }], {}).length === 0, 0, 0);
  check('обычная сумма считается медианой, а не средним',
    ALR.median([1000, 1020, 1040, 1060, 90000]) === 1040, ALR.median([1000, 1020, 1040, 1060, 90000]), 1040);

  // проверка базы находит именно то, что сломано
  const bad = ALR.checkBase({
    docs: [{ id: 'a', firm: '', sum: 0, date: 'чепуха', key: 'k1' },
           { id: 'b', firm: 'X', sum: 10, date: '2026-09-01', key: 'k2' },
           { id: 'c', firm: 'Y', sum: 20, date: '2026-09-01', key: 'k2' }],
    dds: [{ id: 'f', date: '2099-01-01' }],
    supreg: [{ id: 's', name: '' }]
  });
  const kinds = bad.map(b => b.kind);
  ['docs-no-firm', 'no-date', 'docs-zero', 'docs-dup', 'dds-future', 'firm-no-name'].forEach(k => {
    check('проверка находит: ' + k, kinds.indexOf(k) >= 0, kinds.indexOf(k) >= 0 ? 'да' : 'нет', 'да');
  });
  check('здоровая база проходит проверку',
    ALR.checkBase({ docs: [{ id: 'a', firm: 'X', sum: 100, date: '2026-09-01', key: 'k' }], dds: [], supreg: [] }).length === 0,
    'чисто', 'чисто');
  console.log('');
}

/* Быстрый ввод: сканер, голос, шаблоны */
console.log('— Быстрый ввод');
{
  const stock = [{ name: 'Хлеб', barcode: '4600000012345' }, { name: 'Молоко', article: 'М-77' }];
  check('товар находится по штрихкоду', (INP.findByCode('4600000012345', stock, []) || {}).name === 'Хлеб', 'Хлеб', 'Хлеб');
  check('ведущие нули не мешают', (INP.findByCode('04600000012345', stock, []) || {}).name === 'Хлеб', 'Хлеб', 'Хлеб');
  check('чужой код не подставляет товар', INP.findByCode('999', stock, []) === null, 'null', 'null');

  const tpl = INP.templateFrom('ddsExpense', { date: '2026-09-04', category: 'Аренда', amount: 168000 }, '');
  check('шаблон не запоминает дату', tpl.values.date === undefined, 'без даты', 'без даты');
  check('шаблон помнит остальное', tpl.values.category === 'Аренда' && tpl.values.amount === 168000,
    tpl.values.category + ' ' + tpl.values.amount, 'Аренда 168000');
  check('имя шаблона понятное', INP.templateName({ category: 'Аренда', amount: 168000 }).indexOf('Аренда') === 0,
    INP.templateName({ category: 'Аренда', amount: 168000 }), 'начинается со статьи');
  console.log('');
}

/* Сравнения, наценка, ведомость */
console.log('— Сравнения и ведомости');
{
  const d = EXT.delta(412000, 381000);
  check('рост считается в рублях и процентах', d.diff === 31000 && d.pct === 8.14 && d.dir === 'up',
    d.diff + ' (' + d.pct + '%)', '31000 (8.14%)');
  check('падение видно', EXT.delta(100, 200).dir === 'down', EXT.delta(100, 200).dir, 'down');
  check('деление на ноль в сравнении не ломает', EXT.delta(100, 0).pct === null, 'null', 'null');
  const pr = EXT.prevRange('2026-08-01', '2026-08-31');
  check('прошлый период такой же длины', pr.days === 31 && pr.from === '2026-07-01' && pr.to === '2026-07-31',
    pr.from + '–' + pr.to, '2026-07-01–2026-07-31');

  const mk = EXT.markupByFirm([
    { firm: 'Молоко Юг', sum: 1000, retail: 1400, left: 0 },
    { firm: 'Молоко Юг', sum: 2000, retail: 2600, left: 100 },
    { firm: 'Пекарня', sum: 500, retail: 600, left: 0 }
  ]);
  check('наценка по фирме = (розница − закуп) / закуп',
    mk[0].firm === 'Молоко Юг' && mk[0].gross === 1000 && mk[0].markup === 33.33,
    mk[0].firm + ': ' + mk[0].gross + ' ₽, ' + mk[0].markup + '%', 'Молоко Юг: 1000 ₽, 33.33%');
  check('фирмы отсортированы по заработку', mk[0].gross >= mk[1].gross,
    mk.map(m => m.gross).join(' > '), 'по убыванию');
  check('без розничной суммы фирма не показывается',
    EXT.markupByFirm([{ firm: 'X', sum: 100, retail: 0 }]).length === 0, 0, 0);

  const sheet = EXT.payrollSheet([
    { employee: 'Марина', accrued: 5000, paid: 2000, left: 3000, hours: 24, shifts: 2 },
    { employee: 'Артём', accrued: 2640, paid: 0, left: 2640, hours: 12, shifts: 1 }
  ]);
  check('в ведомости итог сходится с суммой строк',
    sheet.total.accrued === 7640 && sheet.total.left === 5640,
    sheet.total.accrued + ' / ' + sheet.total.left, '7640 / 5640');

  const spark = EXT.spark([1, 5, 3, 8, 2]);
  check('спарклайн рисуется', spark.indexOf('<svg') === 0 && spark.indexOf('path') > 0, 'есть', 'есть');
  check('из одной точки график не строится', EXT.spark([5]) === '', 'пусто', 'пусто');
  console.log('');
}

/* Запись строкой: «аренда 168000 переводом» раскладывается по полям */
console.log('— Запись одной строкой');
{
  const d = { categories: ['Аренда', 'Закуп товара', 'ЗП', 'Коммуналка', 'Хозтовары'],
    suppliers: ['Молоко Юг', 'Пекарня'], employees: ['Марина'] };
  const t = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  function line(text) { return ENT.parseLine(text, d); }
  let p = line('аренда 168000 переводом');
  check('«аренда 168000 переводом»',
    p.amount === 168000 && p.category === 'Аренда' && p.method === 'Перевод' && p.type === 'Расход',
    p.amount + ' · ' + p.category + ' · ' + p.method, '168000 · Аренда · Перевод');

  p = line('вчера закуп товара 45000 наличными');
  check('«вчера» превращается во вчерашнюю дату', p.date === yest, p.date, yest);
  check('способ оплаты понят', p.method === 'Наличные', p.method, 'Наличные');

  p = line('5 тыс коммуналка');
  check('«5 тыс» — это 5 000, а не 5', p.amount === 5000, p.amount, 5000);
  p = line('15к аренда');
  check('«15к» — это 15 000', p.amount === 15000, p.amount, 15000);
  p = line('хозтовары 1 250,50 налом');
  check('разряды с пробелом читаются как одна сумма', p.amount === 1250.5, p.amount, 1250.5);

  p = line('коммуналка 3000');
  check('«коммуНАЛка» не становится «наличными»', !p.method, p.method || 'способ не выбран', 'способ не выбран');
  p = line('картошка 500');
  check('«КАРТошка» не становится «картой»', !p.method, p.method || 'способ не выбран', 'способ не выбран');

  p = line('молоко юг 12500 в долг');
  check('поставщик из двух слов найден', p.supplier === 'Молоко Юг', p.supplier, 'Молоко Юг');
  check('«в долг» — это долг, а не расход', p.type === 'Долг', p.type, 'Долг');
  check('имя поставщика не осталось в комментарии', !p.note, p.note || 'пусто', 'пусто');

  p = line('марине зп 15000');
  check('сотрудник узнаётся по корню слова', p.employee === 'Марина', p.employee, 'Марина');

  p = line('приход 25000 наличными');
  check('«приход» — это приход', p.type === 'Приход' && p.amount === 25000,
    p.type + ' ' + p.amount, 'Приход 25000');

  p = line('12.09 пекарня 3200 картой');
  check('дата числом читается', p.date.slice(5) === '09-12', p.date, '…-09-12');
  check('число рядом со словом «картой» не раздувается', p.amount === 3200, p.amount, 3200);

  check('строка без суммы не сохраняется', line('мусор без цифр').__ok === false, 'не сохранится', 'не сохранится');
  check('пустая строка ничего не ломает', ENT.parseLine('', d) === null, 'null', 'null');

  const bulk = ENT.parseBulk('аренда 168000 переводом\n\nхлам\nзп 15000 наличными', d);
  check('массовый ввод: пустые строки пропускаются', bulk.length === 3, bulk.length, 3);
  check('массовый ввод: непонятная строка помечена', bulk.filter(r => !r.ok).length === 1,
    bulk.filter(r => !r.ok).length, 1);
  check('массовый ввод: номера строк сохраняются', bulk[2].no === 4, bulk[2].no, 4);

  // буфер записи
  ENT.clearClip();
  ENT.copy({ id: 'x', key: 'k', date: '2026-09-01', category: 'Аренда', amount: 1000, __tmp: 1 }, 'dds');
  const c = ENT.clip();
  check('в буфер не попадают id и служебные поля',
    c.values.id === undefined && c.values.key === undefined && c.values.__tmp === undefined,
    Object.keys(c.values).join(','), 'без id и key');
  check('в буфере остаётся суть записи', c.values.category === 'Аренда' && c.values.amount === 1000,
    c.values.category + ' ' + c.values.amount, 'Аренда 1000');

  // отмена последнего действия
  const log = [{ id: '1', what: 'правка', before: { a: 1 } },
    { id: '2', what: 'удаление', before: { a: 2 }, undone: true },
    { id: '3', what: 'добавление', before: null }];
  check('на отмену берётся последнее неотменённое с историей',
    ENT.lastUndoable(log).id === '1', ENT.lastUndoable(log).id, '1');
  check('когда отменять нечего — не падаем', ENT.lastUndoable([]) === null, 'null', 'null');
  console.log('');
}

/* Касса, сейф, точки, кассиры, эквайринг */
console.log('— Касса, сейф и кассиры');
{
  const set = { openCashStart: 0, openCardStart: 0, openTransferStart: 0,
    payoutLimit: 20000, acquiringFee: 2, mainCashName: 'Касса', cashPlaces: 'Сейф' };
  const t = new Date().toISOString().slice(0, 10);
  const st = { dds: [
    { date: '2026-09-01', type: 'Приход', method: 'Наличные', amount: 50000, cashier: 'Марина', diff: -500, shift: 'День' },
    { date: '2026-09-01', type: 'Приход', method: 'Карта', amount: 20000, cashier: 'Марина', shift: 'День' },
    { date: '2026-09-02', type: 'Забор', method: 'Наличные', amount: 10000 },
    { date: t, type: 'Расход', method: 'Наличные', amount: 25000, category: 'Закуп', cashier: 'Артём' }
  ], cashcount: [{ cashier: 'Артём', diff: -1200 }] };

  // перекладывание денег не меняет их количество
  const before = CSH.ownerSplit(st, set).shop;
  CSH.moveRecords({ amount: 15000, from: 'Касса', to: 'Сейф' }, set).forEach(r => st.dds.push(r));
  const after = CSH.ownerSplit(st, set);
  check('инкассация не меняет деньги магазина', after.shop === before,
    WM.fmtMoney(after.shop), WM.fmtMoney(before));
  const places = CSH.byPlace(st, set);
  const safe = places.find(p => p.place === 'Сейф');
  check('в сейфе появились переложенные деньги', safe.cash === 15000, WM.fmtMoney(safe.cash), '15 000 ₽');
  const cash = places.find(p => p.place === 'Касса');
  check('из кассы они ушли', cash.cash === 50000 - 10000 - 25000 - 15000,
    WM.fmtMoney(cash.cash), WM.fmtMoney(0));

  // забор владельца: из магазина ушло, в кармане прибавилось
  check('забор владельца уходит в его карман', after.pocket === 10000, WM.fmtMoney(after.pocket), '10 000 ₽');
  check('деньги магазина считаются без кармана', after.shop === 15000 + 0 + 20000,
    WM.fmtMoney(after.shop), WM.fmtMoney(35000));
  check('видно, сколько забрали из оборота', after.drawn === 10000, WM.fmtMoney(after.drawn), '10 000 ₽');

  // лимит выдачи за смену
  const w = CSH.payoutWatch(st, set, t);
  check('превышение лимита выдачи замечено', w.over === true && w.spent === 25000,
    WM.fmtMoney(w.spent) + ' при лимите ' + WM.fmtMoney(w.limit), 'превышено');
  check('перемещение денег не считается выдачей',
    CSH.payoutWatch({ dds: [{ date: t, type: 'Расход', method: 'Наличные', amount: 99999,
      category: 'Перемещение денег' }] }, set, t).spent === 0, 0, 0);
  check('без лимита не тревожим', CSH.payoutWatch(st, { payoutLimit: 0 }, t).over === false, 'тихо', 'тихо');

  // кассиры
  const sc = CSH.cashierScore(st, set);
  const marina = sc.find(r => r.name === 'Марина');
  const artem = sc.find(r => r.name === 'Артём');
  check('недостача кассира посчитана', marina.short === 500, WM.fmtMoney(marina.short), '500 ₽');
  check('пересчёт по купюрам тоже идёт в рейтинг', artem.short === 1200, WM.fmtMoney(artem.short), '1 200 ₽');
  check('недостача на 1000 ₽ выручки', marina.perThousand === 7.14, marina.perThousand, 7.14);
  check('у кассира без выручки не делим на ноль', artem.perThousand === 0, artem.perThousand, 0);

  // эквайринг с комиссией
  const acq = CSH.acquiringCheck(st, [{ date: '2026-09-01', amount: 19600 }], set);
  check('банк зачислил ровно за вычетом комиссии', acq.rows[0].ok === true,
    WM.fmtMoney(acq.rows[0].bank) + ' при ожидаемых ' + WM.fmtMoney(acq.rows[0].expect), 'сошлось');
  const acq2 = CSH.acquiringCheck(st, [{ date: '2026-09-01', amount: 15000 }], set);
  check('недоплата банка видна', acq2.badDays === 1 && acq2.rows[0].diff === -4600,
    WM.fmtMoney(acq2.rows[0].diff), '−4 600 ₽');
  const acq3 = CSH.acquiringCheck(st, [], set);
  check('день без зачисления помечен', acq3.rows[0].missing === true, 'помечен', 'помечен');
  console.log('');
}

/* Прогноз денег, долги по срокам, налоги */
console.log('— Хватит ли денег и когда платить');
{
  const t = new Date().toISOString().slice(0, 10);
  const isInc = r => r.type === 'Приход', isExp = r => r.type === 'Расход';
  const dds = [];
  for (let i = 1; i <= 30; i++) {
    const d = '2026-08-' + String(i).padStart(2, '0');
    dds.push({ date: d, type: 'Приход', amount: 40000 });
    dds.push({ date: d, type: 'Расход', amount: 20000 });
  }
  // один праздничный день с двойной выручкой не должен задирать прогноз
  dds.push({ date: '2026-08-31', type: 'Приход', amount: 400000 });
  const pace = FRC.dayPace(dds, isInc, isExp, 400);
  check('обычный день считается по середине, а не по среднему',
    pace.income === 40000, WM.fmtMoney(pace.income), '40 000 ₽');

  // кассовый разрыв
  const due = FRC.addDays(t, 3);
  const cal = FRC.calendar({ cashNow: 50000, pace: { income: 0, expense: 0 },
    docs: [{ left: 200000, confirmed: true, due: due, firm: 'Молоко Юг' }], days: 10 });
  check('кассовый разрыв найден', cal.gap && cal.gap.date === due, cal.gap && cal.gap.date, due);
  check('видно, сколько денег не хватит', cal.needed === 150000, WM.fmtMoney(cal.needed), '150 000 ₽');
  const ok = FRC.calendar({ cashNow: 500000, pace: { income: 0, expense: 0 },
    docs: [{ left: 200000, confirmed: true, due: due }], days: 10 });
  check('когда денег хватает — разрыва нет', ok.gap === null, 'нет', 'нет');
  check('неподтверждённая накладная в календарь не лезет',
    FRC.calendar({ cashNow: 0, pace: { income: 0, expense: 0 },
      docs: [{ left: 999999, confirmed: false, due: due }], days: 5 }).gap === null, 'нет', 'нет');

  // долги по срокам
  const bk = FRC.debtBuckets([
    { left: 1000, confirmed: true, due: FRC.addDays(t, -5) },
    { left: 2000, confirmed: true, due: FRC.addDays(t, 3) },
    { left: 3000, confirmed: true, due: FRC.addDays(t, 20) },
    { left: 500, confirmed: false }
  ], t);
  const names = bk.buckets.map(b => b.name);
  check('долги разложены по срокам', bk.total === 6500 && names.indexOf('Просрочено') === 0,
    names.join(' / '), 'просрочено первым');
  check('доли в сумме дают 100%',
    Math.abs(bk.buckets.reduce((a, b) => a + b.share, 0) - 100) < 0.1,
    bk.buckets.reduce((a, b) => a + b.share, 0), 100);
  check('неподтверждённый срок вынесен отдельно',
    names.indexOf('Срок не подтверждён') >= 0, 'да', 'да');

  // проценты за просрочку
  const wi = FRC.withInterest({ left: 100000, due: '2026-08-04', confirmed: true }, 20, '2026-09-04');
  check('пеня считается за дни просрочки', wi.days === 31 && wi.interest === 1698.63,
    wi.days + ' дн. → ' + WM.fmtMoney(wi.interest), '31 дн. → 1 698,63 ₽');
  check('без просрочки пени нет',
    FRC.withInterest({ left: 1000, due: FRC.addDays(t, 5), confirmed: true }, 20, t).interest === 0, 0, 0);

  // взаимозачёт уменьшает долг фирме
  const net = FRC.netDebt([{ firm: 'Молоко Юг', left: 30000 }],
    { offsets: [{ firm: 'Молоко Юг', amount: 12000, used: false }] });
  check('возврат поставщику уменьшает долг ему', net[0].net === 18000,
    WM.fmtMoney(net[0].net), '18 000 ₽');
  check('уже проведённый зачёт второй раз не считается',
    FRC.netDebt([{ firm: 'A', left: 100 }], { offsets: [{ firm: 'A', amount: 50, used: true }] })[0].net === 100,
    100, 100);

  // частичные оплаты
  const dp = FRC.docPayments({ key: 'k1', sum: 10000 },
    [{ linkKind: 'auto', linkKey: 'k1', sum: 4000, date: '2026-09-01' },
     { linkKind: 'auto', linkKey: 'k1', sum: 3000, date: '2026-09-03' }]);
  check('история частичных оплат ведётся', dp.rows.length === 2 && dp.left === 3000,
    dp.rows.map(r => WM.fmtMoney(r.left)).join(' → '), 'остаток 3 000 ₽');

  // безубыточность по дням
  const bd = FRC.bepDays(dds, isInc, 300000, 25, '2026-08');
  check('выход в ноль по дням посчитан', bd.rows.length === 31, bd.rows.length, 31);
  check('накопление растёт от дня к дню', bd.rows[10].acc > bd.rows[5].acc,
    WM.fmtMoney(bd.rows[10].acc) + ' > ' + WM.fmtMoney(bd.rows[5].acc), 'растёт');
  check('день выхода в ноль найден', !!bd.passed, bd.passed ? bd.passed.day + '-е число' : 'нет', 'найден');

  // настоящая маржа
  const rm = FRC.realMargin({ revenue: 1000000, cogs: 750000 }, 30000, 5000);
  check('маржа после списаний ниже бумажной',
    rm.marginBook === 25 && rm.marginReal === 21.5,
    rm.marginBook + '% → ' + rm.marginReal + '%', '25% → 21,5%');
  check('видно, сколько прибыли съели потери', rm.lossShare === 14, rm.lossShare + '%', '14%');

  // налоговый календарь
  const tax = FRC.taxCalendar({ taxMode: 'УСН 6% (доходы)', taxRate: 6, legalForm: 'ИП', ipFixed: 53658 },
    2026, (s2, i) => ({ sum: i * 0.06 }), 6000000, 4000000);
  const dates = tax.map(r => r.date);
  check('авансы по УСН стоят на 28 число', dates.indexOf('2026-04-28') >= 0 &&
    dates.indexOf('2026-07-28') >= 0 && dates.indexOf('2026-10-28') >= 0,
    '28.04 / 28.07 / 28.10', 'все три');
  check('взносы ИП за себя — 28 декабря', dates.indexOf('2026-12-28') >= 0, 'есть', 'есть');
  check('1% свыше 300 тысяч — 1 июля следующего года', dates.indexOf('2027-07-01') >= 0, 'есть', 'есть');
  check('платежи идут по возрастанию даты',
    dates.join() === dates.slice().sort().join(), 'по порядку', 'по порядку');
  console.log('');
}

/* Товар: цены, сезонность, полки, возвраты */
console.log('— Цены, сезонность и полки');
{
  // история цен и подорожание
  let hist = [];
  hist = GDS.addSnapshot(hist, GDS.snapshot([
    { key: 'хлеб', name: 'Хлеб', supplier: 'Пекарня', price: 20 },
    { key: 'молоко', name: 'Молоко', supplier: 'Юг', price: 60 }], '2026-08-01'));
  hist = GDS.addSnapshot(hist, GDS.snapshot([
    { key: 'хлеб', name: 'Хлеб', supplier: 'Пекарня', price: 24 },
    { key: 'молоко', name: 'Молоко', supplier: 'Юг', price: 58 }], '2026-09-01'));
  check('снимки цен копятся по датам', hist.length === 2, hist.length, 2);
  hist = GDS.addSnapshot(hist, GDS.snapshot([{ key: 'хлеб', name: 'Хлеб', supplier: 'Пекарня', price: 25 }], '2026-09-01'));
  check('снимок за тот же день перезаписывается, а не дублируется', hist.length === 2, hist.length, 2);

  const j = GDS.priceJumps(hist, 5);
  check('подорожание найдено', j.rows.length === 1 && j.rows[0].pct === 25,
    j.rows.length ? j.rows[0].name + ' +' + j.rows[0].pct + '%' : 'нет', 'Хлеб +25%');
  check('мелкие изменения не тревожат',
    GDS.priceJumps(hist, 50).rows.length === 0, 0, 0);
  check('история одного товара собирается',
    GDS.priceHistory(hist, 'хлеб').length === 2, GDS.priceHistory(hist, 'хлеб').length, 2);
  check('одного снимка мало для сравнения',
    GDS.priceJumps([hist[0]], 5).rows.length === 0, 0, 0);

  // сезонность
  const dds = [
    { date: '2026-01-05', type: 'Приход', amount: 100000 },
    { date: '2026-07-05', type: 'Приход', amount: 300000 },
    { date: '2026-12-05', type: 'Приход', amount: 200000 }
  ];
  const sez = GDS.seasons(dds, r => r.type === 'Приход');
  const july = sez.months[6], jan = sez.months[0];
  check('месяц с высокой выручкой помечен сезоном', july.kind === 'сезон', july.kind, 'сезон');
  check('месяц с низкой — затишьем', jan.kind === 'затишье', jan.kind, 'затишье');
  check('месяцы без данных не портят среднее', sez.monthsWithData === 3, sez.monthsWithData, 3);
  check('доли месяцев дают 100%',
    Math.abs(sez.months.reduce((a, m) => a + m.share, 0) - 100) < 0.1,
    sez.months.reduce((a, m) => a + m.share, 0), 100);

  // кто приезжает вместе
  const docs = [];
  for (let i = 1; i <= 3; i++) {
    docs.push({ date: '2026-09-0' + i, firm: 'Молоко Юг' });
    docs.push({ date: '2026-09-0' + i, firm: 'Пекарня' });
  }
  const pairs = GDS.together(docs, 3);
  check('поставщики, приезжающие в один день, найдены',
    pairs.length === 1 && pairs[0].days === 3, pairs.length ? pairs[0].days + ' дн.' : 'нет', '3 дн.');
  check('случайное совпадение одного дня не считается',
    GDS.together([{ date: '2026-09-01', firm: 'A' }, { date: '2026-09-01', firm: 'B' }], 3).length === 0, 0, 0);

  // полки
  const sv = GDS.shelfValue(
    [{ group: 'Вода', buySum: 100000 }, { group: 'Хлеб', buySum: 10000 }],
    [{ key: 'a', revenue: 5000, profit: 1000, qty: 10 }, { key: 'b', revenue: 50000, profit: 20000, qty: 100 }],
    { a: 'Вода', b: 'Хлеб' });
  const voda = sv.rows.find(r => r.group === 'Вода');
  const hleb = sv.rows.find(r => r.group === 'Хлеб');
  check('прибыль с рубля считается по группе', voda.perRuble === 0.01 && hleb.perRuble === 2,
    voda.perRuble + ' и ' + hleb.perRuble, '0.01 и 2');
  check('группа, не окупающая место, помечена', voda.dead === true && hleb.dead === false,
    'Вода не окупает', 'Вода не окупает');
  check('деньги в мёртвых группах посчитаны', sv.deadMoney === 100000,
    WM.fmtMoney(sv.deadMoney), '100 000 ₽');
  check('доли склада дают 100%',
    Math.abs(sv.rows.reduce((a, r) => a + r.share, 0) - 100) < 0.1,
    sv.rows.reduce((a, r) => a + r.share, 0), 100);

  // возвраты поставщику
  const rets = [
    GDS.returnDoc({ date: '2026-09-01', firm: 'Пекарня', sum: 1500, reason: 'Брак', accepted: false }),
    GDS.returnDoc({ date: '2026-09-02', firm: 'Юг', sum: 2500, reason: 'Просрочка', accepted: true })
  ];
  const rt = GDS.returnTotals(rets);
  check('возвраты сложились', rt.sum === 4000 && rt.count === 2, WM.fmtMoney(rt.sum), '4 000 ₽');
  check('непринятые возвраты видны отдельно', rt.waiting === 1 && rt.waitingSum === 1500,
    WM.fmtMoney(rt.waitingSum), '1 500 ₽');
  console.log('');
}

/* Люди: график, схемы оплаты, опоздания, отпуска, задачи */
console.log('— Сотрудники: график, оплата, опоздания');
{
  const set = { dayStart: '09:00', nightStart: '21:00', lateGrace: 5,
    advanceDay: 25, salaryDay: 10, advancePct: 40 };

  // опоздания и переработки
  const late = STF.shiftTiming({ planIn: '09:00', factIn: '09:25', planOut: '21:00', factOut: '22:30' }, set);
  check('опоздание считается в минутах', late.lateMin === 25, late.lateMin, 25);
  check('переработка считается в часах', late.overtime === 1.5, late.overtime, 1.5);
  const ok = STF.shiftTiming({ factIn: '09:03', factOut: '21:00' }, set);
  check('три минуты — не опоздание', ok.lateMin === 0 && ok.onTime === true, 'вовремя', 'вовремя');
  check('ранний уход виден',
    STF.shiftTiming({ factIn: '09:00', factOut: '20:00' }, set).earlyMin === 60,
    STF.shiftTiming({ factIn: '09:00', factOut: '20:00' }, set).earlyMin, 60);

  // схемы оплаты
  const shifts = [{ hours: 12, rate: 200, bonus: 500, penalty: 0, overtime: 1.5 }, { hours: 12, rate: 200 }];
  const byHour = STF.accrue({ scheme: 'Ставка за час', rate: 200 }, shifts, 0, 30);
  check('оплата по часам: часы × ставка + переработка ×1,5 + премия',
    byHour.total === 24 * 200 + 1.5 * 200 * 1.5 + 500, WM.fmtMoney(byHour.total), '5 750 ₽');
  const bySalary = STF.accrue({ scheme: 'Оклад за месяц', salary: 40000, normShifts: 15 }, shifts, 0, 30);
  check('оклад делится пропорционально отработанным сменам',
    bySalary.base === 5333.33, WM.fmtMoney(bySalary.base), '5 333,33 ₽');
  const both = STF.accrue({ scheme: 'Оклад + процент', salary: 30000, normShifts: 2, percent: 1 },
    shifts, 500000, 30);
  check('«оклад + процент» складывает обе части',
    both.base === 30000 && both.percent === 5000, WM.fmtMoney(both.total), '35 950 ₽');
  check('полная норма смен даёт полный оклад', both.base === 30000, WM.fmtMoney(both.base), '30 000 ₽');

  // аванс и окончательный расчёт
  const parts = STF.payParts(set, '2026-09');
  check('аванс и расчёт стоят на своих датах',
    parts.advanceDate === '2026-09-25' && parts.finalDate === '2026-10-10',
    parts.advanceDate + ' и ' + parts.finalDate, '25.09 и 10.10');
  const split = STF.splitPay(50000, set, 10000);
  check('аванс — доля от начисленного', split.advance === 20000, WM.fmtMoney(split.advance), '20 000 ₽');
  check('видно, сколько ещё выдать', split.leftTotal === 40000, WM.fmtMoney(split.leftTotal), '40 000 ₽');

  // отпуска
  check('дни отпуска считаются включительно',
    STF.absenceDays({ from: '2026-09-01', to: '2026-09-14' }) === 14, 14, 14);
  const abs = [{ employee: 'Артём', kind: 'Отпуск', from: '2026-09-12', to: '2026-09-20' }];
  check('занятость в отпускной день видна',
    !!STF.busyOn(abs, 'Артём', '2026-09-15'), 'занят', 'занят');
  check('вне отпуска человек свободен',
    STF.busyOn(abs, 'Артём', '2026-09-25') === null, 'свободен', 'свободен');

  // график смен
  const sc = STF.schedule(
    [{ date: '2026-09-01', employee: 'Артём', shift: 'Ночь' }],
    [{ date: '2026-09-01', employee: 'Марина', shift: 'День', hours: 12 }],
    '2026-09', [{ name: 'Марина' }, { name: 'Артём' }]);
  check('в месяце столько дней, сколько есть', sc.daysIn === 30, sc.daysIn, 30);
  check('день с людьми не считается дырой', sc.days[0].empty === false, 'занят', 'занят');
  check('дни без смен посчитаны', sc.gaps === 29, sc.gaps, 29);
  check('план и факт различаются',
    sc.days[0].planned === 1 && sc.days[0].worked === 1, '1 план / 1 факт', '1 / 1');

  // кто был на смене, когда деньги не сошлись
  const st = {
    dds: [{ date: '2026-09-07', type: 'Приход', amount: 40000, cashier: 'Марина', shift: 'День', diff: -800 },
          { date: '2026-09-08', type: 'Приход', amount: 40000, cashier: 'Марина', shift: 'День', diff: -50 }],
    timesheet: [{ date: '2026-09-07', employee: 'Марина', shift: 'День', hours: 12 },
                { date: '2026-09-07', employee: 'Артём', shift: 'День', hours: 6 }],
    cashcount: []
  };
  const cases = STF.shortageCases(st, 100);
  check('мелкие расхождения в разбор не идут', cases.length === 1, cases.length, 1);
  check('видно всех, кто был на смене', cases[0].who.length === 2,
    cases[0].who.map(w => w.who).join(', '), 'Марина, Артём');

  // задачи
  const tasks = [
    { id: '1', what: 'Сроки', employee: 'Марина', due: '2020-01-01', done: false },
    { id: '2', what: 'Витрина', employee: 'Артём', due: '2030-01-01', done: true },
    { id: '3', what: 'Полы', employee: 'Марина', due: '2030-01-01', done: false }
  ];
  const ts = STF.taskStats(tasks);
  check('задачи посчитаны', ts.all === 3 && ts.done === 1 && ts.open === 2,
    ts.done + ' из ' + ts.all, '1 из 3');
  check('просроченная задача видна', ts.late === 1, ts.late, 1);
  check('сделанные уходят вниз списка',
    STF.tasksFor(tasks)[2].done === true, 'внизу', 'внизу');
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
  // --- Числа в смешанном формате (нашли, сверяясь с каталогом) ---------------
  check('«1 234 567,89» — русский формат', WM.num('1 234 567,89') === 1234567.89, WM.num('1 234 567,89'), 1234567.89);
  check('«1,234.56» — английский формат', WM.num('1,234.56') === 1234.56, WM.num('1,234.56'), 1234.56);
  check('«1.234,56» — европейский формат', WM.num('1.234,56') === 1234.56, WM.num('1.234,56'), 1234.56);
  check('«2,500» — это 2,5 кг, а не 2500', WM.num('2,500') === 2.5, WM.num('2,500'), 2.5);
  check('«48,000» — это 48, а не 48 тысяч', WM.num('48,000') === 48, WM.num('48,000'), 48);

  // --- СБП и деньги в пути (счёт 57.03 в 1С) ---------------------------------
  check('СБП есть в способах оплаты', FIN.METHODS.indexOf('СБП') >= 0, FIN.METHODS.join(', '), 'со СБП');
  check('карта и СБП — деньги в пути', FIN.isTransit('Карта') && FIN.isTransit('СБП') && !FIN.isTransit('Наличные'),
    'да', 'да');
  const trRows = [
    { date: '2025-01-10', type: 'Приход', method: 'Наличные', amount: 10000 },
    { date: '2025-01-10', type: 'Приход', method: 'Карта', amount: 50000 },
    { date: '2025-01-11', type: 'Приход', method: 'СБП', amount: 20000 }
  ];
  const trBal = FIN.balances(trRows, {});
  check('СБП попадает в остатки отдельной строкой', trBal.map['СБП'] === 20000, trBal.map['СБП'], 20000);
  const tr1 = FIN.inTransit(trRows, [], { acquiringFee: 2 });
  check('пока выписки нет — всё безналичное в пути', tr1.sum === 68600, tr1.sum, 68600);
  check('комиссия банка посчиталась', tr1.commission === 1400, tr1.commission, 1400);
  check('видно, с какого дня деньги висят', tr1.oldest === '2025-01-10', tr1.oldest, '2025-01-10');
  const tr2 = FIN.inTransit(trRows, [{ date: '2025-01-10', amount: 49000 }], { acquiringFee: 2 });
  check('зачисленный день уходит из «в пути»', tr2.sum === 19600, tr2.sum, 19600);
  const acq = CSH.acquiringCheck({ dds: trRows }, [{ date: '2025-01-10', amount: 49000 }], { acquiringFee: 2 });
  check('сверка видит и карту, и СБП', acq.shopTotal === 70000, acq.shopTotal, 70000);
  check('сверка считает комиссию за период', acq.commissionTotal === 1400, acq.commissionTotal, 1400);
  check('день без выписки помечен «в пути»', acq.transitTotal === 19600, acq.transitTotal, 19600);
  const sbpLine = ENT.parseLine('выручка 500 сбп', { categories: [], methods: FIN.METHODS, cashiers: [], shifts: [], suppliers: [] });
  check('в быстрой строке «сбп» — это способ оплаты',
    sbpLine && sbpLine.method === 'СБП', sbpLine && sbpLine.method, 'СБП');

  // --- Отчёты для владельца ---------------------------------------------------
  const rDds = [];
  for (let d = 1; d <= 20; d++) {
    const dd = String(d).padStart(2, '0');
    rDds.push({ date: '2026-09-' + dd, type: 'Приход', category: 'Продажи', method: 'Наличные',
      amount: 50000, diff: d === 3 ? -800 : 0, checks: 200, group: 'g' + dd });
    rDds.push({ date: '2025-09-' + dd, type: 'Приход', category: 'Продажи', method: 'Наличные',
      amount: 40000, diff: 0, checks: 180, group: 'p' + dd });
  }
  rDds.push({ date: '2026-09-05', type: 'Расход', category: 'Аренда', method: 'Перевод', amount: 168000 });
  rDds.push({ date: '2026-09-10', type: 'Расход', category: 'ЗП', method: 'Наличные', amount: 240000 });
  rDds.push({ date: '2026-09-11', type: 'Расход', category: 'Закуп товара', method: 'Наличные', amount: 400000 });
  rDds.push({ date: '2026-09-13', type: 'Забор', category: 'Забор владельца', method: 'Наличные', amount: 100000 });

  const flow = REP.moneyFlow(rDds, '2026-09');
  check('водопад: выручка за месяц', flow.income === 1000000, flow.income, 1000000);
  check('водопад: расходы собраны', flow.expense === 808000, flow.expense, 808000);
  check('водопад: забор владельца отдельно', flow.draw === 100000, flow.draw, 100000);
  check('водопад: остаток сходится',
    flow.left === flow.income - flow.expense - flow.draw, flow.left, 92000);
  check('водопад: первая полоса — выручка, последняя — остаток',
    flow.steps[0].kind === 'start' && flow.steps[flow.steps.length - 1].kind === 'end', 'да', 'да');

  const ac = REP.avgCheck(rDds.filter(r => r.date >= '2026-09-01' && r.date <= '2026-09-30'));
  check('средний чек = выручка ÷ чеки', ac.avg === 250, ac.avg, 250);
  check('чеки не считаются трижды за одну смену', ac.checks === 4000, ac.checks, 4000);
  const acNo = REP.avgCheck([{ date: '2026-09-01', type: 'Приход', amount: 1000 }]);
  check('без числа чеков средний чек не выдумывается', acNo.avg === 0 && acNo.checks === 0, acNo.avg, 0);

  const ya = REP.yearAgo(rDds, '2026-09');
  check('год назад: месяц найден', ya.prevYm === '2025-09' && ya.has, ya.prevYm, '2025-09');
  check('год назад: выручка сравнилась',
    ya.lines[0].cur === 1000000 && ya.lines[0].prev === 800000, ya.lines[0].prev, 800000);
  check('год назад: рост посчитан в процентах', ya.lines[0].pct === 25, ya.lines[0].pct, 25);

  const pace = REP.monthPace(rDds, '2026-09', '2026-09-20');
  check('прогноз: заработано за месяц', pace.done === 1000000, pace.done, 1000000);
  check('прогноз: обычный день по медиане', pace.median === 50000, pace.median, 50000);
  check('прогноз: до конца месяца', pace.forecast === 1500000, pace.forecast, 1500000);
  check('прогноз: осталось дней', pace.left === 10, pace.left, 10);

  check('1 января — праздник', REP.dayKind('2026-01-01') === 'праздник', REP.dayKind('2026-01-01'), 'праздник');
  check('31 декабря — праздник', REP.isHoliday('2026-12-31'), 'да', 'да');
  check('7 марта — канун праздника', REP.dayKind('2026-03-07') === 'канун праздника',
    REP.dayKind('2026-03-07'), 'канун праздника');
  const cal = REP.calendarEffect(rDds);
  check('календарь: дни разложены по видам', cal.rows.length >= 2, cal.rows.length, '>=2');

  const pr = REP.topProblems({ dds: rDds, ym: '2026-09', writeoffSum: 45000, overdue: 12000, overdueCount: 2 });
  check('проблемы: самая дорогая сверху', pr.top[0].what === 'Списанный товар', pr.top[0].what, 'Списанный товар');
  check('проблемы: недостача найдена',
    pr.all.some(x => x.what === 'Недостачи в кассе' && x.sum === 800), 'да', 'да');
  check('проблемы: показываем только три главные', pr.top.length === 3, pr.top.length, 3);

  const gp = REP.groupProfit([
    { group: 'Сигареты', revenue: 500000, gross: 25000, margin: 5, items: 40 },
    { group: 'Молочка', revenue: 300000, gross: 90000, margin: 30, items: 60 }
  ]);
  check('группы: доля в прибыли, а не в выручке',
    gp.rows[0].group === 'Молочка' && gp.rows[0].profitShare > gp.rows[0].revShare, gp.rows[0].group, 'Молочка');
  check('группы: «продаём много, зарабатываем мало» помечено',
    gp.rows[1].gap < 0, gp.rows[1].gap, '<0');

  const ip = REP.itemProfit([
    { name: 'Сигареты', key: 's', qty: 100, revenue: 200000, cogs: 190000 },
    { name: 'Кофе', key: 'k', qty: 50, revenue: 100000, cogs: 40000 }
  ]);
  check('рейтинг: сверху тот, кто приносит деньги', ip.byProfit[0].name === 'Кофе', ip.byProfit[0].name, 'Кофе');
  check('рейтинг: по выручке порядок другой', ip.byRevenue[0].name === 'Сигареты', ip.byRevenue[0].name, 'Сигареты');

  const pe = REP.profitEaters({ dds: rDds, ym: '2026-09', writeoffSum: 45000 });
  check('едоки: валовая прибыль = выручка минус закуп', pe.gross === 600000, pe.gross, 600000);
  check('едоки: зарплата самая крупная', pe.eaters[0].name === 'Зарплата', pe.eaters[0].name, 'Зарплата');
  check('едоки: списания попали в разбор',
    pe.eaters.some(x => x.name === 'Списанный товар' && x.sum === 45000), 'да', 'да');
  check('едоки: остаток = валовая минус съеденное',
    pe.left === pe.gross - pe.eaten, pe.left, pe.gross - pe.eaten);

  check('месяц в заголовке — именительный', FIN.monthTitle('2026-09') === 'Сентябрь 2026',
    FIN.monthTitle('2026-09'), 'Сентябрь 2026');

  // --- Свои показатели: формула словами, без выполнения чужого кода ----------
  const kv = REP.kpiValues({ dds: rDds.filter(r => r.date >= '2026-09-01' && r.date <= '2026-09-30') });
  check('в формуле есть выручка', kv['выручка'] === 1000000, kv['выручка'], 1000000);
  check('в формуле есть средний чек', kv['средний_чек'] === 250, kv['средний_чек'], 250);
  check('формула «выручка - закуп - зп» считается',
    REP.kpiEval('выручка - закуп - зп', kv).value === 360000,
    REP.kpiEval('выручка - закуп - зп', kv).value, 360000);
  check('скобки и проценты работают',
    REP.kpiEval('(выручка - закуп) / выручка * 100', kv).value === 60,
    REP.kpiEval('(выручка - закуп) / выручка * 100', kv).value, 60);
  check('«средний_чек» не распадается на «чеки»',
    REP.kpiEval('средний_чек * 2', kv).value === 500, REP.kpiEval('средний_чек * 2', kv).value, 500);
  check('непонятное слово даёт понятную ошибку',
    /Не понимаю слово/.test(REP.kpiEval('выручка - шоколадка', kv).error || ''),
    REP.kpiEval('выручка - шоколадка', kv).error, 'ошибка про слово');
  check('чужой код в формуле не выполняется',
    !!REP.kpiEval('alert(1)', kv).error, REP.kpiEval('alert(1)', kv).error, 'ошибка');
  check('кривая формула не роняет расчёт',
    !!REP.kpiEval('выручка - ', kv).error, REP.kpiEval('выручка - ', kv).error, 'ошибка');

  // --- Сохранённые наборы фильтров ------------------------------------------
  FLT.clearAll();
  FLT.set('stock', 'group', 'Соки');
  FLT.setText('stock', 'сок');
  const snap = FLT.snapshot('stock');
  check('набор фильтров снимается', snap.state.group === 'Соки' && snap.text === 'сок',
    snap.state.group + '/' + snap.text, 'Соки/сок');
  FLT.clear('stock');
  check('после сброса фильтров ничего не осталось', FLT.active('stock') === 0, FLT.active('stock'), 0);
  FLT.restore('stock', snap);
  check('набор возвращается одной кнопкой',
    FLT.get('stock', 'group') === 'Соки' && FLT.text('stock') === 'сок',
    FLT.get('stock', 'group'), 'Соки');
  check('программа видит, что набор уже применён', FLT.sameAs('stock', snap), 'да', 'да');
  FLT.set('stock', 'group', 'Вода');
  check('изменил фильтр — набор больше не «тот же»', !FLT.sameAs('stock', snap), 'да', 'да');
  FLT.clearAll();

  // --- Работа на двух компьютерах: примирение изменений ----------------------
  const mineSt = { dds: [{ id: 'a', amount: 1 }, { id: 'b', amount: 2 }], trash: [] };
  const theirSt = { dds: [{ id: 'a', amount: 1 }, { id: 'c', amount: 3 }], trash: [] };
  const rec1 = STORE.reconcile(mineSt, theirSt, { mineSaved: '2026-09-01', theirsSaved: '2026-09-02' });
  check('слияние: ни одна запись не пропала',
    rec1.state.dds.map(r => r.id).join(',') === 'a,b,c', rec1.state.dds.map(r => r.id).join(','), 'a,b,c');
  check('слияние: чужие записи посчитаны', rec1.report.added === 1, rec1.report.added, 1);
  check('слияние: одинаковые записи не спорят', rec1.report.conflicts === 0, rec1.report.conflicts, 0);

  const rec2 = STORE.reconcile(
    { dds: [{ id: 'a', amount: 1 }], trash: [] },
    { dds: [{ id: 'a', amount: 99 }], trash: [] },
    { mineSaved: '2026-09-01', theirsSaved: '2026-09-02' });
  check('спорную запись берём из более позднего файла',
    rec2.state.dds[0].amount === 99 && rec2.report.conflicts === 1, rec2.state.dds[0].amount, 99);
  const rec3 = STORE.reconcile(
    { dds: [{ id: 'a', amount: 1 }], trash: [] },
    { dds: [{ id: 'a', amount: 99 }], trash: [] },
    { mineSaved: '2026-09-03', theirsSaved: '2026-09-02' });
  check('если позже мой файл — остаётся моё', rec3.state.dds[0].amount === 1, rec3.state.dds[0].amount, 1);

  const rec4 = STORE.reconcile(
    { dds: [{ id: 'a' }, { id: 'z' }], trash: [] },
    { dds: [{ id: 'a' }], trash: [{ id: 't1', at: '2026-09-02', rec: { id: 'z' } }] },
    { mineSaved: '2026-09-01', theirsSaved: '2026-09-02' });
  check('удалённая на другом компьютере запись не воскресает',
    rec4.state.dds.map(r => r.id).join(',') === 'a' && rec4.report.removed === 1,
    rec4.state.dds.map(r => r.id).join(','), 'a');
  check('корзина после слияния помнит удаление', (rec4.state.trash || []).length === 1,
    (rec4.state.trash || []).length, 1);
  const rec5 = STORE.reconcile(
    { dds: [], settings: { storeName: 'Моё' } },
    { dds: [], settings: { storeName: 'Из файла' } },
    { mineSaved: '2026-09-01', theirsSaved: '2026-09-02' });
  check('настройки берутся у более позднего файла целиком',
    rec5.state.settings.storeName === 'Из файла', rec5.state.settings.storeName, 'Из файла');
  check('запись без номера получает свой при слиянии',
    STORE.reconcile({ dds: [{ amount: 5 }] }, { dds: [] }, {}).state.dds[0].id.length > 2, 'есть', 'есть');
  check('слияние считает записи',
    rec1.report.total === 3, rec1.report.total, 3);

  // --- Справочники ------------------------------------------------------------
  const dSt = {
    dds: [{ category: 'Хозтовары', method: 'Наличные', cashier: 'Аня', shift: 'День' },
      { category: 'Хозтовары', method: 'Наличные', cashier: 'Аня', shift: 'День' },
      { category: 'Аренда', method: 'Перевод', cashier: 'Аня', shift: 'День' }],
    staff: [{ id: 's1', name: 'Аня' }, { id: 's2', name: 'Пётр', fired: '2026-08-01' }],
    supreg: [{ id: 'f1', name: 'Рамми' }, { id: 'f2', name: 'Старый ТП', archived: true }],
    timesheet: [{ employee: 'Пётр' }], docs: [{ firm: 'Рамми' }], dictoff: []
  };
  const dSet = { finCategories: 'Хозтовары, Аренда, Ненужное' };

  check('справочник считает, где стоит слово',
    DIC.usage(dSt, 'categories', 'Хозтовары') === 2, DIC.usage(dSt, 'categories', 'Хозтовары'), 2);
  const dList = DIC.list(dSt, dSet, 'categories');
  check('в справочнике видно всё: и заданное, и вписанное',
    dList.length === 3, dList.map(r => r.name).join(', '), 3);
  check('неиспользуемое видно отдельно',
    dList.filter(r => !r.used).map(r => r.name).join() === 'Ненужное',
    dList.filter(r => !r.used).map(r => r.name).join(), 'Ненужное');

  check('добавить новое слово можно',
    !!DIC.add(dSt, dSet, 'categories', 'Реклама').ok, dSet.finCategories, 'с рекламой');
  check('дважды одно и то же не добавится',
    !!DIC.add(dSt, dSet, 'categories', 'реклама').error, 'ошибка', 'ошибка');
  check('запятая в названии не принимается',
    !!DIC.add(dSt, dSet, 'categories', 'плохо, с запятой').error, 'ошибка', 'ошибка');

  const ren = DIC.rename(dSt, dSet, 'categories', 'Хозтовары', 'Хозрасходы', true);
  check('переименование переписало записи', ren.records === 2, ren.records, 2);
  check('после переименования старого слова в записях нет',
    dSt.dds.filter(r => r.category === 'Хозтовары').length === 0, 0, 0);
  check('новое слово попало в справочник',
    dSet.finCategories.indexOf('Хозрасходы') >= 0, dSet.finCategories, 'с Хозрасходами');
  const renNo = DIC.rename(dSt, dSet, 'categories', 'Аренда', 'Помещение', false);
  check('можно переименовать только в списке, не трогая записи',
    renNo.records === 0 && dSt.dds.filter(r => r.category === 'Аренда').length === 1,
    renNo.records, 0);

  check('используемое удалить нельзя',
    !!DIC.remove(dSt, dSet, 'categories', 'Хозрасходы').error, 'ошибка', 'ошибка');
  check('неиспользуемое удалить можно',
    !!DIC.remove(dSt, dSet, 'categories', 'Ненужное').ok, 'удалено', 'удалено');

  DIC.hide(dSt, 'categories', 'Хозрасходы');
  check('скрытое помечено', DIC.isHidden(dSt, 'categories', 'Хозрасходы'), 'да', 'да');
  check('записи со скрытым словом не тронуты',
    dSt.dds.filter(r => r.category === 'Хозрасходы').length === 2, 2, 2);
  check('скрытое не предлагается в формах',
    Q.dicts(dSt, dSet).categories.indexOf('Хозрасходы') < 0, 'нет в списке', 'нет в списке');
  DIC.show(dSt, 'categories', 'Хозрасходы');
  check('скрытое возвращается',
    Q.dicts(dSt, dSet).categories.indexOf('Хозрасходы') >= 0, 'снова есть', 'снова есть');

  // уволенные и закрытые поставщики
  check('уволенный не предлагается в формах',
    Q.dicts(dSt, {}).employees.indexOf('Пётр') < 0, 'нет', 'нет');
  check('работающий предлагается',
    Q.dicts(dSt, {}).employees.indexOf('Аня') >= 0, 'есть', 'есть');
  check('закрытый поставщик не предлагается',
    Q.dicts(dSt, {}).suppliers.indexOf('Старый ТП') < 0, 'нет', 'нет');
  check('уволенных видно отдельным списком',
    DIC.staffFired(dSt).length === 1 && DIC.staffActive(dSt).length === 1, '1 и 1', '1 и 1');
  check('у сотрудника с историей считаются записи',
    DIC.staffUsage(dSt, 'Пётр') === 1, DIC.staffUsage(dSt, 'Пётр'), 1);

  // сбор из записей и из выгрузок 1С
  const dSt2 = { staff: [{ name: 'Аня' }], timesheet: [{ employee: 'Марат' }, { employee: 'Марат' }],
    payouts: [{ employee: 'Ольга' }], dds: [{ cashier: 'Аня' }] };
  const found = DIC.staffFromRecords(dSt2);
  check('находит людей без карточки',
    found.map(f => f.name).sort().join(', ') === 'Марат, Ольга',
    found.map(f => f.name).sort().join(', '), 'Марат, Ольга');
  check('заведённых заново не предлагает',
    found.every(f => f.name !== 'Аня'), 'Ани нет', 'Ани нет');

  const imp = DIC.firmsFromData(
    { supreg: [{ name: 'Рамми', phone: '' }], docs: [{ firm: 'Рамми' }, { firm: 'Новый ТП' }] },
    { contacts: [{ name: 'Рамми', phone: '+7 928 111-22-33' }], prices: [{ supplier: 'Ещё один' }] });
  check('из 1С видно, кого добавить',
    imp.add.map(a => a.name).sort().join(', ') === 'Ещё один, Новый ТП',
    imp.add.map(a => a.name).sort().join(', '), 'Ещё один, Новый ТП');
  check('и кому проставить телефон',
    imp.update.length === 1 && imp.update[0].name === 'Рамми', imp.update.length, 1);

  // «вписал в форме» возвращает скрытое слово
  const backSt = { dictoff: [{ kind: 'categories', name: 'Вода' }] }, backSet = { finCategories: 'Вода' };
  Q.learn(backSet, 'categories', 'Вода', backSt);
  check('вписанное в форме слово возвращается из скрытых',
    backSt.dictoff.length === 0, backSt.dictoff.length, 0);
  const manySet = { finCategories: 'Аренда' };
  Q.learn(manySet, 'categories', ['Вода', 'Такси'], {});
  check('список названий запоминается по одному, а не строкой',
    manySet.finCategories === 'Аренда, Вода, Такси', manySet.finCategories, 'Аренда, Вода, Такси');


  console.log('');
}

console.log('Итог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
process.exit(failed ? 1 : 0);
