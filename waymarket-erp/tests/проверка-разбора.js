/* ============================================================================
   Проверка расчётов. Запуск:  node tests/проверка-разбора.js

   Главное, что здесь проверяется, — кассовая дисциплина:
   безналичные деньги не попадают в денежный ящик, расхождение считается
   от наличных, а долг поставщикам не задваивается.
   ========================================================================== */
const path = require('path');
const WM = require(path.join(__dirname, '..', 'js', 'engine.js'));
const BOOK = require(path.join(__dirname, '..', 'js', 'book.js'));
const STORE = require(path.join(__dirname, '..', 'js', 'store.js'));
const Q = require(path.join(__dirname, '..', 'js', 'quick.js'));
const FLT = require(path.join(__dirname, '..', 'js', 'filters.js'));
const DIC = require(path.join(__dirname, '..', 'js', 'dicts.js'));
const NUM = require(path.join(__dirname, '..', 'js', 'numpad.js'));
const ENT = require(path.join(__dirname, '..', 'js', 'entry.js'));

let passed = 0, failed = 0;
function check(name, ok, got, want) {
  if (ok) { passed++; console.log('  ✅ ' + name + (got !== undefined ? '  → ' + got : '')); }
  else { failed++; console.log('  ❌ ' + name + '  получено: ' + got + ', ожидалось: ' + want); }
}

console.log('\n— Сверка кассы: главная формула');
{
  // Пример владельца: размен 0, Z-нал 26 467, Z-безнал 29 743, выплаты 10 000, факт 16 000
  const c = WM.shiftCalc({ openCash: 0, zCash: 26467, zCashless: 29743,
    payouts: 10000, factCash: 16000 });
  check('расчётный остаток = размен + Z-нал − выплаты', c.expected === 16467, c.expected, 16467);
  check('расхождение = факт − расчётный', c.diff === -467, c.diff, -467);
  check('минус — это недостача', c.status === 'недостача' && c.short === 467, c.status, 'недостача');
  check('БЕЗНАЛ В ЯЩИК НЕ ПОПАДАЕТ', c.expected !== 16467 + 29743, c.expected, 'без 29 743');
  check('выручка считается вся: наличные плюс безнал', c.revenue === 56210, c.revenue, 56210);

  const over = WM.shiftCalc({ openCash: 5000, zCash: 10000, payouts: 2000, factCash: 13500 });
  check('плюс — это излишек', over.diff === 500 && over.status === 'излишек', over.diff, 500);
  const zero = WM.shiftCalc({ openCash: 5000, zCash: 10000, payouts: 2000, factCash: 13000 });
  check('касса сходится', zero.ok && zero.diff === 0, zero.status, 'сходится');
  const empty = WM.shiftCalc({});
  check('пустая смена не ломает расчёт', empty.expected === 0 && empty.diff === 0, empty.diff, 0);
  const neg = WM.shiftCalc({ openCash: 0, zCash: 1000, payouts: 5000, factCash: 0 });
  check('выплатили больше, чем было — видно минусом', neg.expected === -4000, neg.expected, -4000);
}

console.log('\n— Сколько наличных в ящиках');
{
  const rows = [
    { type: 'Смена', date: '2026-09-01', till: 'Касса 1', zCash: 26467, zCashless: 29743,
      payouts: 10000, openCash: 0, factCash: 16000 }
  ];
  check('в кассе только наличные', WM.cashOnHand(rows, {}) === 16000, WM.cashOnHand(rows, {}), 16000);
  check('безнал посчитан отдельно', WM.cashlessTotal(rows) === 29743, WM.cashlessTotal(rows), 29743);
  check('начальный остаток прибавляется',
    WM.cashOnHand(rows, { openCashStart: 5000 }) === 21000,
    WM.cashOnHand(rows, { openCashStart: 5000 }), 21000);

  const withOut = rows.concat([
    { type: 'Расход', date: '2026-09-02', method: 'Наличные', amount: 3000, category: 'Аренда' },
    { type: 'Расход', date: '2026-09-02', method: 'Перевод', amount: 50000, category: 'Аренда' }
  ]);
  check('расход наличными уменьшает ящик', WM.cashOnHand(withOut, {}) === 13000,
    WM.cashOnHand(withOut, {}), 13000);
  check('расход переводом ящик не трогает',
    WM.cashOnHand(withOut, {}) === WM.cashOnHand(rows.concat([withOut[1]]), {}) - 3000 + 3000 - 3000 + 3000
      ? true : WM.cashOnHand([rows[0], withOut[2]], {}) === 16000,
    WM.cashOnHand([rows[0], withOut[2]], {}), 16000);
  const drawn = rows.concat([{ type: 'Забор', date: '2026-09-02', method: 'Наличные', amount: 6000 }]);
  check('забор владельца уменьшает ящик', WM.cashOnHand(drawn, {}) === 10000, WM.cashOnHand(drawn, {}), 10000);

  // недостача обязана входить: в ящике лежит факт, а не «сколько должно быть»
  const two = [
    { type: 'Смена', date: '2026-09-01', till: 'Касса 1', openCash: 0, zCash: 10000, payouts: 0, factCash: 9000 },
    { type: 'Смена', date: '2026-09-02', till: 'Касса 1', openCash: 9000, zCash: 10000, payouts: 0, factCash: 19000 }
  ];
  check('накопленная недостача не «теряется» в остатке', WM.cashOnHand(two, {}) === 19000,
    WM.cashOnHand(two, {}), 19000);
}

