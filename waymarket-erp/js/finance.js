/* ============================================================================
   Финансовый учёт «как в вашей таблице Auron Finance»:
   единая база ДДС (приход / расход / долг), план выплат поставщикам,
   все KPI-карточки и разрезы аналитики.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.WMFin = factory(root.WM);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  var num = E.num, txt = E.txt, norm = E.norm, round = E.safeRound, div = E.div;

  var TYPES = ['Приход', 'Расход', 'Долг', 'Забор'];
  var METHODS = ['Наличные', 'Карта', 'Перевод'];
  var WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  var PURCHASE = 'Закуп товара';     // закуп: и оплаченный, и взятый в долг
  var DEBT_PAY = 'Оплата ТП';        // погашение долга поставщику
  var SALES = 'Продажи';

  /* --- Чтение вашей книги ------------------------------------------------- */

  // Строка заголовков таблицы: та, где сразу несколько нужных слов стоят
  // отдельными ячейками. Общий поиск шапки тут не годится — в подзаголовках
  // листа («Платежи поставщикам — план и факт») те же слова встречаются в тексте.
  function findHeaderRow(matrix, needles, minHits) {
    var best = -1, bestHits = 0;
    for (var r = 0; r < Math.min(matrix.length, 30); r++) {
      var row = matrix[r] || [], hits = 0;
      for (var c = 0; c < row.length; c++) {
        var v = norm(row[c]);
        if (!v || v.length > 40) continue;
        for (var n = 0; n < needles.length; n++) {
          if (v === needles[n] || v.indexOf(needles[n]) === 0) { hits++; break; }
        }
      }
      if (hits > bestHits) { bestHits = hits; best = r; }
    }
    return bestHits >= (minHits || 3) ? best : -1;
  }


  // Лист «БАЗА_ДДС»: ID | Магазин | Дата | Смена | Кассир | Тип | Категория |
  //                  Способ оплаты | Сумма | Расхождение | Комментарий | Месяц
  function parseDdsBase(matrix) {
    var he = findHeaderRow(matrix, ['id', 'дата', 'смена', 'кассир', 'тип', 'категория', 'способ оплаты', 'сумма', 'расхождение'], 4);
    if (he < 0) he = E.findHeaderEnd(matrix, ['дата', 'смена', 'кассир', 'категория', 'способ оплаты', 'сумма']);
    var t = E.columnTitles(matrix, he);
    var col = {
      id: E.findCol(t, [['id']]),
      store: E.findCol(t, [['магазин']]),
      date: E.findCol(t, [['дата']]),
      shift: E.findCol(t, [['смена']]),
      cashier: E.findCol(t, [['кассир']]),
      type: E.findCol(t, [['тип']]),
      category: E.findCol(t, [['категория']]),
      method: E.findCol(t, [['способ оплаты']]),
      amount: E.findCol(t, [['сумма']]),
      diff: E.findCol(t, [['расхождение']]),
      note: E.findCol(t, [['комментарий'], ['примечание']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var date = E.excelDate(row[col.date]);
      var amount = num(row[col.amount]);
      if (!date || (!amount && !num(row[col.diff]))) continue;
      rows.push({
        id: txt(row[col.id]) || E.uid(),
        date: date,
        shift: txt(row[col.shift]),
        cashier: txt(row[col.cashier]),
        type: txt(row[col.type]) || 'Расход',
        category: txt(row[col.category]) || 'Другое',
        method: txt(row[col.method]) || 'Наличные',
        amount: amount,
        diff: col.diff >= 0 ? num(row[col.diff]) : 0,
        note: col.note >= 0 ? txt(row[col.note]) : '',
        src: 'импорт'
      });
    }
    return { rows: rows, cols: col };
  }

  // Лист «Запись_Выплат»: план платежей поставщикам
  function parsePayPlan(matrix) {
    var he = findHeaderRow(matrix, ['дата плановой оплаты', 'дата план', 'поставщик', 'сумма', 'статус', 'накладная', 'способ оплаты'], 4);
    if (he < 0) return { rows: [], cols: {} };
    var t = E.columnTitles(matrix, he);
    var col = {
      due: E.findCol(t, [['дата плановой оплаты'], ['дата план']]),
      supplier: E.findCol(t, [['поставщик']]),
      amount: E.findCol(t, [['сумма']]),
      status: E.findCol(t, [['статус']]),
      doc: E.findCol(t, [['накладная']]),
      method: E.findCol(t, [['способ оплаты']]),
      paidAt: E.findCol(t, [['дата фактической оплаты'], ['фактической']]),
      note: E.findCol(t, [['примечание']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var due = E.excelDate(row[col.due]);
      var amount = num(row[col.amount]);
      if (!due || !amount) continue;
      rows.push({
        id: E.uid(), due: due,
        supplier: txt(row[col.supplier]) || 'Поставщик',
        amount: amount,
        status: txt(row[col.status]) || 'Запланировано',
        doc: col.doc >= 0 ? txt(row[col.doc]) : '',
        method: col.method >= 0 ? txt(row[col.method]) : 'Наличные',
        paidAt: col.paidAt >= 0 ? E.excelDate(row[col.paidAt]) : '',
        note: col.note >= 0 ? txt(row[col.note]) : ''
      });
    }
    return { rows: rows, cols: col };
  }

  // Лист «Настройки»: параметры, пороги и справочники
  function parseFinSettings(matrix) {
    var out = { store: '', opening: { cash: 0, card: 0, transfer: 0 },
      thresholds: { debtWarn: 0, debtCrit: 0, dueWarn: 7, diffCrit: 1000 },
      dict: { cashiers: [], categories: [], methods: [], types: [], suppliers: [], shifts: [], statuses: [] } };
    var headerRow = -1, colOf = {};
    for (var r = 0; r < matrix.length; r++) {
      var row = matrix[r] || [];
      for (var c = 0; c < row.length; c++) {
        var v = norm(row[c]);
        if (!v) continue;
        var next = txt(row[c + 1]) || txt(row[c + 2]);
        if (v.indexOf('магазин') === 0 && next) out.store = next;
        if (v.indexOf('начальный остаток кассы') >= 0) out.opening.cash = num(row[c + 1] || row[c + 2]);
        if (v.indexOf('нач. остаток (карта)') >= 0) out.opening.card = num(row[c + 1]);
        if (v.indexOf('нач. остаток (перевод)') >= 0) out.opening.transfer = num(row[c + 1]);
        if (v.indexOf('долг — внимание') >= 0) out.thresholds.debtWarn = num(row[c + 1]);
        if (v.indexOf('долг — критично') >= 0) out.thresholds.debtCrit = num(row[c + 1]);
        if (v.indexOf('дней до оплаты') >= 0) out.thresholds.dueWarn = num(row[c + 1]);
        if (v.indexOf('расхождение кассы') >= 0) out.thresholds.diffCrit = num(row[c + 1]);
        if (v === 'кассиры') { headerRow = r; colOf.cashiers = c; }
        if (v.indexOf('категории расход') >= 0) colOf.categories = c;
        if (v.indexOf('способы оплаты') >= 0) colOf.methods = c;
        if (v.indexOf('типы операций') >= 0) colOf.types = c;
        if (v.indexOf('поставщик') >= 0 && headerRow >= 0 && colOf.suppliers == null) colOf.suppliers = c;
        if (v === 'смены') colOf.shifts = c;
        if (v === 'статусы') colOf.statuses = c;
      }
    }
    if (headerRow >= 0) {
      for (var k in colOf) {
        var list = [];
        for (var rr = headerRow + 1; rr < Math.min(matrix.length, headerRow + 40); rr++) {
          var val = txt((matrix[rr] || [])[colOf[k]]);
          if (!val) break;          // справочник кончился — дальше другой блок листа
          list.push(val);
        }
        out.dict[k] = list;
      }
    }
    return out;
  }

  /* --- Расчёты ------------------------------------------------------------- */

  function isIncome(r) { return norm(r.type) === 'приход'; }
  function isExpense(r) { return norm(r.type) === 'расход'; }
  function isDebt(r) { return norm(r.type) === 'долг'; }
  // Забор денег владельцем: деньги из оборота уходят, но это не расход магазина
  function isDraw(r) { return norm(r.type) === 'забор'; }
  function isPurchase(r) { return norm(r.category).indexOf('закуп') >= 0; }
  function isDebtPay(r) { return norm(r.category).indexOf('оплата тп') >= 0; }

  // Остатки денег по способам оплаты: приход минус расход
  function balances(rows, opening) {
    opening = opening || {};
    var b = { 'Наличные': num(opening.cash), 'Карта': num(opening.card), 'Перевод': num(opening.transfer) };
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], m = txt(r.method) || 'Наличные';
      if (b[m] === undefined) b[m] = 0;
      if (isIncome(r)) b[m] += num(r.amount);
      else if (isExpense(r) || isDraw(r)) b[m] -= num(r.amount);
      // «Долг» деньги не двигает: товар взят, оплата будет позже
    }
    var total = 0, out = [];
    for (var k in b) { b[k] = round(b[k]); total += b[k]; out.push({ name: k, sum: b[k] }); }
    return { list: out, map: b, total: round(total) };
  }

  function totals(rows) {
    var t = { income: 0, expense: 0, debtTaken: 0, debtPaid: 0, purchase: 0, tx: rows.length,
      diffSum: 0, diffCount: 0, salary: 0, rent: 0, other: 0, draw: 0 };
    var days = {}, shifts = {}, byDay = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], a = num(r.amount);
      if (r.date) days[r.date] = true;
      if (r.date && r.shift) shifts[r.date + '|' + r.shift] = true;
      if (num(r.diff)) { t.diffSum += num(r.diff); t.diffCount++; }
      if (isIncome(r)) {
        t.income += a;
        byDay[r.date] = (byDay[r.date] || 0) + a;
      } else if (isExpense(r)) {
        t.expense += a;
        if (isPurchase(r)) t.purchase += a;
        else if (norm(r.category) === 'зп') t.salary += a;
        else if (norm(r.category) === 'аренда') t.rent += a;
        else t.other += a;
        if (isDebtPay(r)) t.debtPaid += a;
      } else if (isDebt(r)) {
        t.debtTaken += a;
      } else if (isDraw(r)) {
        // изъятие из оборота: прибыль не уменьшает, деньги в кассе — да
        t.draw += a;
      }
    }
    for (var k in t) t[k] = round(t[k]);
    t.tx = rows.length;
    t.days = Object.keys(days).length;
    t.shifts = Object.keys(shifts).length;
    t.profit = round(t.income - t.expense);                       // прибыль по кассе
    t.profitability = round(div(t.profit, t.income) * 100);       // рентабельность
    t.margin = round(div(t.income - t.purchase, t.income) * 100); // маржа: выручка минус закуп
    t.debtNow = round(t.debtTaken - t.debtPaid);                  // текущий долг поставщикам
    t.avgDay = round(div(t.income, t.days));
    t.avgShift = round(div(t.income, t.shifts));
    t.expenseDay = round(div(t.expense, t.days));
    t.purchaseEff = round(div(t.income, t.purchase) * 100) / 100; // во сколько раз выручка больше закупа
    t.debtLoad = round(div(t.debtNow, t.income) * 100);
    t.debtShare = round(div(t.debtTaken, t.purchase) * 100);      // доля закупа, взятого в долг
    t.salaryRent = round(t.salary + t.rent);
    var dayVals = [];
    for (var d in byDay) dayVals.push(round(byDay[d]));
    dayVals.sort(function (a, b) { return a - b; });
    t.minDay = dayVals.length ? dayVals[0] : 0;
    t.maxDay = dayVals.length ? dayVals[dayVals.length - 1] : 0;
    t.byDay = byDay;
    return t;
  }

  // Разрез по любому полю: сумма, доля, количество
  function group(rows, keyFn, filterFn) {
    var map = {}, total = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (filterFn && !filterFn(r)) continue;
      var k = keyFn(r) || '—', a = num(r.amount);
      if (!map[k]) map[k] = { name: k, sum: 0, count: 0 };
      map[k].sum += a; map[k].count++; total += a;
    }
    var out = [];
    for (var n in map) {
      map[n].sum = round(map[n].sum);
      map[n].share = round(div(map[n].sum, total) * 100);
      out.push(map[n]);
    }
    return out.sort(function (a, b) { return b.sum - a.sum; });
  }

  function byCategory(rows) { return group(rows, function (r) { return r.category; }, isExpense); }
  function byMethodIncome(rows) { return group(rows, function (r) { return r.method; }, isIncome); }
  function byShift(rows) { return group(rows, function (r) { return r.shift || '—'; }, isIncome); }
  function byWeekday(rows) {
    var g = group(rows, function (r) {
      var d = new Date(r.date);
      return isNaN(d) ? '—' : WEEKDAYS[d.getDay()];
    }, isIncome);
    var order = WEEKDAYS.slice(1).concat([WEEKDAYS[0]]);
    return g.sort(function (a, b) { return order.indexOf(a.name) - order.indexOf(b.name); });
  }

  // Расхождения кассы по кассирам
  function byCashier(rows) {
    var map = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], k = r.cashier || '—';
      if (!map[k]) map[k] = { name: k, diff: 0, diffCount: 0, income: 0, shifts: {} };
      if (num(r.diff)) { map[k].diff += num(r.diff); map[k].diffCount++; }
      if (isIncome(r)) map[k].income += num(r.amount);
      if (r.date && r.shift) map[k].shifts[r.date + '|' + r.shift] = true;
    }
    var out = [];
    for (var n in map) {
      var m = map[n];
      m.diff = round(m.diff); m.income = round(m.income);
      m.shiftCount = Object.keys(m.shifts).length;
      delete m.shifts;
      out.push(m);
    }
    return out.sort(function (a, b) { return a.diff - b.diff; });
  }

  /* --- Отчёты -------------------------------------------------------------- */

  function inMonth(date, ym) { return String(date).slice(0, 7) === ym; }
  function prevMonth(ym) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
    if (m === 0) { y--; m = 12; }
    return y + '-' + (m < 10 ? '0' + m : m);
  }
  function monthName(ym) {
    var names = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    var m = +ym.slice(5, 7);
    return names[m - 1] + ' ' + ym.slice(0, 4);
  }

  // Отчёт руководителя: текущий месяц против прошлого
  function monthReport(rows, ym) {
    var cur = rows.filter(function (r) { return inMonth(r.date, ym); });
    var prv = rows.filter(function (r) { return inMonth(r.date, prevMonth(ym)); });
    var a = totals(cur), b = totals(prv);
    function line(name, x, y, ofRevenue) {
      return { name: name, cur: x, prev: y, delta: round(x - y),
        deltaPct: y ? round(div(x - y, Math.abs(y)) * 100) : null,
        share: ofRevenue && a.income ? round(div(x, a.income) * 100) : null };
    }
    return {
      ym: ym, title: monthName(ym), prevTitle: monthName(prevMonth(ym)),
      cur: a, prev: b,
      finance: [
        line('Выручка (все поступления)', a.income, b.income),
        line('Расходы всего', a.expense, b.expense, true),
        line('в т.ч. закуп товара', a.purchase, b.purchase, true),
        line('в т.ч. зарплата', a.salary, b.salary, true),
        line('в т.ч. аренда', a.rent, b.rent, true),
        line('Прочие расходы', a.other, b.other, true),
        line('Чистая прибыль', a.profit, b.profit, true),
        line('Рентабельность, %', a.profitability, b.profitability),
        line('Маржа, %', a.margin, b.margin)
      ],
      methods: METHODS.map(function (m) {
        var x = cur.filter(function (r) { return isIncome(r) && r.method === m; }).reduce(function (s, r) { return s + num(r.amount); }, 0);
        var y = prv.filter(function (r) { return isIncome(r) && r.method === m; }).reduce(function (s, r) { return s + num(r.amount); }, 0);
        return line(m, round(x), round(y), true);
      }),
      categories: (function () {
        var names = {};
        byCategory(cur).forEach(function (c) { names[c.name] = 1; });
        byCategory(prv).forEach(function (c) { names[c.name] = 1; });
        return Object.keys(names).map(function (n) {
          var x = cur.filter(function (r) { return isExpense(r) && r.category === n; }).reduce(function (s, r) { return s + num(r.amount); }, 0);
          var y = prv.filter(function (r) { return isExpense(r) && r.category === n; }).reduce(function (s, r) { return s + num(r.amount); }, 0);
          var l = line(n, round(x), round(y));
          l.share = a.expense ? round(div(x, a.expense) * 100) : null;
          return l;
        }).sort(function (p, q) { return q.cur - p.cur; });
      })(),
      stats: [
        line('Дней с данными', a.days, b.days),
        line('Смен проведено', a.shifts, b.shifts),
        line('Средняя выручка в день', a.avgDay, b.avgDay),
        line('Средняя выручка за смену', a.avgShift, b.avgShift),
        line('Расхождение касс', a.diffSum, b.diffSum),
        line('Операций', a.tx, b.tx)
      ]
    };
  }

  // Ежедневный отчёт руководителя
  function dayReport(rows, date, opening) {
    var day = rows.filter(function (r) { return String(r.date).slice(0, 10) === date; });
    var t = totals(day);
    var upTo = rows.filter(function (r) { return String(r.date).slice(0, 10) <= date; });
    var bal = balances(upTo, opening);
    var tu = totals(upTo);
    return {
      date: date, totals: t, balances: bal, debtNow: tu.debtNow,
      flow: round(t.income - t.expense),
      byShift: byShift(day), byMethod: byMethodIncome(day),
      byCategory: byCategory(day), rows: day
    };
  }

  /* --- План выплат поставщикам --------------------------------------------- */

  function planStatus(p, today) {
    var s = norm(p.status);
    if (s.indexOf('оплач') >= 0) return 'paid';
    if (p.due && p.due < today) return 'overdue';
    return 'planned';
  }
  function planTotals(plans, today) {
    var t = { planned: 0, overdue: 0, paid: 0, dueToday: 0, count: plans.length,
      plannedCount: 0, overdueCount: 0, paidCount: 0 };
    for (var i = 0; i < plans.length; i++) {
      var p = plans[i], st = planStatus(p, today), a = num(p.amount);
      if (st === 'paid') { t.paid += a; t.paidCount++; }
      else if (st === 'overdue') { t.overdue += a; t.overdueCount++; }
      else { t.planned += a; t.plannedCount++; if (p.due === today) t.dueToday += a; }
    }
    for (var k in t) t[k] = round(t[k]);
    t.count = plans.length;
    t.paidShare = round(div(t.paid, t.paid + t.planned + t.overdue) * 100);
    return t;
  }

  // Календарь месяца: недели по 7 дней с суммами платежей
  function calendarMonth(plans, ym, today) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var first = new Date(Date.UTC(y, m - 1, 1));
    var daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var startDow = (first.getUTCDay() + 6) % 7;      // неделя с понедельника
    var byDay = {};
    plans.forEach(function (p) {
      if (String(p.due).slice(0, 7) !== ym) return;
      var d = +String(p.due).slice(8, 10);
      if (!byDay[d]) byDay[d] = { sum: 0, items: [] };
      byDay[d].sum += num(p.amount);
      byDay[d].items.push(p);
    });
    var cells = [];
    for (var i = 0; i < startDow; i++) cells.push(null);
    for (var d2 = 1; d2 <= daysIn; d2++) {
      var iso = ym + '-' + (d2 < 10 ? '0' + d2 : d2);
      var info = byDay[d2] || { sum: 0, items: [] };
      var st = '';
      info.items.forEach(function (p) {
        var s = planStatus(p, today);
        if (s === 'overdue') st = 'overdue';
        else if (s === 'planned' && st !== 'overdue') st = 'planned';
        else if (!st) st = 'paid';
      });
      cells.push({ day: d2, date: iso, sum: round(info.sum), items: info.items, status: st, isToday: iso === today });
    }
    while (cells.length % 7) cells.push(null);
    var weeks = [];
    for (var w = 0; w < cells.length; w += 7) weeks.push(cells.slice(w, w + 7));
    return { weeks: weeks, ym: ym, title: monthName(ym) };
  }

  return {
    TYPES: TYPES, METHODS: METHODS, WEEKDAYS: WEEKDAYS,
    PURCHASE: PURCHASE, DEBT_PAY: DEBT_PAY, SALES: SALES,
    findHeaderRow: findHeaderRow, parseDdsBase: parseDdsBase, parsePayPlan: parsePayPlan, parseFinSettings: parseFinSettings,
    isIncome: isIncome, isExpense: isExpense, isDebt: isDebt, isDraw: isDraw, isPurchase: isPurchase, isDebtPay: isDebtPay,
    balances: balances, totals: totals, group: group,
    byCategory: byCategory, byMethodIncome: byMethodIncome, byShift: byShift,
    byWeekday: byWeekday, byCashier: byCashier,
    monthReport: monthReport, dayReport: dayReport, prevMonth: prevMonth, monthName: monthName,
    planStatus: planStatus, planTotals: planTotals, calendarMonth: calendarMonth
  };
});
