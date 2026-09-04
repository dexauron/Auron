/* ============================================================================
   Сравнения, ведомости и выгрузки.

   — сравнение любых двух периодов рядом, строка в строку;
   — спарклайн: выручка за 30 дней одной линией прямо в строке;
   — ведомость зарплаты на печать;
   — наценка по поставщику: кто на самом деле зарабатывает магазину;
   — один файл для бухгалтера со всем, что нужно для отчётности.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMExtra = factory();
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

  /* --- Сравнение с прошлым периодом ------------------------------------------
     Цифра сама по себе ничего не говорит: 412 000 — это много или мало?
     Рядом всегда должно стоять «на 8% больше, чем в прошлом месяце».
     ---------------------------------------------------------------------- */
  function delta(now, was) {
    var d = round(now - was);
    var pct = was ? round(d / Math.abs(was) * 100) : null;
    return {
      diff: d, pct: pct,
      dir: d > 0 ? 'up' : (d < 0 ? 'down' : 'flat'),
      has: was !== 0 || now !== 0
    };
  }

  // Границы периода и такого же периода перед ним
  function prevRange(from, to) {
    var days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
    return { from: addDays(from, -days), to: addDays(from, -1), days: days };
  }

  /* --- Спарклайн: 30 дней одной линией --------------------------------------- */
  function spark(values, w, h) {
    var v = (values || []).map(num);
    if (v.length < 2) return '';
    w = w || 90; h = h || 22;
    var max = Math.max.apply(null, v), min = Math.min.apply(null, v);
    var span = max - min || 1;
    var step = w / (v.length - 1);
    var pts = v.map(function (y, i) {
      return (i * step).toFixed(1) + ',' + (h - (y - min) / span * (h - 3) - 1.5).toFixed(1);
    });
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<path class="spark-fill" d="M0,' + h + ' L' + pts.join(' L') + ' L' + w + ',' + h + ' Z"/>' +
      '<path d="M' + pts.join(' L') + '"/></svg>';
  }

  // Выручка по дням за последние N дней — для спарклайна и сравнения
  function dailyRevenue(dds, days, isIncome) {
    // считаем от последнего дня, где вообще есть записи: если выгрузка за
    // прошлый месяц, график должен показывать её, а не пустые 30 дней
    var last = '';
    (dds || []).forEach(function (r) { if (r.date && r.date > last && r.date <= today()) last = r.date; });
    var end = last || today(), start = addDays(end, -(days || 30) + 1);
    var by = {};
    for (var d = start; d <= end; d = addDays(d, 1)) by[d] = 0;
    (dds || []).forEach(function (r) {
      if (!r.date || r.date < start || r.date > end) return;
      if (isIncome && !isIncome(r)) return;
      by[r.date] = (by[r.date] || 0) + num(r.amount);
    });
    return Object.keys(by).sort().map(function (k) { return { date: k, sum: round(by[k]) }; });
  }

  /* --- Наценка по поставщику -------------------------------------------------
     Приход в закупе и в рознице лежит в самой накладной 1С. Значит, видно,
     сколько магазин зарабатывает на каждой фирме, а не только сколько ей должен.
     ---------------------------------------------------------------------- */
  function markupByFirm(docs) {
    var map = {};
    (docs || []).forEach(function (d) {
      if (!d.firm) return;
      var k = norm(d.firm);
      if (!map[k]) map[k] = { firm: d.firm, docs: 0, buy: 0, retail: 0, left: 0 };
      map[k].docs++; map[k].buy += num(d.sum); map[k].retail += num(d.retail); map[k].left += num(d.left);
    });
    var out = [];
    Object.keys(map).forEach(function (k) {
      var m = map[k];
      m.buy = round(m.buy); m.retail = round(m.retail); m.left = round(m.left);
      m.gross = round(m.retail - m.buy);                       // сколько заработаем, если продадим всё
      m.markup = m.buy ? round(m.gross / m.buy * 100) : 0;     // наценка к закупу
      m.margin = m.retail ? round(m.gross / m.retail * 100) : 0;
      if (m.retail > 0) out.push(m);
    });
    return out.sort(function (a, b) { return b.gross - a.gross; });
  }

  /* --- Ведомость зарплаты ---------------------------------------------------- */
  function payrollSheet(rows, period) {
    var total = { accrued: 0, paid: 0, left: 0, hours: 0, shifts: 0 };
    (rows || []).forEach(function (r) {
      total.accrued += num(r.accrued); total.paid += num(r.paid);
      total.left += num(r.left); total.hours += num(r.hours); total.shifts += num(r.shifts);
    });
    Object.keys(total).forEach(function (k) { total[k] = round(total[k]); });
    return { rows: rows || [], total: total, period: period || '' };
  }

  /* --- Что положить в файл для бухгалтера ------------------------------------
     Один xlsx, в котором есть всё, что обычно просят: доходы и расходы по
     дням, зарплата, поставщики и налог за период.
     ---------------------------------------------------------------------- */
  function accountantData(state, settings, FIN, sup, from, to) {
    function inRange(d) { return d && d >= from && d <= to; }
    var dds = (state.dds || []).filter(function (r) { return inRange(r.date); });
    var t = FIN.totals(dds);
    var byDay = {};
    dds.forEach(function (r) {
      if (!byDay[r.date]) byDay[r.date] = { date: r.date, income: 0, expense: 0 };
      if (FIN.isIncome(r)) byDay[r.date].income += num(r.amount);
      else if (FIN.isExpense(r)) byDay[r.date].expense += num(r.amount);
    });
    var days = Object.keys(byDay).sort().map(function (k) {
      var d = byDay[k];
      d.income = round(d.income); d.expense = round(d.expense);
      d.profit = round(d.income - d.expense);
      return d;
    });
    var docs = ((sup && sup.docs) || []).filter(function (d) { return inRange(d.date); });
    var pays = (state.pays || []).filter(function (p) { return inRange(p.date); });
    var tax = FIN.taxAmount(settings, t.income, t.expense);
    return {
      from: from, to: to, totals: t, days: days,
      categories: FIN.byCategory(dds),
      methods: FIN.byMethodIncome(dds),
      docs: docs, pays: pays,
      payouts: (state.payouts || []).filter(function (r) { return inRange(r.date); }),
      timesheet: (state.timesheet || []).filter(function (r) { return inRange(r.date); }),
      tax: tax
    };
  }

  return {
    delta: delta, prevRange: prevRange, spark: spark, dailyRevenue: dailyRevenue,
    markupByFirm: markupByFirm, payrollSheet: payrollSheet, accountantData: accountantData,
    addDays: addDays, today: today
  };
});
