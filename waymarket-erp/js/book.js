/* ============================================================================
   Книга «Бухгалтерия.xlsx» — она же база программы.
   Всё, что дашборд знает, лежит в одном файле Excel внутри рабочей папки:
   листы-журналы можно править прямо в Excel, программа их перечитывает,
   а расчётные листы (отчёты) она пересобирает сама при каждом сохранении.
   Ключ строки — колонка ID: по ней правка узнаётся, а не задваивается.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./supply.js'), require('./finance.js'), require('./settings.js'));
  } else {
    root.WMBook = factory(root.WMSupply, root.WMFin, root.WMSettings);
  }
})(typeof self !== 'undefined' ? self : this, function (SUP, FIN, CAT) {
  'use strict';

  var FILE = 'Бухгалтерия.xlsx';

  function txt(v) { return v == null ? '' : String(v).trim(); }
  function num(v) { return SUP.num(v); }
  function round(v) { return SUP.round(num(v)); }
  function yes(v) {
    var s = txt(v).toLowerCase();
    return s === 'да' || s === 'true' || s === '1' || s === 'x' || s === '+';
  }
  function uid() { return SUP.uid(); }

  // Дата из ячейки Excel: и «2026-09-01», и «01.09.2026», и настоящая дата Excel
  function toDate(v) {
    if (!v && v !== 0) return '';
    if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    var s = txt(v);
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];
    var ru = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
    if (ru) return ru[3] + '-' + ('0' + ru[2]).slice(-2) + '-' + ('0' + ru[1]).slice(-2);
    if (typeof v === 'number' && v > 20000 && v < 2958466) {        // серийная дата Excel
      var d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return d.toISOString().slice(0, 10);
    }
    return '';
  }

  /* --- Описание листов ------------------------------------------------------
     [Заголовок, поле, тип]: text · num · date · bool · list (через «;»)      */
  var SHEETS = [
    { name: 'Касса_и_расходы', coll: 'dds', edit: true,
      about: 'Все деньги: выручка по сменам, расходы, долг, забор владельцем.',
      cols: [['ID', 'id'], ['Дата', 'date', 'date'], ['Смена', 'shift'], ['Кассир', 'cashier'],
        ['Тип', 'type'], ['Категория', 'category'], ['Способ', 'method'],
        ['Сумма', 'amount', 'num'], ['Расхождение', 'diff', 'num'], ['Комментарий', 'note']] },

    { name: 'Поставщики', coll: 'supreg', edit: true,
      about: 'Справочник фирм: отсрочка, чем обычно платим, все написания имени из 1С.',
      cols: [['ID', 'id'], ['Поставщик', 'name'], ['Отсрочка_дней', 'termDays', 'num'],
        ['Обычная_оплата', 'method'], ['Телефон', 'phone'], ['Имена_в_1С', 'aliases', 'list'],
        ['Держать_отдельно', 'keepSeparate', 'bool'], ['Заметка', 'note']] },

    { name: 'Накладные', coll: 'docs', edit: true,
      about: 'Приходные накладные из 1С. Правьте дату выплаты и отметку «Подтверждена».',
      cols: [['ID', 'id'], ['Документ', 'doc'], ['Дата', 'date', 'date'], ['Поставщик', 'firm'],
        ['Вх_номер', 'incomingNo'], ['Сумма_закуп', 'sum', 'num'], ['Сумма_розница', 'retail', 'num'],
        ['Дата_выплаты', 'payDate', 'date'], ['Подтверждена', 'confirmed', 'bool'],
        ['Закрыта_вручную', 'closedManual', 'bool'], ['Остаток_долгом', 'underpayKeep', 'bool'],
        ['Списано_округление', 'roundOff', 'num'], ['Имя_в_1С', 'supplier']] },

    { name: 'Оплаты', coll: 'pays', edit: true,
      about: 'Расходные кассовые ордера из 1С и их привязка к накладным.',
      cols: [['ID', 'id'], ['Документ', 'doc'], ['Дата', 'date', 'date'], ['Поставщик', 'firm'],
        ['Основание', 'basis'], ['Касса', 'cashbox'], ['Сумма', 'sum', 'num'],
        ['Вид_операции', 'operation'], ['Статья_ДДС', 'article'],
        ['Привязка', 'linkKind'], ['Ключ_накладной', 'linkKey'], ['Статья_расхода', 'category'],
        ['Разобрано', 'resolved', 'bool'], ['Имя_в_1С', 'supplier']] },

    { name: 'План_выплат', coll: 'plans', edit: true,
      about: 'Ручные плановые платежи поставщикам.',
      cols: [['ID', 'id'], ['Дата_плана', 'due', 'date'], ['Поставщик', 'supplier'],
        ['Сумма', 'amount', 'num'], ['Накладная', 'doc'], ['Способ', 'method'],
        ['Статус', 'status'], ['Оплачено_дата', 'paidAt', 'date'], ['Примечание', 'note']] },

    { name: 'Долги_покупателей', coll: 'debtors', edit: true,
      about: 'Тетрадка у кассы: кто должен магазину.',
      cols: [['ID', 'id'], ['Дата', 'date', 'date'], ['Имя', 'name'], ['Телефон', 'phone'],
        ['Сумма', 'sum', 'num'], ['Обещал_вернуть', 'promise', 'date'], ['Погашено', 'paid', 'bool'],
        ['Дата_погашения', 'paidDate', 'date'], ['Кто_записал', 'cashier']] },

    { name: 'Зарплата', coll: 'payouts', edit: true,
      about: 'Авансы и зарплата сотрудникам.',
      cols: [['ID', 'id'], ['Дата', 'date', 'date'], ['Сотрудник', 'employee'], ['Что_выдаём', 'type'],
        ['Сумма', 'amount', 'num'], ['Чем', 'form'], ['Основание', 'note']] },

    { name: 'Табель', coll: 'timesheet', edit: true,
      about: 'Смены сотрудников: часы, ставка, премии и штрафы.',
      cols: [['ID', 'id'], ['Дата', 'date', 'date'], ['Сотрудник', 'employee'], ['Смена', 'shift'],
        ['Часы', 'hours', 'num'], ['Ставка', 'rate', 'num'], ['Премия', 'bonus', 'num'],
        ['Штраф', 'penalty', 'num'], ['Заметка', 'note']] },

    { name: 'Сроки_годности', coll: 'expiry', edit: true,
      about: 'Что уценить или снять с полки.',
      cols: [['ID', 'id'], ['Товар', 'name'], ['Группа', 'group'], ['Осталось', 'qty', 'num'],
        ['Цена', 'price', 'num'], ['Годен_до', 'bestBefore', 'date']] },

    { name: 'Настройки', settings: true, edit: true,
      about: 'Все правила магазина: налоги, смены, отсрочки, цели, справочники.',
      cols: [['Параметр', 'key'], ['Значение', 'value'], ['Что это', 'label']] },

    { name: 'Отчёт_по_месяцам', calc: 'months',
      about: 'Считается сам: выручка, расходы, прибыль, приход товара и долг по месяцам.',
      cols: [['Месяц'], ['Выручка'], ['Расходы'], ['Прибыль'], ['Приход_товара'],
        ['Оплачено_поставщикам'], ['Списания_и_забор'], ['Смен'], ['Средний_день']] },

    { name: 'Доходы_и_расходы', calc: 'kudir',
      about: 'Считается сам: построчно доходы и расходы по дате денег — как в книге учёта.',
      cols: [['Дата'], ['Операция'], ['Основание'], ['Доход'], ['Расход']] },

    { name: 'Долг_поставщикам', calc: 'debt',
      about: 'Считается сам: сколько должны каждой фирме и когда платить.',
      cols: [['Поставщик'], ['Накладных'], ['Поставки'], ['Оплачено'], ['Долг'], ['Просрочено'],
        ['Ждут_подтверждения'], ['Отсрочка_дней'], ['Ближайший_срок'], ['Телефон']] },

    { name: 'Товар', calc: 'stock',
      about: 'Остатки из последней выгрузки 1С — для наценки, заказов и инвентаризации.',
      cols: [['Штрихкод'], ['Наименование'], ['Группа'], ['Остаток'], ['Цена_закуп'],
        ['Цена_розница'], ['Наценка_%'], ['Сумма_в_закупе']] }
  ];

  function sheetByName(name) {
    for (var i = 0; i < SHEETS.length; i++) if (SHEETS[i].name === name) return SHEETS[i];
    return null;
  }

  /* --- Сборка книги --------------------------------------------------------- */

  function cellOut(row, col) {
    var t = col[2] || 'text', v = row[col[1]];
    // пустое поле остаётся пустым: «отсрочка не задана» — это не ноль дней
    if (t === 'num') return (v === '' || v == null) ? '' : round(v);
    if (t === 'bool') return v ? 'да' : 'нет';
    if (t === 'list') return (v || []).join ? (v || []).join('; ') : txt(v);
    return v == null ? '' : v;
  }

  function months(state) {
    var by = {}, i, r;
    function slot(m) {
      if (!m) return null;
      if (!by[m]) by[m] = { m: m, income: 0, expense: 0, supply: 0, paid: 0, loss: 0, shifts: {}, days: {} };
      return by[m];
    }
    var dds = state.dds || [];
    for (i = 0; i < dds.length; i++) {
      r = dds[i];
      var s = slot((r.date || '').slice(0, 7)); if (!s) continue;
      if (FIN.isIncome(r)) { s.income += num(r.amount); s.days[r.date] = 1; if (r.shift) s.shifts[r.date + '|' + r.shift] = 1; }
      else if (FIN.isExpense(r)) s.expense += num(r.amount);
      else if (FIN.isDraw && FIN.isDraw(r)) s.loss += num(r.amount);
    }
    for (i = 0; i < (state.docs || []).length; i++) {
      r = state.docs[i];
      var sd = slot((r.date || '').slice(0, 7)); if (sd) sd.supply += num(r.sum);
    }
    for (i = 0; i < (state.pays || []).length; i++) {
      r = state.pays[i];
      var sp = slot((r.date || '').slice(0, 7)); if (sp) sp.paid += num(r.sum);
    }
    var out = Object.keys(by).sort().map(function (k) {
      var v = by[k], days = Object.keys(v.days).length;
      return [v.m, round(v.income), round(v.expense), round(v.income - v.expense), round(v.supply),
        round(v.paid), round(v.loss), Object.keys(v.shifts).length, round(days ? v.income / days : 0)];
    });
    return out;
  }

  function kudir(state) {
    var rows = [];
    (state.dds || []).forEach(function (r) {
      if (FIN.isDebt(r)) return;                     // товар в долг деньги не двигает
      var income = FIN.isIncome(r) ? num(r.amount) : 0;
      var expense = FIN.isIncome(r) ? 0 : num(r.amount);
      rows.push([r.date || '', FIN.isIncome(r) ? 'Выручка' : (r.category || 'Расход'),
        [r.shift, r.cashier, r.note].filter(Boolean).join(' · '), round(income), round(expense)]);
    });
    (state.pays || []).forEach(function (p) {
      rows.push([p.date || '', 'Оплата поставщику', (p.firm || p.supplier || '') + ' · ' + SUP.shortDoc(p.doc),
        0, round(p.sum)]);
    });
    rows.sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
    var income = 0, expense = 0;
    rows.forEach(function (r) { income += r[3]; expense += r[4]; });
    rows.push(['', 'ИТОГО', '', round(income), round(expense)]);
    return rows;
  }

  function debtSheet(state, settings) {
    var c = SUP.compute(state, settings);
    return c.firms.map(function (f) {
      return [f.firm, f.docs, f.sum, f.paid, f.left, f.overdue, f.awaitingSum || 0,
        f.term === null ? '' : f.term, f.due || '', f.phone || ''];
    });
  }

  function stockSheet(stock) {
    return (stock || []).slice(0, 20000).map(function (r) {
      var buy = num(r.buyPrice), sell = num(r.retailPrice);
      return [r.barcode || '', r.name, r.group || '', num(r.qty), buy, sell,
        buy ? round((sell - buy) / buy * 100) : 0, round(num(r.qty) * buy)];
    });
  }

  // aoa (массив строк) для каждого листа книги
  function build(state, settings, extra) {
    extra = extra || {};
    var out = [];
    SHEETS.forEach(function (sh) {
      var head = sh.cols.map(function (c) { return c[0]; });
      var rows = [];
      if (sh.coll) {
        rows = (state[sh.coll] || []).map(function (r) {
          return sh.cols.map(function (c) { return cellOut(r, c); });
        });
      } else if (sh.settings) {
        var s = settings || {};
        rows = Object.keys(s).map(function (k) {
          return [k, s[k], CAT ? CAT.label(k) : ''];
        });
      } else if (sh.calc === 'months') rows = months(state);
      else if (sh.calc === 'kudir') rows = kudir(state);
      else if (sh.calc === 'debt') rows = debtSheet(state, settings);
      else if (sh.calc === 'stock') rows = stockSheet(extra.stock);
      out.push({ name: sh.name, aoa: [head].concat(rows), about: sh.about, edit: !!sh.edit, count: rows.length });
    });
    return out;
  }

  /* --- Чтение книги обратно в базу ------------------------------------------ */

  function cellIn(v, col) {
    var t = col[2] || 'text';
    if (t === 'num') return txt(v) === '' ? null : num(v);
    if (t === 'bool') return yes(v);
    if (t === 'date') return toDate(v);
    if (t === 'list') return txt(v) ? txt(v).split(/[;,]/).map(function (x) { return x.trim(); }).filter(Boolean) : [];
    return txt(v);
  }

  // matrixOf(name) → массив строк листа (или null, если листа нет)
  function parse(matrixOf, state, settings) {
    var report = { sheets: [], rows: 0, skipped: [] };
    SHEETS.forEach(function (sh) {
      if (!sh.edit) return;
      var m = matrixOf(sh.name);
      if (!m || !m.length) { report.skipped.push(sh.name + ' — листа нет'); return; }

      // шапка: ищем строку, где стоит первая колонка
      var head = -1;
      for (var r = 0; r < Math.min(m.length, 5); r++) {
        var joined = (m[r] || []).map(txt).join('|').toLowerCase();
        if (joined.indexOf(sh.cols[0][0].toLowerCase()) >= 0) { head = r; break; }
      }
      if (head < 0) { report.skipped.push(sh.name + ' — не нашлась шапка'); return; }

      var idx = {};
      (m[head] || []).forEach(function (cell, i) { idx[txt(cell).toLowerCase()] = i; });

      if (sh.settings) {
        var applied = 0;
        for (var k = head + 1; k < m.length; k++) {
          var key = txt((m[k] || [])[idx['параметр']]);
          if (!key) continue;
          var val = (m[k] || [])[idx['значение']];
          if (settings && typeof settings[key] === 'number') settings[key] = num(val);
          else if (settings && typeof settings[key] === 'boolean') settings[key] = yes(val);
          else if (settings) settings[key] = txt(val);
          applied++;
        }
        report.sheets.push({ name: sh.name, rows: applied });
        report.rows += applied;
        return;
      }

      var rows = [];
      for (var i = head + 1; i < m.length; i++) {
        var row = m[i] || [];
        var empty = row.every(function (c) { return txt(c) === ''; });
        if (empty) continue;
        var rec = {};
        sh.cols.forEach(function (c) {
          var pos = idx[c[0].toLowerCase()];
          if (pos === undefined) return;
          rec[c[1]] = cellIn(row[pos], c);
        });
        if (!rec.id) rec.id = uid();
        rows.push(rec);
      }

      // пустой лист журнала не стирает базу — так правка в Excel не потеряет данные
      if (!rows.length && (state[sh.coll] || []).length) {
        report.skipped.push(sh.name + ' — лист пуст, данные оставлены');
        return;
      }
      // служебные ключи не пишем в файл как отдельные колонки — восстанавливаем сами
      if (sh.coll === 'docs') rows.forEach(function (r) { r.key = SUP.norm(r.doc); });
      if (sh.coll === 'pays') rows.forEach(function (r) {
        r.key = SUP.norm(r.doc);
        r.basisKey = SUP.norm(r.basis);
      });
      state[sh.coll] = rows;
      report.sheets.push({ name: sh.name, rows: rows.length });
      report.rows += rows.length;
    });
    return report;
  }

  return { FILE: FILE, SHEETS: SHEETS, sheetByName: sheetByName, build: build, parse: parse,
    toDate: toDate, months: months, kudir: kudir };
});
