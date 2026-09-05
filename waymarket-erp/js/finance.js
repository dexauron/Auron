/* ============================================================================
   Переходник между новой моделью кассы и отчётами.

   Раньше движение денег хранилось строками «Приход / Расход» с суммой.
   Теперь смена — одна запись со своей арифметикой, а вечерние итоги дня —
   другая. Чтобы отчёты не переписывать под каждую мелочь, этот файл отдаёт
   им привычный вид: список операций, где у каждой есть тип, статья, способ
   и сумма. Сам он ничего не хранит — только раскладывает.

   Правило, которое здесь важнее всего: ВЫПЛАТЫ ИЗ ЯЩИКА не превращаются в
   расход. Это способ, которым платили, а не отдельная трата: аренда,
   оплаченная из ящика, уже стоит в своей статье. Иначе она посчиталась бы
   дважды — и в кассе, и в прибыли.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.WMFin = factory(root.WM);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  var num = E.num, txt = E.txt, norm = E.norm, round = E.safeRound, div = E.div;

  var SALES = 'Продажи';
  var METHODS = ['Наличные', 'Карта', 'СБП', 'Перевод'];

  function isIncome(r) { return norm(r && r.type) === 'приход'; }
  function isExpense(r) { return norm(r && r.type) === 'расход'; }
  function isDraw(r) { return norm(r && r.type) === 'забор'; }
  // Закуп товара расходом магазина не считается: это не трата, а обмен
  // денег на товар. В «куда ушли деньги» он идёт отдельной строкой.
  function isPurchase(r) {
    var c = norm(r && r.category);
    return c.indexOf('закуп') >= 0 || c.indexOf('оплата тп') >= 0 || c.indexOf('поставщик') >= 0;
  }

  /* Разложить базу в плоский список операций — так её ждут отчёты.
     Смена превращается в две строки выручки (наличные и безнал), вечерние
     итоги — в закуп товара. Выплаты из ящика строкой расхода НЕ становятся. */
  function flatten(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (E.isShift(r)) {
        var c = E.shiftCalc(r);
        var base = { date: r.date, shift: r.shift, cashier: r.cashier, till: r.till,
          type: 'Приход', category: SALES, src: 'смена', id: r.id, group: r.id };
        if (c.zCash) out.push(Object.assign({}, base, { method: 'Наличные', amount: c.zCash,
          diff: c.diff, checks: num(r.checks) }));
        if (c.zCashless) out.push(Object.assign({}, base, { method: 'Безнал', amount: c.zCashless,
          diff: 0, checks: c.zCash ? 0 : num(r.checks) }));
      } else if (E.isDay(r)) {
        if (num(r.goodsCash)) out.push({ date: r.date, type: 'Расход', category: 'Закуп товара',
          method: 'Наличные', amount: num(r.goodsCash), src: 'итоги дня', id: r.id, noCash: true });
        if (num(r.debtTaken)) out.push({ date: r.date, type: 'Долг', category: 'Закуп товара',
          method: '', amount: num(r.debtTaken), src: 'итоги дня', id: r.id });
        if (num(r.debtPaid)) out.push({ date: r.date, type: 'Оплата долга', category: 'Оплата ТП',
          method: '', amount: num(r.debtPaid), src: 'итоги дня', id: r.id, noCash: true });
      } else if (E.isMove(r)) {
        /* Перемещение денег отчётам не отдаём вовсе: в «куда ушли деньги» и
           в прибыли ему места нет — деньги не потрачены, а переложены.
           Наличный остаток считает cashOnHand, он смотрит саму запись. */
        return;
      } else if (E.isExpense(r) && E.notACost(r.category)) {
        // Старые записи с закупом или долгом в статье расхода: в отчёты о
        // прибыли они не идут, иначе те же деньги вычтутся дважды
        return;
      } else {
        out.push(r);
      }
    });
    return out;
  }

  // Сколько денег по статье за период — по названию статьи
  function byKind(rows, kind) {
    var sum = 0;
    (rows || []).forEach(function (r) {
      if (!E.isExpense(r) || E.notACost(r.category)) return;
      if (E.costKindOf(r.category) === kind) sum += num(r.amount);
    });
    return round(sum);
  }

  // Итоги в привычном отчётам виде
  function totals(rows) {
    var t = E.totals(rows);
    var debt = E.supplierDebt(rows || [], {});
    return {
      salary: byKind(rows, 'fot'), rent: byKind(rows, 'rent'),
      debtNow: debt.debt,
      income: t.revenue, expense: t.expense, purchase: round(t.goodsCash + t.debtTaken),
      profit: round(t.revenue - t.expense), draw: t.draw,
      other: t.expense,
      debtTaken: t.debtTaken, debtPaid: t.debtPaid,
      diffSum: t.diff, diffCount: t.badShifts, shifts: t.shifts,
      days: t.dayCount, avgDay: t.avgDay, avgShift: t.avgShift,
      margin: t.revenue ? round(div(t.revenue - round(t.goodsCash + t.debtTaken), t.revenue) * 100) : 0,
      profitability: t.revenue ? round(div(t.revenue - t.expense, t.revenue) * 100) : 0,
      tx: (rows || []).length, byDay: {}
    };
  }

  // Разрез по любому полю: сумма, доля, количество
  function group(rows, keyFn, filterFn) {
    var map = {}, total = 0;
    (rows || []).forEach(function (r) {
      if (filterFn && !filterFn(r)) return;
      var k = keyFn(r) || '—', a = num(r.amount);
      if (!map[k]) map[k] = { name: k, sum: 0, count: 0 };
      map[k].sum += a; map[k].count++; total += a;
    });
    var out = [];
    for (var k in map) {
      map[k].sum = round(map[k].sum);
      map[k].share = total ? round(div(map[k].sum, total) * 100) : 0;
      out.push(map[k]);
    }
    return out.sort(function (a, b) { return b.sum - a.sum; });
  }
  function byCategory(rows) { return group(flatten(rows), function (r) { return r.category; }, isExpense); }
  function byMethodIncome(rows) { return group(flatten(rows), function (r) { return r.method; }, isIncome); }
  function byCashier(rows) { return group(flatten(rows), function (r) { return r.cashier; }, isIncome); }
  function byShift(rows) { return group(flatten(rows), function (r) { return r.shift; }, isIncome); }

  // Налог по выбранной системе. Считается от денег, а не от начислений.
  function taxAmount(settings, income, expense) {
    settings = settings || {};
    var mode = norm(settings.taxMode || ''), rate = num(settings.taxRate) / 100;
    if (mode.indexOf('патент') >= 0) return { sum: round(num(settings.patentMonth)), base: 0, name: 'Патент' };
    if (mode.indexOf('не считать') >= 0 || !mode) return { sum: 0, base: 0, name: 'Налог не считается' };
    var base = mode.indexOf('минус расход') >= 0
      ? Math.max(0, num(income) - num(expense)) : num(income);
    return { sum: round(base * rate), base: round(base), rate: num(settings.taxRate),
      name: settings.taxMode };
  }

  /* Где сейчас лежат деньги. Наличные считает касса (размен, смены, расходы
     наличными), безнал приходит с карт и СБП — в ящик он не попадает. */
  function balances(rows, opening) {
    opening = opening || {};
    var cash = E.cashOnHand(rows || [], { openCashStart: num(opening['Наличные']) });
    var cashless = E.cashlessTotal(rows || []);
    var map = { 'Наличные': cash, 'Карта': 0, 'СБП': 0, 'Перевод': 0, 'Безнал': cashless };
    (rows || []).forEach(function (r) {
      if (!E.isExpense(r) || E.notACost(r.category)) return;
      var m = txt(r.method);
      if (m && m !== 'Наличные' && map[m] !== undefined) map[m] = round(map[m] - num(r.amount));
    });
    map['Сейф'] = E.safeOnHand(rows || [], { openSafeStart: num(opening['Сейф']) });
    return { map: map, cash: cash, cashless: cashless, safe: map['Сейф'],
      total: round(cash + cashless + map['Сейф']) };
  }

  /* Деньги «в пути» — эквайринг, который банк ещё не зачислил. В ручном учёте
     мы их не отслеживаем: Z-отчёт по безналу и так лежит в своей строке.
     Функция оставлена, чтобы отчёты не спотыкались. */
  function inTransit() { return { sum: 0, rows: [] }; }

  function monthName(ym) { return E.monthName(ym); }
  function monthTitle(ym) { return E.monthTitle(ym); }
  function prevMonth(ym) { return E.prevMonth(ym); }

  return {
    SALES: SALES, METHODS: METHODS,
    isIncome: isIncome, isExpense: isExpense, isDraw: isDraw, isPurchase: isPurchase,
    balances: balances, inTransit: inTransit, byKind: byKind,
    flatten: flatten, totals: totals, group: group,
    byCategory: byCategory, byMethodIncome: byMethodIncome,
    byCashier: byCashier, byShift: byShift,
    taxAmount: taxAmount, monthName: monthName, monthTitle: monthTitle, prevMonth: prevMonth
  };
});
