/* ============================================================================
   Вай Маркет — интерфейс. Оформление в стиле iOS: крупные цифры, списки,
   минимум лишнего. Расчёты — js/engine.js, журналы — js/store.js,
   сохранение в файлы — js/filestore.js.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.WM, S = window.WMStore, F = window.WMFiles;
  S.load();

  /* --- Данные выгрузок (в памяти) ----------------------------------------- */
  var D = {
    sales: [], salesPeriod: null, stock: [], prices: [], contacts: [], pricelist: [],
    barcodes: [], units: [], writeoffs: [], writeoffsPeriod: null, returns: [], returnsPeriod: null,
    invoices1c: [], invoicesPeriod: null, cashOrders: [], owner: null, files: []
  };
  var C = {};                 // производные расчёты
  var SUP = window.WMSupply;  // поставки, оплаты и справочник фирм
  var LAST_IMPORT = [];       // что распознали в последней загрузке файлов
  var VIEW = 'today';
  var PERIOD = 'month';
  var PAGE = {};              // сколько строк показано в таблицах
  var TAB = {};               // выбранные вкладки внутри экранов
  var CHARTS = {};

  /* --- Мелочи -------------------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(id) { return document.getElementById(id); }
  function num(x) { return E.num(x); }
  function money(x) { return E.fmtMoney(x); }
  function priv(x) { return '<span class="private">' + money(x) + '</span>'; }
  function nf(x, d) { return E.fmtNum(x, d); }
  function pct(x, d) { return E.fmtPct(x, d); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function cls(x) { return x > 0 ? 'c-green' : (x < 0 ? 'c-red' : 'c-muted'); }
  function badge(text, kind) { return '<span class="badge b-' + kind + '">' + esc(text) + '</span>'; }
  function plural(n, one, few, many) {
    n = Math.abs(Math.round(n)); var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
  function dateRu(iso) {
    if (!iso) return '';
    var m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    var mon = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return +m[3] + ' ' + mon[+m[2] - 1];
  }

  function toast(text, ms) {
    var old = document.querySelector('.toast'); if (old) old.remove();
    var d = document.createElement('div'); d.className = 'toast'; d.textContent = text;
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.remove(); }, ms || 4600);
  }
  function sheet(title, bodyHtml) {
    closeSheet();
    var b = document.createElement('div');
    b.className = 'backdrop';
    b.innerHTML = '<div class="sheet"><div class="sheet-head"><div class="sheet-title">' + esc(title) +
      '</div><button class="btn btn-sm" data-act="close-sheet">Закрыть</button></div>' +
      '<div class="sheet-body">' + bodyHtml + '</div></div>';
    b.addEventListener('click', function (e) { if (e.target === b) closeSheet(); });
    document.body.appendChild(b);
    var first = b.querySelector('input,select,textarea');
    if (first) setTimeout(function () { first.focus(); }, 60);
    return b;
  }
  function closeSheet() { var b = document.querySelector('.backdrop'); if (b) b.remove(); }

  /* --- Период --------------------------------------------------------------- */
  var PERIODS = [
    { id: 'today', name: 'Сегодня' }, { id: 'week', name: 'Неделя' },
    { id: 'month', name: 'Месяц' }, { id: 'quarter', name: 'Квартал' }, { id: 'all', name: 'Всё' }
  ];
  function periodRange() {
    var now = new Date(today()), from, to = today();
    if (PERIOD === 'today') from = to;
    else if (PERIOD === 'week') from = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10);
    else if (PERIOD === 'month') from = to.slice(0, 8) + '01';
    else if (PERIOD === 'quarter') {
      var q = Math.floor(now.getMonth() / 3) * 3;
      from = new Date(Date.UTC(now.getFullYear(), q, 1)).toISOString().slice(0, 10);
    } else { from = '0000-01-01'; to = '9999-12-31'; }
    return { from: from, to: to };
  }
  function periodName() {
    for (var i = 0; i < PERIODS.length; i++) if (PERIODS[i].id === PERIOD) return PERIODS[i].name;
    return '';
  }
  function inPeriod(d) {
    if (!d) return PERIOD === 'all';
    var r = periodRange(), x = String(d).slice(0, 10);
    return x >= r.from && x <= r.to;
  }
  function jrn(coll) {
    var rows = S.state[coll] || [];
    return PERIOD === 'all' ? rows.slice() : rows.filter(function (r) { return inPeriod(r.date); });
  }
  function periodDays() {
    if (PERIOD === 'today') return 1;
    if (PERIOD === 'all') return 30;
    var r = periodRange();
    return Math.max(1, Math.round((new Date(r.to) - new Date(r.from)) / 86400000) + 1);
  }

  /* --- Компоненты ------------------------------------------------------------ */
  function hero(label, value, sub, color) {
    return '<div class="hero"><div class="hero-label">' + esc(label) + '</div>' +
      '<div class="hero-value private' + (color ? ' ' + color : '') + '">' + value + '</div>' +
      (sub ? '<div class="hero-sub">' + sub + '</div>' : '') + '</div>';
  }
  function stat(label, value, sub, color) {
    return '<div class="stat"><div class="stat-label">' + esc(label) + '</div>' +
      '<div class="stat-value private' + (color ? ' ' + color : '') + '">' + value + '</div>' +
      (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div>';
  }
  function card(title, bodyHtml, headRight) {
    return '<div class="card"><div class="card-head"><div class="card-title">' + esc(title) + '</div>' +
      (headRight ? '<div>' + headRight + '</div>' : '') + '</div>' + bodyHtml + '</div>';
  }
  function listRow(o) {
    return '<div class="row' + (o.tap ? ' tappable' : '') + '"' + (o.attrs || '') + '>' +
      (o.icon ? '<div class="row-icon">' + o.icon + '</div>' : '') +
      '<div class="row-main"><div class="row-title">' + o.title + '</div>' +
      (o.sub ? '<div class="row-sub">' + o.sub + '</div>' : '') + '</div>' +
      (o.value ? '<div class="row-value">' + o.value + '</div>' : '') +
      (o.tap ? '<span class="chevron">›</span>' : '') + '</div>';
  }
  function listOf(rows, emptyText) {
    if (!rows.length) return '<div class="list"><div class="empty">' + emptyText + '</div></div>';
    return '<div class="list">' + rows.join('') + '</div>';
  }

  // Таблица для больших данных
  function table(id, cols, rows, opts) {
    opts = opts || {};
    var step = opts.step || 40, limit = PAGE[id] || step;
    var h = '<div class="table-wrap"><table class="data"><thead><tr>';
    cols.forEach(function (c) { h += '<th class="' + (c.cls || '') + '">' + esc(c.title) + '</th>'; });
    h += '</tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="' + cols.length + '"><div class="empty">' + (opts.empty || 'Пока пусто') + '</div></td></tr>';
    rows.slice(0, limit).forEach(function (r, i) {
      h += '<tr>';
      cols.forEach(function (c) { h += '<td class="' + (c.cls || '') + '">' + (c.fn ? c.fn(r, i) : esc(r[c.key])) + '</td>'; });
      h += '</tr>';
    });
    if (opts.total) {
      h += '<tr class="total">';
      opts.total.forEach(function (c) {
        h += '<td class="' + (c.cls || '') + '"' + (c.span ? ' colspan="' + c.span + '"' : '') + '>' + (c.html || '') + '</td>';
      });
      h += '</tr>';
    }
    if (rows.length > limit) {
      h += '<tr><td colspan="' + cols.length + '"><div class="more"><button class="btn btn-sm" data-act="more" data-id="' +
        esc(id) + '" data-step="' + step + '">Показать ещё (' + nf(rows.length - limit) + ')</button></div></td></tr>';
    }
    return h + '</tbody></table></div>';
  }

  function fieldRow(label, name, type, value, opts) {
    opts = opts || {};
    var h = '<div class="form-row"><label>' + esc(label) + '</label>';
    if (type === 'select') {
      h += '<select name="' + name + '">' + (opts.options || []).map(function (o) {
        var v = typeof o === 'string' ? o : o.value, t = typeof o === 'string' ? o : o.text;
        return '<option value="' + esc(v) + '"' + (String(value) === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>';
      }).join('') + '</select>';
    } else {
      h += '<input type="' + type + '" name="' + name + '" value="' + esc(value == null ? '' : value) + '"' +
        (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
        (opts.list ? ' list="' + opts.list + '"' : '') +
        (type === 'number' ? ' step="0.01" inputmode="decimal"' : '') + '>';
    }
    return h + '</div>';
  }
  function formValues(form) {
    var out = {};
    Array.prototype.forEach.call(form.querySelectorAll('input,select,textarea'), function (i) {
      if (!i.name) return;
      out[i.name] = i.type === 'number' ? num(i.value) : i.value.trim();
    });
    return out;
  }
  function datalist(id, values) {
    return '<datalist id="' + id + '">' + values.slice(0, 900).map(function (v) {
      return '<option value="' + esc(v) + '">';
    }).join('') + '</datalist>';
  }
  function supplierNames() {
    var set = {};
    D.contacts.forEach(function (c) { set[c.name] = 1; });
    (C.balance || []).forEach(function (b) { set[b.supplier] = 1; });
    (S.state.invoices || []).forEach(function (i) { if (i.supplier) set[i.supplier] = 1; });
    (S.state.payments || []).forEach(function (p) { if (p.supplier) set[p.supplier] = 1; });
    return Object.keys(set).sort();
  }
  function phoneOf(supplier) {
    return (C.contactsIdx && C.contactsIdx[E.norm(supplier)]) || '';
  }
  // 79281234567 → +7 928 123-45-67
  function phoneFmt(p) {
    var d = String(p || '').replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) {
      return '+7 ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9);
    }
    return p || '';
  }
  function phoneLink(supplier) {
    var p = phoneOf(supplier);
    return p ? '<a class="phone" href="tel:' + esc(p) + '">' + esc(phoneFmt(p)) + '</a>' : '';
  }

  /* --- Загрузка выгрузок 1С -------------------------------------------------- */
  function readWorkbook(buffer) {
    var wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    return { wb: wb, names: wb.SheetNames,
      matrix: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }) };
  }
  function sheetOf(wb, name) {
    return wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) : null;
  }

  function ingest(name, buffer, size) {
    var m = readWorkbook(buffer);
    var kind = E.detectKind(name, m.matrix, m.names);
    var info = { name: name, kind: kind, rows: 0, size: size || 0, period: null, note: '' };
    var r;
    if (kind === 'sales') { r = E.parseSales(m.matrix); D.sales = r.rows; D.salesPeriod = r.period; info.period = r.period; }
    else if (kind === 'stock') { r = E.parseStock(m.matrix); D.stock = r.rows; }
    else if (kind === 'prices') { r = E.parsePrices(m.matrix); D.prices = r.rows; }
    else if (kind === 'contacts') { r = E.parseContacts(m.matrix); D.contacts = r.rows; }
    else if (kind === 'pricelist') { r = E.parsePricelist(m.matrix); D.pricelist = r.rows; }
    else if (kind === 'barcodes') { r = E.parseBarcodes(m.matrix); D.barcodes = r.rows; }
    else if (kind === 'units') { r = E.parseUnits(m.matrix); D.units = r.rows; }
    else if (kind === 'writeoffs1c') { r = E.parseWriteoffs1C(m.matrix); D.writeoffs = r.rows; D.writeoffsPeriod = r.period; info.period = r.period; }
    else if (kind === 'returns') { r = E.parseReturns(m.matrix); D.returns = r.rows; D.returnsPeriod = r.period; info.period = r.period; }
    else if (kind === 'invoices1c') {
      r = E.parseIncomingInvoices(m.matrix); D.invoices1c = r.rows; D.invoicesPeriod = r.period; info.period = r.period;
      var sd = SUP.mergeDocs(S.state, r.rows, name, S.state.supreg, S.settings);
      S.save(); LAST_IMPORT.push({ name: name, kind: 'Приходные накладные', rows: r.rows.length, stat: sd });
      info.note = 'новых ' + sd.added + ', обновлено ' + sd.updated + ', дублей ' + sd.same;
    }
    else if (kind === 'cashout' || kind === 'cashin') {
      r = E.parseCashOrders(m.matrix, kind === 'cashin' ? 'in' : 'out'); D.cashOrders = r.rows; info.period = r.period;
      var sp = SUP.mergePays(S.state, r.rows, name, S.state.supreg, S.settings);
      S.save(); LAST_IMPORT.push({ name: name, kind: 'Расходные кассовые ордера', rows: r.rows.length, stat: sp });
      info.note = 'новых ' + sp.added + ', обновлено ' + sp.updated + ', дублей ' + sp.same;
    }
    else if (kind === 'writeoffs') {
      r = E.parseWriteoffs(m.matrix);
      D.writeoffs = r.rows.map(function (x) {
        return { name: x.name, reason: x.reason || 'Без причины', qty: x.qty, cost: x.sum, retail: 0, key: E.norm(x.name) };
      });
    } else if (kind === 'finance_book') {
      var res = window.WM_IMPORT_FINANCE ? window.WM_IMPORT_FINANCE(m.wb, sheetOf) : null;
      info.rows = res ? res.dds : 0;
      info.note = res ? ('операций ' + res.dds + ', выплат ' + res.plans + (res.settings ? ', справочники перенесены' : '')) : '';
      r = { rows: [] };
    } else if (kind === 'owner_book') {
      var book = { daily: [], payments: [], payroll: [], monthly: [], openingDebt: 0, file: name };
      m.names.forEach(function (sn) {
        var mat = sheetOf(m.wb, sn); if (!mat) return;
        var k = E.norm(sn);
        if (k === 'ддс') { var od = E.parseOwnerDaily(mat); book.daily = od.rows; book.openingDebt = od.openingDebt; }
        else if (k === 'оплата') book.payments = E.parseOwnerPayments(mat).rows;
        else if (k.indexOf('платежка') >= 0) book.payroll = E.parseOwnerPayroll(mat).rows;
        else if (k.indexOf('отч') >= 0) book.monthly.push({ sheet: sn, rows: E.parseOwnerMonthly(mat).rows });
      });
      D.owner = book; r = { rows: book.daily };
      info.note = 'смен ' + book.daily.length + ', оплат ' + book.payments.length;
    } else if (kind === 'journal_shifts') {
      var sh = sheetOf(m.wb, 'Журнал_Смен_24_7'), iv = sheetOf(m.wb, 'Накладные_и_Выплаты');
      if (sh) S.addMany('shifts', E.parseShiftJournalSheet(sh), true);
      if (iv) S.addMany('invoices', E.parseInvoiceSheet(iv), true);
      r = { rows: (sh || []).slice(1) }; info.note = 'журнал загружен в базу';
    } else if (kind === 'journal_staff') {
      var ts = sheetOf(m.wb, 'Табель_Смен_24_7'), po = sheetOf(m.wb, 'Выплаты_и_Авансы');
      if (ts) S.addMany('timesheet', E.parseTimesheetSheet(ts), true);
      if (po) S.addMany('payouts', E.parsePayoutSheet(po), true);
      r = { rows: (ts || []).slice(1) }; info.note = 'табель загружен в базу';
    } else { info.note = 'формат не распознан'; }
    info.rows = r && r.rows ? r.rows.length : 0;
    D.files = D.files.filter(function (f) { return f.name !== name; });
    D.files.push(info);
    return info;
  }

  function recompute() {
    C = {};
    C.sales = E.salesTotals(D.sales);
    C.stock = E.stockTotals(D.stock);
    C.groupIdx = E.groupIndex(D.stock, D.prices);
    C.byGroup = E.salesByGroup(D.sales, C.groupIdx);
    C.contactsIdx = E.contactsIndex(D.contacts);
    C.bestPrices = E.bestPriceIndex(D.prices);
    C.stockIdx = {}; D.stock.forEach(function (r) { C.stockIdx[r.key] = r; });
    C.abc = E.abcClassify(D.sales.slice());
    C.writeoffSum = D.writeoffs.reduce(function (a, r) { return a + num(r.cost); }, 0);
    C.returnSum = D.returns.reduce(function (a, r) { return a + num(r.cost); }, 0);
    C.payments1c = D.invoices1c.length ? E.matchPayments(D.invoices1c, D.cashOrders) : null;
    C.balance1c = D.invoices1c.length ? E.supplierBalance(D.invoices1c, D.cashOrders) : null;
    C.cash1c = D.cashOrders.length ? E.cashSummary(D.cashOrders) : null;
    C.ownerAll = D.owner ? E.ownerTotals(D.owner.daily) : null;
    if (SUP.autoRegister(S.state, S.settings)) S.save();  // новые имена сразу в справочник
    C.sup = SUP.compute(S.state, S.settings);
    C.bySupplier = {};
    D.prices.forEach(function (p) { var k = E.norm(p.supplier); C.bySupplier[k] = (C.bySupplier[k] || 0) + 1; });
    C.balance = C.balance1c;
  }

  // Ручной учёт за период
  function manual() {
    var inv = jrn('invoices'), pay = jrn('payments');
    return { invoices: inv, payments: pay, totals: E.manualTotals(inv, pay),
      docs: E.manualDocs(inv, pay), balance: E.manualBalance(inv, pay) };
  }

  // Итоговый долг поставщикам: из 1С, если выгрузки есть; иначе из ручного учёта
  function debtNow() {
    var man = E.manualTotals(S.state.invoices || [], S.state.payments || []);
    if (C.sup && C.sup.totals.docs) {
      return { value: C.sup.totals.left, source: 'по накладным 1С',
        manual: man.debt, hasBoth: man.debt !== 0 };
    }
    if (D.owner && C.ownerAll && C.ownerAll.debt) {
      return { value: C.ownerAll.debt, source: 'по вашей книге ДДС на ' + dateRu(C.ownerAll.debtDate),
        manual: man.debt, hasBoth: man.debt !== 0 };
    }
    return { value: man.debt, source: 'по вашим записям', manual: man.debt, hasBoth: false };
  }

  async function loadFiles(list) {
    var files = Array.prototype.slice.call(list).filter(function (f) {
      return /\.(xls|xlsx|csv)$/i.test(f.name) && !/^~\$/.test(f.name);
    });
    if (!files.length) { toast('Файлов 1С не нашлось. Нужны .xls, .xlsx или .csv'); return; }
    LAST_IMPORT = [];
    var b = sheet('Читаю файлы', '<div class="card"><div class="card-pad" id="progText">Подождите…</div></div>');
    var okCount = 0;
    for (var i = 0; i < files.length; i++) {
      var t = $('progText');
      if (t) t.textContent = (i + 1) + ' из ' + files.length + ': ' + files[i].name;
      await new Promise(function (r) { setTimeout(r, 10); });
      try { var info = ingest(files[i].name, await files[i].arrayBuffer(), files[i].size); if (info.kind !== 'unknown') okCount++; }
      catch (e) { /* битый файл пропускаем */ }
    }
    closeSheet();
    recompute(); render();
    toast('Загружено файлов: ' + okCount + ' из ' + files.length +
      (C.sales.revenue ? '\nВыручка по 1С: ' + money(C.sales.revenue) : ''));
  }

  /* --- Папка с данными: сохранение и чтение выгрузок ------------------------- */
  var folderStamps = {};

  async function connectFolder() {
    try {
      await F.connect();
      var saved = await F.loadSaved();
      if (saved && confirm('В папке уже есть сохранённая база. Загрузить её (ваши текущие записи будут заменены)?')) {
        S.replaceAll(saved);
      } else {
        await F.saveNow(function () { return S.state; });
      }
      await syncFolder(true);
      render();
      toast('Папка подключена: ' + F.dirName + '\nВсё, что вы записываете, сохраняется в файл ' +
        F.DATA_DIR + '/' + F.DATA_FILE);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      toast('Не получилось: ' + e.message);
    }
  }

  async function reconnectFolder() {
    try {
      await F.reconnect();
      var saved = await F.loadSaved();
      if (saved) S.replaceAll(saved);
      await syncFolder(true);
      render();
      toast('Папка снова подключена, данные на месте.');
    } catch (e) { toast('Не получилось: ' + e.message); }
  }

  // Прочитать выгрузки 1С из подключённой папки (только изменившиеся файлы)
  async function syncFolder(silent) {
    if (F.state !== 'ready') return false;
    var files = await F.listExports();
    var changed = files.filter(function (f) { return folderStamps[f.name] !== f.stamp; });
    if (!changed.length) { if (!silent) toast('Новых выгрузок в папке нет.'); return false; }
    for (var i = 0; i < changed.length; i++) {
      try {
        ingest(changed[i].name.split('/').pop(), await changed[i].file.arrayBuffer(), changed[i].file.size);
        folderStamps[changed[i].name] = changed[i].stamp;
      } catch (e) { /* пропускаем */ }
    }
    recompute();
    if (!silent) { render(); toast('Обновлено файлов: ' + changed.length); }
    return true;
  }

  function saveState() {
    var st = F.state, when = F.lastSaved;
    if (st === 'ready') {
      return { dot: '', text: 'Сохраняется в папку' + (when ? ' · ' + when.toLocaleTimeString('ru-RU').slice(0, 5) : ''), ok: true };
    }
    if (st === 'needs-permission') return { dot: 'off', text: 'Нажмите, чтобы продолжить сохранение в папку', ok: false };
    if (st === 'unsupported') return { dot: 'off', text: 'Сохранение в файл: только Chrome / Edge', ok: false };
    return { dot: 'off', text: 'Сохранение в папку не подключено', ok: false };
  }

  /* --- Формы ручного ввода ---------------------------------------------------- */
  var FORMS = {
    shift: {
      title: 'Смена и касса', icon: '💵',
      body: function (v) {
        v = v || {};
        return fieldRow('Дата', 'date', 'date', v.date || today()) +
          fieldRow('Смена', 'shift', 'select', v.shift || 'Дневная', { options: ['Дневная', 'Ночная', 'Суточная'] }) +
          fieldRow('Кассир', 'cashier', 'text', v.cashier || '', { placeholder: 'кто сдаёт', list: 'dl-staff' }) +
          fieldRow('Было в кассе утром', 'openCash', 'number', v.openCash != null ? v.openCash : S.settings.openCash) +
          fieldRow('Наличными по Z-отчёту', 'zCash', 'number', v.zCash || '') +
          fieldRow('Выдано из кассы за смену', 'payouts', 'number', v.payouts || 0) +
          fieldRow('Фактически в ящике', 'factCash', 'number', v.factCash || '') +
          fieldRow('По карте и переводом', 'terminal', 'number', v.terminal || 0);
      },
      hint: 'Должно остаться = утро + Z-отчёт − выдано. Разницу дашборд посчитает сам.',
      save: function (v) {
        if (!v.zCash && !v.factCash) return 'Заполните Z-отчёт и фактические деньги.';
        S.add('shifts', v);
        var c = E.shiftCalc(v);
        return { ok: 'Смена записана. Должно быть ' + money(c.expected) + ', в ящике ' + money(v.factCash) + ' — ' + c.statusText };
      }
    },
    invoice: {
      title: 'Приход товара (накладная)', icon: '📥',
      body: function (v) {
        v = v || {};
        return fieldRow('Дата', 'date', 'date', v.date || today()) +
          fieldRow('Поставщик', 'supplier', 'text', v.supplier || '', { placeholder: 'название', list: 'dl-sup' }) +
          fieldRow('Номер накладной', 'doc', 'text', v.doc || '', { placeholder: 'например 412' }) +
          fieldRow('Что привезли', 'goods', 'text', v.goods || '', { placeholder: 'молочка, хлеб…' }) +
          fieldRow('Сумма накладной', 'total', 'number', v.total || '') +
          fieldRow('Отдали сразу наличными', 'paidCash', 'number', v.paidCash || 0) +
          fieldRow('Оплатить до', 'due', 'date', v.due || '');
      },
      hint: 'Остаток в долг = сумма накладной − отдали сразу.',
      save: function (v) {
        if (!v.total) return 'Укажите сумму накладной.';
        if (!v.supplier) return 'Укажите поставщика.';
        S.add('invoices', v);
        var left = Math.max(0, num(v.total) - num(v.paidCash));
        return { ok: 'Записано. Остаётся долг ' + money(left) + ' перед «' + v.supplier + '»' };
      }
    },
    payment: {
      title: 'Оплата поставщику', icon: '💸',
      body: function (v) {
        v = v || {};
        return fieldRow('Дата', 'date', 'date', v.date || today()) +
          fieldRow('Поставщик', 'supplier', 'text', v.supplier || '', { placeholder: 'название', list: 'dl-sup' }) +
          fieldRow('Сумма', 'amount', 'number', v.amount || '') +
          fieldRow('За что', 'kind', 'select', v.kind || 'погашение долга',
            { options: ['погашение долга', 'оплата сразу при приёмке', 'предоплата'] }) +
          fieldRow('Чем платили', 'form', 'select', v.form || 'наличными из кассы',
            { options: ['наличными из кассы', 'переводом', 'картой'] }) +
          fieldRow('По накладной №', 'doc', 'text', v.doc || '', { placeholder: 'если известна' }) +
          fieldRow('Заметка', 'note', 'text', v.note || '');
      },
      hint: 'Оплата уменьшает долг перед поставщиком.',
      save: function (v) {
        if (!v.supplier) return 'Укажите поставщика.';
        if (!v.amount) return 'Укажите сумму.';
        S.add('payments', v);
        var bal = E.manualBalance(S.state.invoices || [], S.state.payments || [])
          .filter(function (b) { return E.norm(b.supplier) === E.norm(v.supplier); })[0];
        return { ok: 'Оплата записана. Долг перед «' + v.supplier + '»: ' + money(bal ? bal.debt : 0) };
      }
    },
    expense: {
      title: 'Расход магазина', icon: '🧾',
      body: function (v) {
        v = v || {};
        return fieldRow('Дата', 'date', 'date', v.date || today()) +
          fieldRow('Статья', 'category', 'select', v.category || 'Прочее',
            { options: ['Аренда', 'Коммунальные', 'Налоги', 'Зарплата', 'Обед', 'ГСМ', 'Расходники', 'Ремонт', 'Реклама', 'Прочее'] }) +
          fieldRow('Сумма', 'amount', 'number', v.amount || '') +
          fieldRow('Чем платили', 'form', 'select', v.form || 'наличными из кассы',
            { options: ['наличными из кассы', 'переводом', 'картой'] }) +
          fieldRow('Заметка', 'note', 'text', v.note || '');
      },
      save: function (v) {
        if (!v.amount) return 'Укажите сумму.';
        S.add('expenses', v);
        return { ok: 'Расход записан: ' + v.category + ' — ' + money(v.amount) };
      }
    },
    writeoff: {
      title: 'Списание товара', icon: '🗑',
      body: function (v) {
        v = v || {};
        return fieldRow('Дата', 'date', 'date', v.date || today()) +
          fieldRow('Товар', 'name', 'text', v.name || '', { list: 'dl-goods' }) +
          fieldRow('Количество', 'qty', 'number', v.qty || '') +
          fieldRow('Сумма по себестоимости', 'cost', 'number', v.cost || '') +
          fieldRow('Причина', 'reason', 'select', v.reason || 'Просрочка',
            { options: ['Просрочка', 'Бой, порча', 'Кража', 'Пересортица', 'Потери при инвентаризации', 'Другое'] });
      },
      save: function (v) {
        if (!v.name) return 'Укажите товар.';
        S.add('inventory', { date: v.date, name: v.name, group: '', accounted: num(v.qty), fact: 0,
          price: num(v.qty) ? num(v.cost) / num(v.qty) : 0, reason: 'Списание: ' + v.reason });
        return { ok: 'Списание записано: ' + v.name + ' на ' + money(v.cost) };
      }
    },
    expiryItem: {
      title: 'Товар с коротким сроком', icon: '⏰',
      body: function (v) {
        v = v || {};
        return fieldRow('Товар', 'name', 'text', v.name || '', { list: 'dl-goods' }) +
          fieldRow('Группа', 'group', 'text', v.group || '') +
          fieldRow('Сколько осталось', 'qty', 'number', v.qty || '') +
          fieldRow('Цена', 'price', 'number', v.price || '') +
          fieldRow('Годен до', 'bestBefore', 'date', v.bestBefore || '');
      },
      save: function (v) {
        if (!v.name || !v.bestBefore) return 'Нужны товар и дата «годен до».';
        S.add('expiry', v);
        var f = E.fefoStatus(v.bestBefore, S.settings);
        return { ok: 'На контроле. ' + (f.days < 0 ? 'Просрочено!' : 'Осталось ' + f.days + ' ' + plural(f.days, 'день', 'дня', 'дней')) + '. ' + f.action };
      }
    },
    timesheet: {
      title: 'Смена сотрудника', icon: '👤',
      body: function (v) {
        v = v || {};
        return fieldRow('Дата', 'date', 'date', v.date || today()) +
          fieldRow('Сотрудник', 'employee', 'text', v.employee || '', { list: 'dl-staff' }) +
          fieldRow('Должность', 'position', 'text', v.position || 'Кассир') +
          fieldRow('Смена', 'shift', 'select', v.shift || 'Дневная', { options: ['Дневная', 'Ночная', 'Суточная'] }) +
          fieldRow('Часов', 'hours', 'number', v.hours || 12) +
          fieldRow('Ставка за час', 'rate', 'number', v.rate || S.settings.rateDay) +
          fieldRow('Штраф', 'penalty', 'number', v.penalty || 0) +
          fieldRow('Премия', 'bonus', 'number', v.bonus || 0);
      },
      save: function (v) {
        if (!v.employee) return 'Укажите сотрудника.';
        S.add('timesheet', v);
        return { ok: 'Записано. Начислено за смену: ' + money(E.timesheetCalc(v)) };
      }
    },
    payout: {
      title: 'Выплата сотруднику', icon: '💰',
      body: function (v) {
        v = v || {};
        return fieldRow('Дата', 'date', 'date', v.date || today()) +
          fieldRow('Сотрудник', 'employee', 'text', v.employee || '', { list: 'dl-staff' }) +
          fieldRow('Что выдаём', 'type', 'select', v.type || 'Аванс', { options: ['Аванс', 'Зарплата', 'Премия', 'Прочее'] }) +
          fieldRow('Сумма', 'amount', 'number', v.amount || '') +
          fieldRow('Чем', 'form', 'select', v.form || 'Наличные из кассы',
            { options: ['Наличные из кассы', 'Перевод СБП', 'Банковский перевод'] }) +
          fieldRow('Основание', 'note', 'text', v.note || '');
      },
      save: function (v) {
        if (!v.employee || !v.amount) return 'Нужны сотрудник и сумма.';
        S.add('payouts', v);
        return { ok: 'Выплата записана: ' + v.employee + ' — ' + money(v.amount) };
      }
    },
    inventory: {
      title: 'Пересчёт товара', icon: '📋',
      body: function (v) {
        v = v || {};
        return fieldRow('Дата', 'date', 'date', v.date || today()) +
          fieldRow('Товар', 'name', 'text', v.name || '', { list: 'dl-goods' }) +
          fieldRow('По учёту', 'accounted', 'number', v.accounted || '') +
          fieldRow('По факту', 'fact', 'number', v.fact || '') +
          fieldRow('Цена', 'price', 'number', v.price || '') +
          fieldRow('Причина', 'reason', 'text', v.reason || '');
      },
      save: function (v) {
        if (!v.name) return 'Укажите товар.';
        S.add('inventory', v);
        var d = (num(v.fact) - num(v.accounted)) * num(v.price);
        return { ok: 'Записано. Разница: ' + money(d) };
      }
    },
    kvi: {
      title: 'Товар-маркер (следим за ценой)', icon: '🏷',
      body: function (v) {
        v = v || {};
        return fieldRow('Товар', 'name', 'text', v.name || '', { list: 'dl-goods' }) +
          fieldRow('Себестоимость', 'cost', 'number', v.cost || '') +
          fieldRow('Наша цена', 'ourPrice', 'number', v.ourPrice || '') +
          fieldRow('Цена у соседей', 'competitorPrice', 'number', v.competitorPrice || '');
      },
      save: function (v) {
        if (!v.name) return 'Укажите товар.';
        S.add('kvi', v);
        return { ok: 'Добавлено в наблюдение.' };
      }
    }
  };

  if (window.WM_EXTRA_FORMS) {
    for (var fk in window.WM_EXTRA_FORMS) FORMS[fk] = window.WM_EXTRA_FORMS[fk];
    // Касса и расходы ведутся в единой базе операций: старые кнопки открывают
    // те же формы, чтобы одно и то же не вводилось в двух местах.
    if (FORMS.cashShift) FORMS.shift = FORMS.cashShift;
    if (FORMS.ddsExpense) FORMS.expense = FORMS.ddsExpense;
  }

  var EDIT = null;    // что правим: {coll, id}

  function openForm(id, prefill, edit) {
    var f = FORMS[id]; if (!f) return;
    EDIT = edit || null;
    var lists = datalist('dl-sup', supplierNames()) +
      datalist('dl-staff', staffNames()) +
      datalist('dl-goods', D.stock.slice(0, 900).map(function (r) { return r.name; }));
    sheet(f.title,
      '<form id="wmForm" data-fid="' + id + '"><div class="form-list">' + f.body(prefill) + '</div>' +
      (f.hint ? '<div class="form-hint">' + esc(f.hint) + '</div>' : '') + lists +
      '<div class="form-actions"><button type="button" class="btn" data-act="close-sheet">Отмена</button>' +
      '<button type="submit" class="btn btn-primary btn-lg">' + (edit ? 'Сохранить изменения' : 'Сохранить') + '</button></div></form>');
  }
  function staffNames() {
    var set = {};
    (S.state.timesheet || []).forEach(function (r) { if (r.employee) set[r.employee] = 1; });
    (S.state.payouts || []).forEach(function (r) { if (r.employee) set[r.employee] = 1; });
    (S.state.shifts || []).forEach(function (r) { if (r.cashier) set[r.cashier] = 1; });
    if (D.owner) D.owner.payroll.forEach(function (r) { if (r.name) set[r.name] = 1; });
    return Object.keys(set).sort();
  }

  // Помощники рисования отдаём экранам финансов (js/finviews.js)
  window.WMUI = {
    esc: esc, money: money, priv: priv, nf: nf, pct: pct, num: num, cls: cls, badge: badge,
    dateRu: dateRu, plural: plural, today: today,
    card: card, listRow: listRow, listOf: listOf, table: table, stat: stat, hero: hero,
    fieldRow: fieldRow, pageHead: pageHead, toast: toast, sheet: sheet, closeSheet: closeSheet,
    periodRange: periodRange, periodName: periodName, periodDays: periodDays, inPeriod: inPeriod,
    go: function (id) { go(id); }, render: function () { render(); },
    lastImport: function () { return LAST_IMPORT; },
    tab: function (key, def) { return TAB[key] || def; },
    page: function (id, step) { return PAGE[id] || step; },
    data: function () { return D; }, calc: function () { return C; },
    openForm: function (id, prefill, edit) { openForm(id, prefill, edit); },
    form: function (id) { return FORMS[id]; },
    pickFiles: function () { $('filesInput').click(); },
    recompute: function () { recompute(); }
  };

  function quickBar() {
    return '<div class="quick">' +
      '<button class="btn btn-primary" data-form="cashShift">💵 Касса за смену</button>' +
      '<button class="btn" data-form="ddsExpense">🧾 Расход</button>' +
      '<button class="btn" data-form="payPlan">📅 Выплата поставщику</button>' +
      '<button class="btn" data-form="invoice">📥 Приход товара</button>' +
      '<button class="btn" data-form="writeoff">🗑 Списание</button>' +
      '</div>';
  }

  /* --- Долги к оплате (ручные записи + документы 1С) -------------------------- */
  function dueDocs() {
    var out = [];
    E.manualDocs(S.state.invoices || [], S.state.payments || []).forEach(function (d) {
      if (d.left > 0) out.push({ due: d.due || d.date, supplier: d.supplier, doc: d.doc || '—',
        left: d.left, src: 'мои записи', id: d.id });
    });
    if (C.sup) {
      // в накладной 1С срока оплаты нет: он считается по отсрочке поставщика,
      // но в план попадает только подтверждённая владельцем дата
      C.sup.docs.forEach(function (d) {
        if (d.left <= 0) return;
        out.push({ due: d.confirmed ? d.due : '', date: d.date, supplier: d.firm,
          doc: d.doc.replace('Приходная накладная ', ''), left: d.left,
          src: d.confirmed ? '1С' : '1С, дата не подтверждена' });
      });
    }
    return out.sort(function (a, b) { return (a.due || '').localeCompare(b.due || ''); });
  }

  function attention() {
    var items = [], t = today();
    var docs = dueDocs();
    var overdue = docs.filter(function (d) { return d.due && d.due < t; });
    var dueToday = docs.filter(function (d) { return d.due === t; });
    if (overdue.length) {
      items.push({ icon: '🔴', title: 'Просроченные оплаты поставщикам',
        sub: overdue.length + ' ' + plural(overdue.length, 'накладная', 'накладные', 'накладных') + ' — самая старая от ' + dateRu(overdue[0].due),
        value: '<span class="c-red private">' + money(overdue.reduce(function (a, d) { return a + d.left; }, 0)) + '</span>',
        view: 'suppliers' });
    }
    if (dueToday.length) {
      items.push({ icon: '📅', title: 'Оплатить сегодня', sub: dueToday.map(function (d) { return d.supplier; }).slice(0, 3).join(', '),
        value: '<span class="c-orange private">' + money(dueToday.reduce(function (a, d) { return a + d.left; }, 0)) + '</span>', view: 'suppliers' });
    }
    if (C.sup && C.sup.confirm.length) items.push({ icon: '✅', title: 'Подтвердите даты выплат',
      sub: 'дата предложена по отсрочке — в план попадёт после подтверждения',
      value: C.sup.confirm.length + ' ' + plural(C.sup.confirm.length, 'накладная', 'накладные', 'накладных'),
      view: 'confirm' });
    if (C.sup && C.sup.recon.length) items.push({ icon: '🧷', title: 'Оплаты, которые не сошлись',
      sub: 'недоплата, оплата без накладной или выплата не поставщику',
      value: '<span class="c-orange">' + C.sup.recon.length + '</span>', view: 'recon' });
    if (C.sup && C.sup.newNames.length) items.push({ icon: '🔗', title: 'Новые имена поставщиков',
      sub: 'пока имя не связано с фирмой, долг по нему считается отдельно',
      value: '<span class="c-orange">' + C.sup.newNames.length + '</span>', view: 'match' });
    if (C.sup && C.sup.debtors.old > 0) items.push({ icon: '📓', title: 'Старые долги покупателей',
      sub: 'старше ' + C.sup.debtors.oldDays + ' дней',
      value: '<span class="c-red private">' + money(C.sup.debtors.old) + '</span>', view: 'debtors' });
    if (D.sales.length && D.stock.length) {
      if (C.ropCount == null) C.ropCount = E.ropList(D.sales, D.stock, D.salesPeriod ? D.salesPeriod.days : 30, S.settings, C.bestPrices).length;
      if (C.ropCount) items.push({ icon: '🚚', title: 'Пора заказать товар',
        sub: 'Остаток ниже точки заказа', value: nf(C.ropCount) + ' поз.', view: 'orders' });
    }
    var exp = (S.state.expiry || []).map(function (r) { return E.fefoStatus(r.bestBefore, S.settings); })
      .filter(function (f) { return f.level === 'crit' || f.level === 'expired'; });
    if (exp.length) items.push({ icon: '⏰', title: 'Сроки годности заканчиваются',
      sub: 'Уценить или снять с полки', value: '<span class="c-red">' + exp.length + ' поз.</span>', view: 'expiry' });
    var led = (S.state.dds || []).filter(function (r) { return inPeriod(r.date); });
    var finT = window.WMFin.totals(led.length ? led : (S.state.dds || []));
    if (finT.diffCount && finT.diffSum !== 0) items.push({
      icon: '💵', title: finT.diffSum < 0 ? 'Недостача по кассе' : 'Излишек по кассе',
      sub: 'Смен с расхождением: ' + finT.diffCount,
      value: '<span class="' + cls(finT.diffSum) + ' private">' + money(finT.diffSum) + '</span>', view: 'cash' });
    var pl = window.WMFin.planTotals(S.state.plans || [], t);
    if (pl.overdueCount) items.push({ icon: '📅', title: 'Просроченные выплаты по плану',
      sub: pl.overdueCount + ' ' + plural(pl.overdueCount, 'платёж', 'платежа', 'платежей'),
      value: '<span class="c-red private">' + money(pl.overdue) + '</span>', view: 'finpay' });
    if (F.state !== 'ready') items.push({ icon: '💾', title: 'Данные не сохраняются в файл',
      sub: F.state === 'unsupported' ? 'Откройте дашборд в Chrome или Edge' : 'Подключите папку — записи будут храниться в файле',
      value: '<button class="btn btn-sm btn-primary" data-act="' + (F.state === 'needs-permission' ? 'folder-reconnect' : 'folder-connect') + '">Подключить</button>' });
    if (!D.sales.length && !D.owner) items.push({ icon: '📂', title: 'Данные 1С не загружены',
      sub: 'Выгрузите отчёты в папку и нажмите «Обновить из 1С»',
      value: '<button class="btn btn-sm" data-act="pick-files">Загрузить</button>' });
    return items;
  }

  /* --- Экран «Сегодня» --------------------------------------------------------- */
  function viewToday() {
    var debt = debtNow();
    var Fin = window.WMFin;
    var ledger = S.state.dds || [];
    var ledgerPeriod = ledger.filter(function (r) { return inPeriod(r.date); });
    if (!ledgerPeriod.length) ledgerPeriod = ledger;
    var fin = Fin.totals(ledgerPeriod);
    var finBal = Fin.balances(ledger, { cash: num(S.settings.openCashStart), card: num(S.settings.openCardStart), transfer: num(S.settings.openTransferStart) });
    var sh = E.shiftsTotals(jrn('shifts'));
    var man = manual();
    var t = C.sales || E.salesTotals([]);
    var ownerSel = ownerRows(), ownerT = D.owner ? E.ownerTotals(ownerSel.rows) : null;
    var lastDate = ledger.length ? ledger.map(function (r) { return r.date; }).sort().pop() : '';
    var cashNow = ledger.length ? finBal.map['Наличные'] : 0;
    var att = attention();
    var docs = dueDocs();
    var payPeriod = jrn('payments').reduce(function (a, p) { return a + num(p.amount); }, 0);

    var h = '<div class="page-head"><div><div class="page-title">Сегодня</div>' +
      '<div class="page-sub">' + esc(new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })) + '</div></div></div>';

    h += '<div class="grid-2">' +
      hero('Долг поставщикам', priv(debt.value), esc(debt.source) +
        (docs.length ? ' · ' + docs.length + ' ' + plural(docs.length, 'накладная', 'накладные', 'накладных') + ' не закрыто' : ''),
        debt.value > 0 ? 'c-red' : 'c-green') +
      hero('Оплачено поставщикам',
        priv(payPeriod || (C.payments1c ? C.payments1c.totalPaid + C.payments1c.oldDebtPaid : 0)),
        payPeriod ? 'по моим записям за ' + periodName().toLowerCase()
          : (C.payments1c ? 'по кассовым ордерам 1С' + (D.invoicesPeriod ? ' за ' + D.invoicesPeriod.days + ' дн.' : '') : 'записей пока нет'),
        'c-green') +
      '</div>';

    h += quickBar();

    h += '<div class="stat-grid">' +
      stat('Наличные в кассе', priv(cashNow), ledger.length ? 'На ' + dateRu(lastDate) + ' по базе операций' : 'Запишите кассу за смену') +
      stat('Выручка', priv(fin.income || (ownerT && ownerT.revenue) || t.revenue),
        fin.income ? 'По базе операций · ' + fin.days + ' ' + plural(fin.days, 'день', 'дня', 'дней')
          : (ownerT && ownerT.revenue ? 'По вашей книге, ' + ownerT.dayCount + ' дн.' : 'По отчёту 1С')) +
      stat('Прибыль', priv(fin.income ? fin.profit : t.gross),
        fin.income ? 'Рентабельность ' + pct(fin.profitability) : (t.revenue ? 'Маржа ' + pct(t.margin) : 'Нужны данные'),
        (fin.income ? fin.profit : t.gross) >= 0 ? 'c-green' : 'c-red') +
      stat('Куплено товара', priv(man.totals.supplies || (C.payments1c ? C.payments1c.totalSum : 0)),
        man.totals.docs ? man.totals.docs + ' ' + plural(man.totals.docs, 'накладная', 'накладные', 'накладных') + ' за ' + periodName().toLowerCase() : 'По накладным 1С') +
      '</div>';

    if (att.length) {
      h += card('Требует внимания', listOf(att.map(function (a) {
        return listRow({ icon: a.icon, title: esc(a.title), sub: esc(a.sub), value: a.value,
          tap: !!a.view, attrs: a.view ? ' data-go="' + a.view + '"' : '' });
      }), 'Всё спокойно'));
    }

    var topDebt = (C.balance1c || man.balance).filter(function (b) { return b.debt > 0; }).slice(0, 6);
    if (topDebt.length) {
      h += card('Кому платить в первую очередь', listOf(topDebt.map(function (b) {
        return listRow({ icon: '🤝', title: esc(b.supplier),
          sub: (phoneLink(b.supplier) || 'телефон не найден') + ' · поставки на ' + money(b.sum),
          value: '<span class="c-red private">' + money(b.debt) + '</span>' +
            '<small><button class="btn btn-sm" data-form="payment" data-supplier="' + esc(b.supplier) + '">Оплатить</button></small>' });
      }), 'Долгов нет'), '<button class="btn btn-sm" data-go="suppliers">Все поставщики</button>');
    }

    if (chartDays().length > 1) h += '<div class="chart-box"><canvas id="chartMain"></canvas></div>';
    return h;
  }

  function ownerRows() {
    if (!D.owner) return { rows: [], whole: false };
    var rows = D.owner.daily.filter(function (r) { return inPeriod(r.date); });
    if (!rows.length) return { rows: D.owner.daily, whole: true };
    return { rows: rows, whole: false };
  }

  // Данные для графика выручки: сначала книга владельца, иначе журнал смен
  function chartDays() {
    var byDay = {};
    var ledger = S.state.dds || [];
    if (ledger.length) {
      ledger.forEach(function (r) {
        if (!r.date || !window.WMFin.isIncome(r)) return;
        byDay[r.date] = (byDay[r.date] || 0) + num(r.amount);
      });
    } else if (D.owner && D.owner.daily.length) {
      D.owner.daily.forEach(function (r) {
        if (!r.date) return;
        byDay[r.date] = (byDay[r.date] || 0) + num(r.cash) + num(r.online) + num(r.transfer);
      });
    } else {
      (S.state.shifts || []).forEach(function (s) {
        if (!s.date) return;
        byDay[s.date] = (byDay[s.date] || 0) + num(s.zCash) + num(s.terminal);
      });
    }
    return Object.keys(byDay).sort().slice(-30).map(function (d) { return { date: d, sum: byDay[d] }; });
  }

  function drawChart() {
    var cv = $('chartMain'); if (!cv || typeof Chart === 'undefined') return;
    var days = chartDays();
    if (CHARTS.main) CHARTS.main.destroy();
    var css = getComputedStyle(document.body);
    var blue = css.getPropertyValue('--blue').trim() || '#007AFF';
    var label = css.getPropertyValue('--label-2').trim() || '#888';
    CHARTS.main = new Chart(cv.getContext('2d'), {
      type: 'line',
      data: {
        labels: days.map(function (d) { return dateRu(d.date); }),
        datasets: [{ data: days.map(function (d) { return Math.round(d.sum); }), label: 'Выручка за день, ₽',
          borderColor: blue, backgroundColor: 'rgba(0,122,255,.12)', fill: true, tension: .35,
          pointRadius: 0, borderWidth: 2.5 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, title: { display: true, text: 'Выручка по дням', color: label, font: { size: 14, weight: '600' }, align: 'start' } },
        scales: { x: { grid: { display: false }, ticks: { color: label, maxTicksLimit: 8 }, border: { display: false } },
          y: { grid: { color: 'rgba(120,120,128,.14)' }, ticks: { color: label, callback: function (v) { return (v / 1000) + 'т'; } }, border: { display: false } } }
      }
    });
  }

  /* --- Экран «Поставщики» ------------------------------------------------------- */
  function viewSuppliers() {
    var man = manual();
    var tab = TAB.suppliers || (C.sup && C.sup.totals.docs ? '1c' : 'my');
    var debt = debtNow();
    var docs = dueDocs();
    var t = today();
    var overdue = docs.filter(function (d) { return d.due && d.due < t; });

    var h = '<div class="page-head"><div><div class="page-title">Поставщики</div>' +
      '<div class="page-sub">Что привезли, что оплатили, сколько должны</div></div></div>';

    var noDate = docs.filter(function (d) { return !d.due; });
    h += '<div class="grid-2">' +
      hero('Общий долг', priv(debt.value), esc(debt.source), debt.value > 0 ? 'c-red' : 'c-green') +
      (overdue.length
        ? hero('Просрочено', priv(overdue.reduce(function (a, d) { return a + d.left; }, 0)),
            overdue.length + ' ' + plural(overdue.length, 'документ', 'документа', 'документов') + ' с истёкшим сроком', 'c-red')
        : hero('Ждут оплаты', priv(docs.reduce(function (a, d) { return a + d.left; }, 0)),
            docs.length ? docs.length + ' ' + plural(docs.length, 'накладная', 'накладные', 'накладных') +
              (noDate.length ? ' · срок не указан у ' + noDate.length : '') : 'Всё оплачено',
            docs.length ? 'c-orange' : 'c-green')) + '</div>';

    h += '<div class="quick">' +
      '<button class="btn btn-primary" data-form="invoice">📥 Записать приход</button>' +
      '<button class="btn" data-form="payment">💸 Записать оплату</button></div>';

    if (C.sup && C.sup.totals.docs) {
      h += '<div class="segmented"><button class="' + (tab === 'my' ? 'active' : '') + '" data-tab="suppliers:my">Мои записи</button>' +
        '<button class="' + (tab === '1c' ? 'active' : '') + '" data-tab="suppliers:1c">Из 1С</button></div>';
    }

    if (tab === '1c' && C.sup && C.sup.totals.docs) {
      var sp = C.sup, tt = sp.totals;
      h += '<div class="stat-grid">' +
        stat('Поставки в базе', priv(tt.sum), nf(tt.docs) + ' ' + plural(tt.docs, 'накладная', 'накладные', 'накладных')) +
        stat('Оплачено по ним', priv(tt.paid), 'расходные ордера 1С') +
        stat('Долг сейчас', priv(tt.left), 'по всем накладным', tt.left > 0 ? 'c-red' : 'c-green') +
        stat('Погашено старых долгов', priv(sp.linkStat.oldSum), 'по накладным вне выгрузок', 'c-green') + '</div>';

      if (sp.confirm.length) {
        h += '<div class="banner"><span>✅</span><span>' + sp.confirm.length + ' ' +
          plural(sp.confirm.length, 'накладная ждёт', 'накладные ждут', 'накладных ждут') +
          ' подтверждения даты выплаты — до этого они не попадают в план.</span>' +
          '<button class="btn" data-go="confirm">Подтвердить</button></div>';
      }

      // долг считается по фирме: все написания имени из 1С сложены вместе
      h += card('Долг по поставщикам', listOf(sp.firms.filter(function (f) { return f.left > 0 || f.overdue > 0; })
        .slice(0, 200).map(function (f) {
          var sub = [];
          if (f.phone || phoneLink(f.firm)) sub.push(f.phone ? '<a class="phone" href="tel:' + esc(f.phone) + '">' + esc(phoneFmt(f.phone)) + '</a>' : phoneLink(f.firm));
          sub.push(f.docs + ' ' + plural(f.docs, 'накладная', 'накладные', 'накладных'));
          if (f.reps.length) sub.push(f.reps.length + ' ' + plural(f.reps.length, 'имя', 'имени', 'имён') + ' в 1С');
          sub.push(f.term === null ? 'отсрочка не задана' : 'отсрочка ' + f.term + ' дн.');
          if (f.due) sub.push('ближайший срок ' + dateRu(f.due));
          else if (f.awaiting) sub.push(f.awaiting + ' ' + plural(f.awaiting, 'накладная ждёт', 'накладные ждут', 'накладных ждут') + ' подтверждения');
          return listRow({ icon: f.overdue > 0 ? '🔴' : (f.left > 0 ? '🟠' : '🟢'), title: esc(f.firm),
            sub: sub.join(' · '),
            value: '<span class="' + (f.overdue > 0 ? 'c-red' : '') + ' private">' + money(f.left) + '</span>' +
              (f.overdue > 0 ? '<small class="c-red private">просрочено ' + money(f.overdue) + '</small>'
                : (f.awaiting ? '<small class="c-muted">ждут подтверждения</small>' : '')) });
        }), 'Долгов нет — всё оплачено'), '<button class="btn btn-sm" data-go="terms">Отсрочки</button>');

      h += card('Накладные из 1С', table('inv1c', [
        { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
        { title: 'Поставщик', fn: function (r) { return esc(r.firm); } },
        { title: 'Документ', fn: function (r) { return esc(r.doc); } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.sum); } },
        { title: 'Оплачено', cls: 'num', fn: function (r) { return priv(r.paid); } },
        { title: 'Долг', cls: 'num', fn: function (r) { return '<span class="' + (r.left > 0 ? 'c-red' : 'c-green') + ' private">' + money(r.left) + '</span>'; } },
        { title: 'Платить', fn: function (r) {
          if (r.left <= 0) return '—';
          if (!r.confirmed) return '<span class="c-muted">' + esc(dateRu(r.due)) + ' (не подтв.)</span>';
          return '<span class="' + (r.overdue ? 'c-red' : '') + '">' + esc(dateRu(r.due)) + '</span>'; } },
        { title: '', cls: 'center', fn: function (r) { return badge(r.statusText, r.status === 'paid' ? 'green' : (r.status === 'part' ? 'orange' : 'red')); } }
      ], sp.docs, { step: 40 }));
      return h;
    }

    var mt = man.totals;
    h += '<div class="stat-grid">' +
      stat('Привезли за период', priv(mt.supplies), mt.docs + ' ' + plural(mt.docs, 'накладная', 'накладные', 'накладных')) +
      stat('Оплатили', priv(mt.paid), mt.payments + ' ' + plural(mt.payments, 'платёж', 'платежа', 'платежей')) +
      stat('Осталось должны', priv(mt.debt), 'По моим записям', mt.debt > 0 ? 'c-red' : 'c-green') +
      stat('Средний чек накладной', priv(mt.docs ? mt.supplies / mt.docs : 0), 'За ' + periodName().toLowerCase()) + '</div>';

    h += card('Долг по поставщикам', listOf(man.balance.map(function (b) {
      return listRow({ icon: b.debt > 0 ? '🔴' : '🟢', title: esc(b.supplier),
        sub: (phoneLink(b.supplier) ? phoneLink(b.supplier) + ' · ' : '') + 'привезли ' + money(b.sum) + ' · оплатили ' + money(b.paid),
        value: '<span class="' + (b.debt > 0 ? 'c-red' : 'c-green') + ' private">' + money(b.debt) + '</span>' +
          '<small><button class="btn btn-sm" data-form="payment" data-supplier="' + esc(b.supplier) + '">Оплатить</button></small>' });
    }), 'Пока никаких записей. Нажмите «Записать приход» после первой поставки.'));

    h += card('Накладные', table('manDocs', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Поставщик', fn: function (r) { return esc(r.supplier); } },
      { title: '№', fn: function (r) { return esc(r.doc || '—'); } },
      { title: 'Товар', fn: function (r) { return esc(r.goods || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.sum); } },
      { title: 'Оплачено', cls: 'num', fn: function (r) { return priv(r.paid); } },
      { title: 'Долг', cls: 'num', fn: function (r) { return '<span class="' + (r.left > 0 ? 'c-red' : 'c-green') + ' private">' + money(r.left) + '</span>'; } },
      { title: 'Оплатить до', fn: function (r) { return r.due ? (r.due < t ? '<span class="c-red">' + dateRu(r.due) + '</span>' : esc(dateRu(r.due))) : '—'; } },
      { title: '', cls: 'center', fn: function (r) {
        return '<button class="btn btn-sm" data-edit="invoices:' + r.id + ':invoice">✎</button> ' +
          '<button class="btn btn-sm btn-danger" data-del="invoices:' + r.id + '">✕</button>'; } }
    ], man.docs, { step: 30, empty: 'Накладных ещё нет' }));

    h += card('Оплаты', table('manPays', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Поставщик', fn: function (r) { return esc(r.supplier); } },
      { title: 'За что', fn: function (r) { return esc(r.kind || '—'); } },
      { title: 'Чем', fn: function (r) { return esc(r.form || '—'); } },
      { title: 'Накладная', fn: function (r) { return esc(r.doc || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.amount); } },
      { title: '', cls: 'center', fn: function (r) {
        return '<button class="btn btn-sm" data-edit="payments:' + r.id + ':payment">✎</button> ' +
          '<button class="btn btn-sm btn-danger" data-del="payments:' + r.id + '">✕</button>'; } }
    ], man.payments.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }),
      { step: 30, empty: 'Оплат ещё нет' }));
    return h;
  }

  /* --- Касса и смены ------------------------------------------------------------ */
  // Смены собираются из базы операций: записи одной смены сгруппированы
  // по дате, смене и кассиру — как строки «Ввод_Касса» в вашей таблице.
  function shiftsFromLedger() {
    var Fin = window.WMFin;
    var rows = (S.state.dds || []).filter(function (r) { return inPeriod(r.date); });
    if (!rows.length && (S.state.dds || []).length) rows = S.state.dds;
    var map = {};
    rows.forEach(function (r) {
      var key = r.date + '|' + (r.shift || '') + '|' + (r.cashier || '');
      if (!map[key]) map[key] = { date: r.date, shift: r.shift || '—', cashier: r.cashier || '—',
        z: 0, diff: 0, payouts: 0, cash: 0, card: 0, transfer: 0, ids: [] };
      var g = map[key];
      g.ids.push(r.id);
      if (Fin.isIncome(r)) {
        g.z += num(r.amount); g.diff += num(r.diff);
        if (r.method === 'Наличные') g.cash += num(r.amount);
        else if (r.method === 'Карта') g.card += num(r.amount);
        else g.transfer += num(r.amount);
      } else if (Fin.isExpense(r) && E.norm(r.category).indexOf('выплата из кассы') >= 0) {
        g.payouts += num(r.amount);
      }
    });
    var out = [];
    for (var k in map) {
      var g = map[k];
      if (!g.z && !g.payouts) continue;
      g.z = E.safeRound(g.z); g.diff = E.safeRound(g.diff); g.payouts = E.safeRound(g.payouts);
      g.fact = E.safeRound(g.z + g.diff);
      out.push(g);
    }
    return out.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  }

  function viewCash() {
    var rows = shiftsFromLedger();
    var t = { count: rows.length, zCash: 0, factCash: 0, payouts: 0, diff: 0, terminal: 0, short: 0, over: 0 };
    rows.forEach(function (g) {
      t.zCash += g.cash; t.terminal += g.card + g.transfer; t.payouts += g.payouts;
      t.diff += g.diff; t.factCash += g.fact;
      if (g.diff < 0) t.short += Math.abs(g.diff); else t.over += g.diff;
    });
    for (var tk in t) t[tk] = E.safeRound(t[tk]);
    t.count = rows.filter(function (g) { return g.shift && g.shift !== '—'; }).length || rows.length;
    t.revenue = E.safeRound(t.zCash + t.terminal);
    var byCashier = {};
    rows.forEach(function (g) {
      var k = g.cashier || 'Без имени';
      if (!byCashier[k]) byCashier[k] = { name: k, shifts: 0, diff: 0, short: 0, over: 0, z: 0 };
      byCashier[k].shifts++; byCashier[k].diff += g.diff; byCashier[k].z += g.z;
      if (g.diff < 0) byCashier[k].short += Math.abs(g.diff); else byCashier[k].over += g.diff;
    });
    var people = Object.keys(byCashier).map(function (k) { return byCashier[k]; })
      .sort(function (a, b) { return a.diff - b.diff; });

    var h = '<div class="page-head"><div><div class="page-title">Касса и смены</div>' +
      '<div class="page-sub">День 09:00–21:00 · ночь 21:00–09:00</div></div>' +
      '<button class="btn btn-primary" data-form="cashShift">＋ Закрыть смену</button></div>';

    h += '<div class="stat-grid">' +
      stat('Выручка за смены', priv(t.revenue), t.count + ' ' + plural(t.count, 'смена', 'смены', 'смен') +
        ' · наличными ' + money(t.zCash)) +
      stat('Выдано из кассы', priv(t.payouts), 'Оплаты и расходы из ящика') +
      stat('Факт по кассе', priv(t.factCash), 'С учётом расхождений') +
      stat(t.diff < 0 ? 'Недостача' : 'Расхождение', priv(t.diff),
        'Недостачи ' + money(t.short) + ' · излишки ' + money(t.over), t.diff === 0 ? 'c-green' : (t.diff < 0 ? 'c-red' : 'c-orange')) +
      '</div>';

    if (people.length) {
      h += card('Кассиры', listOf(people.map(function (p) {
        return listRow({ icon: p.diff === 0 ? '🟢' : (p.diff < 0 ? '🔴' : '🟠'), title: esc(p.name),
          sub: p.shifts + ' ' + plural(p.shifts, 'смена', 'смены', 'смен') + ' · сдал ' + money(p.z),
          value: '<span class="' + cls(p.diff) + ' private">' + money(p.diff) + '</span>' +
            '<small>' + (p.diff === 0 ? 'всё сходится' : (p.diff < 0 ? 'недостача' : 'излишек')) + '</small>' });
      }), 'Нет закрытых смен'));
    }

    h += card('Журнал смен', table('shiftsT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift); } },
      { title: 'Кассир', fn: function (r) { return esc(r.cashier); } },
      { title: 'Наличные', cls: 'num', fn: function (r) { return priv(r.cash); } },
      { title: 'Карта', cls: 'num', fn: function (r) { return priv(r.card); } },
      { title: 'Перевод', cls: 'num', fn: function (r) { return priv(r.transfer); } },
      { title: 'Выручка смены', cls: 'num', fn: function (r) { return priv(r.z); } },
      { title: 'Выдано', cls: 'num', fn: function (r) { return priv(r.payouts); } },
      { title: 'Факт', cls: 'num', fn: function (r) { return priv(r.fact); } },
      { title: 'Расхождение', cls: 'num', fn: function (r) { return '<span class="' + cls(r.diff) + ' private">' + money(r.diff) + '</span>'; } },
      { title: '', cls: 'center', fn: function (r) {
        return '<button class="btn btn-sm btn-danger" data-act="del-shift" data-ids="' + r.ids.join(',') + '">✕</button>'; } }
    ], rows, { step: 30, empty: 'Смен за период нет. Нажмите «Закрыть смену».',
      total: [{ html: 'Итого', span: 3 }, { html: money(t.zCash), cls: 'num' },
        { html: money(rows.reduce(function (a, r) { return a + r.card; }, 0)), cls: 'num' },
        { html: money(rows.reduce(function (a, r) { return a + r.transfer; }, 0)), cls: 'num' },
        { html: money(t.revenue), cls: 'num' }, { html: money(t.payouts), cls: 'num' },
        { html: money(t.factCash), cls: 'num' },
        { html: '<span class="' + cls(t.diff) + '">' + money(t.diff) + '</span>', cls: 'num' }, { html: '' }] }));
    return h;
  }

  /* --- Расходы и книга ДДС -------------------------------------------------------- */
  function viewDds() {
    var Fin = window.WMFin;
    var ledger = (S.state.dds || []).filter(function (r) { return inPeriod(r.date) && Fin.isExpense(r); });
    if (!ledger.length) ledger = (S.state.dds || []).filter(Fin.isExpense);
    var exp = ledger.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var byCat = {};
    exp.forEach(function (e) { byCat[e.category || 'Прочее'] = (byCat[e.category || 'Прочее'] || 0) + num(e.amount); });
    var cats = Object.keys(byCat).map(function (k) { return { name: k, sum: E.safeRound(byCat[k]) }; })
      .sort(function (a, b) { return b.sum - a.sum; });
    var expSum = cats.reduce(function (a, c) { return a + c.sum; }, 0);
    var sel = ownerRows(), ot = D.owner ? E.ownerTotals(sel.rows) : null;

    var h = '<div class="page-head"><div><div class="page-title">Расходы</div>' +
      '<div class="page-sub">Куда уходят деньги магазина</div></div>' +
      '<button class="btn btn-primary" data-form="ddsExpense">＋ Записать расход</button></div>';

    h += '<div class="stat-grid">' +
      stat('Расходы за период', priv(expSum), exp.length + ' ' + plural(exp.length, 'запись', 'записи', 'записей')) +
      stat('Постоянные расходы в месяц', priv(S.fixedMonthly()), 'Аренда, зарплата, налоги — из настроек') +
      (ot ? stat('Оборот по книге ДДС', priv(ot.revenue), ot.dayCount + ' дн.' + (sel.whole ? ' (весь файл)' : '')) : '') +
      (ot ? stat('Прибыль по книге', priv(ot.profit), 'Ваш расчёт: 25% минус расходы', ot.profit >= 0 ? 'c-green' : 'c-red') : '') +
      '</div>';

    if (cats.length) {
      h += card('По статьям', listOf(cats.map(function (c) {
        return listRow({ icon: '🧾', title: esc(c.name), sub: pct(E.div(c.sum, expSum) * 100) + ' от расходов',
          value: priv(c.sum) });
      }), ''));
    }

    h += card('Записи расходов', table('expT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Статья', fn: function (r) { return esc(r.category); } },
      { title: 'Чем платили', fn: function (r) { return esc(r.method || '—'); } },
      { title: 'Заметка', fn: function (r) { return esc(r.note || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.amount); } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn btn-sm btn-danger" data-del="dds:' + r.id + '">✕</button>'; } }
    ], exp, { step: 30, empty: 'Расходов пока не записано' }));

    if (!D.owner) return h;

    var rows = sel.rows;
    var expenses = [
      { name: 'Зарплата', v: ot.salary }, { name: 'Аренда', v: ot.rent },
      { name: 'Коммунальные', v: ot.utilities }, { name: 'Налог', v: ot.tax },
      { name: 'Списание продукта', v: ot.writeoff }, { name: 'Комиссия банка', v: ot.bankFee },
      { name: 'Обед', v: ot.lunch }, { name: 'ГСМ', v: ot.fuel }, { name: 'Расходники', v: ot.supplies }
    ].filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; });

    h += card('Расходы по вашей книге ДДС', listOf(expenses.map(function (e) {
      return listRow({ icon: '💳', title: esc(e.name),
        sub: pct(E.div(e.v, ot.revenue) * 100) + ' от оборота · ' + money(E.div(e.v, ot.dayCount)) + ' в день',
        value: priv(e.v) });
    }), 'Расходы в книге не заполнены'),
      '<button class="btn btn-sm" data-act="owner-to-settings">Перенести в настройки</button>');

    h += card('Движение денег по сменам', table('ddsT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift); } },
      { title: 'Наличная', cls: 'num', fn: function (r) { return priv(r.cash); } },
      { title: 'Онлайн', cls: 'num', fn: function (r) { return priv(r.online); } },
      { title: 'Оборот', cls: 'num', fn: function (r) { return r.revenue ? priv(r.revenue) : '—'; } },
      { title: 'Закуп налом', cls: 'num', fn: function (r) { return priv(r.buyCashOffice); } },
      { title: 'Оплата долга', cls: 'num', fn: function (r) { return priv(r.payDebtOffice); } },
      { title: 'Закуп в долг', cls: 'num', fn: function (r) { return priv(r.buyCredit); } },
      { title: 'Прибыль', cls: 'num', fn: function (r) { return r.profit ? '<span class="' + cls(r.profit) + ' private">' + money(r.profit) + '</span>' : '—'; } },
      { title: 'Долг поставщикам', cls: 'num', fn: function (r) { return r.debt ? priv(r.debt) : '—'; } }
    ], rows.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }), { step: 40 }));

    D.owner.monthly.forEach(function (mo, i) {
      if (!mo.rows.length) return;
      h += card('Ваша сводка из файла — «' + mo.sheet + '»', table('mon' + i, [
        { title: 'Статья', fn: function (r) { return esc(r.name); } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.value); } }
      ], mo.rows, { step: 25 }), '<span class="card-note">как в вашем файле</span>');
    });
    return h;
  }

  /* --- Зарплата ------------------------------------------------------------------- */
  function viewStaff() {
    var ts = jrn('timesheet'), po = jrn('payouts');
    var sum = E.payrollSummary(ts, po);
    var accrued = sum.reduce(function (a, r) { return a + r.accrued; }, 0);
    var paid = sum.reduce(function (a, r) { return a + r.paid; }, 0);

    var h = '<div class="page-head"><div><div class="page-title">Зарплата</div>' +
      '<div class="page-sub">Смены, начисления и выплаты</div></div>' +
      '<div><button class="btn" data-form="timesheet">＋ Смена</button> ' +
      '<button class="btn btn-primary" data-form="payout">＋ Выплата</button></div></div>';

    h += '<div class="stat-grid">' +
      stat('Начислено', priv(accrued), ts.length + ' ' + plural(ts.length, 'смена', 'смены', 'смен') + ' за ' + periodName().toLowerCase()) +
      stat('Выплачено', priv(paid), po.length + ' ' + plural(po.length, 'выплата', 'выплаты', 'выплат')) +
      stat('Осталось выплатить', priv(accrued - paid), 'Долг перед сотрудниками', accrued - paid > 0 ? 'c-orange' : 'c-green') +
      stat('Людей в табеле', nf(sum.length), 'За ' + periodName().toLowerCase()) + '</div>';

    h += card('По сотрудникам', listOf(sum.map(function (r) {
      return listRow({ icon: '👤', title: esc(r.employee),
        sub: (r.position || 'сотрудник') + ' · ' + nf(r.hours, 0) + ' ч · начислено ' + money(r.accrued) + ' · выдано ' + money(r.paid),
        value: '<span class="' + (r.left > 0 ? 'c-orange' : 'c-green') + ' private">' + money(r.left) + '</span>' +
          '<small><button class="btn btn-sm" data-form="payout" data-employee="' + esc(r.employee) + '">Выдать</button></small>' });
    }), 'Табель пуст — нажмите «＋ Смена»'));

    if (D.owner && D.owner.payroll.length) {
      h += card('Ставки из вашей платёжки', listOf(D.owner.payroll.map(function (r) {
        return listRow({ icon: r.night ? '🌙' : '☀️', title: esc(r.name || r.position),
          sub: esc(r.position + (r.schedule ? ' · ' + r.schedule : '')), value: priv(r.rate) + '<small>за смену</small>' });
      }), ''));
    }

    h += card('Табель', table('tsT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Сотрудник', fn: function (r) { return esc(r.employee); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift); } },
      { title: 'Часы', cls: 'num', fn: function (r) { return nf(r.hours, 1); } },
      { title: 'Ставка', cls: 'num', fn: function (r) { return priv(r.rate); } },
      { title: 'Штраф', cls: 'num', fn: function (r) { return priv(r.penalty); } },
      { title: 'Премия', cls: 'num', fn: function (r) { return priv(r.bonus); } },
      { title: 'Начислено', cls: 'num', fn: function (r) { return priv(E.timesheetCalc(r)); } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn btn-sm btn-danger" data-del="timesheet:' + r.id + '">✕</button>'; } }
    ], ts.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }), { step: 30, empty: 'Смен нет' }));

    h += card('Выплаты', table('poT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Сотрудник', fn: function (r) { return esc(r.employee); } },
      { title: 'Что', fn: function (r) { return esc(r.type); } },
      { title: 'Чем', fn: function (r) { return esc(r.form); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.amount); } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn btn-sm btn-danger" data-del="payouts:' + r.id + '">✕</button>'; } }
    ], po.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }), { step: 30, empty: 'Выплат нет' }));
    return h;
  }

  /* --- Склад ---------------------------------------------------------------------- */
  function viewStock() {
    var inv = jrn('inventory');
    var h = '<div class="page-head"><div><div class="page-title">Склад</div>' +
      '<div class="page-sub">' + (D.stock.length ? nf(C.stock.sku) + ' позиций из 1С' : 'Загрузите отчёт «Остатки номенклатуры»') + '</div></div>' +
      '<button class="btn" data-form="inventory">＋ Пересчёт</button></div>';

    if (D.stock.length) {
      h += '<div class="stat-grid">' +
        stat('Товара на складе', priv(C.stock.buySum), 'По себестоимости') +
        stat('В розничных ценах', priv(C.stock.retailSum), 'Если продать всё') +
        stat('Наценка', pct(E.div(C.stock.retailSum - C.stock.buySum, C.stock.buySum) * 100), 'В среднем по складу') +
        stat('Закончилось', nf(C.stock.zeroSku), 'Позиций с нулевым остатком', C.stock.zeroSku ? 'c-orange' : '') + '</div>';

      var q = ($('search') && $('search').value || '').trim();
      var rows = D.stock;
      if (q) { var nq = E.norm(q); rows = rows.filter(function (r) {
        return r.key.indexOf(nq) >= 0 || (r.barcode && r.barcode.indexOf(nq) >= 0) || E.norm(r.article).indexOf(nq) >= 0; }); }
      rows = rows.slice().sort(function (a, b) { return b.buySum - a.buySum; });

      h += card('Остатки' + (q ? ' — «' + esc(q) + '»' : ''), table('stockT', [
        { title: 'Товар', fn: function (r) { return esc(r.name); } },
        { title: 'Группа', fn: function (r) { return esc(r.group); } },
        { title: 'Штрихкод', fn: function (r) { return esc(r.barcode || '—'); } },
        { title: 'Остаток', cls: 'num', fn: function (r) {
          return '<span class="' + (r.qty <= 0 ? 'c-red' : (r.qty < 3 ? 'c-orange' : '')) + '">' + nf(r.qty, 2) + ' ' + esc(r.unit) + '</span>'; } },
        { title: 'Закупка', cls: 'num', fn: function (r) { return priv(r.buyPrice); } },
        { title: 'Розница', cls: 'num', fn: function (r) { return priv(r.retailPrice); } },
        { title: 'Наценка', cls: 'num', fn: function (r) { return r.buyPrice > 0 ? pct(E.div(r.retailPrice - r.buyPrice, r.buyPrice) * 100) : '—'; } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.buySum); } }
      ], rows, { step: 50, empty: 'Ничего не найдено' }));
    }

    if (inv.length) {
      var lost = 0, extra = 0;
      inv.forEach(function (r) { var d = (num(r.fact) - num(r.accounted)) * num(r.price); if (d < 0) lost += d; else extra += d; });
      h += card('Пересчёты и списания', table('invT', [
        { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
        { title: 'Товар', fn: function (r) { return esc(r.name); } },
        { title: 'Учёт', cls: 'num', fn: function (r) { return nf(r.accounted, 2); } },
        { title: 'Факт', cls: 'num', fn: function (r) { return nf(r.fact, 2); } },
        { title: 'Разница', cls: 'num', fn: function (r) {
          var d = num(r.fact) - num(r.accounted);
          return '<span class="' + cls(d) + '">' + (d > 0 ? '+' : '') + nf(d, 2) + '</span>'; } },
        { title: 'Деньгами', cls: 'num', fn: function (r) {
          var d = (num(r.fact) - num(r.accounted)) * num(r.price);
          return '<span class="' + cls(d) + ' private">' + money(d) + '</span>'; } },
        { title: 'Причина', fn: function (r) { return esc(r.reason || '—'); } },
        { title: '', cls: 'center', fn: function (r) { return '<button class="btn btn-sm btn-danger" data-del="inventory:' + r.id + '">✕</button>'; } }
      ], inv.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }), { step: 30 }),
        '<span class="card-note">недостача ' + money(lost) + ' · излишки ' + money(extra) + '</span>');
    }
    return h;
  }

  /* --- Заказы (ROP) ---------------------------------------------------------------- */
  function viewOrders() {
    if (!D.sales.length || !D.stock.length) {
      return pageHead('Заказы', 'Что пора закупить') +
        '<div class="card"><div class="empty"><b>Нужны отчёты 1С</b><br>«Продажи» и «Остатки номенклатуры» — по ним видно, что заканчивается.</div></div>';
    }
    var days = D.salesPeriod ? D.salesPeriod.days : 30;
    var rows = E.ropList(D.sales, D.stock, days, S.settings, C.bestPrices);
    var sum = rows.reduce(function (a, r) { return a + r.sum; }, 0);
    var bySup = {};
    rows.forEach(function (r) {
      var k = r.supplier || 'Поставщик не указан';
      if (!bySup[k]) bySup[k] = { name: k, items: 0, sum: 0 };
      bySup[k].items++; bySup[k].sum += r.sum;
    });
    var sups = Object.keys(bySup).map(function (k) { return bySup[k]; }).sort(function (a, b) { return b.sum - a.sum; });

    var h = pageHead('Заказы', 'Что пора закупить') +
      '<div class="grid-2">' +
      hero('Нужно закупить', priv(sum), nf(rows.length) + ' ' + plural(rows.length, 'позиция', 'позиции', 'позиций') + ' по лучшим ценам') +
      hero('Уже закончилось', nf(rows.filter(function (r) { return r.critical; }).length),
        'Позиций с нулевым остатком при живом спросе', 'c-red') + '</div>';

    h += card('Кому звонить', listOf(sups.slice(0, 12).map(function (s) {
      return listRow({ icon: '📞', title: esc(s.name), sub: phoneLink(s.name) || 'телефон не найден',
        value: priv(s.sum) + '<small>' + s.items + ' ' + plural(s.items, 'позиция', 'позиции', 'позиций') + '</small>' });
    }), ''));

    h += card('Список заказа', table('ropT', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Осталось', cls: 'num', fn: function (r) { return '<span class="' + (r.critical ? 'c-red' : '') + '">' + nf(r.stock, 1) + '</span>'; } },
      { title: 'Продаём в день', cls: 'num', fn: function (r) { return nf(r.demand, 1); } },
      { title: 'Заказать', cls: 'num', fn: function (r) { return '<b>' + nf(r.order) + '</b>'; } },
      { title: 'Цена', cls: 'num', fn: function (r) { return priv(r.price); } },
      { title: 'Поставщик', fn: function (r) { return esc(r.supplier || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.sum); } }
    ], rows, { step: 40, empty: 'Всё в наличии' }));
    return h;
  }

  function pageHead(title, sub, right) {
    return '<div class="page-head"><div><div class="page-title">' + esc(title) + '</div>' +
      (sub ? '<div class="page-sub">' + esc(sub) + '</div>' : '') + '</div>' + (right || '') + '</div>';
  }

  /* --- Сроки годности --------------------------------------------------------------- */
  function viewExpiry() {
    var rows = (S.state.expiry || []).map(function (r) {
      return { r: r, f: E.fefoStatus(r.bestBefore, S.settings) };
    }).sort(function (a, b) { return (a.r.bestBefore || '').localeCompare(b.r.bestBefore || ''); });
    var crit = rows.filter(function (x) { return x.f.level === 'crit' || x.f.level === 'expired'; });

    var h = pageHead('Сроки годности', 'Что уценить сегодня',
      '<div><button class="btn" data-act="print-labels">🖨 Ценники</button> ' +
      '<button class="btn btn-primary" data-form="expiryItem">＋ Товар</button></div>');

    h += '<div class="stat-grid">' +
      stat('Уценить срочно', nf(crit.length), 'До ' + S.settings.fefoCrit + ' дн. — скидка ' + pct(S.settings.discountCrit, 0), crit.length ? 'c-red' : 'c-green') +
      stat('Скоро закончится', nf(rows.filter(function (x) { return x.f.level === 'warn'; }).length),
        'До ' + S.settings.fefoWarn + ' дн. — скидка ' + pct(S.settings.discountWarn, 0), 'c-orange') +
      stat('Под контролем', nf(rows.length), 'Всего партий') +
      stat('Денег в этих партиях', priv(rows.reduce(function (a, x) { return a + num(x.r.qty) * num(x.r.price); }, 0)), '') +
      '</div>';

    h += card('Партии', listOf(rows.map(function (x) {
      var kind = x.f.level === 'ok' ? 'green' : (x.f.level === 'warn' ? 'orange' : 'red');
      return listRow({ icon: x.f.level === 'ok' ? '🟢' : (x.f.level === 'warn' ? '🟠' : '🔴'),
        title: esc(x.r.name),
        sub: esc(x.f.action) + ' · годен до ' + dateRu(x.r.bestBefore),
        value: badge(x.f.days == null ? '—' : (x.f.days < 0 ? 'просрочено' : x.f.days + ' ' + plural(x.f.days, 'день', 'дня', 'дней')), kind) +
          '<small>' + (x.f.discount ? 'скидка ' + x.f.discount + '% → ' + money(num(x.r.price) * (100 - x.f.discount) / 100) : money(x.r.price)) +
          ' <button class="btn btn-sm btn-danger" data-del="expiry:' + x.r.id + '">✕</button></small>' });
    }), 'Пока пусто. Добавьте товар с коротким сроком при приёмке.'));
    return h;
  }

  /* --- Списания и возвраты ---------------------------------------------------------- */
  function viewLosses() {
    if (!D.writeoffs.length && !D.returns.length) {
      return pageHead('Списания', 'Потери магазина') +
        '<div class="card"><div class="empty"><b>Отчёты не загружены</b><br>Выгрузите из 1С «Причины списания» и «Причины возврата».</div></div>';
    }
    var wDays = D.writeoffsPeriod ? D.writeoffsPeriod.days : 30;
    var perMonth = E.perMonth(C.writeoffSum, wDays);
    var revDay = E.div(C.sales.revenue, D.salesPeriod ? D.salesPeriod.days : 30);
    var share = E.div(E.div(C.writeoffSum, wDays), revDay) * 100;

    var h = pageHead('Списания и возвраты', 'Куда уходит товар');
    h += '<div class="grid-2">' +
      hero('Списано за период', priv(C.writeoffSum),
        D.writeoffsPeriod ? dateRu(D.writeoffsPeriod.from.split('.').reverse().join('-')) + ' – ' + dateRu(D.writeoffsPeriod.to.split('.').reverse().join('-')) + ' · ' + wDays + ' дн.' : '', 'c-red') +
      hero('В месяц', priv(perMonth), 'Это ' + pct(share) + ' от оборота', share > 2 ? 'c-red' : 'c-green') + '</div>';

    h += card('Причины списаний', listOf(E.byReason(D.writeoffs).map(function (r) {
      return listRow({ icon: '🗑', title: esc(r.reason), sub: nf(r.docs) + ' ' + plural(r.docs, 'запись', 'записи', 'записей') + ' · ' + pct(r.share) + ' от потерь',
        value: priv(r.cost) });
    }), ''));

    h += card('Больше всего теряем на этом', table('woTop', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Количество', cls: 'num', fn: function (r) { return nf(r.qty, 2); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.cost); } },
      { title: 'Причины', fn: function (r) { return esc(r.reason); } }
    ], E.topByCost(D.writeoffs, 40), { step: 20 }));

    if (D.returns.length) {
      h += card('Возвраты поставщикам', listOf(E.byReason(D.returns).map(function (r) {
        return listRow({ icon: '↩️', title: esc(r.reason), sub: nf(r.docs) + ' строк · ' + pct(r.share),
          value: priv(r.cost) });
      }), ''));
    }
    return h;
  }

  /* --- Прибыль (P&L) ----------------------------------------------------------- */
  function viewPnl() {
    var sel = ownerRows(), ot = D.owner ? E.ownerTotals(sel.rows) : null;
    var salesDays = D.salesPeriod ? D.salesPeriod.days : 30;
    var expMonth = jrn('expenses').reduce(function (a, e) { return a + num(e.amount); }, 0) * 30 / Math.max(1, periodDays());
    var writeMonth = D.writeoffsPeriod ? E.perMonth(C.writeoffSum, D.writeoffsPeriod.days) : C.writeoffSum;
    var payroll = E.payrollSummary(jrn('timesheet'), jrn('payouts'));
    var accrued = payroll.reduce(function (a, r) { return a + r.accrued; }, 0) * 30 / Math.max(1, periodDays());

    if (!D.sales.length && !ot) {
      return pageHead('Прибыль', 'Сколько зарабатывает магазин') +
        '<div class="card"><div class="empty"><b>Нужны данные</b><br>Загрузите отчёт 1С «Продажи» или свою книгу ДДС.</div></div>';
    }

    var revenue, cogs, gross, marginPct, srcNote;
    if (D.sales.length) {
      revenue = E.safeRound(C.sales.revenue / salesDays * 30);
      cogs = E.safeRound(C.sales.cogs / salesDays * 30);
      gross = E.safeRound(revenue - cogs);
      marginPct = C.sales.margin;
      srcNote = 'по отчёту 1С «Продажи» за ' + salesDays + ' дн., приведено к месяцу';
    } else {
      revenue = E.safeRound(ot.revenue / Math.max(1, ot.dayCount) * 30);
      marginPct = 25;
      gross = E.safeRound(revenue * 0.25);
      cogs = E.safeRound(revenue - gross);
      srcNote = 'по вашей книге ДДС, наценка принята 25% (как у вас в файле)';
    }

    var costs = [
      { name: 'Зарплата', v: accrued > 0 ? accrued : num(S.settings.fot) },
      { name: 'Аренда', v: num(S.settings.rent) },
      { name: 'Коммунальные', v: num(S.settings.utilities) },
      { name: 'Налоги', v: num(S.settings.taxes) },
      { name: 'Прочие постоянные', v: num(S.settings.other) },
      { name: 'Списания и потери', v: writeMonth },
      { name: 'Мои записанные расходы', v: E.safeRound(expMonth) }
    ].filter(function (x) { return x.v > 0; });
    var costSum = costs.reduce(function (a, c) { return a + c.v; }, 0);
    var net = E.safeRound(gross - costSum);

    var h = pageHead('Прибыль за месяц', srcNote);
    h += '<div class="grid-2">' +
      hero('Чистая прибыль', priv(net), 'Рентабельность ' + pct(E.div(net, revenue) * 100), net >= 0 ? 'c-green' : 'c-red') +
      hero('Валовая прибыль', priv(gross), 'Маржа ' + pct(marginPct)) + '</div>';

    h += card('Из чего складывается', listOf(
      [listRow({ icon: '💰', title: 'Выручка', sub: srcNote, value: priv(revenue) }),
       listRow({ icon: '📦', title: 'Себестоимость проданного', sub: 'Сколько стоил проданный товар', value: '<span class="c-red private">−' + money(cogs) + '</span>' }),
       listRow({ icon: '📈', title: 'Валовая прибыль', sub: 'Выручка минус себестоимость', value: '<b class="private">' + money(gross) + '</b>' })]
        .concat(costs.map(function (c) {
          return listRow({ icon: '🧾', title: esc(c.name), sub: pct(E.div(c.v, revenue) * 100) + ' от выручки',
            value: '<span class="c-red private">−' + money(c.v) + '</span>' });
        }))
        .concat([listRow({ icon: net >= 0 ? '✅' : '⚠️', title: 'Чистая прибыль', sub: 'Что осталось владельцу',
          value: '<b class="' + (net >= 0 ? 'c-green' : 'c-red') + ' private">' + money(net) + '</b>' })]), ''));
    return h;
  }

  /* --- Точка безубыточности ------------------------------------------------------ */
  function revenueMonth() {
    if (D.owner) {
      var t = E.ownerTotals(ownerRows().rows);
      if (t.revenue > 0 && t.dayCount > 0)
        return { value: E.safeRound(t.revenue / t.dayCount * 30), source: 'ваша книга ДДС', days: t.dayCount };
    }
    var d = D.salesPeriod ? D.salesPeriod.days : 30;
    return { value: C.sales ? E.safeRound(C.sales.revenue / d * 30) : 0, source: 'отчёт 1С «Продажи»', days: d };
  }
  function marginNow() {
    var manualM = num(S.settings.marginManual);
    if (manualM > 0) return manualM;
    return C.sales && C.sales.margin ? C.sales.margin : 25;
  }
  function bepNow() {
    var r = revenueMonth();
    var b = E.bep(S.fixedMonthly(), marginNow(), r.value);
    b.source = r.source; b.days = r.days;
    return b;
  }

  function viewBep() {
    var b = bepNow();
    var done = Math.max(0, Math.min(100, b.done));
    var h = pageHead('Точка безубыточности', 'Сколько надо продать, чтобы выйти в ноль');
    h += hero(b.profitable ? 'Порог пройден' : 'До порога осталось',
      priv(b.profitable ? b.revenue - b.month : b.month - b.revenue),
      'Порог ' + money(b.month) + ' в месяц · выручка ' + money(b.revenue) + ' (' + b.source + ')',
      b.profitable ? 'c-green' : 'c-orange');

    h += card('Что это значит', listOf([
      listRow({ icon: '🏠', title: 'Постоянные расходы', sub: 'Аренда, зарплата, налоги — из настроек', value: priv(b.fixedMonth) }),
      listRow({ icon: '📊', title: 'Маржинальность', sub: num(S.settings.marginManual) > 0 ? 'задана вручную' : 'посчитана по продажам 1С', value: pct(b.margin) }),
      listRow({ icon: '🎯', title: 'Нужно продавать в месяц', sub: 'Чтобы покрыть расходы', value: priv(b.month) }),
      listRow({ icon: '📅', title: 'Нужно продавать в день', sub: 'Ровный план на день', value: priv(b.day) }),
      listRow({ icon: '✅', title: 'Расходы закрываются', sub: 'При нынешней выручке', value: b.dayOfMonth ? b.dayOfMonth + '-го числа' : '—' }),
      listRow({ icon: '🛟', title: 'Запас прочности', sub: 'На сколько выручка выше порога', value: '<span class="' + (b.safety > 0 ? 'c-green' : 'c-red') + '">' + pct(b.safety) + '</span>' })
    ], ''), '<span class="card-note">выполнение ' + pct(b.done) + '</span>');
    return h;
  }

  /* --- ABC ---------------------------------------------------------------------- */
  function viewAbc() {
    if (!D.sales.length) return pageHead('ABC-анализ', 'Что приносит деньги') +
      '<div class="card"><div class="empty"><b>Нужен отчёт 1С «Продажи»</b></div></div>';
    var rows = C.abc, sum = { A: 0, B: 0, C: 0 }, cnt = { A: 0, B: 0, C: 0 };
    rows.forEach(function (r) { sum[r.abc] += r.revenue; cnt[r.abc]++; });
    var h = pageHead('ABC-анализ', 'Какие товары дают выручку');
    h += '<div class="stat-grid">' +
      stat('A — главные', nf(cnt.A) + ' поз.', money(sum.A) + ' · 80% выручки', 'c-green') +
      stat('B — средние', nf(cnt.B) + ' поз.', money(sum.B) + ' · до 95%', 'c-orange') +
      stat('C — хвост', nf(cnt.C) + ' поз.', money(sum.C) + ' · последние 5%', 'c-muted') +
      stat('Всего в продаже', nf(rows.length) + ' поз.', 'За ' + (D.salesPeriod ? D.salesPeriod.days + ' дн.' : 'период отчёта')) + '</div>';
    h += card('Список', table('abcT', [
      { title: '№', cls: 'num', fn: function (r, i) { return nf(i + 1); } },
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Группа', fn: function (r) { return esc(C.groupIdx[r.key] || '—'); } },
      { title: 'Продано', cls: 'num', fn: function (r) { return nf(r.qty, 1); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return priv(r.revenue); } },
      { title: 'Прибыль', cls: 'num', fn: function (r) { return priv(r.profit); } },
      { title: 'Класс', cls: 'center', fn: function (r) { return badge(r.abc, r.abc === 'A' ? 'green' : (r.abc === 'B' ? 'orange' : 'gray')); } }
    ], rows, { step: 50 }));
    return h;
  }

  /* --- Цены поставщиков ---------------------------------------------------------- */
  function viewPriceCmp() {
    var h = pageHead('Цены поставщиков', 'Где дешевле купить',
      '<button class="btn" data-form="kvi">＋ Товар-маркер</button>');
    if (!D.prices.length) {
      h += '<div class="card"><div class="empty"><b>Нужен отчёт 1С «Текущие цены поставщиков»</b><br>' +
        'С ним видно, у кого дешевле, и сколько можно сэкономить.</div></div>';
    } else {
      if (!C.cmp) C.cmp = E.priceComparison(D.prices, C.contactsIdx);
      var q = ($('search') && $('search').value || '').trim();
      var rows = C.cmp;
      if (q) { var nq = E.norm(q); rows = rows.filter(function (r) { return r.key.indexOf(nq) >= 0; }); }
      var multi = C.cmp.filter(function (r) { return r.suppliers > 1; });
      h += '<div class="stat-grid">' +
        stat('Цен в базе', nf(D.prices.length), 'Поставщиков: ' + nf(Object.keys(C.bySupplier).length)) +
        stat('Есть выбор', nf(multi.length), 'Товаров с 2+ поставщиками') +
        stat('Можно сэкономить', priv(multi.reduce(function (a, r) { return a + r.spread; }, 0)), 'Если брать по лучшей цене') +
        stat('Телефонов', nf(D.contacts.filter(function (c) { return c.phone; }).length), 'Звонок прямо из таблицы') + '</div>';
      h += card('Сравнение цен' + (q ? ' — «' + esc(q) + '»' : ''), table('cmpT', [
        { title: 'Товар', fn: function (r) { return esc(r.name); } },
        { title: 'Дешевле всего', cls: 'num', fn: function (r) { return '<span class="c-green private">' + money(r.min) + '</span>'; } },
        { title: 'У кого', fn: function (r) { return esc(r.bestSupplier) + (r.bestPhone ? ' · <a class="phone" href="tel:' + esc(r.bestPhone) + '">' + esc(r.bestPhone) + '</a>' : ''); } },
        { title: 'Дороже всего', cls: 'num', fn: function (r) { return priv(r.max); } },
        { title: 'Разница', cls: 'num', fn: function (r) { return r.spread ? '<span class="c-green private">' + money(r.spread) + '</span>' : '—'; } },
        { title: 'Предложений', cls: 'center', fn: function (r) { return nf(r.suppliers); } }
      ], rows, { step: 40, empty: 'Ничего не найдено' }));
    }

    var kvi = (S.state.kvi || []).map(function (r) {
      var st = C.stockIdx ? C.stockIdx[E.norm(r.name)] : null;
      var cost = num(r.cost) || (st ? st.buyPrice : 0);
      var our = num(r.ourPrice) || (st ? st.retailPrice : 0);
      return { id: r.id, name: r.name, cost: cost, our: our, comp: num(r.competitorPrice),
        diff: num(r.competitorPrice) ? E.safeRound(our - num(r.competitorPrice)) : null };
    });
    if (kvi.length) {
      h += card('Товары-маркеры: наши цены против соседей', listOf(kvi.map(function (r) {
        return listRow({ icon: r.diff == null ? '⚪️' : (r.diff <= 0 ? '🟢' : '🔴'), title: esc(r.name),
          sub: 'себестоимость ' + money(r.cost) + ' · наша ' + money(r.our) + (r.comp ? ' · у соседей ' + money(r.comp) : ''),
          value: (r.diff == null ? '<span class="c-muted">нет цены соседей</span>'
            : '<span class="' + (r.diff <= 0 ? 'c-green' : 'c-red') + '">' + (r.diff > 0 ? 'дороже на ' : 'дешевле на ') + money(Math.abs(r.diff)) + '</span>') +
            '<small><button class="btn btn-sm btn-danger" data-del="kvi:' + r.id + '">✕</button></small>' });
      }), ''));
    }
    return h;
  }

  /* --- Поиск ------------------------------------------------------------------------ */
  function viewSearch() {
    var q = ($('search') && $('search').value || '').trim();
    var h = pageHead('Поиск', 'По товарам, поставщикам, штрихкодам и телефонам');
    if (!q) return h + '<div class="card"><div class="empty">Введите запрос в строке поиска сверху</div></div>';
    var res = E.search(q, D, 'all', 300);
    h += card('Найдено: ' + nf(res.length), listOf(res.slice(0, 120).map(function (r) {
      return listRow({ icon: '🔎', title: esc(r.name), sub: esc(r.type) + ' · ' + r.cols.filter(Boolean).join(' · ') });
    }), 'Ничего не нашлось'));
    return h;
  }

  /* --- Данные и файлы ---------------------------------------------------------------- */
  var KINDS = {
    sales: 'Продажи', stock: 'Остатки', prices: 'Цены поставщиков', contacts: 'Контакты',
    pricelist: 'Прайс-лист', barcodes: 'Штрихкоды', units: 'Единицы измерения',
    writeoffs1c: 'Причины списания', writeoffs: 'Списания', returns: 'Причины возврата',
    invoices1c: 'Приходные накладные', cashout: 'Расходные ордера', cashin: 'Приходные ордера',
    journal_shifts: 'Журнал смен', journal_staff: 'Табель', owner_book: 'Ваша книга ДДС', unknown: 'Не распознан'
  };
  function viewData() {
    var st = saveState();
    var h = pageHead('Данные и файлы', 'Где хранится ваша база и что загружено из 1С');

    h += '<div class="banner ' + (st.ok ? 'green' : '') + '">' +
      '<span>' + (st.ok ? '✅' : '⚠️') + '</span><div><b>' + esc(st.text) + '</b>' +
      (st.ok ? '<div class="card-note">Папка: ' + esc(F.dirName) + ' → ' + F.DATA_DIR + '/' + F.DATA_FILE +
        '. Копия базы сохраняется раз в день.</div>'
        : '<div class="card-note">Пока записи хранятся только внутри браузера. Подключите папку — и всё будет лежать файлом рядом с программой.</div>') +
      '</div>' + (st.ok ? '<button class="btn" data-act="folder-forget">Отключить</button>'
        : '<button class="btn btn-primary" data-act="' + (F.state === 'needs-permission' ? 'folder-reconnect' : 'folder-connect') + '">Подключить папку</button>') +
      '</div>';

    h += card('Загрузить выгрузки 1С', listOf([
      listRow({ icon: '📂', title: 'Прочитать папку с выгрузками', sub: 'Файлы .xls, .xlsx, .csv — имена любые',
        value: '<button class="btn btn-sm btn-primary" data-act="pick-folder">Выбрать папку</button>' }),
      listRow({ icon: '📄', title: 'Загрузить отдельные файлы', sub: 'Если нужно обновить один отчёт',
        value: '<button class="btn btn-sm" data-act="pick-files">Выбрать файлы</button>' }),
      F.state === 'ready' ? listRow({ icon: '🔄', title: 'Перечитать подключённую папку', sub: 'Берёт только изменившиеся файлы',
        value: '<button class="btn btn-sm" data-act="folder-sync">Обновить</button>' }) : ''
    ].filter(Boolean), ''));

    h += card('Загруженные файлы', table('filesT', [
      { title: 'Файл', fn: function (r) { return esc(r.name); } },
      { title: 'Что это', fn: function (r) { return esc(KINDS[r.kind] || r.kind); } },
      { title: 'Строк', cls: 'num', fn: function (r) { return nf(r.rows); } },
      { title: 'Период', fn: function (r) { return r.period ? esc(r.period.from + ' – ' + r.period.to) : '—'; } },
      { title: '', cls: 'center', fn: function (r) { return r.kind === 'unknown' ? badge('не понял', 'red') : badge('готово', 'green'); } }
    ], D.files, { step: 30, empty: 'Пока ничего не загружено' }));

    h += card('Сохранить и перенести', listOf([
      listRow({ icon: '📊', title: 'Выгрузить всё в Excel', sub: 'Смены, накладные, оплаты, зарплата, заказы',
        value: '<button class="btn btn-sm" data-act="export-excel">Скачать</button>' }),
      listRow({ icon: '💾', title: 'Сохранить копию базы', sub: 'Файл .json — положите на флешку',
        value: '<button class="btn btn-sm" data-act="backup">Скачать</button>' }),
      listRow({ icon: '📥', title: 'Загрузить базу из копии', sub: 'Заменит текущие записи',
        value: '<button class="btn btn-sm" data-act="restore">Выбрать файл</button>' }),
      listRow({ icon: '🖨', title: 'Распечатать текущий экран', sub: 'В окне печати выберите «Сохранить как PDF»',
        value: '<button class="btn btn-sm" data-act="print">Печать</button>' })
    ], ''));
    return h;
  }

  /* --- Настройки --------------------------------------------------------------------- */
  function viewSettings() {
    var s = S.settings;
    var h = pageHead('Настройки', 'Расходы магазина и правила расчёта');
    h += '<form id="setForm"><div class="form-list">' +
      fieldRow('Название магазина', 'storeName', 'text', s.storeName) +
      fieldRow('Зарплата в месяц', 'fot', 'number', s.fot) +
      fieldRow('Аренда в месяц', 'rent', 'number', s.rent) +
      fieldRow('Коммунальные', 'utilities', 'number', s.utilities) +
      fieldRow('Налоги', 'taxes', 'number', s.taxes) +
      fieldRow('Прочие постоянные', 'other', 'number', s.other) +
      fieldRow('Маржинальность вручную, %', 'marginManual', 'text', s.marginManual) +
      '</div><div class="form-hint">Постоянные расходы сейчас: ' + money(S.fixedMonthly()) + ' в месяц.</div>' +
      '<div class="form-list" style="margin-top:16px">' +
      fieldRow('Ставка день, ₽/час', 'rateDay', 'number', s.rateDay) +
      fieldRow('Ставка ночь, ₽/час', 'rateNight', 'number', s.rateNight) +
      fieldRow('Разменные деньги в кассе', 'openCash', 'number', s.openCash) +
      fieldRow('Доставка поставщика, дней', 'leadDays', 'number', s.leadDays) +
      fieldRow('Отсрочка оплаты поставщику, дней', 'graceDays', 'number', s.graceDays) +
      fieldRow('Страховой запас, %', 'safetyPct', 'number', s.safetyPct) +
      fieldRow('Срочная уценка при, дней', 'fefoCrit', 'number', s.fefoCrit) +
      fieldRow('Предупреждать за, дней', 'fefoWarn', 'number', s.fefoWarn) +
      fieldRow('Скидка срочная, %', 'discountCrit', 'number', s.discountCrit) +
      fieldRow('Скидка обычная, %', 'discountWarn', 'number', s.discountWarn) +
      '</div>' +
      '<div class="form-hint" style="margin-top:16px">Справочники финансового учёта — через запятую. ' +
      'Они подставляются в формах ввода.</div><div class="form-list">' +
      fieldRow('Статьи расходов', 'finCategories', 'text', s.finCategories) +
      fieldRow('Кассиры', 'finCashiers', 'text', s.finCashiers) +
      fieldRow('Смены', 'finShifts', 'text', s.finShifts) +
      fieldRow('Поставщики', 'finSuppliers', 'text', s.finSuppliers) +
      '</div><div class="form-list" style="margin-top:16px">' +
      fieldRow('Начальный остаток наличных', 'openCashStart', 'number', s.openCashStart) +
      fieldRow('Начальный остаток на карте', 'openCardStart', 'number', s.openCardStart) +
      fieldRow('Начальный остаток на счёте', 'openTransferStart', 'number', s.openTransferStart) +
      fieldRow('Долг: предупреждать от, ₽', 'debtWarn', 'number', s.debtWarn) +
      fieldRow('Долг: критично от, ₽', 'debtCrit', 'number', s.debtCrit) +
      fieldRow('Расхождение кассы: критично от, ₽', 'diffCrit', 'number', s.diffCrit) +
      '</div><div class="form-actions"><button type="submit" class="btn btn-primary btn-lg">Сохранить</button></div></form>';

    h += card('О программе', '<div class="card-body">Вай Маркет — учёт магазина 24/7. Работает без интернета: ' +
      'папку можно скопировать на флешку и открыть на любом компьютере.<br>' +
      'Записи хранятся в файле ' + F.DATA_DIR + '/' + F.DATA_FILE + ' внутри подключённой папки.</div>');
    return h;
  }

  /* --- Навигация ---------------------------------------------------------------- */
  var VIEWS = [
    { id: 'today', icon: '🏠', name: 'Сегодня', group: 'Главное', render: viewToday },
    { id: 'suppliers', icon: '🤝', name: 'Поставщики', group: 'Деньги', render: viewSuppliers },
    { id: 'cash', icon: '💵', name: 'Касса и смены', group: 'Деньги', render: viewCash },
    { id: 'dds', icon: '🧾', name: 'Расходы', group: 'Деньги', render: viewDds },
    { id: 'staff', icon: '👥', name: 'Зарплата', group: 'Деньги', render: viewStaff },
    { id: 'stock', icon: '📦', name: 'Склад', group: 'Товары', render: viewStock },
    { id: 'orders', icon: '🚚', name: 'Заказы', group: 'Товары', render: viewOrders },
    { id: 'expiry', icon: '⏰', name: 'Сроки годности', group: 'Товары', render: viewExpiry },
    { id: 'losses', icon: '🗑', name: 'Списания', group: 'Товары', render: viewLosses },
    { id: 'pnl', icon: '📈', name: 'Прибыль', group: 'Отчёты', render: viewPnl },
    { id: 'bep', icon: '⚖️', name: 'Безубыточность', group: 'Отчёты', render: viewBep },
    { id: 'abc', icon: '🏆', name: 'ABC-анализ', group: 'Отчёты', render: viewAbc },
    { id: 'pricecmp', icon: '🏷', name: 'Цены поставщиков', group: 'Отчёты', render: viewPriceCmp },
    { id: 'search', icon: '🔍', name: 'Поиск', group: 'Ещё', render: viewSearch },
    { id: 'data', icon: '🗂', name: 'Данные и файлы', group: 'Ещё', render: viewData },
    { id: 'settings', icon: '⚙️', name: 'Настройки', group: 'Ещё', render: viewSettings }
  ];

  // Экраны финансового учёта встают рядом со своими разделами
  if (window.WM_EXTRA_VIEWS) {
    window.WM_EXTRA_VIEWS.forEach(function (v) {
      var idx = VIEWS.length;
      if (v.after) {
        for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i].id === v.after) { idx = i + 1; break; }
      } else {
        for (var j = VIEWS.length - 1; j >= 0; j--) if (VIEWS[j].group === v.group) { idx = j + 1; break; }
      }
      VIEWS.splice(idx, 0, v);
    });
  }

  function counters() {
    var c = {}, t = today();
    var docs = dueDocs();
    var over = docs.filter(function (d) { return d.due && d.due <= t; }).length;
    if (over) c.suppliers = over > 99 ? '99+' : over;
    var exp = (S.state.expiry || []).filter(function (r) {
      var f = E.fefoStatus(r.bestBefore, S.settings);
      return f.level === 'crit' || f.level === 'expired';
    }).length;
    if (exp) c.expiry = exp;
    if (D.sales.length && D.stock.length) {
      if (C.ropCount == null) C.ropCount = E.ropList(D.sales, D.stock, D.salesPeriod ? D.salesPeriod.days : 30, S.settings, C.bestPrices).length;
      if (C.ropCount) c.orders = C.ropCount > 99 ? '99+' : C.ropCount;
    }
    var sh = E.shiftsTotals(jrn('shifts'));
    if (sh.count && sh.diff !== 0) c.cash = '!';
    if (window.WMFin && (S.state.plans || []).length) {
      var pt = window.WMFin.planTotals(S.state.plans, t);
      if (pt.overdueCount) c.finpay = pt.overdueCount > 99 ? '99+' : pt.overdueCount;
    }
    if (C.sup) {
      if (C.sup.newNames.length) c.match = C.sup.newNames.length > 99 ? '99+' : C.sup.newNames.length;
      if (C.sup.recon.length) c.recon = C.sup.recon.length > 99 ? '99+' : C.sup.recon.length;
      if (C.sup.confirm.length) c.confirm = C.sup.confirm.length > 99 ? '99+' : C.sup.confirm.length;
      if (C.sup.debtors.list.length) c.debtors = C.sup.debtors.list.length > 99 ? '99+' : C.sup.debtors.list.length;
    }
    return c;
  }

  function renderNav() {
    var c = counters(), group = '', html = '';
    VIEWS.forEach(function (v) {
      if (v.group !== group) { group = v.group; html += '<div class="nav-group">' + esc(group) + '</div>'; }
      html += '<div class="nav-item' + (v.id === VIEW ? ' active' : '') + '" data-go="' + v.id + '">' +
        '<span class="nav-icon">' + v.icon + '</span><span>' + esc(v.name) + '</span>' +
        (c[v.id] ? '<span class="nav-count">' + c[v.id] + '</span>' : '') + '</div>';
    });
    $('nav').innerHTML = html;
    $('brandName').textContent = S.settings.storeName || 'Вай Маркет';
    var st = saveState();
    $('saveState').innerHTML = '<span class="saved-dot ' + st.dot + '"></span><span>' + esc(st.text) + '</span>';
  }

  function renderPeriods() {
    var html = PERIODS.map(function (p) {
      return '<button class="' + (p.id === PERIOD ? 'active' : '') + '" data-period="' + p.id + '">' + esc(p.name) + '</button>';
    }).join('');
    $('periods').innerHTML = html;
  }

  function render() {
    var v = VIEWS.filter(function (x) { return x.id === VIEW; })[0] || VIEWS[0];
    C.ropCount = null; C.cmp = C.cmp || null;
    var html;
    try { html = v.render(); }
    catch (e) { html = pageHead('Ошибка', e.message) + '<div class="card"><div class="empty">Что-то пошло не так на этом экране.<br>' + esc(e.message) + '</div></div>'; }
    $('page').innerHTML = html;
    renderNav(); renderPeriods();
    if (VIEW === 'today') drawChart();
    var cur = VIEWS.filter(function (x) { return x.id === VIEW; })[0];
    if (cur && cur.onDraw) { try { cur.onDraw(); } catch (e) { /* график не критичен */ } }
  }
  function go(id) { VIEW = id; PAGE = {}; render(); $('scroll').scrollTop = 0; }

  /* --- Экспорт и копии ------------------------------------------------------------- */
  function exportExcel() {
    var wb = XLSX.utils.book_new();
    function add(name, rows) { if (rows && rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31)); }
    var debt = debtNow(), man = manual(), sh = E.shiftsTotals(jrn('shifts'));
    add('Сводка', [
      { Показатель: 'Магазин', Значение: S.settings.storeName },
      { Показатель: 'Отчёт составлен', Значение: new Date().toLocaleString('ru-RU') },
      { Показатель: 'Период', Значение: periodName() },
      { Показатель: 'Долг поставщикам', Значение: debt.value },
      { Показатель: 'Куплено товара', Значение: man.totals.supplies },
      { Показатель: 'Оплачено поставщикам', Значение: man.totals.paid },
      { Показатель: 'Наличные в кассе', Значение: sh.factCash },
      { Показатель: 'Расхождение кассы', Значение: sh.diff },
      { Показатель: 'Выручка 1С', Значение: C.sales ? C.sales.revenue : 0 },
      { Показатель: 'Валовая прибыль', Значение: C.sales ? C.sales.gross : 0 }
    ]);
    add('Накладные', man.docs);
    add('Оплаты поставщикам', man.payments);
    add('Долг по поставщикам', man.balance);
    add('Смены', jrn('shifts').map(function (s) {
      var c = E.shiftCalc(s);
      return { Дата: s.date, Смена: s.shift, Кассир: s.cashier, 'Утро': num(s.openCash), 'Z-отчёт': num(s.zCash),
        'Выдано': num(s.payouts), 'Должно быть': c.expected, 'В ящике': num(s.factCash), 'Карта': num(s.terminal),
        'Разница': c.diff, Статус: c.statusText };
    }));
    add('Расходы', jrn('expenses'));
    add('Табель', jrn('timesheet'));
    add('Выплаты', jrn('payouts'));
    add('Зарплата свод', E.payrollSummary(jrn('timesheet'), jrn('payouts')));
    add('Сроки годности', (S.state.expiry || []).map(function (r) {
      var f = E.fefoStatus(r.bestBefore, S.settings);
      return { Товар: r.name, Остаток: num(r.qty), Цена: num(r.price), 'Годен до': r.bestBefore, 'Дней': f.days, 'Скидка %': f.discount };
    }));
    add('Пересчёты', S.state.inventory || []);
    if (C.payments1c) { add('Накладные 1С', C.payments1c.docs); add('Долг 1С', C.balance1c); }
    if (D.owner) add('Книга ДДС', D.owner.daily);
    if ((S.state.dds || []).length) {
      add('БАЗА_ДДС', S.state.dds.map(function (r) {
        return { Дата: r.date, Смена: r.shift, Кассир: r.cashier, Тип: r.type, Категория: r.category,
          'Способ оплаты': r.method, Сумма: num(r.amount), Расхождение: num(r.diff), Комментарий: r.note };
      }));
    }
    if ((S.state.plans || []).length) {
      add('Запись_Выплат', S.state.plans.map(function (p) {
        return { 'Дата плановой оплаты': p.due, 'Поставщик (ТП)': p.supplier, Сумма: num(p.amount),
          Статус: p.status, Накладная: p.doc, 'Способ оплаты': p.method, 'Дата фактической оплаты': p.paidAt,
          Примечание: p.note };
      }));
    }
    if (D.sales.length && D.stock.length) {
      add('Заказать', E.ropList(D.sales, D.stock, D.salesPeriod ? D.salesPeriod.days : 30, S.settings, C.bestPrices).slice(0, 300));
    }
    XLSX.writeFile(wb, 'WayMarket_' + today() + '.xlsx');
    toast('Файл Excel сохранён.');
  }

  function backup() {
    var blob = new Blob([S.exportJSON()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'WayMarket_baza_' + today() + '.json'; a.click();
    toast('Копия базы сохранена.');
  }
  function restore() {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try { S.importJSON(fr.result); render(); toast('База загружена из копии.'); }
        catch (e) { toast('Не получилось прочитать файл: ' + e.message); }
      };
      fr.readAsText(f);
    };
    inp.click();
  }

  function printLabels() {
    var rows = (S.state.expiry || []).map(function (r) {
      var f = E.fefoStatus(r.bestBefore, S.settings);
      return { name: r.name, price: num(r.price), disc: f.discount, now: E.safeRound(num(r.price) * (100 - f.discount) / 100), days: f.days };
    }).filter(function (r) { return r.disc > 0; });
    if (!rows.length) { toast('Нет товаров со скидкой — печатать нечего.'); return; }
    var w = window.open('', '_blank');
    if (!w) { toast('Браузер заблокировал окно печати. Разрешите всплывающие окна.'); return; }
    w.document.write('<html><head><meta charset="utf-8"><title>Ценники</title><style>' +
      'body{font-family:-apple-system,Segoe UI,Arial;margin:8mm;display:flex;flex-wrap:wrap;gap:5mm}' +
      '.l{background:#FFE600;border-radius:4mm;padding:6mm;width:76mm;height:48mm;display:flex;flex-direction:column;justify-content:space-between}' +
      '.n{font-size:12pt;font-weight:700;line-height:1.15}.o{font-size:11pt;text-decoration:line-through;color:#666}' +
      '.p{font-size:28pt;font-weight:800}.d{font-size:12pt;font-weight:700}</style></head><body>' +
      rows.map(function (r) {
        return '<div class="l"><div class="n">' + esc(r.name) + '</div><div><div class="o">' + money(r.price) +
          '</div><div class="p">' + money(r.now) + '</div></div><div class="d">СКИДКА −' + r.disc + '%</div></div>';
      }).join('') + '</body></html>');
    w.document.close();
    setTimeout(function () { w.print(); }, 300);
  }

  /* --- Обработчики ------------------------------------------------------------------ */
  function bind() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-go],[data-period],[data-act],[data-form],[data-tab],[data-del],[data-edit]');
      if (!el) return;
      if (el.dataset.go) { closeSheet(); go(el.dataset.go); return; }
      if (el.dataset.period) { PERIOD = el.dataset.period; PAGE = {}; render(); return; }
      if (el.dataset.tab) { var p = el.dataset.tab.split(':'); TAB[p[0]] = p[1]; render(); return; }
      if (el.dataset.edit) {
        var parts = el.dataset.edit.split(':');      // коллекция : id : форма
        var rec = (S.state[parts[0]] || []).filter(function (x) { return x.id === parts[1]; })[0];
        if (rec) {
          var pre = JSON.parse(JSON.stringify(rec));
          if (parts[0] === 'dds') pre.debt = rec.type === 'Долг' ? 'да' : 'нет';
          openForm(parts[2], pre, { coll: parts[0], id: parts[1] });
        }
        return;
      }
      if (el.dataset.form) {
        var pre = {};
        if (el.dataset.supplier) pre.supplier = el.dataset.supplier;
        if (el.dataset.employee) pre.employee = el.dataset.employee;
        openForm(el.dataset.form, pre);
        return;
      }
      if (el.dataset.del) {
        var d = el.dataset.del.split(':');
        if (confirm('Удалить запись?')) { S.remove(d[0], d[1]); render(); }
        return;
      }
      var a = el.dataset.act;
      if (a === 'close-sheet') closeSheet();
      else if (a === 'pick-files' || a === 'backup') { closeSheet(); if (a === 'backup') backup(); else $('filesInput').click(); }
      else if (a === 'more') { PAGE[el.dataset.id] = (PAGE[el.dataset.id] || +el.dataset.step) + (+el.dataset.step) * 3; render(); }
      else if (a === 'pick-folder') $('folderInput').click();
      else if (a === 'folder-connect') connectFolder();
      else if (a === 'folder-reconnect') reconnectFolder();
      else if (a === 'folder-sync') syncFolder(false);
      else if (a === 'folder-forget') { if (confirm('Отключить папку? Записи останутся в браузере и в уже сохранённом файле.')) { F.forget(); render(); } }
      else if (a === 'export-excel') exportExcel();
      else if (a === 'restore') restore();
      else if (a === 'print') window.print();
      else if (a === 'del-shift') {
        if (confirm('Удалить смену целиком?')) {
          el.dataset.ids.split(',').forEach(function (id) { S.remove('dds', id); });
          render();
        }
      }
      else if (a === 'print-labels') printLabels();
      else if (window.WM_EXTRA_ACTIONS && window.WM_EXTRA_ACTIONS[a]) {
        var msg = window.WM_EXTRA_ACTIONS[a](el);
        render();
        if (msg) toast(msg);
      }
      else if (a === 'owner-to-settings') {
        var t = E.ownerTotals(ownerRows().rows);
        if (!t.dayCount) { toast('В книге нет заполненных дней.'); return; }
        var k = 30 / t.dayCount;
        S.setSetting('fot', Math.round(t.salary * k)); S.setSetting('rent', Math.round(t.rent * k));
        S.setSetting('utilities', Math.round(t.utilities * k)); S.setSetting('taxes', Math.round(t.tax * k));
        S.setSetting('other', Math.round((t.lunch + t.fuel + t.supplies + t.bankFee) * k));
        render();
        toast('Расходы перенесены в настройки: ' + money(S.fixedMonthly()) + ' в месяц.');
      }
    });

    document.addEventListener('submit', function (e) {
      var f = e.target;
      e.preventDefault();
      if (f.id === 'wmForm') {
        var id = f.dataset.fid, def = FORMS[id];
        var res = def.save(formValues(f));
        if (typeof res === 'string') { toast(res); return; }
        // при правке новая запись уже добавлена — убираем старую
        if (EDIT) { S.remove(EDIT.coll, EDIT.id); EDIT = null; }
        closeSheet(); render(); toast(res.ok);
      } else if (f.id === 'setForm') {
        var v = formValues(f);
        Object.keys(v).forEach(function (k) { S.setSetting(k, v[k]); });
        render(); toast('Настройки сохранены. Постоянные расходы: ' + money(S.fixedMonthly()) + ' в месяц.');
      }
    });

    document.addEventListener('change', function (e) {
      if (window.WM_EXTRA_CHANGE && window.WM_EXTRA_CHANGE(e.target)) { render(); }
    });

    var timer = null;
    $('search').addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var q = $('search').value.trim();
        if (['stock', 'pricecmp', 'search', 'finbase'].indexOf(VIEW) >= 0) { PAGE = {}; render(); }
        else if (q.length >= 2) go('search');
      }, 280);
    });
    $('menuBtn').addEventListener('click', function () {
      var group = '', rows = [];
      VIEWS.forEach(function (v) {
        if (v.group !== group) { group = v.group; rows.push('<div class="nav-group">' + esc(group) + '</div>'); }
        rows.push(listRow({ icon: v.icon, title: esc(v.name), tap: true, attrs: ' data-go="' + v.id + '"' }));
      });
      var actions = [
        listRow({ icon: '📂', title: 'Обновить из 1С', sub: 'прочитать папку с выгрузками', tap: true, attrs: ' data-act="pick-files"' }),
        listRow({ icon: '💾', title: 'Сохранить копию базы', sub: 'файл .json', tap: true, attrs: ' data-act="backup"' })
      ];
      sheet('Экраны', '<div class="list">' + rows.join('') + '</div>' +
        '<div class="nav-group">Действия</div><div class="list">' + actions.join('') + '</div>');
    });
    $('addBtn').addEventListener('click', function () {
      sheet('Что записать?', listOf([
        listRow({ icon: '💵', title: 'Касса за смену', sub: 'Z-отчёт и фактические деньги', tap: true, attrs: ' data-form="cashShift"' }),
        listRow({ icon: '🧾', title: 'Расход', sub: 'закуп, аренда, ЗП, прочее', tap: true, attrs: ' data-form="ddsExpense"' }),
        listRow({ icon: '💰', title: 'Приход денег', sub: 'прочие поступления', tap: true, attrs: ' data-form="ddsIncome"' }),
        listRow({ icon: '📅', title: 'Выплата поставщику', sub: 'план платежа и оплата', tap: true, attrs: ' data-form="payPlan"' }),
        listRow({ icon: '📥', title: 'Приход товара', sub: 'накладная от поставщика', tap: true, attrs: ' data-form="invoice"' }),
        listRow({ icon: '💸', title: 'Оплата поставщику', sub: 'наличными или переводом', tap: true, attrs: ' data-form="payment"' }),
        listRow({ icon: '🗑', title: 'Списание товара', sub: 'просрочка, бой, потери', tap: true, attrs: ' data-form="writeoff"' }),
        listRow({ icon: '⏰', title: 'Товар с коротким сроком', sub: 'чтобы вовремя уценить', tap: true, attrs: ' data-form="expiryItem"' }),
        listRow({ icon: '👤', title: 'Смена сотрудника', sub: 'часы и ставка', tap: true, attrs: ' data-form="timesheet"' }),
        listRow({ icon: '💰', title: 'Выплата сотруднику', sub: 'аванс или зарплата', tap: true, attrs: ' data-form="payout"' })
      ], ''));
    });
    $('syncBtn').addEventListener('click', function () {
      if (F.state === 'ready') syncFolder(false);
      else if (F.state === 'needs-permission') reconnectFolder();
      else $('folderInput').click();
    });
    $('privacyBtn').addEventListener('click', function () {
      var on = document.body.classList.toggle('priv');
      try { localStorage.setItem('wm_priv', on ? '1' : '0'); } catch (e) {}
      $('privacyBtn').textContent = on ? '🙈' : '👁';
    });
    $('filesInput').addEventListener('change', function (e) { loadFiles(e.target.files); e.target.value = ''; });
    $('folderInput').addEventListener('change', function (e) { loadFiles(e.target.files); e.target.value = ''; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  }

  // Разовый перенос: смены и расходы, записанные раньше, переезжают
  // в единую базу операций, чтобы всё лежало в одном месте.
  function migrateToLedger() {
    if (S.state.migratedLedger) return 0;
    var moved = 0;
    (S.state.shifts || []).forEach(function (sh) {
      var c = E.shiftCalc(sh);
      if (num(sh.zCash)) {
        S.add('dds', { date: sh.date, shift: sh.shift, cashier: sh.cashier, type: 'Приход',
          category: 'Продажи', method: 'Наличные', amount: num(sh.zCash), diff: c.diff,
          note: sh.note || '', src: 'перенос' });
        moved++;
      }
      if (num(sh.terminal)) {
        S.add('dds', { date: sh.date, shift: sh.shift, cashier: sh.cashier, type: 'Приход',
          category: 'Продажи', method: 'Карта', amount: num(sh.terminal), diff: 0, note: '', src: 'перенос' });
        moved++;
      }
      if (num(sh.payouts)) {
        S.add('dds', { date: sh.date, shift: sh.shift, cashier: sh.cashier, type: 'Расход',
          category: 'Выплата из кассы', method: 'Наличные', amount: num(sh.payouts), diff: 0,
          note: '', src: 'перенос' });
        moved++;
      }
    });
    var methodOf = function (form) {
      var f = E.norm(form);
      if (f.indexOf('перевод') >= 0) return 'Перевод';
      if (f.indexOf('карт') >= 0) return 'Карта';
      return 'Наличные';
    };
    (S.state.expenses || []).forEach(function (e) {
      S.add('dds', { date: e.date, shift: '', cashier: '', type: 'Расход',
        category: e.category || 'Другое', method: methodOf(e.form), amount: num(e.amount),
        diff: 0, note: e.note || '', src: 'перенос' });
      moved++;
    });
    S.state.migratedLedger = true;
    S.save();
    return moved;
  }

  /* --- Запуск -------------------------------------------------------------------------- */
  async function init() {
    if (typeof XLSX === 'undefined' || typeof S === 'undefined') {
      document.getElementById('page').innerHTML =
        '<div class="card"><div class="empty"><b>Папка скопирована не полностью</b><br>' +
        'Рядом с файлом «Дашборд_ВайМаркет.html» должны лежать папки js и vendor и файл styles.css.</div></div>';
      return;
    }
    try { if (localStorage.getItem('wm_priv') === '1') { document.body.classList.add('priv'); $('privacyBtn').textContent = '🙈'; } } catch (e) {}

    var moved = migrateToLedger();
    recompute(); bind(); render();
    if (moved) toast('Прежние записи о кассе и расходах перенесены в базу операций: ' + moved + '.', 7000);

    // сохранение в файл: подписываемся на любые изменения журналов
    S.onChange(function () { F.scheduleSave(function () { return S.state; }); });
    F.onChange(function () { renderNav(); });

    var st = await F.restore();
    if (st === 'ready') {
      var saved = await F.loadSaved();
      if (saved) S.replaceAll(saved);
      await syncFolder(true);
      recompute(); render();
    } else if (st === 'off' && F.supported()) {
      // первый запуск: подскажем один раз, но не мешаем работать
      setTimeout(function () {
        if (F.state === 'off') toast('Совет: подключите папку на экране «Данные и файлы» — тогда все записи будут сохраняться в файл рядом с программой.', 9000);
      }, 1500);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