console.log('\n— Разрыв размена между сменами');
{
  const rows = [
    { type: 'Смена', date: '2026-09-01', till: 'Касса 1', openCash: 0, zCash: 26467, payouts: 10000, factCash: 16000 },
    { type: 'Смена', date: '2026-09-02', till: 'Касса 1', openCash: 6000, zCash: 20000, payouts: 0, factCash: 26000 }
  ];
  const gaps = WM.cashGaps(rows);
  check('видно, что 10 000 из ящика вынули', gaps.length === 1 && gaps[0].gap === -10000,
    gaps[0] && gaps[0].gap, -10000);
  const ok = [
    { type: 'Смена', date: '2026-09-01', till: 'Касса 1', openCash: 0, zCash: 100, payouts: 0, factCash: 100 },
    { type: 'Смена', date: '2026-09-02', till: 'Касса 1', openCash: 100, zCash: 100, payouts: 0, factCash: 200 }
  ];
  check('когда размен совпал — тревоги нет', WM.cashGaps(ok).length === 0, WM.cashGaps(ok).length, 0);
  const twoTills = [
    { type: 'Смена', date: '2026-09-01', till: 'Касса 1', openCash: 0, zCash: 100, payouts: 0, factCash: 100 },
    { type: 'Смена', date: '2026-09-01', till: 'Касса 2', openCash: 0, zCash: 200, payouts: 0, factCash: 200 },
    { type: 'Смена', date: '2026-09-02', till: 'Касса 2', openCash: 200, zCash: 50, payouts: 0, factCash: 250 }
  ];
  check('кассы считаются каждая своя', WM.cashGaps(twoTills).length === 0, WM.cashGaps(twoTills).length, 0);
  const st = WM.tillState(twoTills, { tills: 'Касса 1, Касса 2' });
  check('в каждой кассе свой остаток',
    st[0].fact === 100 && st[1].fact === 250, st.map(x => x.till + ':' + x.fact).join(' '), '100 и 250');
}

console.log('\n— Долг поставщикам');
{
  const rows = [
    { type: 'День', date: '2026-09-01', goodsCash: 5000, debtPaid: 3000, debtTaken: 12000 },
    { type: 'День', date: '2026-09-02', goodsCash: 0, debtPaid: 7000, debtTaken: 0 }
  ];
  const d = WM.supplierDebt(rows, { openDebtStart: 100000 });
  check('долг = начальный + взято − погашено', d.debt === 102000, d.debt, 102000);
  check('видно, сколько взяли и сколько отдали', d.taken === 12000 && d.paid === 10000,
    d.taken + ' и ' + d.paid, '12000 и 10000');
  // самое важное: вечерняя форма не двигает кассу — иначе двойной счёт
  check('ИТОГИ ДНЯ КАССУ НЕ ДВИГАЮТ', WM.cashOnHand(rows, { openCashStart: 50000 }) === 50000,
    WM.cashOnHand(rows, { openCashStart: 50000 }), 50000);
  check('без начального остатка долг считается от нуля',
    WM.supplierDebt(rows, {}).debt === 2000, WM.supplierDebt(rows, {}).debt, 2000);
}

