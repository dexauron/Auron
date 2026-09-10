/* ============================================================================
   Отчёты для владельца: куда ушли деньги, средний чек, что было год назад,
   прогноз до конца месяца, влияние календаря, главные проблемы месяца,
   группы товаров и рейтинг по прибыли.
   Считает только по тому, что есть в базе. Чего в выгрузках нет — так и
   говорит, а не подставляет красивое число.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'), require('./finance.js'), require('./numpad.js'));
  } else root.WMReports = factory(root.WM, root.WMFin, root.WMNum);
})(typeof self !== 'undefined' ? self : this, function (E, F, NUM) {
  'use strict';

  var num = E.num, txt = E.txt, norm = E.norm, round = E.safeRound, div = E.div;

  function ymOf(d) { return txt(d).slice(0, 7); }
  function inMonth(r, ym) { return ymOf(r.date) === ym; }
  function median(list) {
    var a = list.slice().sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /* --- 101. Куда ушли деньги за месяц ---------------------------------------
     Водопад: выручка сверху, каждая статья отнимает свой кусок, внизу —
     что осталось. Видно не «расходов 900 тысяч», а из чего они сложились.
     ---------------------------------------------------------------------- */
  function moneyFlow(rows, ym) {
    var per = ym ? rows.filter(function (r) { return inMonth(r, ym); }) : rows;
    var income = 0, byCat = {}, draw = 0;
    per.forEach(function (r) {
      var a = num(r.amount);
      if (F.isIncome(r)) income += a;
      else if (F.isExpense(r)) {
        var k = txt(r.category) || 'Без статьи';
        byCat[k] = (byCat[k] || 0) + a;
      } else if (F.isDraw(r)) draw += a;
    });
    var parts = [];
    for (var k in byCat) parts.push({ name: k, sum: round(byCat[k]) });
    parts.sort(function (a, b) { return b.sum - a.sum; });
    // мелочь ниже 2% сворачиваем в «прочее»: длинный хвост картинку только портит
    var big = [], small = 0;
    parts.forEach(function (p) {
      if (income && p.sum / income < 0.02 && parts.length > 6) small += p.sum;
      else big.push(p);
    });
    if (small > 0) big.push({ name: 'Прочие мелкие траты', sum: round(small) });
    if (draw > 0) big.push({ name: 'Забрал владелец', sum: round(draw), draw: true });

    var left = income, steps = [];
    steps.push({ name: 'Выручка', sum: round(income), left: round(income), kind: 'start' });
    big.forEach(function (p) {
      left -= p.sum;
      steps.push({ name: p.name, sum: round(p.sum), left: round(left),
        share: income ? round(div(p.sum, income) * 100) : 0, kind: p.draw ? 'draw' : 'out' });
    });
    steps.push({ name: 'Осталось', sum: round(left), left: round(left), kind: 'end' });
    return { steps: steps, income: round(income), left: round(left), draw: round(draw),
      expense: round(income - left - draw) };
  }

  /* --- 104. Средний чек ------------------------------------------------------
     Количество чеков берём из Z-отчёта — его вписывает кассир при закрытии
     смены. В выгрузках 1С (Штрих-М) чеков нет: там только итоги по товарам,
     поэтому сами мы это число не выдумываем.
     Чеки записаны на каждой строке смены, поэтому считаем по сменам, а не
     по строкам — иначе одна смена посчиталась бы трижды.
     ---------------------------------------------------------------------- */
  function avgCheck(rows) {
    var byDay = {}, seen = {};
    rows.forEach(function (r) {
      if (!F.isIncome(r)) return;
      var d = txt(r.date); if (!d) return;
      if (!byDay[d]) byDay[d] = { date: d, checks: 0, revenue: 0 };
      byDay[d].revenue += num(r.amount);
      var g = txt(r.group) || r.id;               // одна смена — один счётчик чеков
      if (num(r.checks) > 0 && !seen[g]) { seen[g] = 1; byDay[d].checks += num(r.checks); }
    });
    var days = Object.keys(byDay).sort().map(function (d) {
      var x = byDay[d];
      x.revenue = round(x.revenue);
      x.avg = x.checks ? round(div(x.revenue, x.checks)) : 0;
      return x;
    });
    var withChecks = days.filter(function (d) { return d.checks > 0; });
    var checks = withChecks.reduce(function (a, d) { return a + d.checks; }, 0);
    var revenue = withChecks.reduce(function (a, d) { return a + d.revenue; }, 0);
    // тренд: половина периода против половины
    var half = Math.floor(withChecks.length / 2), trend = null;
    if (withChecks.length >= 4) {
      var a1 = median(withChecks.slice(0, half).map(function (d) { return d.avg; }));
      var a2 = median(withChecks.slice(half).map(function (d) { return d.avg; }));
      trend = { was: round(a1), now: round(a2), change: round(a2 - a1),
        pct: a1 ? round(div(a2 - a1, a1) * 100) : 0 };
    }
    return {
      days: days, withChecks: withChecks.length, totalDays: days.length,
      checks: checks, revenue: round(revenue),
      avg: checks ? round(div(revenue, checks)) : 0,
      checksPerDay: withChecks.length ? round(div(checks, withChecks.length)) : 0,
      trend: trend
    };
  }

  /* --- 107. Что было год назад ----------------------------------------------
     Тот же месяц прошлого года: у продуктового магазина сравнивать нужно
     именно так, а не с прошлым месяцем — январь и декабрь несравнимы.
     ---------------------------------------------------------------------- */
  function yearAgoYm(ym) {
    var p = txt(ym).split('-');
    return p.length === 2 ? (Number(p[0]) - 1) + '-' + p[1] : '';
  }
  function yearAgo(rows, ym) {
    var prevYm = yearAgoYm(ym);
    var cur = rows.filter(function (r) { return inMonth(r, ym); });
    var prv = rows.filter(function (r) { return inMonth(r, prevYm); });
    var a = F.totals(cur), b = F.totals(prv);
    function line(name, x, y, money) {
      var change = round(x - y);
      return { name: name, cur: x, prev: y, change: change,
        pct: y ? round(div(change, Math.abs(y)) * 100) : null, money: !!money };
    }
    return {
      ym: ym, prevYm: prevYm, has: prv.length > 0,
      lines: [
        line('Выручка', a.income, b.income, true),
        line('Расход', a.expense, b.expense, true),
        line('Закуп товара', a.purchase, b.purchase, true),
        line('Прибыль', a.profit, b.profit, true),
        line('Маржа, %', a.margin, b.margin),
        line('Средняя выручка в день', a.avgDay, b.avgDay, true),
        line('Дней с записями', a.days, b.days)
      ]
    };
  }

  /* --- 108. Прогноз выручки до конца месяца ----------------------------------
     Считаем по медиане дневной выручки, а не по среднему: один праздничный
     день с двойной выручкой не должен обещать такой же весь месяц.
     ---------------------------------------------------------------------- */
  function monthPace(rows, ym, today) {
    var byDay = {};
    rows.forEach(function (r) {
      if (!F.isIncome(r) || !inMonth(r, ym)) return;
      byDay[r.date] = (byDay[r.date] || 0) + num(r.amount);
    });
    var dates = Object.keys(byDay).sort();
    var vals = dates.map(function (d) { return byDay[d]; });
    var done = vals.reduce(function (a, v) { return a + v; }, 0);
    var y = Number(ym.slice(0, 4)), mo = Number(ym.slice(5, 7));
    var inMonthDays = new Date(y, mo, 0).getDate();
    var lastDay = dates.length ? Number(dates[dates.length - 1].slice(8, 10)) : 0;
    var todayDay = ymOf(today) === ym ? Number(txt(today).slice(8, 10)) : lastDay;
    var passed = Math.max(lastDay, Math.min(todayDay, inMonthDays));
    var left = Math.max(0, inMonthDays - passed);
    var med = round(median(vals)), avg = dates.length ? round(div(done, dates.length)) : 0;
    return {
      ym: ym, days: inMonthDays, passed: passed, left: left,
      done: round(done), median: med, average: avg,
      forecast: round(done + med * left),
      forecastAvg: round(done + avg * left),
      daysWithData: dates.length,
      // насколько разбросаны дни: если минимум вдвое меньше максимума,
      // прогноз честнее показывать вилкой
      low: round(done + (vals.length ? Math.min.apply(null, vals) : 0) * left),
      high: round(done + (vals.length ? Math.max.apply(null, vals) : 0) * left)
    };
  }

  /* --- 109. Календарь: праздники, выходные, дни зарплаты ---------------------
     Погоду офлайн взять неоткуда — честно об этом пишем. А календарь
     программа знает сама: праздники, предпраздничные дни, выходные и дни,
     когда у людей зарплата.
     ---------------------------------------------------------------------- */
  var HOLIDAYS = ['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08',
    '02-23', '03-08', '05-01', '05-09', '06-12', '11-04', '12-31'];
  function isHoliday(date) { return HOLIDAYS.indexOf(txt(date).slice(5)) >= 0; }
  function dayKind(date) {
    var d = new Date(txt(date) + 'T00:00:00');
    if (isNaN(d.getTime())) return 'обычный день';
    var next = new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
    if (isHoliday(date)) return 'праздник';
    if (isHoliday(next)) return 'канун праздника';
    var dow = d.getDay();
    if (dow === 0 || dow === 6) return 'выходной';
    var num_ = Number(txt(date).slice(8, 10));
    if (num_ <= 5 || (num_ >= 15 && num_ <= 20)) return 'дни зарплаты';
    return 'обычный день';
  }
  function calendarEffect(rows) {
    var byDay = {};
    rows.forEach(function (r) {
      if (!F.isIncome(r) || !r.date) return;
      byDay[r.date] = (byDay[r.date] || 0) + num(r.amount);
    });
    var kinds = {};
    Object.keys(byDay).forEach(function (d) {
      var k = dayKind(d);
      if (!kinds[k]) kinds[k] = { kind: k, days: 0, sum: 0, list: [] };
      kinds[k].days++; kinds[k].sum += byDay[d]; kinds[k].list.push(round(byDay[d]));
    });
    var all = Object.keys(byDay).map(function (d) { return byDay[d]; });
    var base = median(all.length ? all : [0]);
    var out = Object.keys(kinds).map(function (k) {
      var x = kinds[k];
      x.avg = round(div(x.sum, x.days));
      x.med = round(median(x.list));
      x.vs = base ? round(div(x.med - base, base) * 100) : 0;
      x.sum = round(x.sum);
      return x;
    }).sort(function (a, b) { return b.med - a.med; });
    return { rows: out, base: round(base), days: all.length };
  }

  /* --- 110. Три главные проблемы месяца --------------------------------------
     Не список всего подряд, а то, что стоит денег. Каждая проблема — с
     суммой в рублях, чтобы было видно, за что браться первым.
     ---------------------------------------------------------------------- */
  function topProblems(opts) {
    opts = opts || {};
    var rows = opts.dds || [], ym = opts.ym || '';
    var per = ym ? rows.filter(function (r) { return inMonth(r, ym); }) : rows;
    var t = F.totals(per);
    var list = [];

    // недостачи по кассе
    var short = 0, shortDays = 0;
    per.forEach(function (r) { if (num(r.diff) < 0) { short += Math.abs(num(r.diff)); shortDays++; } });
    if (short > 0) {
      list.push({ sum: round(short), what: 'Недостачи в кассе',
        why: shortDays + ' ' + (shortDays === 1 ? 'смена' : 'смен') + ' с недостачей',
        fix: 'Посмотрите, кто работал в эти смены', go: 'cashiers' });
    }
    // списания товара
    if (num(opts.writeoffSum) > 0) {
      list.push({ sum: round(opts.writeoffSum), what: 'Списанный товар',
        why: 'Просрочка, бой и порча за период',
        fix: 'Уценивайте заранее — за 3 дня до срока', go: 'losses' });
    }
    // возвраты поставщикам, которые не забрали
    if (num(opts.returnSum) > 0) {
      list.push({ sum: round(opts.returnSum), what: 'Возвраты поставщикам',
        why: 'Товар вернули — деньги ещё не зачли',
        fix: 'Проверьте, зачёл ли поставщик возврат', go: 'returns2' });
    }
    // просроченные платежи
    if (num(opts.overdue) > 0) {
      list.push({ sum: round(opts.overdue), what: 'Просроченные платежи поставщикам',
        why: (opts.overdueCount || 0) + ' платежей мимо срока',
        fix: 'Договоритесь о переносе или платите частями', go: 'finpay' });
    }
    // деньги, замороженные в неликвиде
    if (num(opts.deadMoney) > 0) {
      list.push({ sum: round(opts.deadMoney), what: 'Деньги стоят в неликвиде',
        why: 'Товар лежит без движения',
        fix: 'Распродайте со скидкой — вернёте оборотные', go: 'dead' });
    }
    // категория расхода, выросшая против прошлого месяца
    if (ym) {
      var prevYm = F.prevMonth(ym);
      var prev = rows.filter(function (r) { return inMonth(r, prevYm); });
      var a = {}, b = {};
      per.forEach(function (r) { if (F.isExpense(r) && !F.isPurchase(r)) a[txt(r.category)] = (a[txt(r.category)] || 0) + num(r.amount); });
      prev.forEach(function (r) { if (F.isExpense(r) && !F.isPurchase(r)) b[txt(r.category)] = (b[txt(r.category)] || 0) + num(r.amount); });
      var worst = null;
      for (var k in a) {
        var grew = a[k] - (b[k] || 0);
        if (b[k] && grew > 0 && (!worst || grew > worst.grew)) {
          worst = { cat: k, grew: grew, was: b[k], now: a[k] };
        }
      }
      if (worst && worst.grew > 0) {
        list.push({ sum: round(worst.grew), what: 'Выросли расходы: ' + worst.cat,
          why: 'Было ' + E.fmtMoney(worst.was) + ', стало ' + E.fmtMoney(worst.now),
          fix: 'Проверьте, почему выросло', go: 'findash' });
      }
    }
    // маржа просела
    if (opts.marginPrev != null && t.margin < opts.marginPrev - 1 && t.income) {
      var lost = round(t.income * (opts.marginPrev - t.margin) / 100);
      list.push({ sum: lost, what: 'Маржа просела',
        why: 'Была ' + round(opts.marginPrev) + '%, стала ' + round(t.margin) + '%',
        fix: 'Проверьте закупочные цены и наценку', go: 'markup' });
    }
    list.sort(function (x, y) { return y.sum - x.sum; });
    return { top: list.slice(0, 3), all: list,
      total: round(list.reduce(function (a, x) { return a + x.sum; }, 0)) };
  }

  /* --- 111. Группы товаров: доля в прибыли, а не в выручке -------------------
     Группа может давать четверть выручки и почти ничего не приносить —
     тогда место на полке под неё занято зря.
     ---------------------------------------------------------------------- */
  function groupProfit(byGroup) {
    var rows = (byGroup || []).slice();
    var rev = rows.reduce(function (a, g) { return a + num(g.revenue); }, 0);
    var gross = rows.reduce(function (a, g) { return a + num(g.gross); }, 0);
    rows.forEach(function (g) {
      g.revShare = rev ? round(div(g.revenue, rev) * 100) : 0;
      g.profitShare = gross ? round(div(g.gross, gross) * 100) : 0;
      g.gap = round(g.profitShare - g.revShare);   // «продаём много, зарабатываем мало»
    });
    rows.sort(function (a, b) { return b.gross - a.gross; });
    return { rows: rows, revenue: round(rev), gross: round(gross),
      margin: rev ? round(div(gross, rev) * 100) : 0 };
  }

  /* --- 112. Рейтинг товаров по прибыли, а не по выручке ----------------------
     Дорогой товар с маленькой наценкой в топе выручки — а денег с него нет.
     Считаем прибыль в рублях и отдельно показываем таких «обманщиков».
     ---------------------------------------------------------------------- */
  function itemProfit(sales, limit) {
    var rows = (sales || []).map(function (s) {
      var profit = round(num(s.revenue) - num(s.cogs));
      return { name: s.name, key: s.key, qty: round(num(s.qty)),
        revenue: round(num(s.revenue)), cogs: round(num(s.cogs)), profit: profit,
        margin: num(s.revenue) ? round(div(profit, s.revenue) * 100) : 0 };
    });
    var byProfit = rows.slice().sort(function (a, b) { return b.profit - a.profit; });
    var byRevenue = rows.slice().sort(function (a, b) { return b.revenue - a.revenue; });
    var profitRank = {};
    byProfit.forEach(function (r, i) { profitRank[r.key || r.name] = i + 1; });
    var n = limit || 20;
    // «обманщики»: в топе выручки, но далеко внизу по прибыли
    var fakes = byRevenue.slice(0, n).filter(function (r) {
      return profitRank[r.key || r.name] > n * 2;
    }).map(function (r) {
      r.profitPlace = profitRank[r.key || r.name];
      return r;
    });
    var totalProfit = rows.reduce(function (a, r) { return a + r.profit; }, 0);
    return { byProfit: byProfit, byRevenue: byRevenue, fakes: fakes,
      total: round(totalProfit), count: rows.length };
  }

  /* --- 113. Что съедает прибыль ----------------------------------------------
     Валовая прибыль сверху, дальше по строке на каждую причину, снизу — что
     реально осталось. Товарные потери берём из 1С, денежные — из базы.
     ---------------------------------------------------------------------- */
  function profitEaters(opts) {
    opts = opts || {};
    var rows = opts.dds || [], ym = opts.ym || '';
    var per = ym ? rows.filter(function (r) { return inMonth(r, ym); }) : rows;
    var t = F.totals(per);
    var gross = round(t.income - t.purchase);      // выручка минус закуп
    var eaters = [];
    function add(name, sum, why, go) {
      if (num(sum) > 0) eaters.push({ name: name, sum: round(sum), why: why, go: go });
    }
    add('Списанный товар', opts.writeoffSum, 'Просрочка, бой и порча', 'losses');
    var short = 0;
    per.forEach(function (r) { if (num(r.diff) < 0) short += Math.abs(num(r.diff)); });
    add('Недостачи в кассе', short, 'Касса не сошлась', 'cashiers');
    add('Зарплата', t.salary, 'Выплаты сотрудникам', 'payroll');
    add('Аренда', t.rent, 'Помещение', 'findash');
    var byCat = {};
    per.forEach(function (r) {
      if (!F.isExpense(r) || F.isPurchase(r)) return;
      var k = norm(r.category);
      if (k === 'зп' || k === 'аренда') return;
      byCat[txt(r.category) || 'Без статьи'] = (byCat[txt(r.category) || 'Без статьи'] || 0) + num(r.amount);
    });
    Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })
      .forEach(function (k) { add(k, byCat[k], 'Статья расходов', 'findash'); });

    var eaten = eaters.reduce(function (a, x) { return a + x.sum; }, 0);
    eaters.forEach(function (x) { x.share = gross ? round(div(x.sum, gross) * 100) : 0; });
    eaters.sort(function (a, b) { return b.sum - a.sum; });
    return { gross: gross, eaters: eaters, eaten: round(eaten),
      left: round(gross - eaten), income: t.income, purchase: t.purchase };
  }

  /* --- 117. Свои показатели --------------------------------------------------
     Владелец пишет формулу словами: «выручка - закуп - зп» — и цифра встаёт
     на главный экран рядом с остальными. Никакого eval: слова заменяются на
     числа, а дальше считает тот же разборщик, что и в числовых полях.
     ---------------------------------------------------------------------- */
  // Слова, которые можно писать в формуле. Ключ — как пишет владелец.
  var KPI_WORDS = [
    'выручка', 'расход', 'прибыль', 'закуп', 'зп', 'аренда', 'налог',
    'долг', 'чеки', 'средний_чек', 'наличные', 'карта', 'сбп', 'перевод',
    'списания', 'недостачи', 'дней', 'смен', 'деньги', 'впути'
  ];
  function kpiValues(opts) {
    opts = opts || {};
    var rows = opts.dds || [];
    var t = F.totals(rows);
    var bal = F.balances(rows, opts.opening || {});
    var ac = avgCheck(rows);
    var short = 0;
    rows.forEach(function (r) { if (num(r.diff) < 0) short += Math.abs(num(r.diff)); });
    var tr = F.inTransit(rows, opts.bank || [], opts.settings || {});
    return {
      'выручка': t.income, 'расход': t.expense, 'прибыль': t.profit,
      'закуп': t.purchase, 'зп': t.salary, 'аренда': t.rent,
      'налог': num(opts.tax), 'долг': t.debtNow,
      'чеки': ac.checks, 'средний_чек': ac.avg,
      'наличные': bal.map['Наличные'] || 0, 'карта': bal.map['Карта'] || 0,
      'сбп': bal.map['СБП'] || 0, 'перевод': bal.map['Перевод'] || 0,
      'списания': num(opts.writeoffSum), 'недостачи': round(short),
      'дней': t.days, 'смен': t.shifts,
      'деньги': bal.total, 'впути': tr.sum
    };
  }
  // Считаем формулу. Возвращаем { value } или { error: 'что не так' }.
  function kpiEval(formula, values) {
    var src = String(formula || '').toLowerCase().replace(/ё/g, 'е');
    if (!src.trim()) return { error: 'Формула пустая.' };
    // сначала длинные слова, иначе «средний_чек» распадётся на «чеки»
    var words = KPI_WORDS.slice().sort(function (a, b) { return b.length - a.length; });
    words.forEach(function (w) {
      src = src.split(w).join('(' + num(values[w]) + ')');
    });
    var left = src.match(/[а-я_]+/g);
    if (left && left.length) {
      return { error: 'Не понимаю слово «' + left[0] + '». Можно писать: ' + KPI_WORDS.join(', ') + '.' };
    }
    var calc = NUM && NUM.calc ? NUM.calc : null;
    if (!calc) return { error: 'Калькулятор недоступен.' };
    var v = calc(src);
    if (v === null || !isFinite(v)) return { error: 'В формуле ошибка — проверьте скобки и знаки.' };
    return { value: round(v) };
  }

  return {
    KPI_WORDS: KPI_WORDS, kpiValues: kpiValues, kpiEval: kpiEval,
    moneyFlow: moneyFlow, avgCheck: avgCheck, yearAgo: yearAgo, yearAgoYm: yearAgoYm,
    monthPace: monthPace, calendarEffect: calendarEffect, dayKind: dayKind, isHoliday: isHoliday,
    topProblems: topProblems, groupProfit: groupProfit, itemProfit: itemProfit,
    profitEaters: profitEaters, median: median
  };
});
