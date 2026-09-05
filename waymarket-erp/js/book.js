/* ============================================================================
   Книга «Бухгалтерия.xlsx» — это и есть база в человеческом виде.
   Программа перезаписывает её после каждой записи и перечитывает правки,
   сделанные в Excel: строку узнаёт по колонке ID.

   Листов ровно столько, сколько коллекций в базе, плюс три считаемых:
   их программа пересобирает сама, править там бесполезно.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.WMBook = factory(root.WM);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  var FILE = 'Бухгалтерия.xlsx';
  var txt = E.txt, num = E.num, round = E.safeRound, norm = E.norm;

  function toDate(v) { return E.excelDate(v); }
  function yes(v) {
    var s = norm(v);
    return s === 'да' || s === 'true' || s === '1' || v === true;
  }
  function uid() { return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* --- Описание листов ------------------------------------------------------
     [Заголовок, поле, тип]: text · num · date · bool                        */
  var SHEETS = [
    /* Смены отдельным листом: это самый частый лист, и мешать его с
       расходами неудобно — в нём своя шапка и своя арифметика. */
    { name: 'Касса_и_Смены', coll: 'dds', edit: true, only: 'Смена',
      about: 'Закрытые смены: размен, Z-отчёт наличными и безналом, выплаты из ящика, ' +
        'факт и расхождение. Безнал в ящик не попадает — в расчётный остаток он не входит.',
      cols: [['ID', 'id'], ['Тип', 'type'], ['Дата', 'date', 'date'],
        ['Касса', 'till'], ['Смена', 'shift'], ['Кассир', 'cashier'],
        ['Размен_на_начало', 'openCash', 'num'],
        ['Z_наличные', 'zCash', 'num'], ['Z_безнал', 'zCashless', 'num'],
        ['Выплаты_из_ящика', 'payouts', 'num'], ['Факт_в_ящике', 'factCash', 'num'],
        ['Расхождение', 'diff', 'num'], ['Чеков', 'checks', 'num'],
        ['Комментарий', 'note']] },

    { name: 'ДДС_Операции', coll: 'dds', edit: true, not: 'Смена',
      about: 'Итоги дня (товар за наличные, погашение и новый долг), приходы, ' +
        'расходы, заборы владельца и перемещения денег. ' +
        'Тип строки: День · Приход · Расход · Забор · Перемещение. ' +
        'Колонка «Откуда_деньги» решает, уменьшать ли ящик: «Из ящика» значит, ' +
        'что деньги уже посчитаны в выплатах смены, и второй раз их не вычитают.',
      cols: [['ID', 'id'], ['Тип', 'type'], ['Дата', 'date', 'date'],
        ['Товар_за_наличные', 'goodsCash', 'num'],
        ['Погашено_долга', 'debtPaid', 'num'],
        ['Взято_в_долг', 'debtTaken', 'num'],
        ['Статья', 'category'], ['Способ', 'method'], ['Сумма', 'amount', 'num'],
        ['Откуда_деньги', 'source'], ['Откуда_переместили', 'from'],
        ['Куда_переместили', 'to'], ['Комментарий', 'note']] },

    { name: 'План_Выплат', coll: 'plans', edit: true,
      about: 'Кому и когда платить. Отметка «Оплачена» долг сама не уменьшает — ' +
        'сумму погашения впишите в «Итоги дня», иначе долг посчитается дважды.',
      cols: [['ID', 'id'], ['Дата_выплаты', 'due', 'date'], ['Кому', 'supplier'],
        ['Сумма', 'amount', 'num'], ['Статус', 'status'],
        ['Чем_платим', 'method'], ['Оплачено_когда', 'paidAt', 'date'],
        ['Комментарий', 'note']] },

    { name: 'Сотрудники', coll: 'staff', edit: true,
      about: 'Кто работает: ставка за час, оклад, телефон, когда принят и уволен. ' +
        'Уволенный не предлагается в формах, но его смены остаются в отчётах.',
      cols: [['ID', 'id'], ['Имя', 'name'], ['Должность', 'position'],
        ['Ставка_за_час', 'rate', 'num'], ['Оклад_за_месяц', 'salary', 'num'],
        ['Телефон', 'phone'], ['Принят', 'hired', 'date'], ['Уволен', 'fired', 'date'],
        ['Заметка', 'note']] },

    { name: 'Табель_Зарплаты', coll: 'timesheet', edit: true,
      about: 'Отработанные смены: часы днём и ночью, премия и удержание. ' +
        'Из этого листа считается начисление в ведомости ФОТ.',
      cols: [['ID', 'id'], ['Дата', 'date', 'date'], ['Сотрудник', 'employee'],
        ['Смена', 'shift'], ['Часы_день', 'hoursDay', 'num'], ['Часы_ночь', 'hoursNight', 'num'],
        ['Ставка_за_час', 'rate', 'num'], ['Премия', 'bonus', 'num'],
        ['Удержание', 'fine', 'num'], ['Комментарий', 'note']] },

    { name: 'Выплаты_Зарплаты', coll: 'payouts', edit: true,
      about: 'Что уже выдали на руки: аванс и окончательный расчёт.',
      cols: [['ID', 'id'], ['Дата', 'date', 'date'], ['Сотрудник', 'employee'],
        ['Вид', 'kind'], ['Сумма', 'amount', 'num'], ['Чем', 'method'], ['Комментарий', 'note']] },

    { name: 'Долги_покупателей', coll: 'debtors', edit: true,
      about: 'Бывшая тетрадка у кассы. Пока долг не погашен, выручкой он не считается.',
      cols: [['ID', 'id'], ['Дата', 'date', 'date'], ['Кто', 'name'],
        ['Телефон', 'phone'], ['Сумма', 'sum', 'num'], ['Погашено', 'paid', 'num'],
        ['Кассир', 'cashier'], ['Комментарий', 'note']] },

    { name: 'Пересчёт_кассы', coll: 'cashcount', edit: true,
      about: 'Сколько каких купюр насчитали в ящике.',
      cols: [['ID', 'id'], ['Дата', 'date', 'date'], ['Касса', 'till'],
        ['Кассир', 'cashier'], ['Насчитали', 'sum', 'num'],
        ['Должно_быть', 'expected', 'num'], ['Расхождение', 'diff', 'num'],
        ['Комментарий', 'note']] }
  ];

  /* Какие настройки показываем в книге и что каждая значит */
  var SETTING_HELP = [
    ['storeName', 'Название магазина'],
    ['tills', 'Денежные ящики через запятую'],
    ['shiftNames', 'Названия смен через запятую'],
    ['openCashStart', 'Наличных в кассах на день начала учёта, ₽'],
    ['openSafeStart', 'Наличных в сейфе на день начала учёта, ₽'],
    ['openDebtStart', 'Долг поставщикам на день начала учёта, ₽'],
    ['diffCrit', 'Крупное расхождение кассы, ₽'],
    ['cashLimit', 'Наличных в кассе больше этого — предупредить, ₽'],
    ['collectTo', 'Куда обычно увозят инкассацию: Сейф или Банк'],
    ['debtWarn', 'Долг поставщикам: внимание, ₽'],
    ['debtCrit', 'Долг поставщикам: критично, ₽'],
    ['rateDay', 'Ставка дневной смены, ₽/час'],
    ['rateNight', 'Ставка ночной смены, ₽/час'],
    ['advanceDay', 'Какого числа аванс'],
    ['advancePct', 'Доля аванса от начисленного, %'],
    ['salaryDay', 'Какого числа окончательный расчёт'],
    ['taxMode', 'Система налогообложения'],
    ['taxRate', 'Ставка налога, %'],
    ['fot', 'Плановый ФОТ в месяц, ₽'],
    ['rent', 'Аренда в месяц, ₽'],
    ['utilities', 'Коммуналка в месяц, ₽'],
    ['taxes', 'Налоги в месяц, ₽'],
    ['other', 'Прочие постоянные расходы, ₽'],
    ['marginManual', 'Наценка для расчёта безубыточности, %'],
    ['planRevenue', 'План выручки в месяц, ₽']
  ];

  function sheetByName(name) {
    for (var i = 0; i < SHEETS.length; i++) if (SHEETS[i].name === name) return SHEETS[i];
    return null;
  }

  function cellOut(row, col) {
    var v = row[col[1]], type = col[2] || 'text';
    if (v == null || v === '') return type === 'num' ? 0 : '';
    if (type === 'num') return round(v);
    if (type === 'bool') return yes(v) ? 'да' : 'нет';
    if (type === 'date') return txt(v);
    return txt(v);
  }
  function cellIn(v, col) {
    var type = col[2] || 'text';
    if (type === 'num') return round(v);
    if (type === 'bool') return yes(v);
    if (type === 'date') return toDate(v);
    return txt(v);
  }

  /* --- Считаемые листы: их программа пересобирает сама ---------------------- */

  // Отчёт по месяцам: выручка, расхождения, товар, долг
  function months(state) {
    var rows = state.dds || [], map = {};
    function slot(ym) {
      if (!map[ym]) map[ym] = { ym: ym, zCash: 0, zCashless: 0, revenue: 0,
        payouts: 0, short: 0, over: 0, shifts: 0, goodsCash: 0,
        debtTaken: 0, debtPaid: 0, expense: 0 };
      return map[ym];
    }
    rows.forEach(function (r) {
      var ym = E.ymOf(r.date); if (!ym) return;
      var m = slot(ym);
      if (E.isShift(r)) {
        var c = E.shiftCalc(r);
        m.zCash += c.zCash; m.zCashless += c.zCashless; m.payouts += c.payouts;
        m.short += c.short; m.over += c.over; m.shifts++;
      } else if (E.isDay(r)) {
        m.goodsCash += num(r.goodsCash);
        m.debtTaken += num(r.debtTaken); m.debtPaid += num(r.debtPaid);
      } else if (E.isExpense(r)) {
        m.expense += num(r.amount);
      }
    });
    return Object.keys(map).sort().map(function (k) {
      var m = map[k];
      m.revenue = round(m.zCash + m.zCashless);
      ['zCash', 'zCashless', 'payouts', 'short', 'over', 'goodsCash',
        'debtTaken', 'debtPaid', 'expense'].forEach(function (f) { m[f] = round(m[f]); });
      return m;
    });
  }

  // Кто сколько недосдал — для разговора с кассирами
  function cashiers(state) {
    return E.cashierRating(state.dds || []);
  }

  // Долг поставщикам по месяцам: сколько взяли, сколько отдали, сколько висит
  function debtSheet(state, settings) {
    var res = E.supplierDebt(state.dds || [], settings || {});
    var run = res.opening, out = [];
    months(state).forEach(function (m) {
      run = round(run + m.debtTaken - m.debtPaid);
      out.push({ ym: m.ym, taken: m.debtTaken, paid: m.debtPaid, left: run });
    });
    return out;
  }

  /* --- Сборка книги ---------------------------------------------------------- */
  function build(state, settings) {
    var out = [];
    SHEETS.forEach(function (sh) {
      var src = (state[sh.coll] || []).filter(function (r) {
        if (sh.only) return txt(r.type) === sh.only;
        if (sh.not) return txt(r.type) !== sh.not;
        return true;
      });
      var rows = src.map(function (r) {
        return sh.cols.map(function (c) { return cellOut(r, c); });
      });
      out.push({ name: sh.name, edit: true, about: sh.about,
        aoa: [sh.cols.map(function (c) { return c[0]; })].concat(rows) });
    });

    var mm = months(state);
    out.push({ name: 'Отчёт_по_месяцам', edit: false,
      about: 'Считается сама — править бесполезно.',
      aoa: [['Месяц', 'Выручка', 'Наличные', 'Безнал', 'Выплаты_из_ящика',
        'Недостачи', 'Излишки', 'Смен', 'Товар_за_наличные', 'Прочие_расходы']]
        .concat(mm.map(function (m) {
          return [m.ym, m.revenue, m.zCash, m.zCashless, m.payouts,
            m.short, m.over, m.shifts, m.goodsCash, m.expense];
        })) });

    out.push({ name: 'Кассиры_расхождения', edit: false,
      about: 'Считается сама.',
      aoa: [['Кассир', 'Смен', 'Недостачи', 'Излишки', 'Итого_расхождение',
        'Выручка', 'Недостача_на_1000₽', 'Смен_с_расхождением']]
        .concat(cashiers(state).map(function (c) {
          return [c.name, c.shifts, c.short, c.over, c.diff, c.revenue,
            c.per1000, c.badShifts];
        })) });

    out.push({ name: 'Долг_поставщикам', edit: false,
      about: 'Считается сама: долг на начало + взято в долг − погашено.',
      aoa: [['Месяц', 'Взято_в_долг', 'Погашено', 'Долг_на_конец']]
        .concat(debtSheet(state, settings).map(function (d) {
          return [d.ym, d.taken, d.paid, d.left];
        })) });

    // Настройки отдельным листом: с колонкой «Что это», чтобы было понятно,
    // на что влияет каждая строка
    var st = (settings || {});
    out.push({ name: 'Настройки', edit: true,
      about: 'Правится и здесь, и в программе.',
      aoa: [['Ключ', 'Значение', 'Что это']].concat(
        SETTING_HELP.filter(function (h) { return st[h[0]] !== undefined; })
          .map(function (h) { return [h[0], st[h[0]], h[1]]; })) });

    return out;
  }

  /* --- Чтение правок из книги ------------------------------------------------
     Строку узнаём по ID. Строка без ID — новая, ей ID выдаётся.
     Пустой лист не принимаем: это почти всегда «случайно всё стёр».
     ------------------------------------------------------------------------ */
  function parse(matrixOf, state) {
    var report = { sheets: [], rows: 0, skipped: [] };
    SHEETS.forEach(function (sh) {
      var m = matrixOf(sh.name);
      if (!m || !m.length) return;
      var head = (m[0] || []).map(function (v) { return norm(v); });
      var idx = {};
      sh.cols.forEach(function (c) {
        var pos = head.indexOf(norm(c[0]));
        if (pos >= 0) idx[c[1]] = pos;
      });
      if (idx.id === undefined) { report.skipped.push(sh.name + ': нет колонки ID'); return; }

      var rows = [], seen = {};
      for (var r = 1; r < m.length; r++) {
        var line = m[r]; if (!line) continue;
        var rec = {}, empty = true;
        sh.cols.forEach(function (c) {
          if (idx[c[1]] === undefined) return;
          var v = cellIn(line[idx[c[1]]], c);
          rec[c[1]] = v;
          if (c[1] !== 'id' && v !== '' && v !== 0 && v !== false) empty = false;
        });
        if (empty) continue;
        if (!rec.id || seen[rec.id]) rec.id = uid();
        seen[rec.id] = 1;
        rows.push(rec);
      }
      var kept = (state[sh.coll] || []).filter(function (r) {
        if (sh.only) return txt(r.type) !== sh.only;      // чужая половина коллекции
        if (sh.not) return txt(r.type) === sh.not;
        return false;
      });
      if (!rows.length && (state[sh.coll] || []).length > kept.length) {
        report.skipped.push(sh.name + ': лист пуст, прежние записи оставлены');
        return;
      }
      // поля, которых нет в книге, у прежней записи сохраняем
      var old = {};
      (state[sh.coll] || []).forEach(function (o) { if (o.id) old[o.id] = o; });
      rows = rows.map(function (rec) {
        var prev = old[rec.id];
        if (!prev) return rec;
        var merged = {};
        for (var k in prev) merged[k] = prev[k];
        for (var k2 in rec) merged[k2] = rec[k2];
        return merged;
      });
      state[sh.coll] = kept.concat(rows);
      report.sheets.push({ name: sh.name, rows: rows.length });
      report.rows += rows.length;
    });
    // лист настроек
    var sm = matrixOf('Настройки');
    if (sm && sm.length > 1 && state.settings) {
      var changed = 0;
      for (var r2 = 1; r2 < sm.length; r2++) {
        var key = txt(sm[r2] && sm[r2][0]);
        if (!key || state.settings[key] === undefined) continue;
        var was = state.settings[key], now = sm[r2][1];
        if (typeof was === 'number') now = round(now);
        else now = txt(now);
        if (String(was) !== String(now)) { state.settings[key] = now; changed++; }
      }
      if (changed) report.sheets.push({ name: 'Настройки', rows: changed });
    }
    return report;
  }

  return { FILE: FILE, SHEETS: SHEETS, SETTING_HELP: SETTING_HELP, sheetByName: sheetByName,
    build: build, parse: parse, toDate: toDate,
    months: months, cashiers: cashiers, debtSheet: debtSheet };
});