console.log('\n— Антирейтинг кассиров');
{
  const rows = [
    { type: 'Смена', date: '2026-09-01', cashier: 'Аня', openCash: 0, zCash: 100000, payouts: 0, factCash: 99000 },
    { type: 'Смена', date: '2026-09-02', cashier: 'Аня', openCash: 99000, zCash: 100000, payouts: 0, factCash: 199000 },
    { type: 'Смена', date: '2026-09-03', cashier: 'Пётр', openCash: 0, zCash: 10000, payouts: 0, factCash: 9500 }
  ];
  const r = WM.cashierRating(rows);
  check('сверху тот, у кого недостач больше', r[0].name === 'Аня', r[0].name, 'Аня');
  check('недостачи посчитаны', r[0].short === 1000 && r[1].short === 500,
    r.map(x => x.name + ':' + x.short).join(' '), 'Аня:1000 Пётр:500');
  check('«на 1000 ₽ выручки» ставит всё на места',
    r[1].per1000 > r[0].per1000, 'Аня ' + r[0].per1000 + ' против Пётр ' + r[1].per1000,
    'у Петра хуже');
  check('видно долю смен с расхождением', r[0].badShifts === 1 && r[0].shifts === 2,
    r[0].badShifts + ' из ' + r[0].shifts, '1 из 2');
  check('запомнен худший случай', r[0].worst === 1000 && r[0].worstDate === '2026-09-01',
    r[0].worstDate, '2026-09-01');
}

console.log('\n— Итоги за период');
{
  const rows = [
    { type: 'Смена', date: '2026-09-01', cashier: 'Аня', openCash: 0, zCash: 26467,
      zCashless: 29743, payouts: 10000, factCash: 16000 },
    { type: 'День', date: '2026-09-01', goodsCash: 5000, debtPaid: 3000, debtTaken: 12000 },
    { type: 'Расход', date: '2026-09-01', category: 'Аренда', method: 'Перевод', amount: 110000 },
    { type: 'Забор', date: '2026-09-01', method: 'Наличные', amount: 5000 }
  ];
  const t = WM.totals(rows);
  check('выручка = наличные + безнал', t.revenue === 56210, t.revenue, 56210);
  check('доля безнала', t.cashlessShare === 52.91, t.cashlessShare, 52.91);
  check('потрачено = выплаты из ящика + расходы', t.spent === 120000, t.spent, 120000);
  check('забор владельца отдельно от расходов', t.draw === 5000 && t.expense === 110000,
    t.draw + ' и ' + t.expense, '5000 и 110000');
  check('расходы разложены по статьям', t.byCategory['Аренда'] === 110000, t.byCategory['Аренда'], 110000);
  check('недостача попала в итоги', t.short === 467, t.short, 467);
}

console.log('\n— План выплат и долги покупателей');
{
  const t = '2026-09-05';
  const plans = [
    { due: '2026-09-01', supplier: 'Рамми', amount: 10000, status: 'Запланирована' },
    { due: '2026-09-05', supplier: 'Ока', amount: 5000, status: 'Запланирована' },
    { due: '2026-09-09', supplier: 'Ока', amount: 7000, status: 'Запланирована' },
    { due: '2026-09-02', supplier: 'Ока', amount: 3000, status: 'Оплачена' }
  ];
  check('просроченное видно', WM.planStatus(plans[0], t).key === 'late', WM.planStatus(plans[0], t).name, 'Просрочена');
  const pt = WM.planTotals(plans, t);
  check('просрочено на сумму', pt.overdue === 10000 && pt.overdueCount === 1, pt.overdue, 10000);
  check('сегодня платить', pt.dueToday === 5000, pt.dueToday, 5000);
  check('на неделе', pt.week === 12000, pt.week, 12000);
  check('оплаченное в план не идёт', pt.planned === 22000, pt.planned, 22000);

  const deb = WM.debtorTotals([
    { date: '2026-07-01', name: 'Сосед', sum: 5000, paid: 1000 },
    { date: '2026-09-04', name: 'Ваня', sum: 2000, paid: 2000 }
  ], t);
  check('не отданное считается', deb.open === 4000, deb.open, 4000);
  check('старые долги видно', deb.old === 4000, deb.old, 4000);
  check('погашенное в долг не идёт', deb.people.length === 1, deb.people.length, 1);
}

