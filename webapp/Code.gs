// ═══════════════════════════════════════════════════════════════════════
//  ФИНАНСОВЫЙ КОНТРОЛЬ — Google Apps Script Backend
//  Deploy as Web App: Execute as Me, Access: Anyone
// ═══════════════════════════════════════════════════════════════════════

var SS_ID = '1MkPEUT2XJlciHthlVcCyaZp_6A9rBAxayRC3i1I82hg';

// ── Sheet names ──────────────────────────────────────────────────────────
var SH_BASE     = 'БАЗА';
var SH_SETTINGS = 'НАСТРОЙКИ';

// ── БАЗА columns ─────────────────────────────────────────────────────────
// A:Дата  B:Смена  C:Кассир  D:Тип  E:Категория  F:Способ  G:Сумма  H:Расхождение  I:Комментарий
var COL_DATE     = 1;
var COL_SHIFT    = 2;
var COL_CASHIER  = 3;
var COL_TYPE     = 4;
var COL_CAT      = 5;
var COL_PAY      = 6;
var COL_AMOUNT   = 7;
var COL_DISC     = 8;
var COL_COMMENT  = 9;

// ── НАСТРОЙКИ ranges ────────────────────────────────────────────────────
var SET_CASHIERS   = 'B2:B20';
var SET_SHIFTS     = 'C2:C10';
var SET_CATS_IN    = 'D2:D20';
var SET_CATS_OUT   = 'E2:E20';
var SET_PAY_TYPES  = 'F2:F10';
var SET_SUPPLIERS  = 'G2:G20';

// ────────────────────────────────────────────────────────────────────────
function getSpreadsheet() {
  return SpreadsheetApp.openById(SS_ID);
}

// ── Entry point ──────────────────────────────────────────────────────────
function doGet(e) {
  try {
    ensureSheets();
  } catch(err) {
    // Non-fatal — page still loads, data calls will surface errors
  }
  var tpl = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Финансовый контроль')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
  tpl.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return tpl;
}

// ── Sheet bootstrap ──────────────────────────────────────────────────────
function ensureSheets() {
  var ss = getSpreadsheet();

  // БАЗА
  var base = ss.getSheetByName(SH_BASE);
  if (!base) {
    base = ss.insertSheet(SH_BASE);
    var headers = ['Дата','Смена','Кассир','Тип','Категория','Способ оплаты',
                   'Сумма','Расхождение','Комментарий'];
    base.getRange(1, 1, 1, headers.length).setValues([headers])
       .setFontWeight('bold').setBackground('#0B4F54').setFontColor('#FFFFFF');
    base.setFrozenRows(1);
    base.setColumnWidth(1, 100);
    base.setColumnWidth(7, 100);
    base.setColumnWidth(8, 110);
    base.setColumnWidth(9, 160);
  }

  // НАСТРОЙКИ
  var sett = ss.getSheetByName(SH_SETTINGS);
  if (!sett) {
    sett = ss.insertSheet(SH_SETTINGS);
    var settHeaders = ['','Кассир','Смена','Категория (Приход)',
                       'Категория (Расход)','Способ оплаты','Поставщик'];
    sett.getRange(1, 1, 1, settHeaders.length).setValues([settHeaders])
       .setFontWeight('bold').setBackground('#0B4F54').setFontColor('#FFFFFF');

    // Default values
    var defaults = [
      ['','Иванова А.','Утро','Выручка','Аренда','Наличные','ООО Ромашка'],
      ['','Петрова Б.','День','Z-отчёт','ЗП','Карта','ИП Иванов'],
      ['','Сидорова В.','Вечер','Прочий приход','Закупка','Эквайринг',''],
      ['','','','','Хозрасходы','СБП',''],
      ['','','','','Прочий расход','',''],
    ];
    sett.getRange(2, 1, defaults.length, defaults[0].length).setValues(defaults);
    sett.setFrozenRows(1);
  }
}

