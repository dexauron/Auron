/* ============================================================================
   Люди: график смен, табель, схемы оплаты, отпуска, задачи.

   89 — график смен на месяц с планированием;
   90 — табель с опозданиями и переработками;
   91 — оклад, ставка за час или процент с выручки;
   92 — аванс и окончательный расчёт двумя датами;
   93 — личный кабинет сотрудника: свои смены и начисления;
   95 — отпуска и больничные;
   96 — кто был на смене, когда пропали деньги;
   97 — задачи сотрудникам с отметкой выполнения.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMStaff = factory();
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
  // «09:15» → 9.25 часа
  function hourNum(t) {
    var m = String(t || '').match(/^(\d{1,2})[:.](\d{2})/);
    if (!m) { var n = num(t); return n > 0 && n < 24 ? n : null; }
    return +m[1] + (+m[2]) / 60;
  }

  /* --- 91. Как считается зарплата --------------------------------------------
     Три схемы: оклад за месяц, ставка за час, процент с выручки. У человека
     может быть и оклад, и процент — тогда складываем.
     ---------------------------------------------------------------------- */
  var SCHEMES = ['Ставка за час', 'Оклад за месяц', 'Процент с выручки', 'Оклад + процент'];

  function personOf(staff, name) {
    var k = norm(name);
    return (staff || []).filter(function (p) { return norm(p.name) === k; })[0] || null;
  }

  // Начислено сотруднику за период по его схеме
  function accrue(person, shifts, revenue, daysInMonth) {
    var scheme = (person && person.scheme) || 'Ставка за час';
    var hours = shifts.reduce(function (a, s) { return a + num(s.hours); }, 0);
    var bonus = shifts.reduce(function (a, s) { return a + num(s.bonus); }, 0);
    var penalty = shifts.reduce(function (a, s) { return a + num(s.penalty); }, 0);
    var over = shifts.reduce(function (a, s) { return a + num(s.overtime); }, 0);
    var base = 0, how = '';

    if (norm(scheme).indexOf('час') >= 0) {
      var rate = num(person && person.rate) || (shifts[0] && num(shifts[0].rate)) || 0;
      base = hours * rate;
      how = round(hours) + ' ч × ' + rate + ' ₽';
    } else if (norm(scheme).indexOf('оклад') >= 0) {
      var salary = num(person && person.salary);
      var norm_ = num(person && person.normShifts) || daysInMonth || 30;
      // отработал меньше нормы — оклад считается пропорционально
      base = shifts.length >= norm_ ? salary : round(salary / norm_ * shifts.length);
      how = shifts.length + ' из ' + norm_ + ' смен · оклад ' + salary + ' ₽';
    }
    var pct = 0;
    if (norm(scheme).indexOf('процент') >= 0) {
      pct = round(num(revenue) * num(person && person.percent) / 100);
      how += (how ? ' + ' : '') + (person && person.percent) + '% с ' + round(num(revenue)) + ' ₽';
    }
    // переработка идёт по полуторной ставке — как в трудовом кодексе
    var rate2 = num(person && person.rate) || (shifts[0] && num(shifts[0].rate)) || 0;
    var overPay = round(over * rate2 * 1.5);

    return {
      scheme: scheme, hours: round(hours), shifts: shifts.length,
      base: round(base), percent: pct, overtime: round(over), overtimePay: overPay,
      bonus: round(bonus), penalty: round(penalty),
      total: round(base + pct + overPay + bonus - penalty),
      how: how
    };
  }

  /* --- 90. Табель: опоздания и переработки ------------------------------------
     Смена знает, когда должна начаться и кончиться. Сравниваем с тем, когда
     человек реально пришёл и ушёл.
     ---------------------------------------------------------------------- */
  function shiftTiming(rec, settings) {
    var planIn = hourNum(rec.planIn) !== null ? hourNum(rec.planIn) : hourNum(settings && settings.dayStart);
    var planOut = hourNum(rec.planOut) !== null ? hourNum(rec.planOut) : hourNum(settings && settings.nightStart);
    var factIn = hourNum(rec.factIn), factOut = hourNum(rec.factOut);
    var late = 0, early = 0, over = 0;
    if (factIn !== null && planIn !== null && factIn > planIn) late = round((factIn - planIn) * 60);
    if (factOut !== null && planOut !== null) {
      var diff = factOut - planOut;
      if (diff < 0) early = round(-diff * 60);
      else if (diff > 0) over = round(diff * 100) / 100;
    }
    var graceMin = num(settings && settings.lateGrace) || 5;
    return {
      lateMin: late > graceMin ? late : 0,
      earlyMin: early > graceMin ? early : 0,
      overtime: over,
      onTime: (late <= graceMin) && (early <= graceMin)
    };
  }

  function timesheetStats(rows, settings) {
    var t = { shifts: 0, hours: 0, late: 0, lateMin: 0, early: 0, overtime: 0, onTime: 0 };
    (rows || []).forEach(function (r) {
      var tm = shiftTiming(r, settings);
      t.shifts++; t.hours += num(r.hours);
      if (tm.lateMin) { t.late++; t.lateMin += tm.lateMin; }
      if (tm.earlyMin) t.early++;
      t.overtime += tm.overtime;
      if (tm.onTime) t.onTime++;
    });
    t.hours = round(t.hours); t.overtime = round(t.overtime);
    t.punctual = t.shifts ? round(t.onTime / t.shifts * 100) : 100;
    return t;
  }

  /* --- 89. График смен на месяц ------------------------------------------------ */
  function schedule(plans, timesheet, ym, staff) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var daysIn = new Date(y, m, 0).getDate();
    var byDay = {};
    (plans || []).forEach(function (p) {
      if (String(p.date || '').slice(0, 7) !== ym) return;
      (byDay[p.date] = byDay[p.date] || []).push({ who: p.employee, shift: p.shift, plan: true });
    });
    (timesheet || []).forEach(function (r) {
      if (String(r.date || '').slice(0, 7) !== ym) return;
      (byDay[r.date] = byDay[r.date] || []).push({ who: r.employee, shift: r.shift, fact: true, hours: num(r.hours) });
    });
    var days = [];
    for (var d = 1; d <= daysIn; d++) {
      var date = ym + '-' + ('0' + d).slice(-2);
      var list = byDay[date] || [];
      var dow = new Date(date).getDay();
      days.push({ date: date, day: d, dow: dow, weekend: dow === 0 || dow === 6,
        people: list, planned: list.filter(function (x) { return x.plan; }).length,
        worked: list.filter(function (x) { return x.fact; }).length,
        empty: !list.length });
    }
    var names = {};
    (staff || []).forEach(function (p) { names[norm(p.name)] = p.name; });
    (timesheet || []).forEach(function (r) { if (r.employee) names[norm(r.employee)] = r.employee; });
    return { days: days, daysIn: daysIn, ym: ym,
      people: Object.keys(names).map(function (k) { return names[k]; }).sort(),
      gaps: days.filter(function (d) { return d.empty; }).length };
  }

  /* --- 95. Отпуска и больничные ------------------------------------------------ */
  var ABSENCE = ['Отпуск', 'Больничный', 'Отгул', 'Прогул', 'За свой счёт'];

  /* --- 96. Кто был на смене, когда не сошлись деньги ---------------------------- */
  /* --- 97. Задачи сотрудникам --------------------------------------------------- */
  /* --- 92. Аванс и окончательный расчёт ----------------------------------------- */
  function payParts(settings, ym) {
    var adv = num(settings && settings.advanceDay) || 25;
    var fin = num(settings && settings.salaryDay) || 10;
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var advDate = ym + '-' + ('0' + Math.min(adv, new Date(y, m, 0).getDate())).slice(-2);
    var nm = m === 12 ? (y + 1) + '-01' : y + '-' + ('0' + (m + 1)).slice(-2);
    var finDate = nm + '-' + ('0' + fin).slice(-2);
    return { advanceDate: advDate, finalDate: finDate,
      advancePct: num(settings && settings.advancePct) || 40 };
  }
  function splitPay(total, settings, alreadyPaid) {
    var pct = num(settings && settings.advancePct) || 40;
    var adv = round(num(total) * pct / 100);
    var paid = num(alreadyPaid);
    return { advance: adv, final: round(num(total) - adv),
      leftAdvance: Math.max(0, round(adv - paid)),
      leftTotal: Math.max(0, round(num(total) - paid)) };
  }

  return {
    SCHEMES: SCHEMES, personOf: personOf, accrue: accrue,
    shiftTiming: shiftTiming, timesheetStats: timesheetStats,
    schedule: schedule,
    payParts: payParts, splitPay: splitPay,
    hourNum: hourNum
  };
});