console.log('\n— Пересчёт денег по купюрам');
{
  const c = WM.countCash({ n5000: 2, n1000: 5, n100: 3, n10: 0 });
  check('сумма по купюрам', c.sum === 15300, c.sum, 15300);
  check('и сколько их всего', c.pieces === 10, c.pieces, 10);
  check('пустой пересчёт не ломается', WM.countCash({}).sum === 0, WM.countCash({}).sum, 0);
}

console.log('\n— Числа, даты и мелочи');
{
  check('«1 234 567,89» — русская запись', WM.num('1 234 567,89') === 1234567.89, WM.num('1 234 567,89'), 1234567.89);
  check('«1,234.56» — английская', WM.num('1,234.56') === 1234.56, WM.num('1,234.56'), 1234.56);
  check('«1.234,56» — европейская', WM.num('1.234,56') === 1234.56, WM.num('1.234,56'), 1234.56);
  check('«2,500» — это 2,5', WM.num('2,500') === 2.5, WM.num('2,500'), 2.5);
  check('мусор даёт 0, а не NaN',
    [undefined, null, '', 'abc', '—'].every(v => WM.num(v) === 0), 'все нули', 'все нули');
  check('деление на ноль не ломает расчёт', WM.div(100, 0) === 0, WM.div(100, 0), 0);
  check('дата из Excel-числа', WM.excelDate(46270) === '2026-09-05', WM.excelDate(46270), '2026-09-05');
  check('дата «05.09.2026»', WM.excelDate('05.09.2026') === '2026-09-05', WM.excelDate('05.09.2026'), '2026-09-05');
  check('месяц в заголовке — именительный', WM.monthTitle('2026-09') === 'Сентябрь 2026',
    WM.monthTitle('2026-09'), 'Сентябрь 2026');
  check('прошлый месяц через год', WM.prevMonth('2026-01') === '2025-12', WM.prevMonth('2026-01'), '2025-12');
  check('считалка в поле: «1250*3+400»', NUM.calc('1250*3+400') === 4150, NUM.calc('1250*3+400'), 4150);
  check('считалка: «200-10%»', NUM.calc('200-10%') === 180, NUM.calc('200-10%'), 180);
  check('чужой код в поле не выполняется', NUM.calc('alert(1)') === null, NUM.calc('alert(1)'), 'null');
}

console.log('\n— База: журналы ручного учёта, журнал правок и корзина');
{
  check('все рабочие журналы на месте',
    ['dds', 'plans', 'staff', 'timesheet', 'payouts', 'debtors', 'cashcount']
      .every(c => STORE.COLLECTIONS.indexOf(c) >= 0),
    STORE.COLLECTIONS.join(', '), 'семь рабочих');
  check('ТОВАРНЫХ ЖУРНАЛОВ В БАЗЕ НЕТ — аналитика 1С живёт в памяти',
    ['docs', 'pays', 'supreg', 'inventory', 'expiry', 'kvi', 'invoices', 'sales', 'stock',
      'writeoffs', 'prices'].every(c => STORE.COLLECTIONS.indexOf(c) < 0), 'чисто', 'чисто');
  check('разбор выгрузок 1С в ядре есть — это контур 2',
    ['parseSales', 'parseStock', 'parseWriteoffs1C', 'parsePrices'].every(k => typeof WM[k] === 'function'),
    Object.keys(WM).filter(k => /^parse/.test(k)).length + ' разборщиков', 'есть');

  const a = { dds: [{ id: 'a', zCash: 1 }, { id: 'b', zCash: 2 }], trash: [] };
  const b = { dds: [{ id: 'a', zCash: 1 }, { id: 'c', zCash: 3 }], trash: [] };
  const rec = STORE.reconcile(a, b, { mineSaved: '2026-09-01', theirsSaved: '2026-09-02' });
  check('слияние баз с двух компьютеров ничего не теряет',
    rec.state.dds.map(r => r.id).join(',') === 'a,b,c', rec.state.dds.map(r => r.id).join(','), 'a,b,c');
}