// ── Settings ─────────────────────────────────────────────────────────────
function getSettings() {
  try {
    ensureSheets();
    var ss  = getSpreadsheet();
    var sett = ss.getSheetByName(SH_SETTINGS);

    function getCol(range) {
      return sett.getRange(range).getValues()
        .map(function(r){ return String(r[0]).trim(); })
        .filter(function(v){ return v !== ''; });
    }

    return {
      ok:        true,
      cashiers:  getCol(SET_CASHIERS),
      shifts:    getCol(SET_SHIFTS),
      catsIn:    getCol(SET_CATS_IN),
      catsOut:   getCol(SET_CATS_OUT),
      payTypes:  getCol(SET_PAY_TYPES),
      suppliers: getCol(SET_SUPPLIERS)
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── Save cashier shift (Ввод Кассы) ─────────────────────────────────────
// data = {
//   date, shift, cashier,
//   zNal, zCard, zSBP,    // Z-report amounts
//   factNal, factCard, factSBP,  // Actual amounts
//   vyplata,             // Выплата из кассы
//   comment
// }
function saveKassa(data) {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var base = ss.getSheetByName(SH_BASE);
    var dt   = new Date(data.date);
    var rows = [];

    var payMethods = [
      { pay: 'Наличные', z: parseFloat(data.zNal)  || 0, fact: parseFloat(data.factNal)  || 0 },
      { pay: 'Карта',    z: parseFloat(data.zCard) || 0, fact: parseFloat(data.factCard) || 0 },
      { pay: 'СБП',      z: parseFloat(data.zSBP)  || 0, fact: parseFloat(data.factSBP)  || 0 },
    ];

    // 3 income rows (one per payment method)
    payMethods.forEach(function(pm) {
      if (pm.z === 0 && pm.fact === 0) return;
      var disc = pm.fact - pm.z;
      rows.push([
        dt,
        data.shift,
        data.cashier,
        'Приход',
        'Z-отчёт',
        pm.pay,
        pm.z,
        disc,
        data.comment || ''
      ]);
    });

    // Payout row if > 0
    var vyplata = parseFloat(data.vyplata) || 0;
    if (vyplata > 0) {
      rows.push([
        dt,
        data.shift,
        data.cashier,
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

    // Format date column
    var dateFmt = base.getRange(lastRow + 1, COL_DATE, rows.length, 1);
    dateFmt.setNumberFormat('dd.mm.yyyy');

    // Format amount and discrepancy
    base.getRange(lastRow + 1, COL_AMOUNT, rows.length, 1).setNumberFormat('#,##0');
    base.getRange(lastRow + 1, COL_DISC,   rows.length, 1).setNumberFormat('#,##0;[Red]-#,##0;"✓"');

    return { ok: true, rows: rows.length };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── Save expense ─────────────────────────────────────────────────────────
// data = { date, shift, cashier, category, payType, amount, supplier, comment }
function saveExpense(data) {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var base = ss.getSheetByName(SH_BASE);
    var dt   = new Date(data.date);

    var row = [
      dt,
      data.shift,
      data.cashier,
      'Расход',
      data.category,
      data.payType,
      parseFloat(data.amount) || 0,
      0,
      (data.supplier ? data.supplier + '. ' : '') + (data.comment || '')
    ];

    var lastRow = base.getLastRow();
    base.getRange(lastRow + 1, 1, 1, 9).setValues([row]);
    base.getRange(lastRow + 1, COL_DATE,   1, 1).setNumberFormat('dd.mm.yyyy');
    base.getRange(lastRow + 1, COL_AMOUNT, 1, 1).setNumberFormat('#,##0');

    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── Dashboard data ────────────────────────────────────────────────────────
// params = { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
function getDashboardData(params) {
  try {
    ensureSheets();
    var ss   = getSpreadsheet();
    var base = ss.getSheetByName(SH_BASE);
    var lastRow = base.getLastRow();

    if (lastRow < 2) {
      return { ok: true, empty: true, kpi: {}, shifts: [], cashiers: [], months: [], payMethods: [] };
    }

    var data = base.getRange(2, 1, lastRow - 1, 9).getValues();
    var fromDate = params && params.from ? new Date(params.from) : null;
    var toDate   = params && params.to   ? new Date(params.to)   : null;

    // Normalize dates to midnight
    if (fromDate) fromDate.setHours(0,0,0,0);
    if (toDate)   toDate.setHours(23,59,59,999);

    // Filter rows by date range
    var rows = data.filter(function(r) {
      if (!r[0] || !(r[0] instanceof Date)) return false;
      var d = new Date(r[0]); d.setHours(0,0,0,0);
      if (fromDate && d < fromDate) return false;
      if (toDate   && d > toDate)   return false;
      return true;
    });

    // ── KPI ──────────────────────────────────────────────────────────
    var totalRevenue  = 0;
    var totalExpense  = 0;
    var totalDisc     = 0;
    var discCount     = 0;

    // For distinct shift counting
    var shiftSet = {};  // key: date+shift → { cashier, hasDisc }

    rows.forEach(function(r) {
      var type   = String(r[COL_TYPE-1]);
      var amount = parseFloat(r[COL_AMOUNT-1]) || 0;
      var disc   = parseFloat(r[COL_DISC-1])   || 0;
      var d      = r[COL_DATE-1];
      var dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      var shiftKey = dateStr + '|' + r[COL_SHIFT-1];

      if (type === 'Приход') {
        totalRevenue += amount;
        if (disc !== 0) {
          totalDisc += disc;
          discCount++;
          if (!shiftSet[shiftKey]) shiftSet[shiftKey] = { cashier: r[COL_CASHIER-1], hasDisc: true };
          else shiftSet[shiftKey].hasDisc = true;
        } else {
          if (!shiftSet[shiftKey]) shiftSet[shiftKey] = { cashier: r[COL_CASHIER-1], hasDisc: false };
        }
      } else if (type === 'Расход') {
        totalExpense += amount;
      }
    });

    // ── By shift ─────────────────────────────────────────────────────
    var shiftTotals = {};
    rows.forEach(function(r) {
      var shift  = String(r[COL_SHIFT-1]);
      var type   = String(r[COL_TYPE-1]);
      var amount = parseFloat(r[COL_AMOUNT-1]) || 0;
      if (!shiftTotals[shift]) shiftTotals[shift] = { revenue: 0, expense: 0 };
      if (type === 'Приход') shiftTotals[shift].revenue += amount;
      else if (type === 'Расход') shiftTotals[shift].expense += amount;
    });

    var shiftsArr = Object.keys(shiftTotals).sort().map(function(s) {
      return { shift: s, revenue: shiftTotals[s].revenue, expense: shiftTotals[s].expense };
    });

    // ── By cashier (discrepancy analysis) ────────────────────────────
    // Count distinct shifts per cashier + shifts with discrepancy
    var cashierShifts    = {};  // cashier → Set of shiftKeys
    var cashierDiscShifts = {}; // cashier → Set of shiftKeys with disc
    var cashierDiscAmt   = {};  // cashier → total disc amount

    rows.forEach(function(r) {
      if (String(r[COL_TYPE-1]) !== 'Приход') return;
      var cashier  = String(r[COL_CASHIER-1]);
      var disc     = parseFloat(r[COL_DISC-1]) || 0;
      var d        = r[COL_DATE-1];
      var dateStr  = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      var shiftKey = dateStr + '|' + r[COL_SHIFT-1];

      if (!cashierShifts[cashier])     cashierShifts[cashier]     = {};
      if (!cashierDiscShifts[cashier]) cashierDiscShifts[cashier] = {};
      if (!cashierDiscAmt[cashier])    cashierDiscAmt[cashier]    = 0;

      cashierShifts[cashier][shiftKey] = true;
      if (disc !== 0) {
        cashierDiscShifts[cashier][shiftKey] = true;
        cashierDiscAmt[cashier] += disc;
      }
    });

    var cashiersArr = Object.keys(cashierShifts).sort().map(function(c) {
      var total = Object.keys(cashierShifts[c]).length;
      var discS = Object.keys(cashierDiscShifts[c] || {}).length;
      return {
        cashier:    c,
        shiftsTotal: total,
        shiftsDisc:  discS,
        discAmount:  cashierDiscAmt[c] || 0,
        discPct:     total > 0 ? Math.round(discS / total * 100) : 0
      };
    }).sort(function(a,b){ return b.shiftsDisc - a.shiftsDisc; });

    // ── By month ─────────────────────────────────────────────────────
    var monthTotals = {};
    rows.forEach(function(r) {
      var d = r[COL_DATE-1];
      if (!(d instanceof Date)) return;
      var monthKey = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
      var type   = String(r[COL_TYPE-1]);
      var amount = parseFloat(r[COL_AMOUNT-1]) || 0;
      if (!monthTotals[monthKey]) monthTotals[monthKey] = { revenue: 0, expense: 0 };
      if (type === 'Приход') monthTotals[monthKey].revenue += amount;
      else if (type === 'Расход') monthTotals[monthKey].expense += amount;
    });

    var monthsArr = Object.keys(monthTotals).sort().map(function(m) {
      var parts = m.split('-');
      var label = ['Янв','Фев','Мар','Апр','Май','Июн',
                   'Июл','Авг','Сен','Окт','Ноя','Дек'][parseInt(parts[1],10)-1]
                 + ' ' + parts[0].slice(2);
      return { month: m, label: label,
               revenue: monthTotals[m].revenue,
               expense: monthTotals[m].expense };
    });

    // ── By payment method ─────────────────────────────────────────────
    var payTotals = {};
    rows.forEach(function(r) {
      if (String(r[COL_TYPE-1]) !== 'Приход') return;
      var pay    = String(r[COL_PAY-1]);
      var amount = parseFloat(r[COL_AMOUNT-1]) || 0;
      if (!payTotals[pay]) payTotals[pay] = 0;
      payTotals[pay] += amount;
    });

    var payArr = Object.keys(payTotals).map(function(p) {
      return { method: p, amount: payTotals[p] };
    }).sort(function(a,b){ return b.amount - a.amount; });

    // ── Recent entries ────────────────────────────────────────────────
    var recentData = data.slice(-50).reverse();
    var recent = recentData.map(function(r) {
      var d = r[0];
      var dateStr = (d instanceof Date)
        ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd.MM.yyyy')
        : '';
      return {
        date:     dateStr,
        shift:    r[COL_SHIFT-1],
        cashier:  r[COL_CASHIER-1],
        type:     r[COL_TYPE-1],
        category: r[COL_CAT-1],
        pay:      r[COL_PAY-1],
        amount:   parseFloat(r[COL_AMOUNT-1]) || 0,
        disc:     parseFloat(r[COL_DISC-1])   || 0,
        comment:  r[COL_COMMENT-1]
      };
    });

    return {
      ok: true,
      kpi: {
        revenue:  totalRevenue,
        expense:  totalExpense,
        profit:   totalRevenue - totalExpense,
        discAmt:  totalDisc,
        discCount: discCount
      },
      shifts:     shiftsArr,
      cashiers:   cashiersArr,
      months:     monthsArr,
      payMethods: payArr,
      recent:     recent
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── Recent entries (История tab) ─────────────────────────────────────────
function getRecentEntries() {
  try {
    var result = getDashboardData(null);
    if (!result.ok) return result;
    return { ok: true, entries: result.recent || [] };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── Delete last entry (undo helper) ──────────────────────────────────────
function deleteLastEntry() {
  try {
    var ss   = getSpreadsheet();
    var base = ss.getSheetByName(SH_BASE);
    var last = base.getLastRow();
    if (last < 2) return { ok: false, error: 'Нет записей для удаления' };
    base.deleteRow(last);
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}
