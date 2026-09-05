/* ============================================================================
   Ядро: числа, даты и кассовая математика.
   Никаких выгрузок 1С — программа считает только то, что вписали руками.

   ГЛАВНОЕ ПРАВИЛО, ради которого всё написано:
   в денежном ящике лежат ТОЛЬКО наличные. Карта и СБП в ящик не попадают —
   они уходят на расчётный счёт и наличный остаток не увеличивают.

       расчётный остаток = размен + Z-наличные − выплаты из ящика
       расхождение       = факт в ящике − расчётный остаток

   Расхождение со знаком минус — недостача кассира, с плюсом — излишек.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* --- Числа ---------------------------------------------------------------- */
  function txt(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return txt(v).toLowerCase().replace(/ё/g, 'е'); }

  /* Число из ячейки или поля.
     В русской записи разделитель тысяч — пробел, а запятая десятичная:
     «2,500» это 2,5. Но файл, пересохранённый в английской раскладке,
     приходит как «1,234.56» — там запятая уже разделяет тысячи. Различаем по
     тому, какой знак стоит правее: он и есть десятичный. */
  function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v)
      .replace(/[   \s]/g, '')
      .replace(/₽|руб\.?|rub|р\.$/gi, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else {
      s = s.replace(/,/g, '.');
    }
    var m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return 0;
    var n = parseFloat(m[0]);
    return isFinite(n) ? n : 0;
  }

  // Округление до копеек без «0.30000000000000004»
  function safeRound(v) {
    var n = num(v);
    if (!isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }
  function div(a, b) { b = num(b); return b ? num(a) / b : 0; }

  /* --- Как показываем ------------------------------------------------------- */
  function fmtNum(v, d) {
    var n = num(v);
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('ru-RU', {
      minimumFractionDigits: d == null ? 0 : d,
      maximumFractionDigits: d == null ? 0 : d
    });
  }
  function fmtMoney(v) { return fmtNum(Math.round(num(v))) + ' ₽'; }
  function fmtPct(v, d) { return fmtNum(v, d == null ? 1 : d).replace('.', ',') + '%'; }
  function plural(n, one, few, many) {
    n = Math.abs(Math.round(num(n)));
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  /* --- Даты ------------------------------------------------------------------ */
  function today() { return new Date().toISOString().slice(0, 10); }
  function addDays(date, days) {
    var d = new Date(txt(date) || today());
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + num(days));
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    var x = new Date(txt(a)), y = new Date(txt(b));
    if (isNaN(x.getTime()) || isNaN(y.getTime())) return 0;
    return Math.round((y - x) / 86400000);
  }
  function ymOf(date) { return txt(date).slice(0, 7); }
  var MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
    'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var MONTHS_IM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
    'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  function monthName(ym) { return (MONTHS_OF[+txt(ym).slice(5, 7) - 1] || '') + ' ' + txt(ym).slice(0, 4); }
  function monthTitle(ym) { return (MONTHS_IM[+txt(ym).slice(5, 7) - 1] || '') + ' ' + txt(ym).slice(0, 4); }
  function prevMonth(ym) {
    var y = +txt(ym).slice(0, 4), m = +txt(ym).slice(5, 7) - 1;
    if (m < 1) { m = 12; y--; }
    return y + '-' + (m < 10 ? '0' : '') + m;
  }
  function daysInMonth(ym) {
    return new Date(+txt(ym).slice(0, 4), +txt(ym).slice(5, 7), 0).getDate();
  }
  // Дата из ячейки Excel: и число «45900», и текст «05.09.2026», и «2026-09-05»
  function excelDate(v) {
    if (v instanceof Date && !isNaN(v.getTime())) {
      return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }
    if (typeof v === 'number' && v > 20000 && v < 90000) {
      var ms = Math.round((v - 25569) * 86400000);
      return new Date(ms).toISOString().slice(0, 10);
    }
    var s = txt(v);
    var ru = s.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})/);
    if (ru) return ru[3] + '-' + ru[2] + '-' + ru[1];
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];
    return '';
  }

  /* ==========================================================================
     КАССОВАЯ МАТЕМАТИКА
     ========================================================================== */

  var TILLS = ['Касса 1', 'Касса 2'];
  var SHIFTS = ['День', 'Ночь'];
  // Как называются записи в общей базе движения денег
  var T_SHIFT = 'Смена', T_DAY = 'День', T_IN = 'Приход', T_OUT = 'Расход', T_DRAW = 'Забор';

  function isShift(r) { return txt(r && r.type) === T_SHIFT; }
  function isDay(r) { return txt(r && r.type) === T_DAY; }
  function isIncome(r) { return txt(r && r.type) === T_IN; }
  function isExpense(r) { return txt(r && r.type) === T_OUT; }
  function isDraw(r) { return txt(r && r.type) === T_DRAW; }
  function isCash(method) { return norm(method) === 'наличные' || !txt(method); }

  /* Сверка одной смены. Единственное место, где считается расхождение.
     Безнал (карта, СБП, QR) в расчётный остаток НЕ входит: этих денег в
     ящике не было — они ушли на расчётный счёт. */
  function shiftCalc(s) {
    s = s || {};
    var open = safeRound(s.openCash), zCash = safeRound(s.zCash);
    var zCashless = safeRound(s.zCashless), payouts = safeRound(s.payouts);
    var fact = safeRound(s.factCash);
    var expected = safeRound(open + zCash - payouts);
    var diff = safeRound(fact - expected);
    return {
      openCash: open, zCash: zCash, zCashless: zCashless, payouts: payouts,
      factCash: fact, expected: expected, diff: diff,
      revenue: safeRound(zCash + zCashless),
      short: diff < 0 ? safeRound(-diff) : 0,
      over: diff > 0 ? safeRound(diff) : 0,
      ok: Math.abs(diff) < 0.5,
      status: Math.abs(diff) < 0.5 ? 'сходится' : (diff < 0 ? 'недостача' : 'излишек')
    };
  }

  // Смены по порядку: сначала по дате, потом по кассе, потом день/ночь
  function shiftsOf(rows, filter) {
    var out = (rows || []).filter(function (r) {
      return isShift(r) && (!filter || filter(r));
    });
    return out.sort(function (a, b) {
      return txt(a.date).localeCompare(txt(b.date)) ||
        txt(a.till).localeCompare(txt(b.till)) ||
        SHIFTS.indexOf(txt(a.shift)) - SHIFTS.indexOf(txt(b.shift));
    });
  }

  /* Сколько наличных в ящиках прямо сейчас.
     Раз «факт = расчётный + расхождение», накопленное движение по кассе — это
     Σ(Z-наличные − выплаты + расхождение). Расхождение обязано входить:
     в ящике лежит факт, а не то, что должно было быть.
     Карта и СБП тут не участвуют — они не в ящике. */
  function cashOnHand(rows, settings, upto) {
    settings = settings || {};
    var cash = safeRound(settings.openCashStart);
    (rows || []).forEach(function (r) {
      if (upto && txt(r.date) > upto) return;
      if (isShift(r)) {
        var c = shiftCalc(r);
        cash += c.zCash - c.payouts + c.diff;
      } else if (isIncome(r) && isCash(r.method)) {
        cash += safeRound(r.amount);
      } else if ((isExpense(r) || isDraw(r)) && isCash(r.method)) {
        cash -= safeRound(r.amount);
      }
    });
    return safeRound(cash);
  }

  /* Безналичная выручка: карта, СБП, QR. В кассу не попадает — идёт на счёт.
     Показываем отдельно, чтобы не путать с наличными. */
  function cashlessTotal(rows, from, to) {
    var sum = 0;
    (rows || []).forEach(function (r) {
      if (from && txt(r.date) < from) return;
      if (to && txt(r.date) > to) return;
      if (isShift(r)) sum += safeRound(r.zCashless);
      else if (isIncome(r) && !isCash(r.method)) sum += safeRound(r.amount);
    });
    return safeRound(sum);
  }

  /* Долг поставщикам (кредиторка). Считается ТОЛЬКО из вечерних итогов дня:
     взяли товар в долг — долг вырос, отдали деньги — уменьшился. Второго
     источника у этой цифры нет специально: две дороги к одному числу всегда
     кончаются двойным счётом. */
  function supplierDebt(rows, settings, upto) {
    settings = settings || {};
    var debt = safeRound(settings.openDebtStart);
    var taken = 0, paid = 0;
    (rows || []).forEach(function (r) {
      if (!isDay(r)) return;
      if (upto && txt(r.date) > upto) return;
      taken += safeRound(r.debtTaken);
      paid += safeRound(r.debtPaid);
    });
    return { debt: safeRound(debt + taken - paid), taken: safeRound(taken),
      paid: safeRound(paid), opening: safeRound(settings.openDebtStart) };
  }

  /* Антирейтинг кассиров: у кого чаще и на сколько не сходится касса.
     Считаем ещё и «на 1000 ₽ выручки» — иначе кассир с большой выручкой и
     парой ошибок выглядит хуже того, у кого выручка маленькая, а недостачи
     те же. */
  function cashierRating(rows, from, to) {
    var map = {};
    shiftsOf(rows, function (r) {
      if (from && txt(r.date) < from) return false;
      if (to && txt(r.date) > to) return false;
      return true;
    }).forEach(function (r) {
      var who = txt(r.cashier) || 'Без имени';
      if (!map[who]) map[who] = { name: who, shifts: 0, short: 0, over: 0,
        diff: 0, revenue: 0, badShifts: 0, worst: 0, worstDate: '' };
      var c = shiftCalc(r), m = map[who];
      m.shifts++; m.short += c.short; m.over += c.over; m.diff += c.diff;
      m.revenue += c.revenue;
      if (!c.ok) m.badShifts++;
      if (c.short > m.worst) { m.worst = c.short; m.worstDate = txt(r.date); }
    });
    var out = [];
    for (var k in map) {
      var m = map[k];
      m.short = safeRound(m.short); m.over = safeRound(m.over);
      m.diff = safeRound(m.diff); m.revenue = safeRound(m.revenue);
      m.per1000 = safeRound(div(m.short, m.revenue) * 1000);
      m.badPct = safeRound(div(m.badShifts, m.shifts) * 100);
      out.push(m);
    }
    // сверху тот, у кого недостач больше
    return out.sort(function (a, b) { return b.short - a.short || b.badShifts - a.badShifts; });
  }

  /* Размен новой смены обязан совпадать с фактом предыдущей по той же кассе.
     Не совпал — значит деньги вынули, и это надо записать, иначе учёт
     незаметно разъедется. Возвращаем список таких разрывов. */
  function cashGaps(rows) {
    var last = {}, out = [];
    shiftsOf(rows).forEach(function (r) {
      var till = txt(r.till) || TILLS[0];
      var prev = last[till];
      var c = shiftCalc(r);
      if (prev) {
        var gap = safeRound(safeRound(r.openCash) - prev.fact);
        if (Math.abs(gap) >= 1) {
          out.push({ id: r.id, date: txt(r.date), till: till, shift: txt(r.shift),
            prevDate: prev.date, prevFact: prev.fact, open: safeRound(r.openCash),
            gap: gap });
        }
      }
      last[till] = { fact: c.factCash, date: txt(r.date) };
    });
    return out;
  }

  // Остаток в каждой кассе на конец последней смены
  function tillState(rows, settings) {
    var last = {};
    shiftsOf(rows).forEach(function (r) {
      last[txt(r.till) || TILLS[0]] = { fact: shiftCalc(r).factCash,
        date: txt(r.date), shift: txt(r.shift), cashier: txt(r.cashier) };
    });
    var tills = txt(settings && settings.tills)
      ? txt(settings.tills).split(',').map(function (x) { return x.trim(); }).filter(Boolean)
      : TILLS.slice();
    return tills.map(function (t) {
      return { till: t, fact: last[t] ? last[t].fact : 0,
        date: last[t] ? last[t].date : '', shift: last[t] ? last[t].shift : '',
        cashier: last[t] ? last[t].cashier : '', closed: !!last[t] };
    });
  }

  /* Итоги за период: выручка, расходы, товар, долги. Одна функция на все
     экраны, чтобы цифры нигде не разошлись. */
  function totals(rows, settings) {
    var t = { zCash: 0, zCashless: 0, revenue: 0, payouts: 0, short: 0, over: 0,
      diff: 0, shifts: 0, badShifts: 0, expense: 0, income: 0, draw: 0,
      goodsCash: 0, debtTaken: 0, debtPaid: 0, days: {}, byCategory: {} };
    (rows || []).forEach(function (r) {
      if (isShift(r)) {
        var c = shiftCalc(r);
        t.zCash += c.zCash; t.zCashless += c.zCashless; t.payouts += c.payouts;
        t.short += c.short; t.over += c.over; t.diff += c.diff;
        t.shifts++; if (!c.ok) t.badShifts++;
        if (r.date) t.days[r.date] = true;
      } else if (isDay(r)) {
        t.goodsCash += safeRound(r.goodsCash);
        t.debtTaken += safeRound(r.debtTaken);
        t.debtPaid += safeRound(r.debtPaid);
        if (r.date) t.days[r.date] = true;
      } else if (isIncome(r)) {
        t.income += safeRound(r.amount);
      } else if (isExpense(r)) {
        t.expense += safeRound(r.amount);
        var cat = txt(r.category) || 'Без статьи';
        t.byCategory[cat] = safeRound((t.byCategory[cat] || 0) + safeRound(r.amount));
      } else if (isDraw(r)) {
        t.draw += safeRound(r.amount);
      }
    });
    t.revenue = safeRound(t.zCash + t.zCashless);
    ['zCash', 'zCashless', 'payouts', 'short', 'over', 'diff', 'expense',
      'income', 'draw', 'goodsCash', 'debtTaken', 'debtPaid'].forEach(function (k) {
      t[k] = safeRound(t[k]);
    });
    t.dayCount = Object.keys(t.days).length;
    t.avgDay = safeRound(div(t.revenue, t.dayCount));
    t.avgShift = safeRound(div(t.revenue, t.shifts));
    t.cashlessShare = safeRound(div(t.zCashless, t.revenue) * 100);
    // Все траты магазина: выплаты из ящика плюс отдельные расходы
    t.spent = safeRound(t.payouts + t.expense);
    return t;
  }

  /* --- План выплат ----------------------------------------------------------- */
  var PLAN_STATUS = ['Запланирована', 'Оплачена', 'Отменена'];
  function planStatus(p, t) {
    t = t || today();
    var st = txt(p && p.status) || PLAN_STATUS[0];
    if (st === 'Оплачена') return { key: 'paid', name: 'Оплачена', color: 'green' };
    if (st === 'Отменена') return { key: 'off', name: 'Отменена', color: 'gray' };
    var due = txt(p && p.due);
    if (!due) return { key: 'nodate', name: 'Без даты', color: 'gray' };
    if (due < t) return { key: 'late', name: 'Просрочена', color: 'red' };
    if (due === t) return { key: 'today', name: 'Сегодня', color: 'orange' };
    if (daysBetween(t, due) <= 3) return { key: 'soon', name: 'Скоро', color: 'orange' };
    return { key: 'plan', name: 'Запланирована', color: 'blue' };
  }
  function planTotals(plans, t) {
    t = t || today();
    var r = { overdue: 0, overdueCount: 0, dueToday: 0, week: 0, planned: 0,
      plannedCount: 0, paid: 0 };
    (plans || []).forEach(function (p) {
      var st = planStatus(p, t), a = safeRound(p.amount);
      if (st.key === 'paid') { r.paid += a; return; }
      if (st.key === 'off') return;
      r.planned += a; r.plannedCount++;
      if (st.key === 'late') { r.overdue += a; r.overdueCount++; }
      if (st.key === 'today') r.dueToday += a;
      if (p.due && p.due >= t && daysBetween(t, p.due) <= 7) r.week += a;
    });
    for (var k in r) r[k] = safeRound(r[k]);
    return r;
  }

  /* --- Долги покупателей («тетрадка у кассы») -------------------------------- */
  function debtorTotals(rows, t) {
    t = t || today();
    var open = 0, closed = 0, old = 0, list = {};
    (rows || []).forEach(function (d) {
      var left = safeRound(safeRound(d.sum) - safeRound(d.paid));
      if (left <= 0) { closed += safeRound(d.sum); return; }
      open += left;
      if (daysBetween(d.date, t) > 30) old += left;
      var who = txt(d.name) || 'Без имени';
      list[who] = safeRound((list[who] || 0) + left);
    });
    var people = Object.keys(list).map(function (k) { return { name: k, left: list[k] }; })
      .sort(function (a, b) { return b.left - a.left; });
    return { open: safeRound(open), closed: safeRound(closed), old: safeRound(old), people: people };
  }

  /* --- Пересчёт купюр -------------------------------------------------------- */
  var NOMINALS = [5000, 2000, 1000, 500, 200, 100, 50, 10, 5, 2, 1];
  function countCash(counts) {
    var sum = 0, pieces = 0;
    NOMINALS.forEach(function (n) {
      var c = Math.max(0, Math.round(num(counts && counts['n' + n])));
      sum += n * c; pieces += c;
    });
    return { sum: safeRound(sum), pieces: pieces };
  }

  return {
    txt: txt, norm: norm, num: num, safeRound: safeRound, div: div,
    fmtNum: fmtNum, fmtMoney: fmtMoney, fmtPct: fmtPct, plural: plural,
    today: today, addDays: addDays, daysBetween: daysBetween, excelDate: excelDate,
    ymOf: ymOf, monthName: monthName, monthTitle: monthTitle, prevMonth: prevMonth,
    daysInMonth: daysInMonth,

    TILLS: TILLS, SHIFTS: SHIFTS, PLAN_STATUS: PLAN_STATUS, NOMINALS: NOMINALS,
    T_SHIFT: T_SHIFT, T_DAY: T_DAY, T_IN: T_IN, T_OUT: T_OUT, T_DRAW: T_DRAW,
    isShift: isShift, isDay: isDay, isIncome: isIncome, isExpense: isExpense,
    isDraw: isDraw, isCash: isCash,

    shiftCalc: shiftCalc, shiftsOf: shiftsOf, cashOnHand: cashOnHand,
    cashlessTotal: cashlessTotal, supplierDebt: supplierDebt,
    cashierRating: cashierRating, cashGaps: cashGaps, tillState: tillState,
    totals: totals, planStatus: planStatus, planTotals: planTotals,
    debtorTotals: debtorTotals, countCash: countCash
  };
});