console.log('\n— Книга «Бухгалтерия.xlsx»');
{
  const st = {
    dds: [
      { id: 's1', type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День',
        cashier: 'Аня', openCash: 0, zCash: 26467, zCashless: 29743, payouts: 10000, factCash: 16000 },
      { id: 'd1', type: 'День', date: '2026-09-01', goodsCash: 5000, debtPaid: 3000, debtTaken: 12000 }
    ],
    plans: [], staff: [], debtors: [], cashcount: []
  };
  const sheets = BOOK.build(st, { openDebtStart: 100000 });
  const names = sheets.map(s => s.name);
  check('в книге есть все листы ручного учёта',
    ['Касса_и_Смены', 'ДДС_Операции', 'План_Выплат', 'Табель_Зарплаты', 'Настройки']
      .every(n => names.includes(n)), names.join(', '), 'все пять');
  check('первый лист — касса и смены', sheets[0].name === 'Касса_и_Смены', sheets[0].name, 'Касса_и_Смены');
  check('листов 1С в книге нет',
    !sheets.some(s => /накладн|номенклатур|остатк|склад/i.test(s.name)), 'нет', 'нет');
  const m = BOOK.months(st)[0];
  check('месяц собран верно', m.revenue === 56210 && m.short === 467, m.revenue + '/' + m.short, '56210/467');
  const d = BOOK.debtSheet(st, { openDebtStart: 100000 });
  check('долг по месяцам считается от начального', d[0].left === 109000, d[0].left, 109000);

  // Смены и остальные операции лежат на разных листах одной коллекции
  const cash = sheets.find(s => s.name === 'Касса_и_Смены');
  const ops = sheets.find(s => s.name === 'ДДС_Операции');
  check('смена ушла на лист кассы, итоги дня — на лист операций',
    cash.aoa.length === 2 && ops.aoa.length === 2, cash.aoa.length + '/' + ops.aoa.length, '2/2');

  // читаем правку обратно: строка узнаётся по ID
  const back = { dds: [], plans: [], staff: [], timesheet: [], payouts: [], debtors: [], cashcount: [] };
  const aoa = cash.aoa.map(r => r.slice());
  aoa[1][10] = 15000;                                  // поправили факт в ящике
  const rep = BOOK.parse(n => (n === 'Касса_и_Смены' ? aoa : null), back);
  check('правка из книги прочиталась', rep.rows === 1, rep.rows, 1);
  check('и поменяла именно то поле', back.dds[0].factCash === 15000, back.dds[0].factCash, 15000);
  check('ID сохранился', back.dds[0].id === 's1', back.dds[0].id, 's1');
  const empt = { dds: [{ id: 'x', type: 'Смена' }] };
  BOOK.parse(n => (n === 'Касса_и_Смены' ? [cash.aoa[0]] : null), empt);
  check('пустой лист не стирает базу', empt.dds.length === 1, empt.dds.length, 1);

  // Правка одного листа не должна стирать вторую половину коллекции
  const both = { dds: JSON.parse(JSON.stringify(st.dds)), plans: [], staff: [],
    timesheet: [], payouts: [], debtors: [], cashcount: [] };
  BOOK.parse(n => (n === 'Касса_и_Смены' ? cash.aoa : null), both);
  check('правка кассы не стёрла итоги дня',
    both.dds.filter(r => r.type === 'День').length === 1,
    both.dds.map(r => r.type).join(','), 'День на месте');
}

console.log('\n— Зарплата: табель и ведомость ФОТ');
{
  const staff = [
    { name: 'Аня', position: 'Кассир', rate: 220, rateNight: 250 },
    { name: 'Борис', position: 'Администратор', salary: 60000 }
  ];
  const ts = [
    { date: '2026-09-01', employee: 'Аня', shift: 'День', hoursDay: 12, hoursNight: 0 },
    { date: '2026-09-02', employee: 'Аня', shift: 'Ночь', hoursDay: 0, hoursNight: 12,
      bonus: 1000, fine: 500 },
    { date: '2026-09-01', employee: 'Борис', shift: 'День', hoursDay: 8 }
  ];
  const po = [{ date: '2026-09-25', employee: 'Аня', kind: 'Аванс', amount: 2000 }];
  const set = { rateDay: 200, rateNight: 220 };

  const c1 = WM.timesheetCalc(ts[0], staff[0], set);
  check('дневная смена: часы × ставку из карточки', c1.total === 2640, c1.total, 2640);
  const c2 = WM.timesheetCalc(ts[1], staff[0], set);
  check('ночь считается по своей, более дорогой ставке', c2.pay === 3000, c2.pay, 3000);
  check('премия прибавляется, удержание вычитается', c2.total === 3500, c2.total, 3500);
  const c3 = WM.timesheetCalc({ hoursDay: 12 }, null, set);
  check('без карточки ставка берётся из настроек', c3.total === 2400, c3.total, 2400);
  const c4 = WM.timesheetCalc({ hoursDay: 10, rate: 300 }, staff[0], set);
  check('ставка, вписанная в смену, главнее карточки', c4.total === 3000, c4.total, 3000);

  const board = WM.payrollSummary(ts, po, staff, set);
  const anya = board.find(r => r.employee === 'Аня');
  const boris = board.find(r => r.employee === 'Борис');
  check('начислено по часам = смены минус удержания', anya.accrued === 6140, anya.accrued, 6140);
  check('аванс уменьшает остаток к выдаче', anya.left === 4140 && anya.advance === 2000,
    anya.left, 4140);
  check('ОКЛАД НЕ СКЛАДЫВАЕТСЯ С ЧАСАМИ — двойной оплаты нет',
    boris.accrued === 60000 && boris.scheme === 'оклад', boris.accrued, 60000);
  check('часы окладника всё равно видны в табеле', boris.hours === 8, boris.hours, 8);

  const tot = WM.payrollTotals(board);
  check('ФОТ месяца — сумма начислений', tot.accrued === 66140, tot.accrued, 66140);
  check('остаток к выдаче = начислено − выдано', tot.left === 64140, tot.left, 64140);
  check('уволенный в подсказки не идёт',
    WM.activeStaff(staff.concat([{ name: 'Старый', fired: '2026-01-01' }])).length === 2,
    WM.activeStaff(staff.concat([{ name: 'Старый', fired: '2026-01-01' }])).length, 2);
}

