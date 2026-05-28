// ═══════════════════════════════════════════════════════════════════════
//  ФИНАНСОВЫЙ КОНТРОЛЬ — Google Apps Script Backend
//  Deploy as Web App: Execute as Me, Access: Anyone
// ═══════════════════════════════════════════════════════════════════════

var SS_ID       = '1MkPEUT2XJlciHthlVcCyaZp_6A9rBAxayRC3i1I82hg';
var SH_BASE      = 'БАЗА';
var SH_SETTINGS  = 'НАСТРОЙКИ';
var SH_REPS      = 'ТОРГ_ПРЕД';
var SH_TIMESHEET = 'ТАБЕЛЬ';
var SH_PULSE     = 'Пульт';
var SH_MONTHLY   = 'По_Месяцам';
var SH_REPORT    = 'Отчёт_Ф';

// ── БАЗА columns (1-indexed) ─────────────────────────────────────────────
// A:Дата  B:Смена  C:Кассир  D:Тип  E:Категория  F:Способ  G:Сумма  H:Расхождение  I:Комментарий
var COL_DATE    = 1;
var COL_SHIFT   = 2;
var COL_CASHIER = 3;
var COL_TYPE    = 4;
var COL_CAT     = 5;
var COL_PAY     = 6;
var COL_AMOUNT  = 7;
var COL_DISC    = 8;
var COL_COMMENT = 9;

// ── Default settings values ──────────────────────────────────────────────
var DEFAULT_SETTINGS = {
  STORE_NAME:   'Мой магазин',
  CASHIERS:     JSON.stringify(['Иванова А.', 'Петрова Б.', 'Сидорова В.']),
  SHIFTS:       JSON.stringify(['Утро', 'День', 'Вечер']),
  EXP_CATS:     JSON.stringify(['Аренда', 'ЗП', 'Закупка', 'Хозрасходы', 'Коммуналка', 'Реклама', 'Прочий расход']),
  PAY_TYPES:    JSON.stringify(['Наличные', 'Карта', 'СБП', 'Безналичный']),
  REP_STATUSES: JSON.stringify(['✅ Оплачено', '❌ Не оплачено', '⛔ Отменён', '🔄 Перенесён', '❓ Не пришёл']),
  EMPLOYEES:    JSON.stringify([
    { name: 'Иванова А.',  schedule: '09:00-18:00', dailySalary: 2500, payFreq: 'monthly' },
    { name: 'Петрова Б.',  schedule: '09:00-18:00', dailySalary: 2500, payFreq: 'monthly' },
    { name: 'Сидорова В.', schedule: '09:00-18:00', dailySalary: 2000, payFreq: 'monthly' }
  ]),
  WIDGETS: JSON.stringify({
    revenueCard:   true,
    kpiGrid:       true,
    monthlyChart:  true,
    paymentChart:  true,
    expenseChart:  true,
    shiftsTable:   true,
    cashierTable:  true,
    topDays:       true,
    dailyChart:    true,
    profitChart:   true,
    discTable:     true,
    avgMetrics:    true
  })
};

// ────────────────────────────────────────────────────────────────────────────
// doGet — entry point, just serves HTML
// ────────────────────────────────────────────────────────────────────────────
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Финансовый контроль')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

// ────────────────────────────────────────────────────────────────────────────
// getSpreadsheet
// ────────────────────────────────────────────────────────────────────────────
function getSpreadsheet() {
  return SpreadsheetApp.openById(SS_ID);
}

