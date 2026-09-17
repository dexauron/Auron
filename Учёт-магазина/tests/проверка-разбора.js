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
const REV = require(path.join(__dirname, '..', 'js', 'revizor.js'));

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
  /* Колонку ищем ПО НАЗВАНИЮ, а не по номеру: номера съезжают, как только
     на лист добавляют столбец, и проверка начинает падать на пустом месте. */
  const колФакт = aoa[0].indexOf('Факт_в_ящике');
  check('в книге есть колонка «Факт_в_ящике»', колФакт >= 0, колФакт, '>= 0');
  aoa[1][колФакт] = 15000;                             // поправили факт в ящике
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

console.log('\n— Две оси: трата или движение денег, из ящика или из сейфа');
{
  // 1. Расшифровка выплаты из ящика НЕ должна вычитать наличные второй раз
  const rows = [
    { type: 'Смена', date: '2026-09-01', till: 'Касса 1', openCash: 0, zCash: 26467,
      zCashless: 29743, payouts: 10000, factCash: 16467 },
    { type: 'Расход', date: '2026-09-01', category: 'Аренда', method: 'Наличные',
      source: 'Из ящика', amount: 5000 }
  ];
  check('РАСХОД ИЗ ЯЩИКА КАССУ ВТОРОЙ РАЗ НЕ УМЕНЬШАЕТ',
    WM.cashOnHand(rows, { openCashStart: 0 }) === 16467,
    WM.cashOnHand(rows, { openCashStart: 0 }), 16467);
  check('но в прибыль эта трата входит',
    WM.pnl({ rows }).costs.find(c => c.key === 'rent').sum === 5000,
    WM.pnl({ rows }).costs.find(c => c.key === 'rent').sum, 5000);

  // Расход помимо ящика — уменьшает наличные, как и должен
  const own = rows.concat([{ type: 'Расход', date: '2026-09-02', category: 'ГСМ',
    method: 'Наличные', amount: 1000 }]);
  check('расход, взятый не из ящика, наличные уменьшает',
    WM.cashOnHand(own, { openCashStart: 0 }) === 15467,
    WM.cashOnHand(own, { openCashStart: 0 }), 15467);

  // 2. Откуда деньги — читается из человеческих слов формы
  check('«Из ящика» распознаётся', WM.moneyFrom({ source: 'Из ящика' }) === 'ящик',
    WM.moneyFrom({ source: 'Из ящика' }), 'ящик');
  check('«Из сейфа» распознаётся', WM.moneyFrom({ source: 'Из сейфа' }) === 'сейф',
    WM.moneyFrom({ source: 'Из сейфа' }), 'сейф');

  /* 3. Сейф живёт отдельно от ящика.
     Кассир вынул 200 000 и записал их в «выплаты из ящика» — факт смены это
     уже учёл. Поэтому инкассация ящик второй раз не уменьшает, а сейф
     пополняет. Вычесть её ещё раз значило бы потерять деньги дважды. */
  const safe = [
    { type: 'Смена', date: '2026-09-02', openCash: 0, zCash: 300000, zCashless: 0,
      payouts: 200000, factCash: 100000 },
    { type: 'Перемещение', date: '2026-09-02', from: 'Касса', to: 'Сейф', amount: 200000 },
    { type: 'Расход', date: '2026-09-03', category: 'Расходники', method: 'Наличные',
      source: 'Из сейфа', amount: 5000 }
  ];
  check('ИНКАССАЦИЯ НЕ ВЫЧИТАЕТСЯ ИЗ ЯЩИКА ДВАЖДЫ',
    WM.cashOnHand(safe, { openCashStart: 0 }) === 100000,
    WM.cashOnHand(safe, { openCashStart: 0 }), 100000);
  check('и увеличивает сейф', WM.safeOnHand(safe, { openSafeStart: 0 }) === 195000,
    WM.safeOnHand(safe, { openSafeStart: 0 }), 195000);
  check('ИНКАССАЦИЯ ПРИБЫЛЬ НЕ УМЕНЬШАЕТ',
    WM.pnl({ rows: safe }).net === 300000 - 5000,
    WM.pnl({ rows: safe }).net, 295000);
  check('и она расшифровывает выплату из ящика',
    WM.tillPayoutCheck(safe).left === 0, WM.tillPayoutCheck(safe).left, 0);

  // 4. Сверка: сколько из ящика выдали и сколько расписали
  const chk = WM.tillPayoutCheck(rows);
  check('видно, что из выплат не расписано', chk.payouts === 10000 &&
    chk.explained === 5000 && chk.left === 5000, chk.left, 5000);
}

console.log('\n— Рабочий день магазина: две кассы, деньги из обеих');
{
  /* Как оно есть на самом деле: за день из двух ящиков вынули 40 000 и
     раздали на всё сразу — товар, долги поставщикам, зарплату, обед,
     инкассацию. Все пять должны сойтись с выплатами по сменам. */
  const rows = [
    { type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День', cashier: 'Аня',
      openCash: 5000, zCash: 40000, zCashless: 12000, payouts: 25000, factCash: 20000 },
    { type: 'Смена', date: '2026-09-01', till: 'Касса 2', shift: 'День', cashier: 'Пётр',
      openCash: 5000, zCash: 30000, zCashless: 8000, payouts: 15000, factCash: 20000 },
    { type: 'День', date: '2026-09-01', goodsCash: 12000, debtPaid: 8000, debtTaken: 0 },
    { type: 'Расход', date: '2026-09-01', category: 'Обед', method: 'Наличные',
      source: 'Из ящика', amount: 3000 },
    { type: 'Перемещение', date: '2026-09-01', from: 'Касса', to: 'Сейф', amount: 2000 }
  ];
  const salary = [{ date: '2026-09-01', employee: 'Аня', kind: 'Аванс',
    amount: 15000, method: 'Наличные', source: 'Из ящика' }];
  const set = { openCashStart: 10000, openSafeStart: 0 };

  check('обе смены сошлись', rows.filter(r => r.type === 'Смена')
    .every(r => WM.shiftCalc(r).ok), 'сошлись', 'сошлись');
  check('НАЛИЧНЫЕ ПО ДВУМ КАССАМ СЧИТАЮТСЯ ВЕРНО',
    WM.cashOnHand(rows, set) === 40000, WM.cashOnHand(rows, set), 40000);
  check('инкассация легла в сейф', WM.safeOnHand(rows, set) === 2000,
    WM.safeOnHand(rows, set), 2000);

  const chk = WM.tillPayoutCheck(rows, null, { payouts: salary });
  check('из ящика выдали столько, сколько записали кассиры', chk.payouts === 40000,
    chk.payouts, 40000);
  check('ВСЕ ПЯТЬ ТРАТ ПОПАЛИ В РАСШИФРОВКУ', chk.explained === 40000,
    chk.explained, 40000);
  check('ложной тревоги «не расписано» нет', chk.left === 0 && !chk.over, chk.left, 0);
  check('видно, на что именно ушли деньги из ящика',
    ['товар', 'долги поставщикам', 'зарплата', 'расходы', 'инкассация']
      .every(k => chk.parts[k] > 0), Object.keys(chk.parts).join(', '), 'все пять');

  // Зарплата: начисление в затратах, выдача — только движение денег
  const p = WM.pnl({ rows, payroll: 15000 });
  check('выручка обеих касс с безналом', p.revenue === 90000, p.revenue, 90000);
  check('закуп = товар за наличные', p.purchase === 12000, p.purchase, 12000);
  check('в затратах ФОТ и обед, без долгов и инкассации',
    p.costTotal === 18000, p.costTotal, 18000);
  check('ПОГАШЕНИЕ ДОЛГА ТП В ЗАТРАТЫ НЕ ПОПАЛО', p.debtPaid === 8000 &&
    p.costs.every(c => c.sum !== 8000), 'не попало', 'не попало');
  check('инкассация в затраты не попала', p.moved === 2000 &&
    p.costs.every(c => c.sum !== 2000), 'не попала', 'не попала');
  check('чистая прибыль = 90000 − 12000 − 18000', p.net === 60000, p.net, 60000);
}

console.log('\n— Счета: где лежат деньги');
{
  const acc = [
    { id: 'a1', name: 'Касса', kind: 'till', opening: 10000, defaultCash: true },
    { id: 'a2', name: 'Сейф', kind: 'cash', opening: 50000 },
    { id: 'a3', name: 'Расчётный счёт', kind: 'bank', opening: 0, defaultCashless: true }
  ];
  const rows = [
    { type: 'Смена', date: '2026-09-01', account: 'a1', cashlessAccount: 'a3',
      openCash: 10000, zCash: 40000, zCashless: 12000, payouts: 25000, factCash: 25000 },
    { type: 'Перемещение', date: '2026-09-01', account: 'a1', toAccount: 'a2', amount: 5000 },
    { type: 'Расход', date: '2026-09-02', category: 'Аренда', method: 'Перевод',
      account: 'a3', amount: 30000 }
  ];
  const b = WM.accountBalances(rows, acc);
  const by = n => b.rows.find(x => x.name === n).balance;

  check('НАЛИЧНАЯ ВЫРУЧКА ЛОЖИТСЯ НА СВОЙ СЧЁТ, БЕЗНАЛ — НА СВОЙ',
    by('Касса') === 25000 && by('Расчётный счёт') === -18000,
    by('Касса') + ' / ' + by('Расчётный счёт'), '25000 / -18000');
  check('перевод пополнил сейф', by('Сейф') === 55000, by('Сейф'), 55000);
  check('ИЗ ЯЩИКА ПЕРЕВОД ВТОРОЙ РАЗ НЕ СПИСЫВАЕТСЯ',
    by('Касса') === 25000, by('Касса'), 25000);
  check('расход со счёта списался как обычно', by('Расчётный счёт') === -18000,
    by('Расчётный счёт'), -18000);

  const t = b.totals;
  check('итоги: в ящиках, в сейфе и на счетах отдельно',
    t.till === 25000 && t.safe === 55000 && t.bank === -18000,
    t.till + '/' + t.safe + '/' + t.bank, '25000/55000/-18000');
  check('«наличные» — это ящики, сейф считается отдельно',
    WM.cashOnHand(rows, {}, null, acc) === 25000 &&
    WM.safeOnHand(rows, {}, null, acc) === 55000,
    WM.cashOnHand(rows, {}, null, acc), 25000);

  // Расход из ящика остаток ящика не трогает: он уже в выплатах смены
  const withCash = rows.concat([{ type: 'Расход', date: '2026-09-01', category: 'Обед',
    method: 'Наличные', account: 'a1', amount: 3000 }]);
  check('РАСХОД ИЗ ЯЩИКА ЕГО ОСТАТОК НЕ МЕНЯЕТ',
    WM.cashOnHand(withCash, {}, null, acc) === 25000,
    WM.cashOnHand(withCash, {}, null, acc), 25000);
  check('но в сверку выплат он попадает',
    WM.tillPayoutCheck(withCash, null, { accounts: acc }).parts['расходы'] === 3000,
    WM.tillPayoutCheck(withCash, null, { accounts: acc }).parts['расходы'], 3000);

  // Счёт по умолчанию
  check('счёт по умолчанию для наличной выручки',
    WM.defaultAccount(acc).name === 'Касса', WM.defaultAccount(acc).name, 'Касса');
  check('и для безналичной', WM.defaultAccount(acc, true).name === 'Расчётный счёт',
    WM.defaultAccount(acc, true).name, 'Расчётный счёт');

  // Старые записи без счёта раскладываются по виду счёта
  const old = [{ type: 'Расход', date: '2026-09-01', category: 'ГСМ',
    method: 'Наличные', source: 'Из сейфа', amount: 2000 }];
  check('записи, сделанные до появления счетов, находят свой счёт',
    WM.accountOf(old[0], acc).name === 'Сейф', WM.accountOf(old[0], acc).name, 'Сейф');

  // Счета заводятся сами и переносят прежние остатки
  STORE.clear();
  STORE.state.settings.openCashStart = 7000;
  STORE.state.settings.openSafeStart = 3000;
  STORE.state.accounts = [];
  const made = STORE.ensureAccounts();
  check('счета заводятся при первом запуске', made.length === 3, made.length, 3);
  check('и забирают прежние начальные остатки',
    made.find(a => a.kind === 'till').opening === 7000 &&
    made.find(a => a.name === 'Сейф').opening === 3000,
    made.find(a => a.kind === 'till').opening, 7000);
  check('счета не считаются «записями» владельца', STORE.stamp().records === 0,
    STORE.stamp().records, 0);
  STORE.clear();
}

console.log('\n— Должности: готовый список и свои');
{
  const st = { staff: [{ name: 'Аня', position: 'Продавец-кассир, Товаровед' }],
    dds: [], plans: [], debtors: [], cashcount: [], dictoff: [] };
  const d = Q.dicts(st, STORE.DEFAULT_SETTINGS);
  check('готовый список должностей продуктового магазина', d.positions.length >= 10,
    d.positions.length + ' должностей', '>=10');
  check('есть те, кого реально держат в магазине',
    ['Продавец-кассир', 'Товаровед', 'Администратор', 'Уборщица', 'Грузчик', 'Бухгалтер']
      .every(p => d.positions.indexOf(p) >= 0), 'все на месте', 'все');
  check('СОВМЕЩЕНИЕ: обе должности человека попадают в справочник',
    d.positions.indexOf('Товаровед') >= 0 && d.positions.indexOf('Продавец-кассир') >= 0,
    'обе', 'обе');

  // Своя должность, которой нет в списке
  const set = JSON.parse(JSON.stringify(STORE.DEFAULT_SETTINGS));
  Q.learn(set, 'positions', 'Пекарь', st);
  check('свою должность можно добавить',
    Q.dicts(st, set).positions.indexOf('Пекарь') >= 0, 'добавилась', 'добавилась');
}