console.log('\n— Прибыль (P&L): один источник для каждой суммы');
{
  const rows = [
    { type: 'Смена', date: '2026-09-01', zCash: 26467, zCashless: 29743,
      payouts: 10000, factCash: 16467, openCash: 0 },
    { type: 'День', date: '2026-09-01', goodsCash: 5000, debtPaid: 3000, debtTaken: 12000 },
    { type: 'Расход', date: '2026-09-02', category: 'Аренда', method: 'Наличные', amount: 110000 },
    { type: 'Расход', date: '2026-09-03', category: 'Обед', method: 'Наличные', amount: 3000 },
    { type: 'Забор', date: '2026-09-04', method: 'Наличные', amount: 7000 }
  ];
  const p = WM.pnl({ rows, payroll: 280000, writeoff1c: 12000 });
  check('выручка = наличные + безнал', p.revenue === 56210, p.revenue, 56210);
  check('ЗАКУП = за наличные + взятое в долг, погашение долга не считается',
    p.purchase === 17000, p.purchase, 17000);
  check('валовая прибыль = выручка − закуп', p.gross === 39210, p.gross, 39210);
  const fot = p.costs.find(c => c.key === 'fot');
  check('ФОТ берётся из табеля', fot.sum === 280000 && fot.source === 'табель', fot.source, 'табель');
  const wo = p.costs.find(c => c.key === 'writeoff');
  check('списания берутся из 1С', wo.sum === 12000 && wo.source === '1С', wo.source, '1С');
  check('чистая = валовая − все затраты', p.net === WM.safeRound(p.gross - p.costTotal), p.net, p.gross - p.costTotal);
  check('ВЫПЛАТЫ ИЗ ЯЩИКА В ЗАТРАТЫ НЕ ВХОДЯТ',
    p.costs.every(c => c.sum !== 10000) && p.payouts === 10000, p.payouts, 10000);
  check('забор владельца показан отдельно от затрат', p.draw === 7000, p.draw, 7000);
  check('погашение долга затратой не стало', p.debtPaid === 3000 &&
    p.costTotal === WM.safeRound(280000 + 110000 + 3000 + 12000), p.costTotal, 405000);
}