// ────────────────────────────────────────────────────────────────────────────
// ensureSheets — create all 4 sheets if missing, populate НАСТРОЙКИ defaults
// ────────────────────────────────────────────────────────────────────────────
function ensureSheets() {
  var ss = getSpreadsheet();

  // ── БАЗА ────────────────────────────────────────────────────────────────
  var base = ss.getSheetByName(SH_BASE);
  if (!base) {
    base = ss.insertSheet(SH_BASE);
    var baseHeaders = ['Дата', 'Смена', 'Кассир', 'Тип', 'Категория',
                       'Способ оплаты', 'Сумма', 'Расхождение', 'Комментарий'];
    base.getRange(1, 1, 1, baseHeaders.length).setValues([baseHeaders])
        .setFontWeight('bold').setBackground('#0B4F54').setFontColor('#FFFFFF');
    base.setFrozenRows(1);
    base.setColumnWidth(1, 100);
    base.setColumnWidth(7, 100);
    base.setColumnWidth(8, 110);
    base.setColumnWidth(9, 160);
  }

  // ── НАСТРОЙКИ ───────────────────────────────────────────────────────────
  var sett = ss.getSheetByName(SH_SETTINGS);
  if (!sett) {
    sett = ss.insertSheet(SH_SETTINGS);
    sett.getRange(1, 1, 1, 2).setValues([['Ключ', 'Значение']])
        .setFontWeight('bold').setBackground('#0B4F54').setFontColor('#FFFFFF');
    sett.setFrozenRows(1);
    sett.setColumnWidth(1, 160);
    sett.setColumnWidth(2, 400);
  }

  // Populate defaults if the sheet has no data rows
  var settLastRow = sett.getLastRow();
  if (settLastRow < 2) {
    var defaultRows = Object.keys(DEFAULT_SETTINGS).map(function(k) {
      return [k, DEFAULT_SETTINGS[k]];
    });
    sett.getRange(2, 1, defaultRows.length, 2).setValues(defaultRows);
  }

  // ── ТОРГ_ПРЕД ───────────────────────────────────────────────────────────
  var reps = ss.getSheetByName(SH_REPS);
  if (!reps) {
    reps = ss.insertSheet(SH_REPS);
    var repsHeaders = ['ID', 'Дата', 'Торговый представитель', 'Номер накладной',
                       'Сумма', 'Статус', 'Комментарий', 'Создано'];
    reps.getRange(1, 1, 1, repsHeaders.length).setValues([repsHeaders])
        .setFontWeight('bold').setBackground('#0B4F54').setFontColor('#FFFFFF');
    reps.setFrozenRows(1);
    reps.setColumnWidth(1, 220);
    reps.setColumnWidth(2, 100);
    reps.setColumnWidth(3, 180);
    reps.setColumnWidth(8, 160);
  }

  // ── ТАБЕЛЬ ──────────────────────────────────────────────────────────────
  var ts = ss.getSheetByName(SH_TIMESHEET);
  if (!ts) {
    ts = ss.insertSheet(SH_TIMESHEET);
    var tsHeaders = ['Дата', 'Сотрудник', 'Приход', 'Уход',
                     'Статус', 'Часы', 'Дневная ставка', 'Комментарий'];
    ts.getRange(1, 1, 1, tsHeaders.length).setValues([tsHeaders])
      .setFontWeight('bold').setBackground('#0B4F54').setFontColor('#FFFFFF');
    ts.setFrozenRows(1);
    ts.setColumnWidth(1, 100);
    ts.setColumnWidth(2, 160);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// getSettings
// ────────────────────────────────────────────────────────────────────────────
function getSettings() {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var sett = ss.getSheetByName(SH_SETTINGS);
    var last = sett.getLastRow();
    var map  = {};

    if (last >= 2) {
      var vals = sett.getRange(2, 1, last - 1, 2).getValues();
      vals.forEach(function(row) {
        var key = String(row[0]).trim();
        var val = String(row[1]).trim();
        if (key) map[key] = val;
      });
    }

    function getJson(key) {
      try {
        var raw = map[key] !== undefined ? map[key] : DEFAULT_SETTINGS[key];
        return JSON.parse(raw);
      } catch (ex) {
        return JSON.parse(DEFAULT_SETTINGS[key]);
      }
    }

    return {
      ok:          true,
      storeName:   map['STORE_NAME'] || DEFAULT_SETTINGS.STORE_NAME,
      cashiers:    getJson('CASHIERS'),
      shifts:      getJson('SHIFTS'),
      expCats:     getJson('EXP_CATS'),
      payTypes:    getJson('PAY_TYPES'),
      repStatuses: getJson('REP_STATUSES'),
      employees:   getJson('EMPLOYEES'),
      widgets:     getJson('WIDGETS')
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// saveSettings
// data = { storeName, cashiers, shifts, expCats, payTypes, repStatuses, employees, widgets }
// ────────────────────────────────────────────────────────────────────────────
function saveSettings(data) {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var sett = ss.getSheetByName(SH_SETTINGS);

    // Build key → serialised value map
    var toSave = {
      STORE_NAME:   data.storeName || DEFAULT_SETTINGS.STORE_NAME,
      CASHIERS:     JSON.stringify(data.cashiers    || []),
      SHIFTS:       JSON.stringify(data.shifts      || []),
      EXP_CATS:     JSON.stringify(data.expCats     || []),
      PAY_TYPES:    JSON.stringify(data.payTypes    || []),
      REP_STATUSES: JSON.stringify(data.repStatuses || []),
      EMPLOYEES:    JSON.stringify(data.employees   || []),
      WIDGETS:      JSON.stringify(data.widgets     || {})
    };

    var last = sett.getLastRow();
    var existingKeys = {};

    if (last >= 2) {
      var vals = sett.getRange(2, 1, last - 1, 1).getValues();
      vals.forEach(function(row, i) {
        var key = String(row[0]).trim();
        if (key) existingKeys[key] = i + 2; // 1-indexed row number
      });
    }

    Object.keys(toSave).forEach(function(key) {
      if (existingKeys[key]) {
        sett.getRange(existingKeys[key], 2).setValue(toSave[key]);
      } else {
        sett.appendRow([key, toSave[key]]);
      }
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// saveKassa
// data = { date, shift, cashier, zNal, zCard, zSBP, factNal, factCard, factSBP, vyplata, comment }
// ────────────────────────────────────────────────────────────────────────────
function saveKassa(data) {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var base = ss.getSheetByName(SH_BASE);
    var dt   = new Date(data.date);
    var rows = [];

    var payMethods = [
      { pay: 'Наличные', z: parseFloat(data.zNal)   || 0, fact: parseFloat(data.factNal)   || 0 },
      { pay: 'Карта',    z: parseFloat(data.zCard)  || 0, fact: parseFloat(data.factCard)  || 0 },
      { pay: 'СБП',      z: parseFloat(data.zSBP)   || 0, fact: parseFloat(data.factSBP)   || 0 }
    ];

    payMethods.forEach(function(pm) {
      if (pm.z === 0 && pm.fact === 0) return;
      var disc = pm.fact - pm.z;
      rows.push([
        dt,
        data.shift    || '',
        data.cashier  || '',
        'Приход',
        'Z-отчёт',
        pm.pay,
        pm.z,
        disc,
        data.comment  || ''
      ]);
    });

    var vyplata = parseFloat(data.vyplata) || 0;
    if (vyplata > 0) {
      rows.push([
        dt,
        data.shift   || '',
        data.cashier || '',
        'Расход',
        'Выплата',
        'Наличные',
        vyplata,
        0,
        'Выплата из кассы'
      ]);
    }

    if (rows.length === 0) {
      return { ok: false, error: 'Нет данных для сохранения' };
    }

    var lastRow = base.getLastRow();
    base.getRange(lastRow + 1, 1, rows.length, 9).setValues(rows);
    base.getRange(lastRow + 1, COL_DATE,   rows.length, 1).setNumberFormat('dd.mm.yyyy');
    base.getRange(lastRow + 1, COL_AMOUNT, rows.length, 1).setNumberFormat('#,##0');
    base.getRange(lastRow + 1, COL_DISC,   rows.length, 1).setNumberFormat('#,##0;[Red]-#,##0;"✓"');

    return { ok: true, rows: rows.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// saveExpense
// data = { date, category, payType, amount, comment }
// ────────────────────────────────────────────────────────────────────────────
function saveExpense(data) {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var base = ss.getSheetByName(SH_BASE);
    var dt   = new Date(data.date);

    var row = [
      dt,
      '',
      '',
      'Расход',
      data.category || '',
      data.payType  || '',
      parseFloat(data.amount) || 0,
      0,
      data.comment  || ''
    ];

    var lastRow = base.getLastRow();
    base.getRange(lastRow + 1, 1, 1, 9).setValues([row]);
    base.getRange(lastRow + 1, COL_DATE,   1, 1).setNumberFormat('dd.mm.yyyy');
    base.getRange(lastRow + 1, COL_AMOUNT, 1, 1).setNumberFormat('#,##0');

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// getDashboardData
// params = { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } or null
// ────────────────────────────────────────────────────────────────────────────
function getDashboardData(params) {
  try {
    ensureSheets();
    var ss      = getSpreadsheet();
    var base    = ss.getSheetByName(SH_BASE);
    var lastRow = base.getLastRow();
    var tz      = Session.getScriptTimeZone();

    if (lastRow < 2) {
      return {
        ok: true, empty: true,
        kpi: {}, shifts: [], cashiers: [], months: [],
        payMethods: [], expByCategory: [], topDays: [],
        revenueByDay: [], recent: []
      };
    }

    var allData  = base.getRange(2, 1, lastRow - 1, 9).getValues();
    var fromDate = params && params.from ? new Date(params.from) : null;
    var toDate   = params && params.to   ? new Date(params.to)   : null;

    if (fromDate) fromDate.setHours(0, 0, 0, 0);
    if (toDate)   toDate.setHours(23, 59, 59, 999);

    var rows = allData.filter(function(r) {
      if (!r[0] || !(r[0] instanceof Date)) return false;
      var d = new Date(r[0].getTime());
      d.setHours(0, 0, 0, 0);
      if (fromDate && d < fromDate) return false;
      if (toDate   && d > toDate)   return false;
      return true;
    });

    // ── Aggregation helpers ────────────────────────────────────────────────
    var totalRevenue = 0;
    var totalExpense = 0;
    var totalDisc    = 0;
    var discCount    = 0;

    // day totals for best/worst
    var dayRevenue   = {};  // dateStr → number
    var shiftSet     = {};  // dateStr+shift → cashier

    // by shift
    var shiftTotals  = {};  // shiftName → {revenue, expense, shifts: Set}

    // by cashier
    var cashierShifts     = {};  // cashier → {shiftKey: true}
    var cashierDiscShifts = {};  // cashier → {shiftKey: true}
    var cashierDiscAmt    = {};  // cashier → total abs disc

    // by month
    var monthTotals = {};  // 'yyyy-MM' → {revenue, expense}

    // by pay method
    var payTotals = {};  // payName → amount

    // by expense category
    var expCatTotals = {};  // category → amount

    rows.forEach(function(r) {
      var d       = r[COL_DATE - 1];
      var shift   = String(r[COL_SHIFT - 1]);
      var cashier = String(r[COL_CASHIER - 1]);
      var type    = String(r[COL_TYPE - 1]);
      var cat     = String(r[COL_CAT - 1]);
      var pay     = String(r[COL_PAY - 1]);
      var amount  = parseFloat(r[COL_AMOUNT - 1]) || 0;
      var disc    = parseFloat(r[COL_DISC - 1])   || 0;

      if (!(d instanceof Date)) return;

      var dateStr  = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      var monthKey = Utilities.formatDate(d, tz, 'yyyy-MM');
      var shiftKey = dateStr + '|' + shift;

      // month totals
      if (!monthTotals[monthKey]) monthTotals[monthKey] = { revenue: 0, expense: 0 };

      if (type === 'Приход') {
        totalRevenue += amount;
        monthTotals[monthKey].revenue += amount;

        // day revenue
        if (!dayRevenue[dateStr]) dayRevenue[dateStr] = 0;
        dayRevenue[dateStr] += amount;

        // pay method
        if (!payTotals[pay]) payTotals[pay] = 0;
        payTotals[pay] += amount;

        // discrepancy
        if (disc !== 0) {
          totalDisc += disc;
          discCount++;
        }

        // shift tracking
        if (!shiftTotals[shift]) shiftTotals[shift] = { revenue: 0, expense: 0, shiftsSet: {} };
        shiftTotals[shift].revenue += amount;
        shiftTotals[shift].shiftsSet[shiftKey] = true;

        // cashier tracking
        if (!cashierShifts[cashier])     cashierShifts[cashier]     = {};
        if (!cashierDiscShifts[cashier]) cashierDiscShifts[cashier] = {};
        if (!cashierDiscAmt[cashier])    cashierDiscAmt[cashier]    = 0;

        cashierShifts[cashier][shiftKey] = true;
        if (disc !== 0) {
          cashierDiscShifts[cashier][shiftKey] = true;
          cashierDiscAmt[cashier] += Math.abs(disc);
        }

        // distinct shifts for this day
        if (!shiftSet[shiftKey]) shiftSet[shiftKey] = cashier;

      } else if (type === 'Расход') {
        totalExpense += amount;
        monthTotals[monthKey].expense += amount;

        if (!shiftTotals[shift]) shiftTotals[shift] = { revenue: 0, expense: 0, shiftsSet: {} };
        shiftTotals[shift].expense += amount;

        // expense by category
        if (!expCatTotals[cat]) expCatTotals[cat] = 0;
        expCatTotals[cat] += amount;
      }
    });

    // ── KPI extended ──────────────────────────────────────────────────────
    var totalShifts = Object.keys(shiftSet).length;
    var dayKeys     = Object.keys(dayRevenue);
    var totalDays   = dayKeys.length;
    var avgDailyRevenue = totalDays > 0 ? totalRevenue / totalDays : 0;
    var avgShiftRevenue = totalShifts > 0 ? totalRevenue / totalShifts : 0;

    var bestDayAmount  = 0, bestDayDate  = '';
    var worstDayAmount = Infinity, worstDayDate = '';

    dayKeys.forEach(function(dk) {
      var v = dayRevenue[dk];
      if (v > bestDayAmount)  { bestDayAmount  = v; bestDayDate  = dk; }
      if (v < worstDayAmount) { worstDayAmount = v; worstDayDate = dk; }
    });
    if (worstDayAmount === Infinity) worstDayAmount = 0;

    var kpi = {
      revenue:         totalRevenue,
      expense:         totalExpense,
      profit:          totalRevenue - totalExpense,
      discAmt:         totalDisc,
      discCount:       discCount,
      avgDailyRevenue: Math.round(avgDailyRevenue),
      avgShiftRevenue: Math.round(avgShiftRevenue),
      bestDayAmount:   bestDayAmount,
      bestDayDate:     bestDayDate,
      worstDayAmount:  worstDayAmount,
      worstDayDate:    worstDayDate,
      totalShifts:     totalShifts,
      totalDays:       totalDays
    };

    // ── By shift ──────────────────────────────────────────────────────────
    var shiftsArr = Object.keys(shiftTotals).sort().map(function(s) {
      var st = shiftTotals[s];
      return {
        shift:        s,
        revenue:      st.revenue,
        expense:      st.expense,
        profit:       st.revenue - st.expense,
        shifts_count: Object.keys(st.shiftsSet).length
      };
    });

    // ── By cashier ────────────────────────────────────────────────────────
    var cashiersArr = Object.keys(cashierShifts).sort().map(function(c) {
      var total = Object.keys(cashierShifts[c]).length;
      var discS = Object.keys(cashierDiscShifts[c] || {}).length;
      return {
        cashier:     c,
        shiftsTotal: total,
        shiftsDisc:  discS,
        discAmount:  cashierDiscAmt[c] || 0,
        discPct:     total > 0 ? Math.round(discS / total * 100) : 0
      };
    }).sort(function(a, b) { return b.shiftsDisc - a.shiftsDisc; });

    // ── By month ──────────────────────────────────────────────────────────
    var MONTH_LABELS = ['Янв','Фев','Мар','Апр','Май','Июн',
                        'Июл','Авг','Сен','Окт','Ноя','Дек'];
    var monthsArr = Object.keys(monthTotals).sort().map(function(m) {
      var parts = m.split('-');
      var label = MONTH_LABELS[parseInt(parts[1], 10) - 1] + ' ' + parts[0].slice(2);
      return {
        month:   m,
        label:   label,
        revenue: monthTotals[m].revenue,
        expense: monthTotals[m].expense,
        profit:  monthTotals[m].revenue - monthTotals[m].expense
      };
    });

    // ── By payment method ─────────────────────────────────────────────────
    var payTotal = Object.keys(payTotals).reduce(function(s, k) { return s + payTotals[k]; }, 0);
    var payArr   = Object.keys(payTotals).map(function(p) {
      return {
        method: p,
        amount: payTotals[p],
        pct:    payTotal > 0 ? Math.round(payTotals[p] / payTotal * 1000) / 10 : 0
      };
    }).sort(function(a, b) { return b.amount - a.amount; });

    // ── By expense category ───────────────────────────────────────────────
    var expTotal  = Object.keys(expCatTotals).reduce(function(s, k) { return s + expCatTotals[k]; }, 0);
    var expCatArr = Object.keys(expCatTotals).map(function(c) {
      return {
        category: c,
        amount:   expCatTotals[c],
        pct:      expTotal > 0 ? Math.round(expCatTotals[c] / expTotal * 1000) / 10 : 0
      };
    }).sort(function(a, b) { return b.amount - a.amount; });

    // ── Top 5 days by revenue ─────────────────────────────────────────────
    var topDays = dayKeys.map(function(dk) {
      return { date: dk, revenue: dayRevenue[dk] };
    }).sort(function(a, b) { return b.revenue - a.revenue; }).slice(0, 5);

    // ── Revenue by day — last 30 calendar days ────────────────────────────
    var today30 = new Date();
    today30.setHours(0, 0, 0, 0);
    var cutoff30 = new Date(today30.getTime() - 29 * 24 * 3600 * 1000);

    var dayExpense = {};
    rows.forEach(function(r) {
      var d = r[COL_DATE - 1];
      if (!(d instanceof Date)) return;
      var dCopy = new Date(d.getTime());
      dCopy.setHours(0, 0, 0, 0);
      if (dCopy < cutoff30) return;
      var dk   = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      var type = String(r[COL_TYPE - 1]);
      var amt  = parseFloat(r[COL_AMOUNT - 1]) || 0;
      if (type === 'Расход') {
        if (!dayExpense[dk]) dayExpense[dk] = 0;
        dayExpense[dk] += amt;
      }
    });

    var revenueByDay = [];
    var cur30 = new Date(cutoff30.getTime());
    while (cur30 <= today30) {
      var dk30 = Utilities.formatDate(cur30, tz, 'yyyy-MM-dd');
      revenueByDay.push({
        date:    dk30,
        revenue: dayRevenue[dk30]  || 0,
        expense: dayExpense[dk30]  || 0
      });
      cur30.setDate(cur30.getDate() + 1);
    }

    // ── Recent — last 50 rows ─────────────────────────────────────────────
    var recentSrc = allData.slice(-50).reverse();
    var recent = recentSrc.map(function(r) {
      var d = r[COL_DATE - 1];
      return {
        date:     (d instanceof Date) ? Utilities.formatDate(d, tz, 'dd.MM.yyyy') : '',
        shift:    r[COL_SHIFT   - 1],
        cashier:  r[COL_CASHIER - 1],
        type:     r[COL_TYPE    - 1],
        category: r[COL_CAT     - 1],
        pay:      r[COL_PAY     - 1],
        amount:   parseFloat(r[COL_AMOUNT - 1]) || 0,
        disc:     parseFloat(r[COL_DISC   - 1]) || 0,
        comment:  r[COL_COMMENT - 1]
      };
    });

    return {
      ok:            true,
      kpi:           kpi,
      shifts:        shiftsArr,
      cashiers:      cashiersArr,
      months:        monthsArr,
      payMethods:    payArr,
      expByCategory: expCatArr,
      topDays:       topDays,
      revenueByDay:  revenueByDay,
      recent:        recent
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// getRecentEntries
// ────────────────────────────────────────────────────────────────────────────
function getRecentEntries() {
  try {
    var result = getDashboardData(null);
    if (!result.ok) return result;
    return { ok: true, entries: result.recent || [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// getRepsForMonth
// yearMonth = 'YYYY-MM'
// ────────────────────────────────────────────────────────────────────────────
function getRepsForMonth(yearMonth) {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var sh   = ss.getSheetByName(SH_REPS);
    var last = sh.getLastRow();
    var tz   = Session.getScriptTimeZone();

    var entries = [];
    var totalAmount  = 0;
    var paidAmount   = 0;
    var unpaidAmount = 0;

    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, 8).getValues();
      vals.forEach(function(r) {
        var id        = String(r[0]);
        var dateVal   = r[1];
        var repName   = String(r[2]);
        var invoice   = String(r[3]);
        var amount    = parseFloat(r[4]) || 0;
        var status    = String(r[5]);
        var comment   = String(r[6]);
        var createdAt = r[7];

        if (!id || !dateVal) return;

        var dateObj;
        if (dateVal instanceof Date) {
          dateObj = dateVal;
        } else {
          // Try parsing dd.mm.yyyy
          var parts = String(dateVal).split('.');
          if (parts.length === 3) {
            dateObj = new Date(parts[2], parts[1] - 1, parts[0]);
          } else {
            dateObj = new Date(dateVal);
          }
        }

        if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return;

        var entryMonth = Utilities.formatDate(dateObj, tz, 'yyyy-MM');
        if (entryMonth !== yearMonth) return;

        var dateISO = Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd');
        var dateFmt = Utilities.formatDate(dateObj, tz, 'dd.MM.yyyy');

        entries.push({
          id:      id,
          date:    dateFmt,
          dateISO: dateISO,
          rep:     repName,
          invoice: invoice,
          amount:  amount,
          status:  status,
          comment: comment
        });

        totalAmount += amount;
        if (status === '✅ Оплачено') {
          paidAmount += amount;
        } else if (status === '❌ Не оплачено') {
          unpaidAmount += amount;
        }
      });
    }

    return {
      ok:            true,
      entries:       entries,
      totalAmount:   totalAmount,
      paidAmount:    paidAmount,
      unpaidAmount:  unpaidAmount
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// saveRep
// data = { date, rep, invoice, amount, status, comment }
// ────────────────────────────────────────────────────────────────────────────
function saveRep(data) {
  try {
    ensureSheets();
    var ss  = getSpreadsheet();
    var sh  = ss.getSheetByName(SH_REPS);
    var id  = Utilities.getUuid();
    var dt  = new Date(data.date);
    var now = new Date();

    sh.appendRow([
      id,
      dt,
      data.rep     || '',
      data.invoice || '',
      parseFloat(data.amount) || 0,
      data.status  || '',
      data.comment || '',
      now
    ]);

    // Format date columns
    var newRow = sh.getLastRow();
    sh.getRange(newRow, 2, 1, 1).setNumberFormat('dd.mm.yyyy');
    sh.getRange(newRow, 5, 1, 1).setNumberFormat('#,##0');
    sh.getRange(newRow, 8, 1, 1).setNumberFormat('dd.mm.yyyy hh:mm');

    return { ok: true, id: id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// updateRep
// data = { id, rep, invoice, amount, status, comment, date }
// ────────────────────────────────────────────────────────────────────────────
function updateRep(data) {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var sh   = ss.getSheetByName(SH_REPS);
    var last = sh.getLastRow();

    if (last < 2) return { ok: false, error: 'not found' };

    var vals = sh.getRange(2, 1, last - 1, 1).getValues();
    var rowNum = -1;
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === String(data.id)) {
        rowNum = i + 2;
        break;
      }
    }

    if (rowNum === -1) return { ok: false, error: 'not found' };

    var dt = new Date(data.date);

    sh.getRange(rowNum, 1, 1, 8).setValues([[
      data.id,
      dt,
      data.rep     || '',
      data.invoice || '',
      parseFloat(data.amount) || 0,
      data.status  || '',
      data.comment || '',
      sh.getRange(rowNum, 8).getValue()  // preserve original createdAt
    ]]);

    sh.getRange(rowNum, 2, 1, 1).setNumberFormat('dd.mm.yyyy');
    sh.getRange(rowNum, 5, 1, 1).setNumberFormat('#,##0');

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// deleteRep
// ────────────────────────────────────────────────────────────────────────────
function deleteRep(id) {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var sh   = ss.getSheetByName(SH_REPS);
    var last = sh.getLastRow();

    if (last < 2) return { ok: false, error: 'not found' };

    var vals = sh.getRange(2, 1, last - 1, 1).getValues();
    var rowNum = -1;
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === String(id)) {
        rowNum = i + 2;
        break;
      }
    }

    if (rowNum === -1) return { ok: false, error: 'not found' };

    sh.deleteRow(rowNum);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// getTimesheetMonth
// yearMonth = 'YYYY-MM'
// ────────────────────────────────────────────────────────────────────────────
function getTimesheetMonth(yearMonth) {
  try {
    ensureSheets();
    var ss     = getSpreadsheet();
    var sh     = ss.getSheetByName(SH_TIMESHEET);
    var last   = sh.getLastRow();
    var tz     = Session.getScriptTimeZone();
    var sett   = getSettings();
    var employees = sett.employees || [];

    var entries = [];

    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, 8).getValues();
      vals.forEach(function(r) {
        var dateVal  = r[0];
        var employee = String(r[1]);
        var timeIn   = String(r[2]);
        var timeOut  = String(r[3]);
        var status   = String(r[4]);
        var hours    = parseFloat(r[5]) || 0;
        var daySal   = parseFloat(r[6]) || 0;
        var comment  = String(r[7]);

        if (!dateVal) return;

        var dateObj;
        if (dateVal instanceof Date) {
          dateObj = dateVal;
        } else {
          var parts = String(dateVal).split('.');
          if (parts.length === 3) {
            dateObj = new Date(parts[2], parts[1] - 1, parts[0]);
          } else {
            dateObj = new Date(dateVal);
          }
        }

        if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return;

        var entryMonth = Utilities.formatDate(dateObj, tz, 'yyyy-MM');
        if (entryMonth !== yearMonth) return;

        entries.push({
          date:      Utilities.formatDate(dateObj, tz, 'dd.MM.yyyy'),
          dateISO:   Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd'),
          employee:  employee,
          timeIn:    timeIn,
          timeOut:   timeOut,
          status:    status,
          hours:     hours,
          daySalary: daySal,
          comment:   comment
        });
      });
    }

    // ── Summary per employee ──────────────────────────────────────────────
    var summaryMap = {};
    employees.forEach(function(emp) {
      summaryMap[emp.name] = {
        employee:    emp.name,
        daysP:       0,
        daysO:       0,
        daysB:       0,
        daysOt:      0,
        daysV:       0,
        totalHours:  0,
        totalSalary: 0
      };
    });

    entries.forEach(function(e) {
      if (!summaryMap[e.employee]) {
        summaryMap[e.employee] = {
          employee:    e.employee,
          daysP:       0,
          daysO:       0,
          daysB:       0,
          daysOt:      0,
          daysV:       0,
          totalHours:  0,
          totalSalary: 0
        };
      }
      var s = summaryMap[e.employee];
      switch (e.status) {
        case 'П':   s.daysP++;  break;
        case 'О':   s.daysO++;  break;
        case 'Б':   s.daysB++;  break;
        case 'Отп': s.daysOt++; break;
        case 'В':   s.daysV++;  break;
      }
      s.totalHours  += e.hours;
      s.totalSalary += e.daySalary;
    });

    var summary = Object.keys(summaryMap).map(function(k) { return summaryMap[k]; });

    return {
      ok:        true,
      employees: employees,
      entries:   entries,
      summary:   summary
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// saveTimesheetEntry
// data = { date, employee, timeIn, timeOut, status, comment }
// ────────────────────────────────────────────────────────────────────────────
function saveTimesheetEntry(data) {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var sh   = ss.getSheetByName(SH_TIMESHEET);
    var last = sh.getLastRow();
    var tz   = Session.getScriptTimeZone();

    var sett      = getSettings();
    var employees = sett.employees || [];
    var empData   = null;
    employees.forEach(function(emp) {
      if (emp.name === data.employee) empData = emp;
    });

    var dailySalary    = empData ? (empData.dailySalary || 0) : 0;
    var scheduleStr    = empData ? (empData.schedule    || '') : '';
    var scheduledHours = 8; // fallback

    if (scheduleStr) {
      var parts = scheduleStr.split('-');
      if (parts.length === 2) {
        var startH = parseFloat(parts[0].split(':')[0]) + parseFloat(parts[0].split(':')[1]) / 60;
        var endH   = parseFloat(parts[1].split(':')[0]) + parseFloat(parts[1].split(':')[1]) / 60;
        if (endH > startH) scheduledHours = endH - startH;
      }
    }

    // Calculate hours
    var hours = 0;
    if (data.timeIn && data.timeOut) {
      var inParts  = String(data.timeIn).split(':');
      var outParts = String(data.timeOut).split(':');
      if (inParts.length >= 2 && outParts.length >= 2) {
        var inH  = parseFloat(inParts[0])  + parseFloat(inParts[1])  / 60;
        var outH = parseFloat(outParts[0]) + parseFloat(outParts[1]) / 60;
        if (outH > inH) hours = Math.round((outH - inH) * 100) / 100;
      }
    }

    // Calculate day salary
    var daySalary = 0;
    if (data.status === 'П') {
      if (hours > 0 && scheduledHours > 0) {
        daySalary = Math.round(dailySalary * hours / scheduledHours);
      } else {
        daySalary = dailySalary;
      }
    }

    var dt = new Date(data.date);
    var dateStr = Utilities.formatDate(dt, tz, 'yyyy-MM-dd');

    // Check for existing row with same date + employee
    var existingRow = -1;
    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, 2).getValues();
      for (var i = 0; i < vals.length; i++) {
        var rowDate = vals[i][0];
        var rowEmp  = String(vals[i][1]);
        if (rowEmp === data.employee && rowDate instanceof Date) {
          var rowDateStr = Utilities.formatDate(rowDate, tz, 'yyyy-MM-dd');
          if (rowDateStr === dateStr) {
            existingRow = i + 2;
            break;
          }
        }
      }
    }

    var rowData = [
      dt,
      data.employee || '',
      data.timeIn   || '',
      data.timeOut  || '',
      data.status   || '',
      hours,
      daySalary,
      data.comment  || ''
    ];

    if (existingRow > 0) {
      sh.getRange(existingRow, 1, 1, 8).setValues([rowData]);
      sh.getRange(existingRow, 1, 1, 1).setNumberFormat('dd.mm.yyyy');
    } else {
      sh.appendRow(rowData);
      var newRow = sh.getLastRow();
      sh.getRange(newRow, 1, 1, 1).setNumberFormat('dd.mm.yyyy');
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// deleteLastEntry
// ────────────────────────────────────────────────────────────────────────────
function deleteLastEntry() {
  try {
    var ss   = getSpreadsheet();
    var base = ss.getSheetByName(SH_BASE);
    var last = base.getLastRow();
    if (last < 2) return { ok: false, error: 'Нет записей для удаления' };
    base.deleteRow(last);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// seedAllData — generate 12 months of realistic sample data
// ────────────────────────────────────────────────────────────────────────────
function seedAllData() {
  try {
    ensureSheets();
    var ss = getSpreadsheet();
    var tz = Session.getScriptTimeZone();

    // ── Clear existing data (keep header row) ────────────────────────────
    var sheetsToClean = [SH_BASE, SH_REPS, SH_TIMESHEET];
    sheetsToClean.forEach(function(shName) {
      var sh   = ss.getSheetByName(shName);
      var last = sh.getLastRow();
      if (last > 1) sh.deleteRows(2, last - 1);
    });

    var cashiers    = ['Иванова А.', 'Петрова Б.', 'Сидорова В.'];
    var expCats     = ['Аренда', 'ЗП', 'Закупка', 'Хозрасходы', 'Коммуналка', 'Реклама', 'Прочий расход'];
    var expPayTypes = ['Наличные', 'Карта', 'Безналичный'];
    var repNames    = ['ООО Ромашка', 'ИП Петров', 'ООО Маяк', 'ИП Сидоров', 'ООО Торг'];
    var repStatuses = ['✅ Оплачено', '❌ Не оплачено', '⛔ Отменён', '🔄 Перенесён'];

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    // Start 12 months ago
    var startDate = new Date(today.getTime());
    startDate.setMonth(startDate.getMonth() - 12);
    startDate.setDate(1);

    // 3 months ago for timesheet
    var tsStart = new Date(today.getTime());
    tsStart.setMonth(tsStart.getMonth() - 3);
    tsStart.setDate(1);

    // Seeded-ish random using day offset
    var _seed = 0;
    function srnd(min, max) {
      _seed = (_seed * 1664525 + 1013904223) & 0xffffffff;
      var r = ((_seed >>> 0) / 0xffffffff);
      return Math.floor(r * (max - min + 1)) + min;
    }
    function srndFloat(min, max) {
      _seed = (_seed * 1664525 + 1013904223) & 0xffffffff;
      var r = ((_seed >>> 0) / 0xffffffff);
      return r * (max - min) + min;
    }
    function pick(arr) {
      return arr[srnd(0, arr.length - 1)];
    }

    // ── БАЗА ────────────────────────────────────────────────────────────
    var baseRows   = [];
    var monthArenda = {};
    var monthZP    = {};

    var yesterday = new Date(today.getTime() - 24 * 3600 * 1000);

    var cur = new Date(startDate.getTime());
    var cashierIdx = 0;

    while (cur <= yesterday) {
      // Re-seed based on date for reproducibility
      _seed = cur.getFullYear() * 10000 + (cur.getMonth() + 1) * 100 + cur.getDate();

      var dayOfMonth = cur.getDate();
      var monthKey   = Utilities.formatDate(cur, tz, 'yyyy-MM');
      var dayShifts  = (srndFloat(0, 1) < 0.80) ? ['Утро', 'Вечер'] : ['Утро'];

      dayShifts.forEach(function(shiftName) {
        var cashier  = cashiers[cashierIdx % cashiers.length];
        cashierIdx++;

        var totalRev = srnd(40000, 150000);
        var nalPct   = srndFloat(0.32, 0.48);
        var cardPct  = srndFloat(0.32, 0.48);
        if (nalPct + cardPct > 0.95) cardPct = 0.95 - nalPct;
        var sbpPct   = 1 - nalPct - cardPct;

        var zNal  = Math.round(totalRev * nalPct);
        var zCard = Math.round(totalRev * cardPct);
        var zSBP  = Math.round(totalRev * sbpPct);

        var discNal = 0;
        if (srndFloat(0, 1) < 0.20) {
          discNal = srnd(-2000, 2000);
          if (discNal === 0) discNal = srnd(200, 500);
        }

        var dtCopy = new Date(cur.getTime());
        baseRows.push([dtCopy, shiftName, cashier, 'Приход', 'Z-отчёт', 'Наличные', zNal,  discNal, '']);
        baseRows.push([dtCopy, shiftName, cashier, 'Приход', 'Z-отчёт', 'Карта',    zCard, 0,       '']);
        baseRows.push([dtCopy, shiftName, cashier, 'Приход', 'Z-отчёт', 'СБП',      zSBP,  0,       '']);

        if (srndFloat(0, 1) < 0.15) {
          var vyplata = srnd(1000, 8000);
          baseRows.push([dtCopy, shiftName, cashier, 'Расход', 'Выплата', 'Наличные', vyplata, 0, 'Выплата из кассы']);
        }
      });

      // ── Expense rows ───────────────────────────────────────────────────
      var expCount = srnd(2, 3);
      for (var ei = 0; ei < expCount; ei++) {
        var cat    = null;
        var amount = 0;
        var payType = pick(expPayTypes);
        var attempt = 0;

        while (cat === null && attempt < 15) {
          attempt++;
          var candidate = expCats[srnd(0, expCats.length - 1)];

          if (candidate === 'Аренда') {
            if (!monthArenda[monthKey] && dayOfMonth >= 1 && dayOfMonth <= 5) {
              cat    = candidate;
              amount = srnd(80000, 120000);
              monthArenda[monthKey] = true;
            }
          } else if (candidate === 'ЗП') {
            if (!monthZP[monthKey]) monthZP[monthKey] = 0;
            if (monthZP[monthKey] < 2 && (dayOfMonth === 5 || dayOfMonth === 20)) {
              cat    = candidate;
              amount = srnd(20000, 40000);
              monthZP[monthKey]++;
            }
          } else if (candidate === 'Закупка') {
            cat    = candidate;
            amount = srnd(5000, 40000);
          } else if (candidate === 'Коммуналка') {
            cat    = candidate;
            amount = srnd(3000, 12000);
          } else if (candidate === 'Реклама') {
            cat    = candidate;
            amount = srnd(2000, 20000);
          } else {
            cat    = candidate;
            amount = srnd(500, 8000);
          }
        }

        if (cat === null) {
          cat    = srndFloat(0, 1) < 0.5 ? 'Хозрасходы' : 'Прочий расход';
          amount = srnd(500, 8000);
        }

        var dtExp = new Date(cur.getTime());
        baseRows.push([dtExp, '', '', 'Расход', cat, payType, amount, 0, '']);
      }

      cur.setDate(cur.getDate() + 1);
    }

    // Write БАЗА
    if (baseRows.length > 0) {
      var base = ss.getSheetByName(SH_BASE);
      base.getRange(2, 1, baseRows.length, 9).setValues(baseRows);
      base.getRange(2, COL_DATE,   baseRows.length, 1).setNumberFormat('dd.mm.yyyy');
      base.getRange(2, COL_AMOUNT, baseRows.length, 1).setNumberFormat('#,##0');
      base.getRange(2, COL_DISC,   baseRows.length, 1).setNumberFormat('#,##0;[Red]-#,##0;"✓"');
    }

    // ── ТОРГ_ПРЕД ────────────────────────────────────────────────────────
    var repRows     = [];
    var invoiceNum  = 1;
    var repSh       = ss.getSheetByName(SH_REPS);

    var repCur = new Date(startDate.getTime());
    while (repCur <= today) {
      _seed = repCur.getFullYear() * 10000 + (repCur.getMonth() + 1) * 100 + repCur.getDate() + 777;

      var dow = repCur.getDay(); // 0=Sun, 6=Sat
      // 5-8 per week → roughly check each day ~1/day base
      // On weekdays, ~80% chance of an entry; weekends ~20%
      var chance = (dow === 0 || dow === 6) ? 0.20 : 0.70;
      // Adjust to get ~5-8 per week average
      var numEntries = srndFloat(0, 1) < chance ? srnd(1, 2) : 0;

      for (var ri = 0; ri < numEntries; ri++) {
        var repId = Utilities.getUuid();
        var repDt = new Date(repCur.getTime());

        // Invoice: Нак-YYYY-NNNN
        var yearStr = repCur.getFullYear();
        var invStr  = 'Нак-' + yearStr + '-' + ('000' + invoiceNum).slice(-4);
        invoiceNum++;

        var repAmt = srnd(5000, 80000);
        var repRep = repNames[srnd(0, repNames.length - 1)];

        // Status distribution: 60% paid if older than 30 days, else mostly unpaid
        var daysAgo = Math.round((today.getTime() - repCur.getTime()) / 86400000);
        var status;
        var roll = srndFloat(0, 1);
        if (daysAgo > 30) {
          if (roll < 0.60)      status = '✅ Оплачено';
          else if (roll < 0.70) status = '⛔ Отменён';
          else if (roll < 0.80) status = '🔄 Перенесён';
          else                   status = '❌ Не оплачено';
        } else {
          if (roll < 0.20)      status = '✅ Оплачено';
          else if (roll < 0.30) status = '⛔ Отменён';
          else if (roll < 0.40) status = '🔄 Перенесён';
          else                   status = '❌ Не оплачено';
        }

        var createdAt = new Date(repCur.getTime());
        repRows.push([repId, repDt, repRep, invStr, repAmt, status, '', createdAt]);
      }

      repCur.setDate(repCur.getDate() + 1);
    }

    if (repRows.length > 0) {
      repSh.getRange(2, 1, repRows.length, 8).setValues(repRows);
      repSh.getRange(2, 2, repRows.length, 1).setNumberFormat('dd.mm.yyyy');
      repSh.getRange(2, 5, repRows.length, 1).setNumberFormat('#,##0');
      repSh.getRange(2, 8, repRows.length, 1).setNumberFormat('dd.mm.yyyy hh:mm');
    }

    // ── ТАБЕЛЬ ─────────────────────────────────────────────────────────
    var tsRows  = [];
    var tsSh    = ss.getSheetByName(SH_TIMESHEET);
    var empList = ['Иванова А.', 'Петрова Б.', 'Сидорова В.'];
    var empSalaries = { 'Иванова А.': 2500, 'Петрова Б.': 2500, 'Сидорова В.': 2000 };

    var tsCur = new Date(tsStart.getTime());
    while (tsCur <= yesterday) {
      _seed = tsCur.getFullYear() * 10000 + (tsCur.getMonth() + 1) * 100 + tsCur.getDate() + 333;

      var tsDow     = tsCur.getDay();
      var isWeekend = (tsDow === 0 || tsDow === 6);

      empList.forEach(function(empName) {
        var roll2 = srndFloat(0, 1);
        var status;

        if (isWeekend) {
          status = roll2 < 0.10 ? 'П' : 'В';
        } else {
          if      (roll2 < 0.80) status = 'П';
          else if (roll2 < 0.85) status = 'О';
          else if (roll2 < 0.90) status = 'Б';
          else if (roll2 < 0.95) status = 'Отп';
          else                    status = 'В';
        }

        var timeIn  = '';
        var timeOut = '';
        var hours   = 0;
        var daySal  = 0;

        if (status === 'П') {
          var inMin   = srnd(45, 75);   // 08:45 – 09:15 (offset from 08:00)
          var outMin  = srnd(17 * 60 + 45, 18 * 60 + 30);  // 17:45–18:30 in minutes from midnight
          var inH     = Math.floor(inMin / 60) + 8;
          var inM     = inMin % 60;
          var outH    = Math.floor(outMin / 60);
          var outM    = outMin % 60;
          timeIn      = ('0' + inH).slice(-2)  + ':' + ('0' + inM).slice(-2);
          timeOut     = ('0' + outH).slice(-2) + ':' + ('0' + outM).slice(-2);
          var inDecimal  = inH  + inM  / 60;
          var outDecimal = outH + outM / 60;
          hours    = Math.round((outDecimal - inDecimal) * 100) / 100;
          var scheduledH = 9;  // 09:00-18:00 = 9 hours
          daySal = Math.round((empSalaries[empName] || 2000) * hours / scheduledH);
        }

        var dtTs = new Date(tsCur.getTime());
        tsRows.push([dtTs, empName, timeIn, timeOut, status, hours, daySal, '']);
      });

      tsCur.setDate(tsCur.getDate() + 1);
    }

    if (tsRows.length > 0) {
      tsSh.getRange(2, 1, tsRows.length, 8).setValues(tsRows);
      tsSh.getRange(2, 1, tsRows.length, 1).setNumberFormat('dd.mm.yyyy');
      tsSh.getRange(2, 7, tsRows.length, 1).setNumberFormat('#,##0');
    }

    return {
      ok:   true,
      rows: {
        base:      baseRows.length,
        reps:      repRows.length,
        timesheet: tsRows.length
      }
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// importExcelRows — batch-import БАЗА rows from Excel (called from browser)
// rows: [{date, shift, cashier, type, category, payType, amount, disc, comment}]
// ────────────────────────────────────────────────────────────────────────────
function importExcelRows(rows) {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var base = ss.getSheetByName(SH_BASE);
    var data = rows.map(function(r) {
      return [
        r.date || '',
        r.shift || '',
        r.cashier || '',
        r.type || '',
        r.category || '',
        r.payType || '',
        Number(r.amount) || 0,
        Number(r.disc) || 0,
        r.comment || ''
      ];
    });
    if (data.length > 0) {
      var startRow = base.getLastRow() + 1;
      base.getRange(startRow, 1, data.length, 9).setValues(data);
    }
    return { ok: true, imported: data.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// importRepExcelRows — batch-import ТОРГ_ПРЕД rows from Excel
// ────────────────────────────────────────────────────────────────────────────
function importRepExcelRows(rows) {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var reps = ss.getSheetByName(SH_REPS);
    var now  = new Date();
    var data = rows.map(function(r) {
      return [
        Utilities.getUuid(),
        r.date || '',
        r.repName || '',
        r.invoiceNum || '',
        Number(r.amount) || 0,
        r.status || '',
        r.comment || '',
        now
      ];
    });
    if (data.length > 0) {
      var startRow = reps.getLastRow() + 1;
      reps.getRange(startRow, 1, data.length, 8).setValues(data);
    }
    return { ok: true, imported: data.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// clearBase — удалить все данные из БАЗА (без заголовка), для реимпорта
// ────────────────────────────────────────────────────────────────────────────
function clearBase() {
  try {
    var ss   = getSpreadsheet();
    var base = ss.getSheetByName(SH_BASE);
    if (!base) return { ok: true };
    var last = base.getLastRow();
    if (last > 1) base.getRange(2, 1, last - 1, 9).clearContent();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// buildAnalyticsSheets — создать/пересоздать формульные листы Пульт, По_Месяцам, Отчёт_Ф
// ────────────────────────────────────────────────────────────────────────────
function buildAnalyticsSheets() {
  try {
    var ss = getSpreadsheet();
    ensureSheets();

    // ── Пульт ──────────────────────────────────────────────────────────────
    var pulse = ss.getSheetByName(SH_PULSE);
    if (pulse) ss.deleteSheet(pulse);
    pulse = ss.insertSheet(SH_PULSE, 0); // first tab

    var tealBg = '#0B4F54'; var white = '#FFFFFF'; var lightBg = '#E8F5E9';

    pulse.setColumnWidth(1, 200); pulse.setColumnWidth(2, 160); pulse.setColumnWidth(3, 160);
    pulse.setColumnWidths(4, 5, 120);

    pulse.getRange('A1:F1').merge().setValue('  ПУЛЬТ — Быстрый обзор магазина')
      .setBackground(tealBg).setFontColor(white).setFontWeight('bold').setFontSize(14);

    // Current year label
    pulse.getRange('A2').setValue('Год:').setFontWeight('bold');
    pulse.getRange('B2').setFormula('=YEAR(TODAY())');

    var kpiLabels = [
      ['Выручка (все время)', '=SUMPRODUCT((БАЗА!D2:D="Приход")*(БАЗА!G2:G))'],
      ['Расходы (все время)', '=SUMPRODUCT((БАЗА!D2:D="Расход")*(БАЗА!G2:G))'],
      ['Прибыль', '=B4-B5'],
      ['Расхождения', '=SUMPRODUCT(ISNUMBER(БАЗА!H2:H)*1*БАЗА!H2:H)'],
      ['Записей всего', '=COUNTA(БАЗА!A2:A)'],
    ];

    pulse.getRange('A4:B4').getCell(1,1).setValue('ПОКАЗАТЕЛЬ').setFontWeight('bold').setBackground(tealBg).setFontColor(white);
    pulse.getRange('B4').setValue('ЗНАЧЕНИЕ').setFontWeight('bold').setBackground(tealBg).setFontColor(white);

    kpiLabels.forEach(function(row, i) {
      var r = i + 5;
      pulse.getRange(r, 1).setValue(row[0]).setBackground(i % 2 === 0 ? lightBg : white);
      pulse.getRange(r, 2).setFormula(row[1]).setBackground(i % 2 === 0 ? lightBg : white)
        .setNumberFormat('#,##0').setFontWeight('bold');
    });

    // Monthly breakdown mini-table on same sheet
    pulse.getRange('A12').setValue('ВЫРУЧКА ПО МЕСЯЦАМ (текущий год)').setFontWeight('bold')
      .setBackground(tealBg).setFontColor(white);
    pulse.getRange('B12').setValue('Выручка').setFontWeight('bold').setBackground(tealBg).setFontColor(white);
    pulse.getRange('C12').setValue('Расходы').setFontWeight('bold').setBackground(tealBg).setFontColor(white);
    pulse.getRange('D12').setValue('Прибыль').setFontWeight('bold').setBackground(tealBg).setFontColor(white);

    var months = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    months.forEach(function(m, i) {
      var r = i + 13;
      var mn = i + 1;
      pulse.getRange(r, 1).setValue(m).setBackground(i % 2 === 0 ? lightBg : white);
      pulse.getRange(r, 2).setFormula(
        '=SUMPRODUCT((YEAR(БАЗА!A2:A)=YEAR(TODAY()))*(MONTH(БАЗА!A2:A)=' + mn + ')*(БАЗА!D2:D="Приход")*(БАЗА!G2:G))'
      ).setNumberFormat('#,##0').setBackground(i % 2 === 0 ? lightBg : white).setFontWeight('bold');
      pulse.getRange(r, 3).setFormula(
        '=SUMPRODUCT((YEAR(БАЗА!A2:A)=YEAR(TODAY()))*(MONTH(БАЗА!A2:A)=' + mn + ')*(БАЗА!D2:D="Расход")*(БАЗА!G2:G))'
      ).setNumberFormat('#,##0').setBackground(i % 2 === 0 ? lightBg : white);
      pulse.getRange(r, 4).setFormula('=B' + r + '-C' + r)
        .setNumberFormat('#,##0').setBackground(i % 2 === 0 ? lightBg : white);
    });

    pulse.setFrozenRows(1);

    // ── По_Месяцам ──────────────────────────────────────────────────────────
    var monthly = ss.getSheetByName(SH_MONTHLY);
    if (monthly) ss.deleteSheet(monthly);
    monthly = ss.insertSheet(SH_MONTHLY);

    monthly.getRange('A1:H1').merge().setValue('  СВОДНАЯ ПО МЕСЯЦАМ И КАССИРАМ')
      .setBackground(tealBg).setFontColor(white).setFontWeight('bold').setFontSize(13);

    var mHeaders = ['Год', 'Месяц', 'Выручка', 'Расходы', 'Прибыль', 'Расхождения', 'Смен', 'Ср/смена'];
    monthly.getRange(2, 1, 1, mHeaders.length).setValues([mHeaders])
      .setFontWeight('bold').setBackground('#C8E6C9');
    monthly.setFrozenRows(2);

    // QUERY to summarize by year-month
    monthly.getRange('A3').setFormula(
      '=IFERROR(QUERY(БАЗА!A:I,"SELECT YEAR(A), MONTH(A), ' +
      'SUM(G), SUM(H) WHERE D=\'Приход\' AND A IS NOT NULL GROUP BY YEAR(A), MONTH(A) ' +
      'ORDER BY YEAR(A) DESC, MONTH(A) DESC LABEL YEAR(A) \'Год\', MONTH(A) \'Месяц\', ' +
      'SUM(G) \'Выручка\', SUM(H) \'Расхождения\'",0),"")'
    );
    monthly.setColumnWidths(1, 8, 120);

    // ── Отчёт_Ф ─────────────────────────────────────────────────────────────
    var rpt = ss.getSheetByName(SH_REPORT);
    if (rpt) ss.deleteSheet(rpt);
    rpt = ss.insertSheet(SH_REPORT);

    rpt.setColumnWidth(1, 220); rpt.setColumnWidth(2, 160);
    rpt.getRange('A1:B1').merge().setValue('  УПРАВЛЕНЧЕСКИЙ ОТЧЁТ')
      .setBackground(tealBg).setFontColor(white).setFontWeight('bold').setFontSize(13);

    rpt.getRange('A2').setValue('Фильтр — Год:').setFontWeight('bold');
    rpt.getRange('B2').setValue(new Date().getFullYear());
    rpt.getRange('A3').setValue('Фильтр — Месяц (1-12):').setFontWeight('bold');
    rpt.getRange('B3').setValue(new Date().getMonth() + 1);

    var rptRows = [
      ['Выручка', '=SUMPRODUCT((YEAR(БАЗА!A2:A)=B2)*(MONTH(БАЗА!A2:A)=B3)*(БАЗА!D2:D="Приход")*(БАЗА!G2:G))'],
      ['Расходы', '=SUMPRODUCT((YEAR(БАЗА!A2:A)=B2)*(MONTH(БАЗА!A2:A)=B3)*(БАЗА!D2:D="Расход")*(БАЗА!G2:G))'],
      ['Прибыль', '=B5-B6'],
      ['Расхождения', '=SUMPRODUCT((YEAR(БАЗА!A2:A)=B2)*(MONTH(БАЗА!A2:A)=B3)*ISNUMBER(БАЗА!H2:H)*1*БАЗА!H2:H)'],
      ['Смен', '=COUNTIFS(БАЗА!D2:D,"Приход",БАЗА!A2:A,">="&DATE(B2,B3,1),БАЗА!A2:A,"<"&DATE(B2,B3+1,1))'],
    ];

    rpt.getRange('A4:B4').getCell(1,1).setValue('Показатель').setFontWeight('bold').setBackground(tealBg).setFontColor(white);
    rpt.getRange('B4').setValue('Сумма').setFontWeight('bold').setBackground(tealBg).setFontColor(white);

    rptRows.forEach(function(row, i) {
      var r = i + 5;
      rpt.getRange(r, 1).setValue(row[0]).setBackground(i % 2 === 0 ? lightBg : white);
      rpt.getRange(r, 2).setFormula(row[1]).setNumberFormat('#,##0')
        .setBackground(i % 2 === 0 ? lightBg : white).setFontWeight('bold');
    });

    // By category breakdown
    rpt.getRange('A11').setValue('РАСХОДЫ ПО КАТЕГОРИЯМ').setFontWeight('bold').setBackground(tealBg).setFontColor(white);
    rpt.getRange('B11').setValue('Сумма').setFontWeight('bold').setBackground(tealBg).setFontColor(white);
    rpt.getRange('A12').setFormula(
      '=IFERROR(QUERY(БАЗА!A:I,"SELECT E, SUM(G) WHERE D=\'Расход\' AND YEAR(A)="&B2&" AND MONTH(A)="&B3&" GROUP BY E ORDER BY SUM(G) DESC LABEL E \'Категория\', SUM(G) \'Сумма\'",0),"")'
    );

    // By payment method
    rpt.getRange('D4').setValue('СПОСОБЫ ОПЛАТЫ').setFontWeight('bold').setBackground(tealBg).setFontColor(white);
    rpt.getRange('E4').setValue('Сумма').setFontWeight('bold').setBackground(tealBg).setFontColor(white);
    rpt.getRange('D5').setFormula(
      '=IFERROR(QUERY(БАЗА!A:I,"SELECT F, SUM(G) WHERE D=\'Приход\' AND YEAR(A)="&B2&" AND MONTH(A)="&B3&" GROUP BY F ORDER BY SUM(G) DESC LABEL F \'Способ\', SUM(G) \'Сумма\'",0),"")'
    );

    rpt.setColumnWidth(1, 220); rpt.setColumnWidth(2, 140); rpt.setColumnWidth(4, 180); rpt.setColumnWidth(5, 140);
    rpt.setFrozenRows(1);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