console.log('\n— Зарплата: один источник ФОТ, но всегда какой-то есть');
{
  const rows = [{ type: 'Смена', date: '2026-09-01', openCash: 0, zCash: 500000,
    zCashless: 0, payouts: 200000, factCash: 300000 }];
  const fot = p => p.costs.find(c => c.key === 'fot');

  // Табеля нет, статьи «ЗП» нет — берём то, что реально выдали на руки
  const paid = WM.pnl({ rows, payroll: 0, salaryPaid: 200000 });
  check('ЗАРПЛАТА БЕЗ ТАБЕЛЯ ВСЁ РАВНО ПОПАДАЕТ В ЗАТРАТЫ',
    fot(paid).sum === 200000 && fot(paid).source === 'выдано на руки',
    fot(paid).sum + ' (' + fot(paid).source + ')', '200000 (выдано на руки)');
  check('и прибыль перестала быть завышенной', paid.net === 300000, paid.net, 300000);

  // Табель главнее выплат — не складываем
  const both = WM.pnl({ rows, payroll: 180000, salaryPaid: 200000 });
  check('ТАБЕЛЬ И ВЫПЛАТЫ НЕ СКЛАДЫВАЮТСЯ', fot(both).sum === 180000,
    fot(both).sum, 180000);
  check('и источник назван честно', fot(both).source === 'табель', fot(both).source, 'табель');

  // Статья «ЗП» главнее выплат
  const art = WM.pnl({ rows: rows.concat([{ type: 'Расход', date: '2026-09-01',
    category: 'ЗП', method: 'Наличные', source: 'Из ящика', amount: 150000 }]),
    payroll: 0, salaryPaid: 200000 });
  check('статья «ЗП» главнее выданного', fot(art).sum === 150000, fot(art).sum, 150000);
}

console.log('\n— Деньги из сейфа и деньги в ящик');
{
  // Товар оплатили из сейфа: ящик не трогали, сейф уменьшился
  const fromSafe = [
    { type: 'Смена', date: '2026-09-01', openCash: 0, zCash: 20000, zCashless: 0,
      payouts: 0, factCash: 20000 },
    { type: 'День', date: '2026-09-01', source: 'Из сейфа', goodsCash: 50000,
      debtPaid: 0, debtTaken: 0 }
  ];
  check('товар из сейфа ящик не трогает',
    WM.cashOnHand(fromSafe, { openCashStart: 0 }) === 20000,
    WM.cashOnHand(fromSafe, { openCashStart: 0 }), 20000);
  check('СЕЙФ УМЕНЬШИЛСЯ НА СУММУ ЗАКУПА',
    WM.safeOnHand(fromSafe, { openSafeStart: 200000 }) === 150000,
    WM.safeOnHand(fromSafe, { openSafeStart: 200000 }), 150000);
  check('и сверка ящика не ругается', !WM.tillPayoutCheck(fromSafe).over,
    'молчит', 'молчит');
  check('в прибыли закуп всё равно учтён',
    WM.pnl({ rows: fromSafe }).purchase === 50000,
    WM.pnl({ rows: fromSafe }).purchase, 50000);

  // Владелец доложил наличных в ящик — кассир пересчитал их вместе со сменой
  const cashIn = [
    { type: 'Смена', date: '2026-09-01', openCash: 0, zCash: 20000, zCashless: 0,
      payouts: 0, factCash: 30000 },
    { type: 'Приход', date: '2026-09-01', category: 'Внёс владелец',
      method: 'Наличные', source: 'Из ящика', amount: 10000 }
  ];
  check('ВНЕСЁННЫЕ В ЯЩИК ДЕНЬГИ НЕ СЧИТАЮТСЯ ДВАЖДЫ',
    WM.cashOnHand(cashIn, { openCashStart: 0 }) === 30000,
    WM.cashOnHand(cashIn, { openCashStart: 0 }), 30000);

  const toSafe = [{ type: 'Приход', date: '2026-09-01', method: 'Наличные',
    source: 'Из сейфа', amount: 10000 }];
  check('внесённое в сейф увеличивает сейф',
    WM.safeOnHand(toSafe, { openSafeStart: 0 }) === 10000,
    WM.safeOnHand(toSafe, { openSafeStart: 0 }), 10000);
  check('и не увеличивает ящик', WM.cashOnHand(toSafe, { openCashStart: 0 }) === 0,
    WM.cashOnHand(toSafe, { openCashStart: 0 }), 0);
}

console.log('\n— Что тратой НЕ является: закуп, долг, инкассация');
{
  const rows = [
    { type: 'Смена', date: '2026-09-01', openCash: 0, zCash: 100000, zCashless: 0,
      payouts: 0, factCash: 100000 },
    { type: 'День', date: '2026-09-01', goodsCash: 30000, debtPaid: 20000, debtTaken: 0 },
    // так владелец мог записать раньше — и прибыль занижалась на 50 000
    { type: 'Расход', date: '2026-09-01', category: 'Закуп товара', method: 'Наличные', amount: 30000 },
    { type: 'Расход', date: '2026-09-01', category: 'Оплата ТП', method: 'Наличные', amount: 20000 },
    { type: 'Расход', date: '2026-09-02', category: 'Инкассация', method: 'Наличные', amount: 40000 }
  ];
  const p = WM.pnl({ rows });
  check('ЗАКУП НЕ СЧИТАЕТСЯ ДВАЖДЫ', p.purchase === 30000, p.purchase, 30000);
  check('ЧИСТАЯ ПРИБЫЛЬ НЕ ЗАНИЖЕНА', p.net === 70000, p.net, 70000);
  check('затрат по этим записям нет вовсе', p.costTotal === 0, p.costTotal, 0);
  check('но владельцу показано, что записи есть', p.excluded.length === 3 &&
    p.excludedTotal === 90000, p.excluded.map(x => x.key).join(','), 'purchase,debt,move');
  check('погашение долга — не расход',
    !!p.excluded.find(x => x.key === 'debt'), 'отделено', 'отделено');

  // Справочник больше не предлагает статьи-ловушки
  const cats = Q.dicts({ dds: [{ type: 'Расход', category: 'Закуп товара' }] }, {}).categories;
  check('ФОРМА БОЛЬШЕ НЕ ПРЕДЛАГАЕТ «ЗАКУП ТОВАРА»', cats.indexOf('Закуп товара') < 0,
    cats.join(','), 'без закупа');
  check('и не предлагает «Оплата ТП»', cats.indexOf('Оплата ТП') < 0, 'нет', 'нет');
  check('обычные статьи на месте', cats.indexOf('Аренда') >= 0 && cats.indexOf('ГСМ') >= 0,
    'на месте', 'на месте');
}

console.log('\n— Недостачи кассира и удержание из зарплаты');
{
  const dds = [
    { type: 'Смена', date: '2026-09-01', cashier: 'Аня', openCash: 0, zCash: 20000,
      zCashless: 0, payouts: 0, factCash: 19500 },
    { type: 'Смена', date: '2026-09-02', cashier: 'Аня', openCash: 0, zCash: 20000,
      zCashless: 0, payouts: 0, factCash: 20000 }
  ];
  const staff = [{ name: 'Аня', rate: 220 }];
  const sh = WM.cashierShortages(dds);
  check('недостачи собраны по кассиру', sh[0].cashier === 'Аня' && sh[0].net === 500,
    sh[0].net, 500);

  const before = WM.payrollSummary([{ date: '2026-09-01', employee: 'Аня', hoursDay: 12 }],
    [], staff, {}, { dds })[0];
  check('в ведомости видно, сколько можно удержать', before.canWithhold === 500,
    before.canWithhold, 500);
  check('сама по себе недостача зарплату не трогает', before.accrued === 2640,
    before.accrued, 2640);

  const after = WM.payrollSummary([{ date: '2026-09-01', employee: 'Аня', hoursDay: 12, fine: 500 }],
    [], staff, {}, { dds })[0];
  check('удержание уменьшило начисление', after.accrued === 2140, after.accrued, 2140);
  check('ДВАЖДЫ ОДНУ НЕДОСТАЧУ НЕ УДЕРЖИМ', after.canWithhold === 0, after.canWithhold, 0);
}