console.log('\n— Списания из 1С: синхронизация файла (Upsert)');
{
  const p1 = { from: '01.09.2026', to: '30.09.2026' };
  const mk = (name, batch, qty, cost) => ({ id: 'n' + name + batch, name, key: WM.norm(name),
    warehouse: 'Основной', batch, reason: 'Просрочка', qty, cost, retail: 0 });

  const a = WM.syncWriteoffs([], [mk('Молоко', 'П1', 2, 300), mk('Хлеб', 'П2', 1, 40)], p1);
  check('первая выгрузка просто загрузилась', a.stats.added === 2 && a.rows.length === 2,
    a.rows.length, 2);
  check('дата для отчётов взята из периода выгрузки', a.rows[0].date === '2026-09-30',
    a.rows[0].date, '2026-09-30');

  const b = WM.syncWriteoffs(a.rows, [mk('Молоко', 'П1', 3, 450), mk('Кефир', 'П3', 1, 90)], p1);
  check('совпавшая строка ОБНОВИЛАСЬ', b.stats.updated === 1 &&
    b.rows.find(r => r.name === 'Молоко').cost === 450, b.stats.updated, 1);
  check('новая строка ДОБАВИЛАСЬ', b.stats.added === 1 &&
    !!b.rows.find(r => r.name === 'Кефир'), b.stats.added, 1);
  check('пропавшая из файла строка СТЁРЛАСЬ из аналитики',
    b.stats.removed === 1 && !b.rows.find(r => r.name === 'Хлеб'), b.stats.removed, 1);
  check('номер строки сохранился — история не рвётся',
    b.rows.find(r => r.name === 'Молоко').id === a.rows.find(r => r.name === 'Молоко').id,
    'сохранился', 'сохранился');

  const p2 = { from: '01.10.2026', to: '31.10.2026' };
  const c = WM.syncWriteoffs(b.rows, [mk('Сыр', 'П4', 1, 500)], p2);
  check('ВЫГРУЗКА ЗА ДРУГОЙ МЕСЯЦ НЕ СТИРАЕТ ПРОШЛЫЙ',
    c.rows.length === 3 && c.stats.kept === 2, c.rows.length, 3);
}

console.log('\n— Справочники');
{
  const st = {
    dds: [{ category: 'Хозтовары', cashier: 'Аня', method: 'Наличные', shift: 'День' },
      { category: 'Хозтовары', cashier: 'Аня' }],
    staff: [{ id: 's1', name: 'Аня' }, { id: 's2', name: 'Пётр', fired: '2026-08-01' }],
    plans: [{ supplier: 'Рамми' }], debtors: [], cashcount: [], dictoff: []
  };
  const set = { finCategories: 'Хозтовары, Аренда' };
  check('считает, где стоит слово', DIC.usage(st, 'categories', 'Хозтовары') === 2,
    DIC.usage(st, 'categories', 'Хозтовары'), 2);
  const ren = DIC.rename(st, set, 'categories', 'Хозтовары', 'Хозрасходы', true);
  check('переименование правит и записи', ren.records === 2, ren.records, 2);
  check('используемое удалить нельзя', !!DIC.remove(st, set, 'categories', 'Хозрасходы').error, 'ошибка', 'ошибка');
  DIC.hide(st, 'categories', 'Хозрасходы');
  check('скрытое не предлагается в формах',
    Q.dicts(st, set).categories.indexOf('Хозрасходы') < 0, 'нет', 'нет');
  check('уволенный не предлагается', Q.dicts(st, {}).employees.indexOf('Пётр') < 0, 'нет', 'нет');
  check('поставщики берутся из плана выплат',
    Q.dicts(st, {}).suppliers.indexOf('Рамми') >= 0, 'есть', 'есть');
  check('уволенных видно отдельно', DIC.staffFired(st).length === 1, DIC.staffFired(st).length, 1);
  check('у кассира с историей считаются записи', DIC.staffUsage(st, 'Аня') === 2, DIC.staffUsage(st, 'Аня'), 2);
  const found = DIC.staffFromRecords({ staff: [], dds: [{ cashier: 'Марат' }] });
  check('находит кассиров без карточки', found[0] && found[0].name === 'Марат', found[0] && found[0].name, 'Марат');
}

console.log('\n— Фильтры и меню строки');
{
  FLT.clearAll();
  FLT.set('morning', 'res', 'short'); FLT.setText('morning', 'аня');
  const snap = FLT.snapshot('morning');
  FLT.clear('morning');
  FLT.restore('morning', snap);
  check('набор фильтров возвращается', FLT.get('morning', 'res') === 'short', FLT.get('morning', 'res'), 'short');
  FLT.clearAll();
  ENT.clearClip();
  ENT.copy({ id: 'x', cashier: 'Аня', zCash: 100 }, 'dds');
  check('запись копируется без служебных полей',
    ENT.clip().values.id === undefined && ENT.clip().values.cashier === 'Аня', 'ок', 'ок');
  check('отменить нечего, когда журнал пуст', ENT.lastUndoable([]) === null, 'null', 'null');
}

console.log('\nИтог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
process.exit(failed ? 1 : 0);
