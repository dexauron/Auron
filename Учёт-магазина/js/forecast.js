/* ============================================================================
   Деньги вперёд: прогноз, календарь, долги, налоги.

   52 — прогноз кассового разрыва: хватит ли денег на выплаты;
   53 — календарь денег по дням вперёд;
   54 — график «сколько денег будет» на месяц;
   55 — долг с процентами и отсрочкой по договору;
   56 — частичная оплата накладной с историей платежей;
   57 — взаимозачёт: поставщик должен нам за возврат;
   61 — точка безубыточности по дням с накоплением;
   63 — реальная маржа после списаний;
   65 — налоговый календарь: когда и сколько платить;
   118 — долги по срокам: до 7 дней, 7–30, больше.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMForecast = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/ё/g, 'е'); }
  function round(v) { return Math.round(v * 100) / 100; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function addDays(d, n) {
    var x = new Date(d || today()); x.setDate(x.getDate() + n);
    return x.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    var d = (new Date(b) - new Date(a)) / 86400000;
    return isFinite(d) ? Math.round(d) : 0;
  }

  /* --- Сколько магазин зарабатывает в обычный день ---------------------------
     Берём медиану последних дней, а не среднее: один праздник с двойной
     выручкой не должен рисовать слишком радужный прогноз.
     ---------------------------------------------------------------------- */
  function median(list) {
    if (!list.length) return 0;
    var s = list.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function dayPace(dds, isIncome, isExpense, days) {
    var back = days || 60, from = addDays(today(), -back);
    var inc = {}, exp = {};
    (dds || []).forEach(function (r) {
      if (!r.date || r.date < from || r.date > today()) return;
      if (isIncome(r)) inc[r.date] = (inc[r.date] || 0) + num(r.amount);
      else if (isExpense(r)) exp[r.date] = (exp[r.date] || 0) + num(r.amount);
    });
    var incDays = Object.keys(inc).map(function (k) { return inc[k]; });
    var expDays = Object.keys(exp).map(function (k) { return exp[k]; });
    return {
      income: round(median(incDays)), expense: round(median(expDays)),
      net: round(median(incDays) - median(expDays)),
      daysWithData: incDays.length
    };
  }

  /* --- 52/53/54. Календарь денег вперёд --------------------------------------
     Каждый день: сколько придёт (по обычному темпу), сколько надо отдать
     (подтверждённые выплаты и план), и что останется в кассе.
     ---------------------------------------------------------------------- */
  function calendar(opts) {
    var days = opts.days || 30;
    var cash = num(opts.cashNow);
    var pace = opts.pace || { income: 0, expense: 0 };
    var out = [], gap = null, minDay = null;
    var byDay = {};

    function put(date, sum, what, who) {
      if (!date) return;
      (byDay[date] = byDay[date] || []).push({ sum: round(sum), what: what, who: who || '' });
    }
    // подтверждённые накладные с датой выплаты
    (opts.docs || []).forEach(function (d) {
      if (d.left > 0 && d.confirmed && d.due) put(d.due, d.left, 'накладная', d.firm);
    });
    // ручной план выплат
    (opts.plans || []).forEach(function (p) {
      if (norm(p.status) === 'оплачено' || p.paidAt) return;
      put(p.due, num(p.amount), 'план', p.supplier);
    });
    // зарплата и налоги — по датам из настроек
    (opts.fixed || []).forEach(function (f) { put(f.date, f.sum, f.what, f.who); });

    var balance = cash;
    for (var i = 0; i < days; i++) {
      var date = addDays(today(), i);
      var pays = byDay[date] || [];
      var out_ = pays.reduce(function (a, p) { return a + p.sum; }, 0);
      // в первый день доход уже учтён в остатке кассы
      var inc = i === 0 ? 0 : pace.income;
      var exp = i === 0 ? 0 : pace.expense;
      balance = round(balance + inc - exp - out_);
      var row = { date: date, income: round(inc), expense: round(exp),
        pays: pays, payOut: round(out_), balance: balance, day: i };
      if (balance < 0 && gap === null) gap = row;
      if (!minDay || balance < minDay.balance) minDay = row;
      out.push(row);
    }
    return {
      rows: out, gap: gap, min: minDay, cashNow: round(cash), pace: pace,
      needed: gap ? round(-gap.balance) : 0
    };
  }

  /* --- 118. Долги по срокам --------------------------------------------------- */
  /* --- 55. Долг с процентами и отсрочкой -------------------------------------
     Если поставщик берёт процент за отсрочку, долг растёт со дня выплаты.
     Считаем простые проценты по дням просрочки — как в договоре.
     ---------------------------------------------------------------------- */
  /* --- 56. История платежей по накладной -------------------------------------- */
  /* --- 57. Взаимозачёт: поставщик должен нам ---------------------------------- */
  /* --- 61. Безубыточность по дням с накоплением ------------------------------- */
  function bepDays(dds, isIncome, fixedMonth, marginPct, ym) {
    var month = ym || today().slice(0, 7);
    var byDay = {};
    (dds || []).forEach(function (r) {
      if (!r.date || r.date.slice(0, 7) !== month || !isIncome(r)) return;
      byDay[r.date] = (byDay[r.date] || 0) + num(r.amount);
    });
    var y = +month.slice(0, 4), m = +month.slice(5, 7);
    var daysIn = new Date(y, m, 0).getDate();
    var need = num(fixedMonth), margin = num(marginPct) / 100 || 0.25;
    var perDay = round(need / daysIn);
    var acc = 0, accNeed = 0, out = [], passed = null;
    for (var d = 1; d <= daysIn; d++) {
      var date = month + '-' + ('0' + d).slice(-2);
      var rev = round(byDay[date] || 0);
      acc = round(acc + rev * margin);           // сколько валовой прибыли накопили
      accNeed = round(accNeed + perDay);
      var row = { date: date, day: d, revenue: rev, gross: round(rev * margin),
        acc: acc, need: accNeed, ahead: round(acc - accNeed) };
      if (acc >= need && passed === null) passed = row;
      out.push(row);
    }
    return { rows: out, need: need, perDay: perDay, margin: round(margin * 100),
      passed: passed, acc: acc, daysIn: daysIn, month: month };
  }

  /* --- 63. Реальная маржа после списаний -------------------------------------- */
  /* --- 65. Налоговый календарь ------------------------------------------------
     Даты по НК РФ: УСН — авансы 28 апреля, 28 июля, 28 октября, налог за год
     28 марта (ИП — 28 апреля); страховые взносы ИП — 28 декабря, 1% свыше
     300 тысяч — 1 июля следующего года. Патент — по срокам патента.
     ---------------------------------------------------------------------- */
  function taxCalendar(settings, year, taxAmountFn, income, expense) {
    var y = year || +today().slice(0, 4);
    var mode = norm(settings && settings.taxMode);
    var isIP = norm(settings && settings.legalForm).indexOf('ип') >= 0 ||
      norm(settings && settings.legalName).indexOf('ип') >= 0;
    var out = [];
    function add(date, name, sum, note) {
      out.push({ date: date, name: name, sum: round(num(sum)), note: note || '',
        past: date < today(), soon: date >= today() && daysBetween(today(), date) <= 14 });
    }
    if (mode.indexOf('усн') >= 0) {
      var q = taxAmountFn ? taxAmountFn(settings, income / 4, expense / 4).sum : 0;
      add(y + '-04-28', 'Аванс по УСН за 1 квартал', q, 'считается по факту квартала');
      add(y + '-07-28', 'Аванс по УСН за полугодие', q, '');
      add(y + '-10-28', 'Аванс по УСН за 9 месяцев', q, '');
      add((y + 1) + (isIP ? '-04-28' : '-03-28'), 'Налог по УСН за год',
        taxAmountFn ? taxAmountFn(settings, income, expense).sum : 0,
        isIP ? 'для ИП' : 'для ООО');
    } else if (mode.indexOf('патент') >= 0) {
      add(y + '-04-01', 'Патент: первая треть', num(settings.patentSum) / 3, 'если патент на год');
      add(y + '-12-31', 'Патент: остаток', num(settings.patentSum) / 3 * 2, '');
    }
    if (isIP) {
      add(y + '-12-28', 'Страховые взносы ИП за себя', num(settings.ipFixed) || 53658,
        'фиксированная часть');
      var over = Math.max(0, income - 300000) * 0.01;
      add((y + 1) + '-07-01', '1% с дохода свыше 300 000 ₽', over, 'за ' + y + ' год');
    }
    add(y + '-01-25', 'НДФЛ и взносы за работников', 0, 'если есть сотрудники — ежемесячно до 28 числа');
    return out.filter(function (r) { return r.sum > 0 || r.note; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  return {
    median: median, dayPace: dayPace, calendar: calendar, bepDays: bepDays, taxCalendar: taxCalendar,
    addDays: addDays, daysBetween: daysBetween
  };
});