console.log('\n— Закрытие месяца: что должно сойтись');
{
  const rows = [
    { type: 'Смена', date: '2026-09-01', cashier: 'Аня', openCash: 0, zCash: 20000,
      zCashless: 0, payouts: 5000, factCash: 15000 },
    { type: 'Расход', date: '2026-09-01', category: 'Аренда', method: 'Наличные',
      source: 'Из ящика', amount: 3000 },
    { type: 'Расход', date: '2026-09-02', category: 'Закуп товара', method: 'Наличные', amount: 1000 }
  ];
  const mc = WM.monthClose({ rows, ym: '2026-09', settings: { diffCrit: 1000 } });
  const by = k => mc.items.find(i => i.key === k);
  check('чек-лист собран', mc.items.length === 7, mc.items.length, 7);
  const saidPay = by('payouts').said.replace(/[\u00a0\u202f]/g, ' ');
  check('видит недорасписанные выплаты', !by('payouts').ok && saidPay.indexOf('2 000') >= 0,
    saidPay, 'не расписано 2 000 ₽');
  check('видит пустой табель', !by('payroll').ok, by('payroll').said, 'табель пуст');
  check('видит закуп, записанный расходом', !by('clean').ok, by('clean').said, 'нашёл');
  check('месяц закрывать рано', mc.ready === false, mc.ready, false);

  // всё поправили — месяц сходится
  const good = WM.monthClose({
    rows: [{ type: 'Смена', date: '2026-09-01', cashier: 'Аня', openCash: 0, zCash: 20000,
      zCashless: 0, payouts: 5000, factCash: 20000 },
      { type: 'Расход', date: '2026-09-01', category: 'Аренда', method: 'Наличные',
        source: 'Из ящика', amount: 5000 }],
    ym: '2026-09', settings: { diffCrit: 1000 },
    payrollRow: { accrued: 50000, paid: 50000, left: 0, people: 1 }
  });
  check('важные пункты сошлись', good.hardLeft === 1, good.hardLeft + ' (дни без смен)', 1);
  check('выплаты расписаны полностью', good.items.find(i => i.key === 'payouts').ok,
    'сошлось', 'сошлось');
  check('зарплата закрыта', good.items.find(i => i.key === 'payroll').ok, 'закрыта', 'закрыта');
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

console.log('\n— Ни байта не теряем: отпечаток базы и сверка при запуске');
{
  const S2 = STORE;
  S2.clear();
  S2.add('dds', { type: 'Смена', date: '2026-09-01', zCash: 26467 });
  S2.save();
  const mine = S2.stamp();
  check('у базы есть номер версии и время', mine.rev > 0 && !!mine.savedAt,
    'rev ' + mine.rev, 'есть');
  check('и число записей', mine.records === 1, mine.records, 1);

  // Файл отстал: в нём ещё пусто, а в браузере уже есть запись
  const stale = S2.compare({ dds: [], rev: 0, savedAt: '2020-01-01T00:00:00Z' });
  check('ОТСТАВШИЙ ФАЙЛ НЕ ПЕРЕБИВАЕТ БРАУЗЕР', stale.verdict === 'local',
    stale.verdict, 'local');
  check('видно, сколько записей уцелело', stale.onlyMine === 1, stale.onlyMine, 1);

  // В файле есть то, чего нет здесь: работали в другой вкладке
  const newer = S2.compare({ dds: [{ id: S2.state.dds[0].id, type: 'Смена' },
    { id: 'zzz', type: 'Смена' }], rev: 99 });
  check('чужие записи из файла подхватываем', newer.verdict === 'file',
    newer.verdict, 'file');

  // И там и там своё — молча выбирать нельзя
  const both = S2.compare({ dds: [{ id: 'zzz', type: 'Смена' }], rev: 99 });
  check('расхождение отдаём владельцу, а не решаем сами', both.verdict === 'ask',
    both.verdict, 'ask');

  // Одинаковый состав, файл новее — берём файл (там могли поправить суммы)
  const sameSet = S2.compare({ dds: [{ id: S2.state.dds[0].id }], rev: 99,
    savedAt: '2099-01-01T00:00:00Z' });
  check('тот же состав, но файл новее — берём файл', sameSet.verdict === 'file',
    sameSet.verdict, 'file');

  // Загрузка из файла не откатывает номер версии назад
  const before = S2.stamp().rev;
  S2.replaceAll({ dds: [{ id: 'q' }], rev: 1 });
  check('номер версии не откатывается назад', S2.stamp().rev > before,
    S2.stamp().rev + ' > ' + before, 'больше');
  S2.clear();
}

console.log('\n— Порядок смен: магазин вправе назвать их по-своему');
{
  const rows = [
    { id: 'a', type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'Вечер',
      openCash: 16000, zCash: 10000, zCashless: 0, payouts: 0, factCash: 26000 },
    { id: 'b', type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'Утро',
      openCash: 5000, zCash: 11000, zCashless: 0, payouts: 0, factCash: 16000 }
  ];
  const set = { shiftNames: 'Утро, Вечер' };
  check('смены выстроились в порядке из настроек',
    WM.shiftsOf(rows, null, set).map(r => r.shift).join('→') === 'Утро→Вечер',
    WM.shiftsOf(rows, null, set).map(r => r.shift).join('→'), 'Утро→Вечер');
  check('ЛОЖНОЙ ТРЕВОГИ ПРО РАЗМЕН БОЛЬШЕ НЕТ', WM.cashGaps(rows, set).length === 0,
    WM.cashGaps(rows, set).length, 0);

  // настоящий разрыв всё так же ловится
  const real = [rows[1], { id: 'c', type: 'Смена', date: '2026-09-01', till: 'Касса 1',
    shift: 'Вечер', openCash: 6000, zCash: 1, zCashless: 0, payouts: 0, factCash: 1 }];
  check('а настоящий разрыв ловится', WM.cashGaps(real, set).length === 1,
    WM.cashGaps(real, set).length, 1);
  check('стандартные «День, Ночь» работают без настроек',
    WM.cashGaps([{ id: 'x', type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'День',
      openCash: 5000, zCash: 11000, zCashless: 0, payouts: 0, factCash: 16000 },
      { id: 'y', type: 'Смена', date: '2026-09-01', till: 'Касса 1', shift: 'Ночь',
        openCash: 16000, zCash: 10000, zCashless: 0, payouts: 0, factCash: 26000 }]).length === 0,
    'тревог нет', 0);
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

console.log('\n— Разряды прямо в поле ввода');
{
  const g = NUM.groupInput;
  const _ = s => String(s).replace(/\u00A0/g, '_');
  check('тысячи отделяются, пока печатаешь', _(g('168000')) === '168_000', _(g('168000')), '168_000');
  check('миллионы тоже', _(g('1234567')) === '1_234_567', _(g('1234567')), '1_234_567');
  check('ноль остаётся нулём', g('0') === '0', g('0'), '0');
  check('лишние нули спереди убираются', g('007') === '7', g('007'), '7');
  check('копейки сохраняются', g('12,5') === '12,5', g('12,5'), '12,5');
  check('точку принимаем как запятую', g('12.5') === '12,5', g('12.5'), '12,5');
  check('третий знак после запятой отбрасывается — рублей таких нет',
    g('12,567') === '12,56', g('12,567'), '12,56');
  check('минус не теряется', _(g('-5000')) === '-5_000', _(g('-5000')), '-5_000');
  check('ВЫРАЖЕНИЕ НЕ РАЗБИВАЕТСЯ НА РАЗРЯДЫ',
    g('1250*3+400') === '1250*3+400', g('1250*3+400'), '1250*3+400');
  check('и если разряды уже стояли — они уходят',
    g('1\u00A0250*3+400') === '1250*3+400', g('1\u00A0250*3+400'), '1250*3+400');
  check('повторный проход ничего не портит',
    _(g(g('168000'))) === '168_000', _(g(g('168000'))), '168_000');
  check('СУММА С РАЗРЯДАМИ СЧИТАЕТСЯ ПРАВИЛЬНО',
    NUM.calc('168\u00A0000') === 168000, NUM.calc('168\u00A0000'), 168000);
  check('и выражение с разрядами тоже',
    NUM.calc('1\u00A0250*3+400') === 4150, NUM.calc('1\u00A0250*3+400'), 4150);

  // Курсор не должен прыгать в конец: считаем цифры слева от него
  check('курсор считается по цифрам, а не по символам',
    NUM.digitsBefore('1\u00A0968\u00A0000', 3) === 2, NUM.digitsBefore('1\u00A0968\u00A0000', 3), 2);
  check('и возвращается на то же место',
    NUM.caretAfter('1\u00A0968\u00A0000', 2) === 3, NUM.caretAfter('1\u00A0968\u00A0000', 2), 3);
  check('в пустом поле курсор в начале', NUM.caretAfter('', 0) === 0, NUM.caretAfter('', 0), 0);
}

console.log('\n— Зарплата на стыке месяцев: у каждого свой график выдачи');
{
  const staff = [{ name: 'Аня', position: 'Продавец', rate: 2500 },
    { name: 'Марат', position: 'Грузчик', salary: 40000, normShifts: 20 }];
  // Смена 31 августа, деньги получены 1 сентября — обычное дело при ежедневной выдаче
  const ts = [{ date: '2026-08-31', employee: 'Аня', shift: 'День', hoursDay: 12 },
    { date: '2026-09-10', employee: 'Аня', shift: 'День', hoursDay: 12 }];
  const po = [{ date: '2026-09-01', employee: 'Аня', amount: 2500 }];
  const мес = (m) => WM.payrollSummary(
    ts.filter(r => r.date.slice(0, 7) === m), po.filter(r => r.date.slice(0, 7) === m),
    staff, {}, {});
  const авг = мес('2026-08').find(r => r.employee === 'Аня') || {};
  const сен = мес('2026-09').find(r => r.employee === 'Аня') || {};

  // Так это выглядит по месяцам — и так оно и должно выглядеть: месяц про месяц
  check('за август видно начисление', авг.accrued === 30000, авг.accrued, 30000);
  check('за сентябрь видно выданное', сен.paid === 2500, сен.paid, 2500);

  // А долг человеку месяцами не считают: складываем всё начисленное и всё выданное
  const всёНачислено = ['2026-08', '2026-09']
    .reduce((s, m) => s + (мес(m).find(r => r.employee === 'Аня') || {}).accrued, 0);
  const всёВыдано = po.reduce((s, r) => s + r.amount, 0);
  const долг = всёНачислено - всёВыдано;
  check('ДОЛГ ПЕРЕД ЧЕЛОВЕКОМ СЧИТАЕТСЯ НАКОПИТЕЛЬНО', долг === 57500, долг, 57500);
  check('и месяц его не запирает', долг > 0 && долг !== сен.left, долг + ' вместо ' + сен.left, 57500);

  // Оклад начисляется за каждый месяц отдельно, а не один раз за всё время
  const ts2 = [];
  for (let d = 1; d <= 20; d++) {
    ts2.push({ date: '2026-08-' + String(d).padStart(2, '0'), employee: 'Марат', shift: 'День', hoursDay: 8 });
    ts2.push({ date: '2026-09-' + String(d).padStart(2, '0'), employee: 'Марат', shift: 'День', hoursDay: 8 });
  }
  const за2мес = ['2026-08', '2026-09'].reduce((s, m) => s + (WM.payrollSummary(
    ts2.filter(r => r.date.slice(0, 7) === m), [], staff, {}, {})
    .find(r => r.employee === 'Марат') || {}).accrued, 0);
  check('ОКЛАД НАЧИСЛЯЕТСЯ ЗА КАЖДЫЙ МЕСЯЦ', за2мес === 80000, за2мес, 80000);
  const однойкучей = (WM.payrollSummary(ts2, [], staff, {}, {})
    .find(r => r.employee === 'Марат') || {}).accrued;
  check('одной кучей оклад посчитался бы один раз — поэтому так не считаем',
    однойкучей === 40000, однойкучей, 40000);
}

console.log('\n— Ящик меняется только сверкой смены — в обе стороны');
{
  const accs = [
    { id: 'till', name: 'Касса', kind: 'till', opening: 1000, defaultCash: true },
    { id: 'safe', name: 'Сейф', kind: 'cash', opening: 50000 },
    { id: 'bank', name: 'Счёт', kind: 'bank', opening: 0, defaultCashless: true }];
  // Размен 1000, наличных 10 000, вынули 3000 → должно остаться 8000, столько и насчитали
  const shift = { type: WM.T_SHIFT, date: '2026-09-01', account: 'till',
    cashlessAccount: 'bank', openCash: 1000, zCash: 10000, zCashless: 0,
    payouts: 3000, factCash: 8000 };
  const till = rows => WM.accountBalances(rows, accs).rows.filter(a => a.id === 'till')[0].balance;
  const safe = rows => WM.accountBalances(rows, accs).rows.filter(a => a.id === 'safe')[0].balance;

  check('после смены в ящике столько, сколько насчитал кассир', till([shift]) === 8000,
    till([shift]), 8000);

  // Владелец привёз размен из сейфа в кассу — кассир его вечером уже пересчитал
  const принёс = [{ type: WM.T_MOVE, date: '2026-09-01', amount: 5000,
    account: 'safe', toAccount: 'till' }, shift];
  check('ПРИВЕЗЁННЫЙ РАЗМЕН В ЯЩИКЕ НЕ ЗАДВАИВАЕТСЯ', till(принёс) === 8000, till(принёс), 8000);
  check('но из сейфа он ушёл', safe(принёс) === 45000, safe(принёс), 45000);

  // Инкассация из ящика в сейф — ящик тоже не трогает
  const увёз = [shift, { type: WM.T_MOVE, date: '2026-09-01', amount: 5000,
    account: 'till', toAccount: 'safe' }];
  check('ИНКАССАЦИЯ ИЗ ЯЩИКА ЕГО НЕ УМЕНЬШАЕТ', till(увёз) === 8000, till(увёз), 8000);
  check('и легла в сейф', safe(увёз) === 55000, safe(увёз), 55000);

  // Приход наличными, записанный на кассу, — та же история
  const приход = [shift, { type: WM.T_IN, date: '2026-09-01', category: 'Прочий приход',
    method: 'Наличные', account: 'till', amount: 2000 }];
  check('ПРИХОД НА КАССУ ЯЩИК НЕ РАЗДУВАЕТ', till(приход) === 8000, till(приход), 8000);

  // Расход и забор из ящика — тоже только объяснение
  const трата = [shift, { type: WM.T_OUT, date: '2026-09-01', category: 'Аренда',
    method: 'Наличные', account: 'till', amount: 2000 }];
  check('расход из ящика его не уменьшает', till(трата) === 8000, till(трата), 8000);
}

console.log('\n— Вставка справочника из таблицы');
{
  const st = {}, se = { finPositions: 'Продавец, Уборщица' };
  const r1 = DIC.addMany(st, se, 'positions', 'Продавец\nТовароведНЕТ');
  check('вставка из одного столбца добавляет новое',
    se.finPositions.indexOf('ТовароведНЕТ') >= 0, se.finPositions, 'есть ТовароведНЕТ');
  check('уже заведённое второй раз не добавляется',
    (se.finPositions.match(/Продавец/g) || []).length === 1, r1.ok, 'Продавец один раз');

  const se2 = { finPositions: '' };
  DIC.addMany(st, se2, 'positions', 'Кассир\tсменный\t100\nПекарь\tночь\t200');
  check('из нескольких столбцов берётся первый',
    se2.finPositions === 'Кассир, Пекарь', se2.finPositions, 'Кассир, Пекарь');

  const se3 = { finCategories: '' };
  DIC.addMany(st, se3, 'categories', 'Аренда; Свет, Вода');
  check('строка с запятыми — тоже список',
    se3.finCategories === 'Аренда, Свет, Вода', se3.finCategories, 'Аренда, Свет, Вода');

  const se4 = { finPositions: '' };
  const bad = DIC.addMany(st, se4, 'positions', '   ');
  check('пустую вставку программа объясняет словами',
    !!bad.error, bad.error || 'ошибки нет', 'есть объяснение');

  const se5 = { finPositions: '' };
  DIC.addMany(st, se5, 'positions', 'Повар\n' + 'я'.repeat(80));
  check('слишком длинное название не попадает в справочник',
    se5.finPositions === 'Повар', se5.finPositions, 'Повар');
}

console.log('\n— Владелец взял себе: с какого счёта');
{
  const accs = [
    { id: 'a1', name: 'Касса', kind: 'till', opening: 0, defaultCash: true },
    { id: 'a2', name: 'Сейф', kind: 'cash', opening: 0 },
    { id: 'a3', name: 'Счёт', kind: 'bank', opening: 0, defaultCashless: true }];
  const rows = [
    { type: WM.T_SHIFT, date: '2026-09-01', openCash: 0, zCash: 30000, zCashless: 12000,
      payouts: 25000, factCash: 5000, account: 'a1', cashlessAccount: 'a3' },
    { type: WM.T_MOVE, date: '2026-09-01', amount: 20000, account: 'a1', toAccount: 'a2' },
    { type: WM.T_DRAW, date: '2026-09-02', amount: 8000, account: 'a2' },
    { type: WM.T_DRAW, date: '2026-09-02', amount: 3000, account: 'a3' }];
  const b = WM.accountBalances(rows, accs);
  const by = {}; b.rows.forEach(r => { by[r.id] = r.balance; });
  check('забор из сейфа уменьшил сейф', by.a2 === 12000, by.a2, 12000);
  check('забор со счёта уменьшил счёт', by.a3 === 9000, by.a3, 9000);
  check('ЗАБОР ЯЩИК ВТОРОЙ РАЗ НЕ ТРОНУЛ', by.a1 === 5000, by.a1, 5000);

  const rows2 = rows.concat([{ type: WM.T_DRAW, date: '2026-09-03', amount: 1000, account: 'a1' }]);
  const b2 = WM.accountBalances(rows2, accs);
  check('забор из ящика объясняет выплату, а не вычитает её',
    b2.rows.filter(r => r.id === 'a1')[0].balance === 5000,
    b2.rows.filter(r => r.id === 'a1')[0].balance, 5000);
  const p = WM.pnl({ rows: rows2, ym: '2026-09' });
  check('ЗАБОР ВЛАДЕЛЬЦА В ЗАТРАТЫ НЕ ПОПАЛ', p.costTotal === 0, p.costTotal, 0);
  check('забор показан отдельной строкой', p.draw === 12000, p.draw, 12000);
}

console.log('\n— Подстатьи: «Коммунальные → Свет»');
{
  check('группа отрезается по черте', WM.catGroup('Коммунальные / Свет') === 'Коммунальные',
    WM.catGroup('Коммунальные / Свет'), 'Коммунальные');
  check('подстатья читается после черты', WM.catLeaf('Коммунальные / Свет') === 'Свет',
    WM.catLeaf('Коммунальные / Свет'), 'Свет');
  check('статья без черты — сама себе группа', WM.catGroup('Аренда') === 'Аренда',
    WM.catGroup('Аренда'), 'Аренда');
  check('у статьи без черты подстатьи нет', WM.catLeaf('Аренда') === '',
    '«' + WM.catLeaf('Аренда') + '»', 'пусто');
  check('человеку показываем стрелкой', WM.catLabel('Коммунальные / Свет') === 'Коммунальные → Свет',
    WM.catLabel('Коммунальные / Свет'), 'Коммунальные → Свет');
  check('лишние пробелы вокруг черты не мешают',
    WM.catGroup('Коммунальные/Свет') === 'Коммунальные' && WM.catLeaf('Коммунальные/Свет') === 'Свет',
    WM.catGroup('Коммунальные/Свет') + '|' + WM.catLeaf('Коммунальные/Свет'), 'Коммунальные|Свет');
  check('собрать обратно — та же строка',
    WM.catGroup(WM.catJoin('Коммунальные', 'Свет')) === 'Коммунальные' &&
    WM.catLeaf(WM.catJoin('Коммунальные', 'Свет')) === 'Свет',
    WM.catJoin('Коммунальные', 'Свет'), 'Коммунальные / Свет');
  check('без подстатьи черта не добавляется', WM.catJoin('Аренда', '') === 'Аренда',
    WM.catJoin('Аренда', ''), 'Аренда');

  const tree = WM.catTree({ 'Коммунальные / Свет': 5000, 'Коммунальные / Вода': 2000,
    'Аренда': 110000 });
  const comm = tree.filter(g => g.name === 'Коммунальные')[0];
  check('подстатьи складываются в группу', comm.sum === 7000, comm.sum, 7000);
  check('внутри группы обе подстатьи', comm.kids.length === 2, comm.kids.length, 2);
  check('крупная подстатья сверху', comm.kids[0].name === 'Свет', comm.kids[0].name, 'Свет');
  check('группы идут от крупной к мелкой', tree[0].name === 'Аренда', tree[0].name, 'Аренда');
  check('у одиночной статьи подстатей нет',
    tree.filter(g => g.name === 'Аренда')[0].kids.length === 0, 0, 0);
  check('сумма дерева равна сумме всех статей',
    tree.reduce((s, g) => s + g.sum, 0) === 117000,
    tree.reduce((s, g) => s + g.sum, 0), 117000);
}

console.log('\n— Подстатьи попадают в ту же группу затрат, что и родитель');
{
  const rows = [
    { type: WM.T_SHIFT, date: '2026-09-01', openCash: 0, zCash: 200000, payouts: 0, factCash: 200000 },
    { type: WM.T_OUT, date: '2026-09-02', amount: 5000, category: 'Коммунальные / Свет' },
    { type: WM.T_OUT, date: '2026-09-03', amount: 2000, category: 'Коммунальные' }];
  const p = WM.pnl({ rows: rows, ym: '2026-09' });
  const kinds = p.byKind || {};
  check('подстатья не уехала в «прочее»',
    WM.costKindOf(WM.catGroup('Коммунальные / Свет')) === WM.costKindOf('Коммунальные'),
    WM.costKindOf(WM.catGroup('Коммунальные / Свет')), WM.costKindOf('Коммунальные'));
  check('обе записи попали в затраты', p.costTotal === 7000, p.costTotal, 7000);
}

console.log('\n— Бюджеты: потолок траты по статье');
{
  const rows = [
    { type: WM.T_OUT, date: '2026-09-02', amount: 5000, category: 'Коммунальные / Свет' },
    { type: WM.T_OUT, date: '2026-09-03', amount: 2000, category: 'Коммунальные / Вода' },
    { type: WM.T_OUT, date: '2026-09-04', amount: 3000, category: 'Обеды' },
    { type: WM.T_OUT, date: '2026-08-30', amount: 9000, category: 'Обеды' },
    { type: WM.T_OUT, date: '2026-09-05', amount: 400000, category: 'Закуп товара' }];
  const budgets = [
    { id: 'b1', category: 'Коммунальные', limit: 6000 },
    { id: 'b2', category: 'Обеды', limit: 10000 },
    { id: 'b3', category: 'Закуп товара', limit: 1000 }];
  const b = WM.budgetTotals(budgets, rows, '2026-09');
  const by = {}; b.rows.forEach(r => { by[r.id] = r; });

  check('БЮДЖЕТ НА ГРУППУ СЧИТАЕТ И ПОДСТАТЬИ', by.b1.spent === 7000, by.b1.spent, 7000);
  check('перебор виден в рублях', by.b1.over === 1000, by.b1.over, 1000);
  check('перебор — это минус в остатке', by.b1.left === -1000, by.b1.left, -1000);
  check('ЧУЖОЙ МЕСЯЦ В БЮДЖЕТ НЕ ЛЕЗЕТ', by.b2.spent === 3000, by.b2.spent, 3000);
  check('пока в рамках — перебора нет', by.b2.over === 0 && by.b2.left === 7000, by.b2.left, 7000);
  check('процент потраченного считается', by.b2.pct === 30, by.b2.pct, 30);
  check('ЗАКУП ТРАТОЙ НЕ СЧИТАЕТСЯ', by.b3.spent === 0, by.b3.spent, 0);
  check('самый горячий бюджет сверху', b.rows[0].id === 'b1', b.rows[0].id, 'b1');
  check('в итогах виден общий потолок', b.totals.limit === 17000, b.totals.limit, 17000);
  check('в итогах видно, сколько бюджетов пробито', b.totals.overCount === 1,
    b.totals.overCount, 1);
  check('в итогах видна общая сумма перебора', b.totals.over === 1000, b.totals.over, 1000);
  check('бюджет на подстатью считает только её',
    WM.budgetTotals([{ id: 'x', category: 'Коммунальные / Свет', limit: 9000 }], rows, '2026-09')
      .rows[0].spent === 5000, 5000, 5000);
  check('бюджет без статьи пропускается',
    WM.budgetTotals([{ id: 'y', category: '', limit: 100 }], rows, '2026-09').rows.length === 0,
    0, 0);
  check('бюджеты и конверты не путаются: бюджет денег не двигает',
    WM.fundTotals([], rows, null, '2026-09').totals.left === 0, 0, 0);
  const noYm = WM.budgetTotals(budgets, rows, null);
  check('без месяца бюджет считает всё подряд',
    noYm.rows.filter(r => r.id === 'b2')[0].spent === 12000,
    noYm.rows.filter(r => r.id === 'b2')[0].spent, 12000);
}

console.log('\n— Конверт и бюджет — разные вещи');
{
  const funds = [{ id: 'f1', name: 'Аренда', plan: 110000 }];
  const rows = [
    { type: WM.T_MOVE, date: '2026-09-01', amount: 110000, fund: 'f1' },
    { type: WM.T_OUT, date: '2026-09-10', amount: 110000, category: 'Аренда', fund: 'f1' }];
  const f = WM.fundTotals(funds, rows, null, '2026-09');
  const r = f.rows[0];
  check('отложили и потратили — в конверте ноль', r.left === 0, r.left, 0);
  check('план месяца выполнен', r.putThisMonth === 110000 && r.toPut === 0, r.toPut, 0);
  const b = WM.budgetTotals([{ id: 'b1', category: 'Аренда', limit: 110000 }], rows, '2026-09');
  check('та же трата видна и в бюджете', b.rows[0].spent === 110000, b.rows[0].spent, 110000);
  check('ПЕРЕВОД В КОНВЕРТ ТРАТОЙ НЕ СЧИТАЕТСЯ',
    b.rows[0].spent === 110000 && b.rows[0].over === 0, b.rows[0].over, 0);
}

console.log('\n— Списания: причины и суммы');
{
  const rows = [
    { name: 'Молоко', reason: 'Просрочка', qty: 2, cost: 300, retail: 400 },
    { name: 'Хлеб', reason: 'Просрочка', qty: 5, cost: 200, retail: 250 },
    { name: 'Специи', reason: 'Списание специй на нужды производства', qty: 1, cost: 5880 }];
  const by = WM.byReason(rows);
  check('у свода по причинам поле называется reason, а не name',
    by[0].reason !== undefined && by[0].name === undefined,
    'reason: ' + by[0].reason, 'reason заполнен, name нет');
  check('САМАЯ ДОРОГАЯ ПРИЧИНА СВЕРХУ',
    by[0].reason === 'Списание специй на нужды производства', by[0].reason, 'специи');
  check('одинаковые причины складываются в одну строку',
    by.filter(r => r.reason === 'Просрочка')[0].cost === 500,
    by.filter(r => r.reason === 'Просрочка')[0].cost, 500);
  check('разных причин ровно две', by.length === 2, by.length, 2);
  check('доли причин дают сто процентов',
    Math.round(by.reduce((s, r) => s + r.share, 0)) === 100,
    Math.round(by.reduce((s, r) => s + r.share, 0)), 100);
  check('пустая причина не теряется, а подписана',
    WM.byReason([{ name: 'Что-то', cost: 100 }])[0].reason === 'Без причины',
    WM.byReason([{ name: 'Что-то', cost: 100 }])[0].reason, 'Без причины');
}

console.log('\n— Списания за произвольный период');
{
  // Выгрузка «Списания» со столбцом «Дата»: даты настоящие, по строкам
  const сДатами = [
    { name: 'Молоко', reason: 'Просрочка', cost: 300, date: '2026-09-02' },
    { name: 'Хлеб', reason: 'Просрочка', cost: 200, date: '2026-09-20' },
    { name: 'Сыр', reason: 'Бой', cost: 900, date: '2026-10-05' }];

  const пол = WM.rowsInRange(сДатами, '2026-09-01', '2026-09-15');
  check('в период попало только то, что в него попадает', пол.rows.length === 1,
    пол.rows.length, 1);
  check('и это нужная строка', пол.rows[0].name === 'Молоко', пол.rows[0].name, 'Молоко');
  check('ПО НАСТОЯЩИМ ДАТАМ ОТБОР ТОЧНЫЙ, БЕЗ ОГОВОРОК', пол.rough === 0, пол.rough, 0);

  check('границы периода включаются',
    WM.rowsInRange(сДатами, '2026-09-02', '2026-09-20').rows.length === 2,
    WM.rowsInRange(сДатами, '2026-09-02', '2026-09-20').rows.length, 2);
  check('пустой период — это «всё»',
    WM.rowsInRange(сДатами, '', '').rows.length === 3,
    WM.rowsInRange(сДатами, '', '').rows.length, 3);
  check('только «с» — значит с этой даты и до конца',
    WM.rowsInRange(сДатами, '2026-10-01', '').rows.length === 1,
    WM.rowsInRange(сДатами, '2026-10-01', '').rows.length, 1);
  check('перепутанные местами даты не ломают отбор',
    WM.rowsInRange(сДатами, '2026-09-15', '2026-09-01').rows.length === 1,
    WM.rowsInRange(сДатами, '2026-09-15', '2026-09-01').rows.length, 1);
  check('за пустые дни — пусто, а не всё подряд',
    WM.rowsInRange(сДатами, '2026-01-01', '2026-01-31').rows.length === 0,
    WM.rowsInRange(сДатами, '2026-01-01', '2026-01-31').rows.length, 0);

  // Выгрузка 1С «Причины списания»: дат по строкам нет, есть только период
  const периодом = [
    { name: 'Специи', reason: 'Производство', cost: 5880,
      from: '2026-09-01', to: '2026-09-30', date: '2026-09-30' },
    { name: 'Крупа', reason: 'Производство', cost: 1000,
      from: '2026-10-01', to: '2026-10-31', date: '2026-10-31' }];

  const сент = WM.rowsInRange(периодом, '2026-09-01', '2026-09-30');
  check('период выгрузки совпал с выбранным — берём его', сент.rows.length === 1,
    сент.rows.length, 1);
  check('и оговорки не нужно: рамки сошлись', сент.rough === 0, сент.rough, 0);

  const половина = WM.rowsInRange(периодом, '2026-09-01', '2026-09-15');
  check('ПЕРИОД ВЫГРУЗКИ НЕ РЕЖЕМ ПОПОЛАМ — ДНЕЙ В НЁМ НЕТ',
    половина.rows.length === 1, половина.rows.length, 1);
  check('НО ГОВОРИМ, ЧТО СЧИТАЛИ ПРИБЛИЗИТЕЛЬНО', половина.rough === 1,
    половина.rough, 1);
  check('и называем сумму, про которую оговорились', половина.roughSum === 5880,
    половина.roughSum, 5880);

  check('непересекающийся период не берём вовсе',
    WM.rowsInRange(периодом, '2026-11-01', '2026-11-30').rows.length === 0,
    WM.rowsInRange(периодом, '2026-11-01', '2026-11-30').rows.length, 0);

  // Строка вообще без даты: спрятать её — значит потерять деньги молча
  const безДаты = [{ name: 'Неизвестно', reason: 'Бой', cost: 700 }];
  const бд = WM.rowsInRange(безДаты, '2026-09-01', '2026-09-30');
  check('СТРОКА БЕЗ ДАТЫ НЕ ПРОПАДАЕТ ИЗ ИТОГА', бд.rows.length === 1, бд.rows.length, 1);
  check('но и она отмечена как приблизительная',
    бд.rough === 1 && бд.roughSum === 700, бд.roughSum, 700);

  // Сумма за «всё» обязана равняться сумме за все куски
  const всё = сДатами.concat(периодом);
  const сумма = x => x.rows.reduce((s, r) => s + r.cost, 0);
  check('СУММА ЗА ВЕСЬ ПЕРИОД = СУММЕ ЗА ЕГО ЧАСТИ',
    сумма(WM.rowsInRange(всё, '', '')) ===
      сумма(WM.rowsInRange(всё, '', '2026-09-30')) +
      сумма(WM.rowsInRange(всё, '2026-10-01', '')),
    сумма(WM.rowsInRange(всё, '', '')),
    сумма(WM.rowsInRange(всё, '', '2026-09-30')) + сумма(WM.rowsInRange(всё, '2026-10-01', '')));
}

console.log('\n— Умный поиск: как в браузере');
{
  const найдётся = (q, текст, числа) => FLT.matches(FLT.parseQuery(q), текст, числа);

  check('СЛОВА МОЖНО ПИСАТЬ КУСКАМИ И В ЛЮБОМ ПОРЯДКЕ',
    найдётся('моло 3.2', 'Молоко 3.2% Простоквашино') &&
    найдётся('3.2 моло', 'Молоко 3.2% Простоквашино'), 'находит', 'находит');
  check('а лишнее не находит', !найдётся('моло 3.2', 'Молоко 2.5%'), 'не находит', 'не находит');
  check('регистр не мешает', найдётся('МОЛОКО', 'молоко'), 'находит', 'находит');
  check('ё и е — одна буква',
    найдётся('счет', 'Счёт') && найдётся('счёт', 'Счет'), 'находит', 'находит');

  check('МИНУС УБИРАЕТ НЕНУЖНОЕ',
    !найдётся('молоко -козье', 'Молоко козье') &&
    найдётся('молоко -козье', 'Молоко коровье'), 'убирает', 'убирает');
  check('кавычки ищут фразу целиком',
    найдётся('"молоко 3.2"', 'Молоко 3.2%') &&
    !найдётся('"молоко 3.2"', 'Молоко жирность 3.2'), 'фразой', 'фразой');

  check('БОЛЬШЕ И МЕНЬШЕ ИЩУТ ПО ЧИСЛАМ',
    найдётся('>1000', 'Сыр', [1500]) && !найдётся('>1000', 'Сыр', [500]),
    'по числам', 'по числам');
  check('меньше тоже', найдётся('<10', 'Сыр', [5]) && !найдётся('<10', 'Сыр', [50]),
    'работает', 'работает');
  check('и «ровно столько»', найдётся('=0', 'Сыр', [0]) && !найдётся('=0', 'Сыр', [1]),
    'работает', 'работает');
  check('больше-или-равно не путается с больше',
    найдётся('>=10', 'Сыр', [10]) && !найдётся('>10', 'Сыр', [10]), 'не путается', 'не путается');
  check('число сравнивается с ЛЮБЫМ числом строки',
    найдётся('>1000', 'Сыр', [5, 1500, 2]), 'находит', 'находит');
  check('слово и число вместе',
    найдётся('сыр >1000', 'Сыр российский', [1500]) &&
    !найдётся('сыр >1000', 'Сыр российский', [500]), 'вместе', 'вместе');
  check('ЭКРАН НЕ ДАЛ ЧИСЕЛ — ЧИСЛОВОЙ КУСОК НИКОГО НЕ ОТСЕИВАЕТ',
    найдётся('>1000', 'Сыр'), 'не отсеивает', 'не отсеивает');
  check('минус перед числом — это минус, а не «убрать»',
    найдётся('=-5', 'Долг', [-5]), 'понял', 'понял');

  check('пустой запрос находит всё', найдётся('', 'что угодно'), 'находит', 'находит');
  check('пробелы вокруг не мешают', найдётся('  молоко  ', 'Молоко'), 'находит', 'находит');
}

console.log('\n— Подсветка найденного');
{
  check('найденное обёрнуто в подсветку',
    FLT.highlight('Молоко 3.2%', 'моло') === '<mark>Моло</mark>ко 3.2%',
    FLT.highlight('Молоко 3.2%', 'моло'), '<mark>Моло</mark>ко 3.2%');
  check('подсвечиваются оба слова',
    (FLT.highlight('Молоко Простоквашино', 'моло прост').match(/<mark>/g) || []).length === 2,
    FLT.highlight('Молоко Простоквашино', 'моло прост'), 'две подсветки');
  check('ВРЕДНЫЙ КОД В НАЗВАНИИ ОСТАЁТСЯ ТЕКСТОМ',
    FLT.highlight('<script>alert(1)</script>', 'alert').indexOf('<script>') < 0,
    FLT.highlight('<script>alert(1)</script>', 'alert').slice(0, 30), 'без тегов');
  check('и подсветка внутри него всё равно работает',
    FLT.highlight('<b>молоко</b>', 'молоко').indexOf('<mark>') >= 0, 'работает', 'работает');
  check('пустой запрос ничего не подсвечивает',
    FLT.highlight('Молоко', '').indexOf('<mark>') < 0, 'не подсвечивает', 'не подсвечивает');
  check('минус-слово не подсвечивается',
    FLT.highlight('Молоко козье', '-козье').indexOf('<mark>') < 0,
    'не подсвечивает', 'не подсвечивает');
  check('одна буква не подсвечивается — иначе рябит весь экран',
    FLT.highlight('Молоко', 'м').indexOf('<mark>') < 0, 'не подсвечивает', 'не подсвечивает');
}

console.log('\n— Выгрузки копятся по периодам, а не затирают друг друга');
{
  const сент = { from: '01.09.2026', to: '30.09.2026' };
  const окт = { from: '01.10.2026', to: '31.10.2026' };
  const ключ = x => x.key;

  let r = WM.syncByPeriod([], [{ name: 'Молоко', key: 'молоко', revenue: 100 }], сент, ключ);
  r = WM.syncByPeriod(r.rows, [{ name: 'Молоко', key: 'молоко', revenue: 200 }], окт, ключ);
  check('ЗАГРУЗКА ОКТЯБРЯ НЕ СТЁРЛА СЕНТЯБРЬ', r.rows.length === 2, r.rows.length, 2);
  check('у каждой строки свой период',
    r.rows.filter(x => x.from === '2026-09-01').length === 1 &&
    r.rows.filter(x => x.from === '2026-10-01').length === 1, 'по своему', 'по своему');

  const снова = WM.syncByPeriod(r.rows, [{ name: 'Молоко', key: 'молоко', revenue: 250 }], окт, ключ);
  check('ПОВТОРНАЯ ЗАГРУЗКА ТОГО ЖЕ МЕСЯЦА НЕ ДВОИТ', снова.rows.length === 2,
    снова.rows.length, 2);
  check('и обновляет цифру, а не добавляет вторую',
    снова.rows.filter(x => x.from === '2026-10-01')[0].revenue === 250,
    снова.rows.filter(x => x.from === '2026-10-01')[0].revenue, 250);
  check('сентябрь при этом цел',
    снова.rows.filter(x => x.from === '2026-09-01')[0].revenue === 100, 100, 100);
  check('программа считает, что обновила, а что добавила',
    снова.stats.updated === 1 && снова.stats.added === 0, снова.stats.updated, 1);

  const пропал = WM.syncByPeriod(r.rows, [], окт, ключ);
  check('пропавшее из файла уходит из своего периода',
    пропал.rows.length === 1 && пропал.stats.removed === 1, пропал.rows.length, 1);
  check('НО ЧУЖОЙ ПЕРИОД ПРИ ЭТОМ НЕ ТРОГАЕТСЯ',
    пропал.rows[0].from === '2026-09-01', пропал.rows[0].from, '2026-09-01');

  const периоды = WM.periodsOf(r.rows);
  check('программа знает, какие периоды загружены', периоды.length === 2, периоды.length, 2);
  check('и перечисляет их по порядку',
    периоды[0].from === '2026-09-01' && периоды[1].from === '2026-10-01',
    периоды.map(p => p.from).join(', '), 'сентябрь, октябрь');
  const охват = WM.coverOf(r.rows);
  check('охват — от самой ранней даты до самой поздней',
    охват.from === '2026-09-01' && охват.to === '2026-10-31',
    охват.from + ' – ' + охват.to, '2026-09-01 – 2026-10-31');

  // Главное: сумма за оба месяца равна сумме по месяцам
  const сум = list => list.reduce((s, x) => s + x.revenue, 0);
  check('СУММА ЗА ВСЁ = СУММЕ ПО МЕСЯЦАМ',
    сум(r.rows) === сум(WM.rowsInRange(r.rows, '', '2026-09-30').rows) +
      сум(WM.rowsInRange(r.rows, '2026-10-01', '').rows),
    сум(r.rows), 300);
}

console.log('\n— Дата снимка у остатков и цен');
{
  const лист = [['Остатки номенклатуры'], ['на 15.09.2026'], ['Товар', 'Количество']];
  check('дату снимка берём из файла', WM.parseAsOf(лист) === '2026-09-15',
    WM.parseAsOf(лист), '2026-09-15');
  check('у отчёта за период берём конец периода',
    WM.parseAsOf([['Продажи за 01.09.2026 - 30.09.2026']]) === '2026-09-30',
    WM.parseAsOf([['Продажи за 01.09.2026 - 30.09.2026']]), '2026-09-30');
  check('НЕТ ДАТЫ — НЕ ВЫДУМЫВАЕМ',
    WM.parseAsOf([['Остатки'], ['Товар', 'Количество']]) === '',
    '«' + WM.parseAsOf([['Остатки'], ['Товар', 'Количество']]) + '»', 'пусто');
}

console.log('\n— Один товар из двух выгрузок = одна строка');
{
  const с = { periodKey: 'с', from: '2026-09-01', to: '2026-09-30', date: '2026-09-30' };
  const о = { periodKey: 'о', from: '2026-10-01', to: '2026-10-31', date: '2026-10-31' };
  const прод = (n, qty, rev, cogs, p) => Object.assign(
    { name: n, key: WM.norm(n), qty, revenue: rev, cogs, sellPrice: rev / qty, abc: 'A' }, p);

  const m = WM.mergeSales([
    прод('Молоко', 10, 50000, 40000, с),
    прод('Молоко', 20, 60000, 45000, о),
    прод('Сыр', 5, 30000, 28000, с)]);

  check('ОДИН ТОВАР — ОДНА СТРОКА', m.length === 2, m.length, 2);
  const мол = m.filter(r => r.name === 'Молоко')[0];
  check('количество сложилось', мол.qty === 30, мол.qty, 30);
  check('ВЫРУЧКА СЛОЖИЛАСЬ', мол.revenue === 110000, мол.revenue, 110000);
  check('себестоимость сложилась', мол.cogs === 85000, мол.cogs, 85000);
  check('прибыль пересчитана, а не сложена из кусков',
    мол.profit === 25000, мол.profit, 25000);
  check('ЦЕНА НЕ СЛОЖИЛАСЬ, А ПЕРЕСЧИТАНА ИЗ СУММ',
    мол.sellPrice === WM.safeRound(110000 / 30), мол.sellPrice, WM.safeRound(110000 / 30));
  check('класс ABC от 1С у склеенной строки снят: он был про другой период',
    мол.abc === '', '«' + мол.abc + '»', 'пусто');
  check('программа помнит, из скольких выгрузок склеено',
    мол.partsCount === 2, мол.partsCount, 2);
  check('период склеенной строки — самый широкий',
    мол.from === '2026-09-01' && мол.to === '2026-10-31',
    мол.from + ' – ' + мол.to, '2026-09-01 – 2026-10-31');

  const сыр = m.filter(r => r.name === 'Сыр')[0];
  check('строку из одной выгрузки не трогаем',
    сыр.qty === 5 && сыр.partsCount === 1 && сыр.abc === 'A', сыр.abc, 'A');

  // Главное: склейка не создаёт и не теряет денег
  const было = [50000, 60000, 30000].reduce((a, b) => a + b, 0);
  check('СКЛЕЙКА НЕ СОЗДАЁТ И НЕ ТЕРЯЕТ ДЕНЕГ',
    m.reduce((a, r) => a + r.revenue, 0) === было,
    m.reduce((a, r) => a + r.revenue, 0), было);

  check('пустой список не ломает склейку', WM.mergeSales([]).length === 0, 0, 0);
  check('склейка по любому полю работает так же',
    WM.mergeByKey([{ k: 'a', v: 1 }, { k: 'a', v: 2 }, { k: 'b', v: 5 }],
      r => r.k, ['v']).length === 2, 2, 2);
}

console.log('\n— Настоящий Z-отчёт магазина: касса наличная (смена 1254)');
{
  /* Цифры переписаны с чека владельца от 14.09.26, слово в слово:
       ЧЕКОВ ПРИХОДА 0391        = 138 194,00   наличными 138 194,00
       ЧЕКОВ ВОЗВРАТОВ ПРИХОДА 0002 =    690,00 наличными    690,00
       ВНЕСЕНИЙ 0001             =  10 000,00
       ВЫПЛАТ  0011              =  57 180,00
       ИНКАССАЦИЯ                =  90 324,00
       ВЫРУЧКА                   = 137 504,00
     Ящик после инкассации вышел в ноль — так смену и сдали.  */
  const c = WM.shiftCalc({
    openCash: 0, zCash: 138194, returnsCash: 690, deposits: 10000,
    payouts: 57180, collected: 90324, factCash: 0, checks: 391, voided: 3 });

  check('ВЫРУЧКА СОШЛАСЬ С ЧЕКОМ ДО РУБЛЯ', c.revenueCash === 137504, c.revenueCash, 137504);
  check('и это приход минус возвраты, а не голый приход',
    c.revenueCash === 138194 - 690, c.revenueCash, 137504);
  check('ДОЛЖНО БЫТЬ В ЯЩИКЕ — НОЛЬ: всё увезли инкассацией',
    c.expected === 0, c.expected, 0);
  check('касса сошлась', c.ok && c.diff === 0, c.status, 'сходится');
  check('внесение легло в ящик, а выручкой не стало',
    c.revenueCash === 137504 && c.deposits === 10000, c.deposits, 10000);
  check('средний чек посчитан по выручке и числу чеков',
    c.avgCheck === WM.safeRound(137504 / 391), c.avgCheck, WM.safeRound(137504 / 391));
  check('аннулированные чеки записаны, но денег не двигают',
    c.voided === 3 && c.expected === 0, c.voided, 3);

  // Забыли переписать возвраты — касса не сойдётся ровно на них
  const без = WM.shiftCalc({ openCash: 0, zCash: 138194, deposits: 10000,
    payouts: 57180, collected: 90324, factCash: 0 });
  check('ЗАБЫЛИ ВОЗВРАТЫ — ПРОГРАММА ЭТО ВИДИТ',
    без.diff === -690, без.diff, -690);
  check('и называет это недостачей на ту же сумму',
    без.status === 'недостача' && без.short === 690, без.short, 690);

  // Забыли инкассацию — расхождение ровно на увезённое
  const безИнк = WM.shiftCalc({ openCash: 0, zCash: 138194, returnsCash: 690,
    deposits: 10000, payouts: 57180, factCash: 0 });
  check('ЗАБЫЛИ ИНКАССАЦИЮ — РАСХОЖДЕНИЕ РОВНО НА НЕЁ',
    безИнк.diff === -90324, безИнк.diff, -90324);
}

console.log('\n— Настоящий Z-отчёт: касса безналичная (смена 26) и терминал');
{
  /* Вторая касса магазина принимает только карты:
       СУММА ПРИХ. ВСЕГО      = 113 955,00
       СУММА ПРИХ. БЕЗНАЛИЧ.  = 113 955,00
       ЧЕКОВ ЗА СМЕНУ         = 303
     Отчёт терминала за тот же день:
       ОПЛАТА (карта) 161 оп. =  53 185,00
       ОПЛАТА ПО QR   123 оп. =  53 377,00
       BLUETOOTH       19 оп. =   7 393,00
       ИТОГО          303 оп. = 113 955,00                              */
  const c = WM.shiftCalc({ zCashless: 113955, zCard: 53185, zQr: 53377,
    zNfc: 7393, checks: 303 });

  check('РАЗБИВКА ТЕРМИНАЛА СОШЛАСЬ С Z-ОТЧЁТОМ', c.wayOk, c.byWay, 113955);
  check('и сумма способов та же, что на чеке', c.byWay === 113955, c.byWay, 113955);
  check('расхождения нет', c.wayDiff === 0, c.wayDiff, 0);
  check('безнал в ящик не попал', c.expected === 0, c.expected, 0);
  check('средний чек по 303 чекам', c.avgCheck === WM.safeRound(113955 / 303),
    c.avgCheck, WM.safeRound(113955 / 303));

  // Один платёж не долетел до кассы — программа обязана это поймать
  const кривой = WM.shiftCalc({ zCashless: 113955, zCard: 53185, zQr: 53377, zNfc: 5000 });
  check('ТЕРМИНАЛ И КАССА РАЗОШЛИСЬ — ПРОГРАММА НЕ МОЛЧИТ',
    !кривой.wayOk, кривой.wayDiff, -2393);
  check('и называет сумму расхождения', кривой.wayDiff === -2393, кривой.wayDiff, -2393);

  // Разбивку не заполнили — это не ошибка, а «не вводили»
  const пусто = WM.shiftCalc({ zCashless: 113955 });
  check('ПУСТАЯ РАЗБИВКА — НЕ РАСХОЖДЕНИЕ',
    пусто.wayOk && !пусто.wayFilled, пусто.wayFilled, false);
}

console.log('\n— Две кассы за день: наличная и безналичная вместе');
{
  const rows = [
    { type: WM.T_SHIFT, date: '2026-09-14', till: 'Касса 1', shift: 'День',
      openCash: 0, zCash: 138194, returnsCash: 690, deposits: 10000,
      payouts: 57180, collected: 90324, factCash: 0, checks: 391 },
    { type: WM.T_SHIFT, date: '2026-09-14', till: 'Касса 2', shift: 'День',
      zCashless: 113955, zCard: 53185, zQr: 53377, zNfc: 7393, checks: 303 }
  ];
  const t = WM.totals(rows);
  check('ВЫРУЧКА ЗА ДЕНЬ = 137 504 + 113 955',
    t.revenue === 137504 + 113955, t.revenue, 251459);
  check('возвраты вычтены из выручки, а не забыты', t.returns === 690, t.returns, 690);
  check('наличная и безналичная части не перемешались',
    t.zCash === 138194 && t.zCashless === 113955, t.zCash + '/' + t.zCashless,
    '138194/113955');
  check('чеков за день — сумма по обеим кассам', t.checks === 694, t.checks, 694);
  check('средний чек за день считается от выручки',
    t.avgCheck === WM.safeRound(251459 / 694), t.avgCheck, WM.safeRound(251459 / 694));
  check('по способам оплаты видно, где карта, а где QR',
    t.card === 53185 && t.qr === 53377 && t.nfc === 7393,
    t.card + '/' + t.qr + '/' + t.nfc, '53185/53377/7393');
  check('ВЫПЛАТЫ ИЗ ЯЩИКА СЧИТАЮТСЯ ТОЛЬКО ПО НАЛИЧНОЙ КАССЕ',
    t.payouts === 57180, t.payouts, 57180);
}

console.log('\n— Старые смены без новых полей считаются как раньше');
{
  const старая = WM.shiftCalc({ openCash: 5000, zCash: 40000, payouts: 10000, factCash: 35000 });
  check('формула свернулась в прежнюю: размен + Z-нал − выплаты',
    старая.expected === 35000, старая.expected, 35000);
  check('и расхождения не появилось на пустом месте',
    старая.ok && старая.diff === 0, старая.status, 'сходится');
  check('пустые новые поля — это нули, а не поломка',
    старая.returns === 0 && старая.deposits === 0 && старая.collected === 0,
    'нули', 'нули');
  check('и выручка прежняя', старая.revenue === 40000, старая.revenue, 40000);
}

console.log('\n— Разбор расхождения: какое число вписано неверно');
{
  /* Настоящая смена владельца, на которой он сказал «явно не правильно считает».
     Формула считает верно: 10 000 + 77 529 − 950 + 10 000 − 10 760 − 74 081
     = 11 738, а в ящике насчитали 67 969. Значит, ошибка не в формуле, а в
     одном из введённых чисел — программа обязана показать, в каком именно. */
  const c = WM.shiftCalc({
    openCash: 10000, zCash: 77529, returnsCash: 950, deposits: 10000,
    payouts: 10760, collected: 74081, factCash: 67969,
    zCashless: 73165, zCard: 25003, zQr: 45828, zNfc: 2334, checks: 129 });
  check('ФОРМУЛА СЧИТАЕТ ВЕРНО: должно быть 11 738', c.expected === 11738, c.expected, 11738);
  check('излишек ровно 56 231', c.diff === 56231 && c.over === 56231, c.diff, 56231);

  const f = WM.shiftFix(c);
  check('РАСХОЖДЕНИЕ РАЗМЕРОМ С ВЫРУЧКУ ПОМЕЧЕНО КАК КРУПНОЕ', f.big === true, f.big, true);
  check('доля от наличных за смену посчитана', Math.round(f.share * 100) === 58,
    Math.round(f.share * 100), 58);

  const по = {};
  f.list.forEach(function (x) { по[x.key] = x.need; });
  check('ЯЩИК СОШЁЛСЯ БЫ ПРИ ИНКАССАЦИИ 17 850', по.collected === 17850, по.collected, 17850);
  check('или если в ящике насчитали бы 11 738', по.factCash === 11738, по.factCash, 11738);
  check('или при размене 66 231', по.openCash === 66231, по.openCash, 66231);
  check('или при Z-нале 133 760', по.zCash === 133760, по.zCash, 133760);
  check('МИНУСОВЫЕ ВЫПЛАТЫ НЕ ПРЕДЛАГАЮТСЯ', по.payouts === undefined, по.payouts, undefined);
  check('минусовые возвраты тоже', по.returnsCash === undefined, по.returnsCash, undefined);

  /* Каждая подсказка обязана обнулять расхождение — иначе это не подсказка. */
  let всеСходятся = true;
  f.list.forEach(function (x) {
    const правка = { openCash: 10000, zCash: 77529, returnsCash: 950, deposits: 10000,
      payouts: 10760, collected: 74081, factCash: 67969 };
    правка[x.key] = x.need;
    if (!WM.shiftCalc(правка).ok) всеСходятся = false;
  });
  check('КАЖДАЯ ПОДСКАЗКА ДЕЙСТВИТЕЛЬНО ОБНУЛЯЕТ РАСХОЖДЕНИЕ', всеСходятся, всеСходятся, true);
}

console.log('\n— Разбор называет знакомые ошибки своим именем');
{
  // Ящик пересчитали до инкассации: в нём ровно на инкассацию больше
  const до = WM.shiftFix({ openCash: 5000, zCash: 60000, payouts: 0, collected: 50000,
    factCash: 65000 });
  check('«ПЕРЕСЧИТАЛИ ДО ИНКАССАЦИИ» УЗНАЁТСЯ',
    /до того, как забрали инкассацию/.test(до.reason), до.reason, 'про инкассацию');

  // Факт не вписали вовсе
  const пусто = WM.shiftFix({ openCash: 5000, zCash: 60000 });
  check('«НЕ ВПИСАЛИ ФАКТ» УЗНАЁТСЯ',
    /не вписали/.test(пусто.reason), пусто.reason, 'про факт');

  // Выплаты записали, а деньги не выдали
  const вып = WM.shiftFix({ openCash: 0, zCash: 30000, payouts: 4000, factCash: 30000 });
  check('«ВЫПЛАТЫ ЗАПИСАЛИ, А НЕ ВЫДАЛИ» УЗНАЁТСЯ',
    /деньги из ящика не выдали/.test(вып.reason), вып.reason, 'про выплаты');

  // Обычная недостача в 200 ₽ на обороте 80 000 — это жизнь, а не ошибка ввода
  const мелочь = WM.shiftFix({ openCash: 5000, zCash: 75000, payouts: 0, collected: 0,
    factCash: 79800 });
  check('МЕЛКАЯ НЕДОСТАЧА НЕ ОБЪЯВЛЯЕТСЯ ОШИБКОЙ ВВОДА', мелочь.big === false, мелочь.big, false);
  check('но подсказки всё равно есть', мелочь.list.length > 0, мелочь.list.length, '>0');

  // Сошлось — разбирать нечего
  const ровно = WM.shiftFix({ openCash: 5000, zCash: 60000, payouts: 0, factCash: 65000 });
  check('СОШЛОСЬ — РАЗБОРА НЕТ',
    ровно.ok && ровно.list.length === 0 && !ровно.reason, ровно.list.length, 0);
}

console.log('\n— Одна касса, два аппарата: чеки магазина за 16.09.26');
{
  /* У магазина на одной кассе два печатающих аппарата и ОБЩИЙ денежный ящик:
       · АСПД (нефискальный), смена 1257: приход 74 936 наличными, 174 чека,
         возвраты 95, внесений 10 000, выплат 10 760, инкассация 74 081;
       · фискальный ККТ, смена 29: приход 75 853 = наличными 2 688 +
         безналичными 73 165, 129 чеков, инкассация 2 688.
     Отчёт терминала за те же часы: карта 25 003 + QR 45 828 + Bluetooth 2 334
     = 73 165 — ровно безнал фискального аппарата.

     Главное доказательство того, что деньги НЕ задваиваются: наличка обоих
     аппаратов минус возвраты плюс внесения минус выплаты в точности равна
     сумме двух инкассаций. Совпадение до рубля на таких числах невозможно. */
  const нал = 74936 + 2688, инк = 74081 + 2688;
  const c = WM.shiftCalc({
    openCash: 0, zCash: нал, zCashless: 73165, returnsCash: 95,
    deposits: 10000, payouts: 10760, collected: инк, factCash: 0,
    zCard: 25003, zQr: 45828, zNfc: 2334, checks: 174 + 129, voided: 3 });

  check('НАЛИЧКА ДВУХ АППАРАТОВ — 77 624, как владелец сложил ручкой на чеке',
    нал === 77624, нал, 77624);
  check('ДВЕ ИНКАССАЦИИ СХОДЯТСЯ С ДВИЖЕНИЕМ НАЛИЧНЫХ ДО РУБЛЯ',
    инк === 74936 + 2688 - 95 + 10000 - 10760, инк, 76769);
  check('ящик закрывается в ноль', c.expected === 0 && c.ok, c.expected, 0);
  check('НОЛЬ В ЯЩИКЕ — НЕ ПОВОД РУГАТЬСЯ: форма заполнена, факт вписан',
    c.factFilled === true, c.factFilled, true);
  check('терминал сошёлся с безналом фискального аппарата',
    c.wayOk && c.byWay === 73165, c.byWay, 73165);
  check('выручка за смену — приход обоих аппаратов минус возвраты',
    c.revenue === 74936 + 2688 + 73165 - 95, c.revenue, 150694);
  check('наличная часть выручки', c.revenueCash === 77529, c.revenueCash, 77529);

  /* В сейф доехало 67 969 вместо 76 769. Это и есть та недостача, ради
     которой сверка существует: пишем ПЕРЕСЧИТАННУЮ инкассацию, а не
     пробитую на кассе, и разница встаёт на своё место. */
  const реально = WM.shiftCalc({
    openCash: 0, zCash: нал, zCashless: 73165, returnsCash: 95,
    deposits: 10000, payouts: 10760, collected: 67969, factCash: 0 });
  check('В СЕЙФ ДОЕХАЛО МЕНЬШЕ — НЕДОСТАЧА 8 800 ВИДНА',
    реально.short === 8800, реально.short, 8800);

  const f = WM.shiftFix(реально);
  /* 8 800 от 87 624 — это 10,04 %, чуть выше порога, и программа просит
     сверить числа. Но обвинять владельца в описке она не вправе: при таких
     деньгах это может быть и настоящая недостача. */
  check('расхождение помечено как крупное: 10 % оборота перевалило',
    f.big === true, Math.round(f.share * 1000) / 10 + '%', '10,0%');
  check('но подсказка «инкассация была 76 769» под рукой',
    f.list.some(function (x) { return x.key === 'collected' && x.need === 76769; }),
    (f.list.filter(function (x) { return x.key === 'collected'; })[0] || {}).need, 76769);
  check('ПРО НЕЗАПОЛНЕННЫЙ ФАКТ РАЗБОР МОЛЧИТ — ноль вписан осознанно',
    !f.reason, f.reason || 'молчит', 'молчит');
}

console.log('\n— Инкассация: что пробила касса и что доехало до сейфа');
{
  /* Смена 16.09.26, оба аппарата одной кассы. Касса пробила инкассацию
     74 081 + 2 688 = 76 769, а владелец пересчитал 67 969. Пока поле было
     одно, ему приходилось выбирать: написать цифру с чека и спрятать
     пропажу, или написать пересчитанное и потерять слова кассы. */
  const пробито = 74081 + 2688;
  const c = WM.shiftCalc({
    openCash: 0, zCash: 74936 + 2688, zCashless: 73165, returnsCash: 95,
    deposits: 10000, payouts: 10760, collected: пробито, collectedFact: 67969,
    factCash: 0, zCard: 25003, zQr: 45828, zNfc: 2334, checks: 129 });

  check('ЯЩИК СЧИТАЕТСЯ ПО ПРОБИТОЙ СУММЕ — её кассир из ящика вынул',
    c.expected === 0, c.expected, 0);
  check('и по ящику всё сошлось: в нём и должно быть пусто',
    c.ok && c.diff === 0, c.status, 'сходится');
  check('ДО СЕЙФА НЕ ДОЕХАЛО 8 800', c.collectShort === 8800, c.collectShort, 8800);
  check('пропажа названа отдельно от ящика, а не свалена в кучу',
    c.diff === 0 && c.collectDiff === -8800, c.diff + ' / ' + c.collectDiff, '0 / -8800');
  check('ИТОГ ПО СМЕНЕ — 8 800, А НЕ 17 600: одна недостача, а не две',
    c.totalShort === 8800, c.totalShort, 8800);
  check('и вердикт «всё сошлось» не выдаётся', c.allOk === false, c.allOk, false);
  check('выручка от этого не изменилась', c.revenue === 150694, c.revenue, 150694);

  /* Не пересчитывали — верим кассе, недостаче взяться неоткуда */
  const без = WM.shiftCalc({
    openCash: 0, zCash: 74936 + 2688, returnsCash: 95, deposits: 10000,
    payouts: 10760, collected: пробито, factCash: 0 });
  check('НЕ ПЕРЕСЧИТЫВАЛИ — ПРОГРАММА НЕ ВЫДУМЫВАЕТ НЕДОСТАЧУ',
    без.collectFilled === false && без.collectDiff === 0 && без.allOk === true,
    без.collectDiff, 0);
  check('в сейф уйдёт пробитая сумма — другой мы не знаем',
    без.collectedFact === пробито, без.collectedFact, пробито);

  /* Пустая строка — это «не считали», а не «доехало ноль». Спутать эти два
     значения означало бы объявить пропавшей всю инкассацию. */
  const пусто = WM.shiftCalc({
    openCash: 0, zCash: 74936 + 2688, returnsCash: 95, deposits: 10000,
    payouts: 10760, collected: пробито, collectedFact: '', factCash: 0 });
  check('ПУСТАЯ СТРОКА НЕ ОЗНАЧАЕТ «ДОЕХАЛО НОЛЬ»',
    пусто.allOk === true && пусто.collectShort === 0, пусто.collectShort, 0);

  const ноль = WM.shiftCalc({
    openCash: 0, zCash: 74936 + 2688, returnsCash: 95, deposits: 10000,
    payouts: 10760, collected: пробито, collectedFact: 0, factCash: 0 });
  check('А ВПИСАННЫЙ НОЛЬ ОЗНАЧАЕТ: НЕ ДОЕХАЛО НИЧЕГО',
    ноль.collectShort === пробито, ноль.collectShort, пробито);

  /* Итог месяца обязан показать пропажу отдельной суммой */
  const t = WM.totals([{ type: 'Смена', date: '2026-09-16', till: 'Касса 1',
    shift: 'Ночь', cashier: 'Марьям', openCash: 0, zCash: 74936 + 2688,
    zCashless: 73165, returnsCash: 95, deposits: 10000, payouts: 10760,
    collected: пробито, collectedFact: 67969, factCash: 0 }]);
  check('В ИТОГАХ ПРОПАЖА ПО ДОРОГЕ СЧИТАЕТСЯ ОТДЕЛЬНОЙ СУММОЙ',
    t.collectShort === 8800 && t.collectBad === 1 && t.diff === 0,
    'ящик ' + t.diff + ', дорога ' + t.collectShort, 'ящик 0, дорога 8800');
}

console.log('\n— Журнал проводок: у каждого рубля есть пара');
{
  const счета = [
    { id: 'till1', name: 'Касса 1', kind: 'till', opening: 0, defaultCash: true },
    { id: 'safe', name: 'Сейф', kind: 'cash', opening: 200000 },
    { id: 'bank', name: 'Расчётный счёт', kind: 'bank', opening: 0, defaultCashless: true }
  ];
  /* Настоящая смена владельца: пробили инкассацию 76 769, доехало 67 969,
     размен 10 000 взяли в сейфе, выплаты 10 760 расписаны расходом. */
  const смена = { type: 'Смена', date: '2026-09-16', till: 'Касса 1', shift: 'Ночь',
    cashier: 'Марьям', account: 'till1', cashlessAccount: 'bank',
    openCash: 0, zCash: 77624, returnsCash: 95, deposits: 10000, payouts: 10760,
    collected: 76769, collectedFact: 67969, factCash: 0, zCashless: 73165 };
  const внесение = { type: 'Перемещение', date: '2026-09-16', amount: 10000,
    account: 'safe', toAccount: 'till1', category: 'Размен', fromShiftDep: 's1' };
  const инкас = { type: 'Перемещение', date: '2026-09-16', amount: 67969,
    account: 'till1', toAccount: 'safe', category: 'Инкассация', fromShift: 's1' };
  const расход = { type: 'Расход', date: '2026-09-16', amount: 10760,
    account: 'till1', category: 'Хознужды' };
  const записи = [смена, внесение, инкас, расход];
  const j = WM.journal(записи, счета);

  check('ЖУРНАЛ СХОДИТСЯ В НОЛЬ: у каждого рубля нашлась пара',
    j.ok && j.total === 0, j.total, 0);
  check('НЕДОСТАЧА ПОЛУЧИЛА СВОЙ СЧЁТ, А НЕ ИСЧЕЗЛА',
    j.gaps === 8800, j.gaps, 8800);
  check('выручка в журнале — та же, что в смене', j.sales === 150694, j.sales, 150694);
  check('затраты — расписанные выплаты', j.costs === 10760, j.costs, 10760);
  check('МОСТ «ЧЕРЕЗ ЯЩИК» ЗАКРЫЛСЯ: смена и записи сказали одно и то же',
    j.tillOk && j.tillGap === 0, j.tillGap, 0);

  /* Два разных способа посчитать одни деньги обязаны дать одно число */
  const b = WM.accountBalances(записи, счета);
  let сошлось = true, где = '';
  b.rows.forEach(function (a) {
    const пров = j.accounts.filter(function (x) { return x.id === a.id; })[0];
    const изЖурнала = WM.safeRound(a.opening + (пров ? пров.sum : 0));
    if (a.balance !== изЖурнала) { сошлось = false; где = a.name; }
  });
  check('ОСТАТКИ СЧЕТОВ И ЖУРНАЛ ДАЮТ ОДНО И ТО ЖЕ',
    сошлось, сошлось ? 'сошлось' : 'разошлось по «' + где + '»', 'сошлось');
  check('в ящике ноль, в сейфе 257 969',
    b.totals.till === 0 && b.rows.filter(function (a) { return a.id === 'safe'; })[0].balance === 257969,
    b.rows.filter(function (a) { return a.id === 'safe'; })[0].balance, 257969);

  /* Выплаты не расписаны — мост показывает, на сколько */
  const безРасхода = WM.journal([смена, внесение, инкас], счета);
  check('ВЫПЛАТЫ НЕ РАСПИСАНЫ — МОСТ ГОВОРИТ, НА СКОЛЬКО',
    безРасхода.tillGap === 10760 && безРасхода.tillOk === false,
    безРасхода.tillGap, 10760);
  check('но журнал всё равно сходится в ноль: это вопрос, а не дыра',
    безРасхода.ok, безРасхода.total, 0);
}

console.log('\n— Внесение размена: деньги берутся в сейфе, а не из воздуха');
{
  const счета = [
    { id: 'till1', name: 'Касса 1', kind: 'till', opening: 0, defaultCash: true },
    { id: 'safe', name: 'Сейф', kind: 'cash', opening: 200000 }
  ];
  const смена = { type: 'Смена', date: '2026-09-16', till: 'Касса 1', shift: 'День',
    account: 'till1', openCash: 0, zCash: 50000, deposits: 10000, payouts: 0,
    collected: 0, factCash: 60000 };

  const без = WM.accountBalances([смена], счета);
  check('БЕЗ ПЕРЕВОДА ДЕНЬГИ БЕРУТСЯ ИЗ ВОЗДУХА — так было раньше',
    без.totals.total === 260000, без.totals.total, 260000);

  const перевод = { type: 'Перемещение', date: '2026-09-16', amount: 10000,
    account: 'safe', toAccount: 'till1', category: 'Размен', fromShiftDep: 's1' };
  const с = WM.accountBalances([смена, перевод], счета);
  check('С ПЕРЕВОДОМ ВСЁ СХОДИТСЯ: было 200 000, заработали 50 000',
    с.totals.total === 250000, с.totals.total, 250000);
  check('в ящике то, что насчитал кассир', с.totals.till === 60000, с.totals.till, 60000);
  check('СЕЙФ ПОХУДЕЛ РОВНО НА РАЗМЕН', с.totals.safe === 190000, с.totals.safe, 190000);
  check('и правило ящика не нарушено: перевод В ящик его остаток не трогал',
    с.totals.till === WM.shiftCalc(смена).factCash, с.totals.till, 60000);
}

console.log('\n— XYZ: насколько ровно берут товар');
{
  /* Пять недель. Хлеб и молоко берут ровно, кофе колеблется, шампанское
     взяли рывком, чипсы — один раз из пяти. */
  const данные = {
    'Хлеб': [200, 190, 210, 205, 195],
    'Молоко': [100, 102, 98, 101, 99],
    'Кофе': [20, 28, 15, 25, 22],
    'Шампанское': [2, 0, 1, 40, 0],
    'Чипсы': [0, 0, 30, 0, 0]
  };
  const продажи = [];
  ['н1', 'н2', 'н3', 'н4', 'н5'].forEach(function (w, i) {
    Object.keys(данные).forEach(function (t) {
      const q = данные[t][i];
      if (!q) return;      // товара нет в выгрузке — строки тоже нет
      продажи.push({ key: t, name: t, periodKey: w, from: '2026-0' + (i + 1) + '-01',
        qty: q, revenue: q * 100, cogs: q * 70, profit: q * 30 });
    });
  });
  const r = WM.abcXyz(продажи);
  const по = {};
  r.rows.forEach(function (x) { по[x.name] = x; });

  check('КАЖДЫЙ ТОВАР В СПИСКЕ ОДИН РАЗ, А НЕ ПО РАЗУ НА ВЫГРУЗКУ',
    r.rows.length === 5, r.rows.length, 5);
  check('ХЛЕБ — AX: много денег и берут ровно',
    по['Хлеб'].group === 'AX', по['Хлеб'].group, 'AX');
  check('молоко ровное, но денег даёт меньше — BX',
    по['Молоко'].group === 'BX', по['Молоко'].group, 'BX');
  check('кофе колеблется — Y', по['Кофе'].xyz === 'Y', по['Кофе'].xyz, 'Y');
  check('ШАМПАНСКОЕ ВЗЯЛИ РЫВКОМ — Z',
    по['Шампанское'].xyz === 'Z', по['Шампанское'].xyz, 'Z');

  /* Главная ловушка: товар, которого нет в выгрузке за период, — это НОЛЬ
     продаж, а не пропуск. Пропустишь — и чипсы, взятые один раз из пяти,
     окажутся идеально ровным «X» по единственному периоду. */
  check('ТОВАР, ВЗЯТЫЙ ОДИН РАЗ ИЗ ПЯТИ, — САМЫЙ НЕРОВНЫЙ, А НЕ САМЫЙ РОВНЫЙ',
    по['Чипсы'].xyz === 'Z', по['Чипсы'].xyz, 'Z');
  check('и разброс у него больше, чем у ровного хлеба',
    по['Чипсы'].spread > по['Хлеб'].spread,
    по['Чипсы'].spread + '% против ' + по['Хлеб'].spread + '%', 'больше');

  check('у ровного товара разброс до 10%', по['Хлеб'].spread <= 10, по['Хлеб'].spread, '≤ 10');
  check('у каждой группы есть совет своими словами',
    /Держите всегда/.test(по['Хлеб'].advice) && /мёртвым грузом/.test(по['Чипсы'].advice),
    'есть', 'есть');
  check('СЕТКА ВСЕГДА ИЗ ДЕВЯТИ КЛЕТОК, даже если товаров мало',
    r.grid.length === 9, r.grid.length, 9);
  check('и сумма по клеткам равна числу товаров',
    r.grid.reduce(function (a, g) { return a + g.count; }, 0) === 5,
    r.grid.reduce(function (a, g) { return a + g.count; }, 0), 5);

  /* Выручка в строках — за все периоды, а не за последний */
  check('выручка хлеба — сумма по всем пяти неделям',
    по['Хлеб'].revenue === (200 + 190 + 210 + 205 + 195) * 100,
    по['Хлеб'].revenue, 100000);

  /* Меньше трёх периодов — честно молчим, а не гадаем */
  const мало = WM.abcXyz(продажи.filter(function (x) { return x.periodKey !== 'н4' && x.periodKey !== 'н5' && x.periodKey !== 'н3'; }));
  check('МЕНЬШЕ ТРЁХ ВЫГРУЗОК — ПРОГРАММА НЕ ГАДАЕТ',
    мало.enough === false && мало.rows.every(function (x) { return !x.xyz; }),
    'молчит', 'молчит');
  check('и говорит, чего не хватает',
    /три выгрузки/.test(мало.rows[0].advice), мало.rows[0].advice.slice(0, 40), 'про выгрузки');
}

console.log('\n— Ревизор: программа проверяет себя сама');
{
  const счета = [
    { id: 'till1', name: 'Касса 1', kind: 'till', opening: 0, defaultCash: true },
    { id: 'safe', name: 'Сейф', kind: 'cash', opening: 200000 },
    { id: 'bank', name: 'Счёт', kind: 'bank', opening: 0, defaultCashless: true }
  ];
  const здоровая = {
    id: 's1', type: 'Смена', date: '2026-09-16', till: 'Касса 1', shift: 'Ночь',
    cashier: 'Марьям', account: 'till1', cashlessAccount: 'bank',
    openCash: 0, zCash: 50000, returnsCash: 0, deposits: 0, payouts: 5000,
    collected: 45000, factCash: 0, zCashless: 20000, zCard: 12000, zQr: 8000
  };
  const инкас = { type: 'Перемещение', date: '2026-09-16', amount: 45000,
    account: 'till1', toAccount: 'safe', category: 'Инкассация', fromShift: 's1' };
  const расход = { type: 'Расход', date: '2026-09-16', amount: 5000,
    account: 'till1', category: 'Хознужды' };

  const чисто = REV.check({ accounts: счета, dds: [здоровая, инкас, расход] }, {});
  check('НА ЗДОРОВОМ МАГАЗИНЕ РЕВИЗОР МОЛЧИТ',
    чисто.counts.alarm === 0 && чисто.counts.warn === 0,
    'тревог ' + чисто.counts.alarm + ', внимания ' + чисто.counts.warn, '0 и 0');

  const больная = Object.assign({}, здоровая, { collectedFact: 40000, zNfc: 500 });
  const инкас2 = Object.assign({}, инкас, { amount: 40000 });
  const r = REV.check({ accounts: счета, dds: [больная, инкас2, расход] }, {});
  const заголовки = r.findings.map(function (f) { return f.title; }).join(' | ')
    .replace(/[\u00a0\u202f]/g, ' ');

  check('НЕДОСТАЧУ ПО ДОРОГЕ В СЕЙФ РЕВИЗОР НАХОДИТ',
    /не доехало 5 000/.test(заголовки), заголовки.slice(0, 60), 'про 5 000');
  check('и расхождение терминала тоже',
    /Терминал и касса разошлись/.test(заголовки), 'находит', 'находит');
  check('ТРЕВОГА СТОИТ ВЫШЕ ВНИМАНИЯ — важное первым',
    r.findings[0].level === 'alarm', r.findings[0].level, 'alarm');
  check('каждая находка объяснена словами',
    r.findings.every(function (f) { return f.why && f.why.length > 20; }), 'объяснены', 'объяснены');
  check('и у каждой есть, куда нажать',
    r.findings.every(function (f) { return !!f.go; }), 'есть', 'есть');

  const воздух = Object.assign({}, здоровая, { deposits: 10000, factCash: 10000 });
  const rv = REV.check({ accounts: счета, dds: [воздух, инкас, расход] }, {});
  /* Журнал сходится в ноль ВСЕГДА — это его устройство, а не проверка.
     Внесение без перевода ловит МОСТ «через ящик»: смена объявила, что через
     ящик прошло одно, а записи объясняют другое. Ждать здесь «journal» —
     значит ждать того, чего по построению не бывает. */
  check('ВНЕСЕНИЕ БЕЗ ПЕРЕВОДА ЛОВИТ МОСТ «ЧЕРЕЗ ЯЩИК»',
    rv.findings.some(function (f) { return f.key === 'tillgap'; }),
    rv.findings.map(function (f) { return f.key; }).join(','), 'есть tillgap');
  check('и мост показывает ровно те 10 000, что взялись из воздуха',
    Math.abs(rv.totals.tillGap) === 10000, Math.abs(rv.totals.tillGap), 10000);
}

console.log('\n— Конструктор правил: кубики вместо формул');
{
  const счета = [{ id: 'till1', name: 'Касса 1', kind: 'till', opening: 0, defaultCash: true }];
  const смена = { id: 's1', type: 'Смена', date: '2026-09-16', till: 'Касса 1', shift: 'День',
    account: 'till1', openCash: 0, zCash: 30000, payouts: 0, collected: 0, factCash: 30000 };

  check('ПОКАЗАТЕЛЕЙ ХВАТАЕТ, ЧТОБЫ БЫЛО ИЗ ЧЕГО СОБИРАТЬ',
    REV.МЕТРИКИ.length >= 15, REV.МЕТРИКИ.length, '≥ 15');
  check('у каждого показателя есть имя словами и пояснение',
    REV.МЕТРИКИ.every(function (m) { return m.name && m.hint && m.unit; }), 'есть', 'есть');
  check('ПРАВИЛО ЧИТАЕТСЯ КАК ФРАЗА, А НЕ КАК ФОРМУЛА',
    REV.ruleText({ metric: 'diff', op: '>', value: 1000, level: 'alarm' })
      .replace(/[\u00a0\u202f]/g, ' ') === 'Если «Расхождение по кассе» больше 1 000 ₽ — тревога',
    REV.ruleText({ metric: 'diff', op: '>', value: 1000, level: 'alarm' }),
    'фраза по-русски');
  check('недособранное правило не притворяется готовым',
    /не до конца/.test(REV.ruleText({ metric: 'нетакого', op: '>' })),
    REV.ruleText({ metric: 'нетакого', op: '>' }), 'про «не до конца»');

  const порог = { id: 'r1', metric: 'revenue', op: '<', value: 40000, level: 'warn',
    title: 'Выручка ниже обычного', what: 'Проверить завоз.' };
  const сработало = REV.check({ accounts: счета, dds: [смена], rules: [порог] }, {});
  check('ПРАВИЛО ВЛАДЕЛЬЦА СРАБОТАЛО: 30 000 меньше 40 000',
    сработало.findings.some(function (f) { return f.own && /Выручка ниже/.test(f.title); }),
    'сработало', 'сработало');

  const молчит = REV.check({ accounts: счета, dds: [смена],
    rules: [Object.assign({}, порог, { value: 20000 })] }, {});
  check('И МОЛЧИТ, КОГДА ПОРОГ НЕ ПЕРЕЙДЁН: 30 000 не меньше 20 000',
    !молчит.findings.some(function (f) { return f.own; }), 'молчит', 'молчит');

  const выкл = REV.check({ accounts: счета, dds: [смена],
    rules: [Object.assign({}, порог, { off: true })] }, {});
  check('ВЫКЛЮЧЕННОЕ ПРАВИЛО МОЛЧИТ, НО ОСТАЁТСЯ',
    !выкл.findings.some(function (f) { return f.own; }), 'молчит', 'молчит');

  const кривое = REV.check({ accounts: счета, dds: [смена],
    rules: [{ id: 'bad', metric: 'такого-нет', op: '>>>', value: 'ерунда' }] }, {});
  check('КРИВОЕ ПРАВИЛО НЕ ЛОМАЕТ РЕВИЗОРА — оно просто не срабатывает',
    !кривое.findings.some(function (f) { return f.own; }), 'пережил', 'пережил');

  const поИтогу = REV.check({ accounts: счета,
    dds: [смена, Object.assign({}, смена, { id: 's2' })],
    rules: [{ id: 'r2', metric: 'cashInTill', op: '>', value: 1000, level: 'note',
      title: 'Много наличных' }] }, {});
  check('ПРАВИЛО ПО ИТОГУ СРАБАТЫВАЕТ ОДИН РАЗ, А НЕ НА КАЖДУЮ СМЕНУ',
    поИтогу.findings.filter(function (f) { return f.ruleId === 'r2'; }).length === 1,
    поИтогу.findings.filter(function (f) { return f.ruleId === 'r2'; }).length, 1);
}

console.log('\n— Поиск с опечатками: точный не должен стать хуже');
{
  const товары = [{ n: 'Молоко 3.2% Простоквашино' }, { n: 'Хлеб Бородинский' },
    { n: 'Сметана 20%' }, { n: 'Шоколад Алёнка' }, { n: 'Молоко козье' }];
  const поиск = q => {
    FLT.clear('t'); FLT.setText('t', q);
    return FLT.apply('t', товары, [], r => r.n).map(r => r.n);
  };
  check('ТОЧНЫЙ ПОИСК ОСТАЛСЯ ТОЧНЫМ: «молоко» даёт только молоко',
    поиск('молоко').length === 2 && поиск('молоко').every(x => /Молоко/.test(x)),
    поиск('молоко').join(', '), 'два молока');
  check('ОПЕЧАТКА ПРОЩАЕТСЯ: «малако» находит молоко',
    поиск('малако').some(x => /Молоко/.test(x)), поиск('малако').join(', '), 'молоко');
  check('и «сметанна» находит сметану',
    поиск('сметанна').some(x => /Сметана/.test(x)), поиск('сметанна').join(', '), 'сметана');
  check('«ХЛЕБ» НЕ ТАЩИТ ЗА СОБОЙ ШОКОЛАД — похожее не подмешивается к точному',
    поиск('хлеб').length === 1 && /Хлеб/.test(поиск('хлеб')[0]),
    поиск('хлеб').join(', '), 'только хлеб');
  check('ЧЕПУХА НЕ НАХОДИТ НИЧЕГО', поиск('ыфвафыв').length === 0,
    поиск('ыфвафыв').length, 0);
  check('пустой запрос возвращает всё', поиск('').length === 5, поиск('').length, 5);
  /* Числовое условие опечаток не прощает: «>1000» либо подходит, либо нет */
  const суммы = [{ n: 'Аренда', s: 110000 }, { n: 'Свет', s: 4000 }];
  FLT.clear('u'); FLT.setText('u', '>10000');
  const числа = FLT.apply('u', суммы, [], r => r.n, r => [r.s]).map(r => r.n);
  check('ЧИСЛОВОЕ УСЛОВИЕ РАБОТАЕТ КАК РАБОТАЛО',
    числа.length === 1 && числа[0] === 'Аренда', числа.join(','), 'Аренда');
}

console.log('\n— Ревизор считает «обычное» по самому магазину');
{
  const счета = [{ id: 't1', name: 'Касса', kind: 'till', opening: 0, defaultCash: true }];
  const смены = (список) => список.map(function (d, i) {
    return { id: 's' + i, type: 'Смена', date: '2026-09-0' + ((i % 9) + 1), till: 'Касса',
      shift: 'День', account: 't1', openCash: 0, zCash: 40000, payouts: 0,
      collected: 0, factCash: 40000 + d };
  });
  const выброс = REV.check({ accounts: счета,
    dds: смены([120, -90, 200, -150, 80, -60, 175, -110, 140, 50000]) },
    { diffCrit: 100000 });
  const странные = выброс.findings.filter(function (f) { return f.key.indexOf('odd:') === 0; });
  check('СМЕНА, ВЫБИВАЮЩАЯСЯ ИЗ ИСТОРИИ, НАХОДИТСЯ',
    странные.length === 1, странные.length, 1);
  check('и это именно она, а не соседние',
    странные.length === 1 && /50 000/.test(странные[0].why.replace(/[\u00a0\u202f]/g, ' ')),
    странные.length ? странные[0].why.slice(0, 60) : 'нет', 'про 50 000');
  check('ОДНА КРАЖА НЕ ПРЯЧЕТ ОСТАЛЬНЫЕ: считаем по медиане, а не по среднему',
    странные.length === 1 &&
      /обычно у вас расходится на 130/.test(странные[0].why.replace(/[\u00a0\u202f]/g, ' ')),
    странные.length ? (странные[0].why.match(/обычно[^.]*/) || [''])[0] : 'нет',
    'обычно 130 ₽');

  const ровные = REV.check({ accounts: счета,
    dds: смены([120, -90, 200, -150, 80, -60, 175, -110, 140, 100]) }, { diffCrit: 100000 });
  check('НА РОВНОЙ ИСТОРИИ НИКТО НЕ ОБЪЯВЛЯЕТСЯ СТРАННЫМ',
    ровные.findings.filter(function (f) { return f.key.indexOf('odd:') === 0; }).length === 0,
    ровные.findings.filter(function (f) { return f.key.indexOf('odd:') === 0; }).length, 0);

  const мало = REV.check({ accounts: счета, dds: смены([120, -90, 50000]) },
    { diffCrit: 100000 });
  check('ПО ТРЁМ СМЕНАМ «ОБЫЧНОГО» НЕ БЫВАЕТ — программа молчит',
    мало.findings.filter(function (f) { return f.key.indexOf('odd:') === 0; }).length === 0,
    мало.findings.filter(function (f) { return f.key.indexOf('odd:') === 0; }).length, 0);
}

console.log('\nИтог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
process.exit(failed ? 1 : 0);
