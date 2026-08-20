/* ============================================================================
   ВАЙ МАРКЕТ — ERP 24/7. Интерфейс: экраны, формы, экспорт, поиск, советник.
   Все расчёты берутся из js/engine.js, журналы — из js/store.js.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.WM;          // движок расчётов
  var S = window.WMStore;     // журналы и настройки
  S.load();

  /* --- Данные из выгрузок 1С (в памяти, не в браузерном хранилище) -------- */
  var DATA = {
    sales: [], salesPeriod: null,
    stock: [], prices: [], contacts: [], pricelist: [], barcodes: [], units: [],
    writeoffs: [], writeoffsPeriod: null,
    returns: [], returnsPeriod: null,
    invoices1c: [], invoicesPeriod: null,
    owner: null,               // ручная книга владельца (ДДС / ОПЛАТА / ПЛАТЕЖКА / ОТЧЁТ)
    cashOrders: [], cashPeriod: null,
    files: []                  // {name, kind, rows, size, time, period}
  };
  var CACHE = {};              // производные расчёты, пересчитываются после загрузки
  var VIEW = 'exec';
  var PERIOD = 'month';        // today | yesterday | month | quarter | all
  var PAGE = {};               // сколько строк показано в каждой таблице
  var CHARTS = {};

  /* --- Мелкие помощники --------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(id) { return document.getElementById(id); }
  function money(x) { return E.fmtMoney(x); }
  function moneyP(x) { return '<span class="private-data">' + E.fmtMoney(x) + '</span>'; }
  function nf(x, d) { return E.fmtNum(x, d); }
  function pct(x, d) { return E.fmtPct(x, d); }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function num(x) { return E.num(x); }

  function signClass(x) { return x > 0 ? 'trend-pos' : (x < 0 ? 'trend-neg' : 'muted'); }
  function badge(text, kind) { return '<span class="badge badge-' + kind + '">' + esc(text) + '</span>'; }

  function toast(text, ms) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.remove(); }, ms || 5200);
  }

  function overlay(html) {
    closeOverlay();
    var d = document.createElement('div');
    d.className = 'overlay';
    d.innerHTML = '<div class="overlay-box">' + html + '</div>';
    d.addEventListener('click', function (e) { if (e.target === d) closeOverlay(); });
    document.body.appendChild(d);
    return d;
  }
  function closeOverlay() {
    var o = document.querySelector('.overlay');
    if (o) o.remove();
  }

  /* --- Период (фильтр журналов) ------------------------------------------ */
  var PERIODS = [
    { id: 'today', name: 'Сегодня' },
    { id: 'yesterday', name: 'Вчера' },
    { id: 'month', name: 'Месяц' },
    { id: 'quarter', name: 'Квартал' },
    { id: 'all', name: 'Всё время' }
  ];

  function periodRange() {
    var now = new Date(todayISO());
    var from, to;
    if (PERIOD === 'today') { from = to = todayISO(); }
    else if (PERIOD === 'yesterday') {
      var y = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
      from = to = y;
    } else if (PERIOD === 'month') {
      from = todayISO().slice(0, 8) + '01';
      to = todayISO();
    } else if (PERIOD === 'quarter') {
      var m = now.getMonth(), qStart = Math.floor(m / 3) * 3;
      from = new Date(Date.UTC(now.getFullYear(), qStart, 1)).toISOString().slice(0, 10);
      to = todayISO();
    } else { from = '0000-01-01'; to = '9999-12-31'; }
    return { from: from, to: to };
  }
  function periodName() {
    for (var i = 0; i < PERIODS.length; i++) if (PERIODS[i].id === PERIOD) return PERIODS[i].name;
    return '';
  }
  function inPeriod(dateISO) {
    if (!dateISO) return PERIOD === 'all';
    var r = periodRange();
    var d = String(dateISO).slice(0, 10);
    return d >= r.from && d <= r.to;
  }
  function filtered(coll) {
    var rows = S.state[coll] || [];
    if (PERIOD === 'all') return rows.slice();
    return rows.filter(function (r) { return inPeriod(r.date); });
  }
  // Сколько дней в выбранном периоде — нужно для приведения расходов к периоду
  function periodDays() {
    if (PERIOD === 'today' || PERIOD === 'yesterday') return 1;
    var r = periodRange();
    if (PERIOD === 'all') {
      var rows = (S.state.shifts || []).concat(S.state.invoices || []);
      if (!rows.length) return 30;
      var min = '9999', max = '0000';
      rows.forEach(function (x) { if (x.date) { if (x.date < min) min = x.date; if (x.date > max) max = x.date; } });
      if (min === '9999') return 30;
      return Math.max(1, Math.round((new Date(max) - new Date(min)) / 86400000) + 1);
    }
    return Math.max(1, Math.round((new Date(r.to) - new Date(r.from)) / 86400000) + 1);
  }

  /* --- Таблицы ------------------------------------------------------------ */
  // cols: [{title, key|fn, cls, width}]  rows: массив объектов
  function table(id, cols, rows, opts) {
    opts = opts || {};
    var step = opts.step || 150;
    var limit = PAGE[id] || step;
    var shown = rows.slice(0, limit);
    var h = '<div class="tbl-wrap"><table class="data-tbl"><thead><tr>';
    cols.forEach(function (c) { h += '<th class="' + (c.cls || '') + '">' + esc(c.title) + '</th>'; });
    h += '</tr></thead><tbody>';
    if (!rows.length) {
      h += '<tr><td colspan="' + cols.length + '" class="empty-state">' + (opts.empty || 'Нет данных') + '</td></tr>';
    }
    shown.forEach(function (r, i) {
      h += '<tr>';
      cols.forEach(function (c) {
        var v = c.fn ? c.fn(r, i) : r[c.key];
        h += '<td class="' + (c.cls || '') + '">' + (c.raw === false ? esc(v) : (v == null ? '' : v)) + '</td>';
      });
      h += '</tr>';
    });
    if (opts.totalRow) {
      h += '<tr class="total-row">';
      opts.totalRow.forEach(function (cell) {
        h += '<td class="' + (cell.cls || '') + '"' + (cell.span ? ' colspan="' + cell.span + '"' : '') + '>' + (cell.html || '') + '</td>';
      });
      h += '</tr>';
    }
    if (rows.length > limit) {
      h += '<tr class="more-row"><td colspan="' + cols.length + '">Показано ' + limit + ' из ' +
        nf(rows.length) + '. <button class="btn-tool btn-mini" data-action="more" data-id="' + esc(id) +
        '" data-step="' + step + '">Показать ещё ' + step + '</button></td></tr>';
    }
    h += '</tbody></table></div>';
    return h;
  }

  function panel(title, bodyHtml, actionsHtml) {
    return '<div class="panel"><div class="panel-hdr"><span>' + title + '</span>' +
      (actionsHtml ? '<span class="no-print">' + actionsHtml + '</span>' : '') + '</div>' + bodyHtml + '</div>';
  }

  function kpi(title, value, sub, color) {
    return '<div class="kpi-card"><div class="kpi-title">' + esc(title) + '</div>' +
      '<div class="kpi-val private-data"' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</div>' +
      '<div class="kpi-sub">' + (sub || '') + '</div></div>';
  }

  function field(label, name, type, value, opts) {
    opts = opts || {};
    var h = '<div class="field"><label>' + esc(label) + '</label>';
    if (type === 'select') {
      h += '<select name="' + name + '"' + (opts.attrs || '') + '>';
      (opts.options || []).forEach(function (o) {
        var val = typeof o === 'string' ? o : o.value, txt = typeof o === 'string' ? o : o.text;
        h += '<option value="' + esc(val) + '"' + (String(value) === String(val) ? ' selected' : '') + '>' + esc(txt) + '</option>';
      });
      h += '</select>';
    } else {
      h += '<input type="' + type + '" name="' + name + '" value="' + esc(value == null ? '' : value) + '"' +
        (opts.step ? ' step="' + opts.step + '"' : '') + (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
        (opts.attrs || '') + '>';
    }
    return h + '</div>';
  }

  function formValues(formEl) {
    var out = {};
    Array.prototype.forEach.call(formEl.querySelectorAll('input,select,textarea'), function (i) {
      if (!i.name) return;
      out[i.name] = i.type === 'number' ? num(i.value) : i.value.trim();
    });
    return out;
  }

  /* --- Загрузка выгрузок 1С ---------------------------------------------- */
  function readMatrix(buffer) {
    var wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    return {
      wb: wb,
      names: wb.SheetNames,
      matrix: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
    };
  }
  function sheetMatrix(wb, name) {
    if (!wb.Sheets[name]) return null;
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
  }

  function progress(title, total) {
    var o = overlay('<div class="overlay-title">' + esc(title) + '</div>' +
      '<div id="progText" style="font-size:12px;color:var(--text-muted)">Подготовка…</div>' +
      '<div class="progress-bar"><div class="progress-fill" id="progFill"></div></div>');
    return {
      step: function (i, name) {
        var t = $('progText'), f = $('progFill');
        if (t) t.textContent = 'Читаю (' + i + ' из ' + total + '): ' + name;
        if (f) f.style.width = Math.round(i / total * 100) + '%';
      },
      done: function () { closeOverlay(); },
      box: o
    };
  }

  // Разбирает один файл и раскладывает данные по модулям
  function ingest(fileName, buffer, size, mtime) {
    var m = readMatrix(buffer);
    var kind = E.detectKind(fileName, m.matrix, m.names);
    var info = { name: fileName, kind: kind, rows: 0, size: size || 0, time: mtime || Date.now(), period: null, note: '' };

    if (kind === 'sales') {
      var s = E.parseSales(m.matrix);
      DATA.sales = s.rows; DATA.salesPeriod = s.period;
      info.rows = s.rows.length; info.period = s.period;
    } else if (kind === 'stock') {
      var st = E.parseStock(m.matrix);
      DATA.stock = st.rows; info.rows = st.rows.length;
    } else if (kind === 'prices') {
      var p = E.parsePrices(m.matrix);
      DATA.prices = p.rows; info.rows = p.rows.length;
    } else if (kind === 'contacts') {
      var c = E.parseContacts(m.matrix);
      DATA.contacts = c.rows; info.rows = c.rows.length;
    } else if (kind === 'pricelist') {
      var pl = E.parsePricelist(m.matrix);
      DATA.pricelist = pl.rows; info.rows = pl.rows.length;
    } else if (kind === 'barcodes') {
      var b = E.parseBarcodes(m.matrix);
      DATA.barcodes = b.rows; info.rows = b.rows.length;
    } else if (kind === 'units') {
      var u = E.parseUnits(m.matrix);
      DATA.units = u.rows; info.rows = u.rows.length;
    } else if (kind === 'writeoffs1c') {
      var w = E.parseWriteoffs1C(m.matrix);
      DATA.writeoffs = w.rows; DATA.writeoffsPeriod = w.period;
      info.rows = w.rows.length; info.period = w.period;
    } else if (kind === 'returns') {
      var rt = E.parseReturns(m.matrix);
      DATA.returns = rt.rows; DATA.returnsPeriod = rt.period;
      info.rows = rt.rows.length; info.period = rt.period;
    } else if (kind === 'writeoffs') {
      var w2 = E.parseWriteoffs(m.matrix);
      DATA.writeoffs = w2.rows.map(function (r) {
        return { id: r.id, name: r.name, reason: r.reason || 'Без причины', qty: r.qty, cost: r.sum, retail: 0, key: E.norm(r.name) };
      });
      info.rows = w2.rows.length;
    } else if (kind === 'invoices1c') {
      var inv1 = E.parseIncomingInvoices(m.matrix);
      DATA.invoices1c = inv1.rows; DATA.invoicesPeriod = inv1.period;
      info.rows = inv1.rows.length; info.period = inv1.period;
    } else if (kind === 'cashout' || kind === 'cashin') {
      var co = E.parseCashOrders(m.matrix, kind === 'cashin' ? 'in' : 'out');
      if (kind === 'cashout') { DATA.cashOrders = co.rows; DATA.cashPeriod = co.period; }
      else { DATA.cashIn = co.rows; }
      info.rows = co.rows.length; info.period = co.period;
    } else if (kind === 'owner_book') {
      var book = { daily: [], payments: [], payroll: [], monthly: [], openingDebt: 0, file: fileName };
      m.names.forEach(function (sn) {
        var mat = sheetMatrix(m.wb, sn);
        if (!mat) return;
        var key = E.norm(sn);
        if (key === 'ддс') {
          var od = E.parseOwnerDaily(mat);
          book.daily = od.rows; book.openingDebt = od.openingDebt;
        } else if (key === 'оплата') {
          book.payments = E.parseOwnerPayments(mat).rows;
        } else if (key.indexOf('платежка') >= 0) {
          book.payroll = E.parseOwnerPayroll(mat).rows;
        } else if (key.indexOf('отч') >= 0) {
          book.monthly.push({ sheet: sn, rows: E.parseOwnerMonthly(mat).rows });
        }
      });
      DATA.owner = book;
      info.rows = book.daily.length;
      info.note = 'смен ' + book.daily.length + ', оплат ' + book.payments.length +
        (book.payroll.length ? ', сотрудников ' + book.payroll.length : '');
    } else if (kind === 'journal_shifts') {
      var sh = sheetMatrix(m.wb, 'Журнал_Смен_24_7');
      var inv = sheetMatrix(m.wb, 'Накладные_и_Выплаты');
      var n = 0;
      if (sh) { n += S.addMany('shifts', E.parseShiftJournalSheet(sh), true); }
      if (inv) { S.addMany('invoices', E.parseInvoiceSheet(inv), true); }
      info.rows = n; info.note = 'журнал смен и накладных загружен в базу дашборда';
    } else if (kind === 'journal_staff') {
      var ts = sheetMatrix(m.wb, 'Табель_Смен_24_7');
      var po = sheetMatrix(m.wb, 'Выплаты_и_Авансы');
      var n2 = 0;
      if (ts) { n2 += S.addMany('timesheet', E.parseTimesheetSheet(ts), true); }
      if (po) { S.addMany('payouts', E.parsePayoutSheet(po), true); }
      info.rows = n2; info.note = 'табель и выплаты загружены в базу дашборда';
    } else {
      info.note = 'формат не распознан — файл пропущен';
    }

    // один файл = одна запись в списке источников
    DATA.files = DATA.files.filter(function (f) { return f.name !== fileName; });
    DATA.files.push(info);
    return info;
  }

  function recompute() {
    CACHE = {};
    CACHE.salesTotals = E.salesTotals(DATA.sales);
    CACHE.stockTotals = E.stockTotals(DATA.stock);
    CACHE.groupIdx = E.groupIndex(DATA.stock, DATA.prices);
    CACHE.byGroup = E.salesByGroup(DATA.sales, CACHE.groupIdx);
    CACHE.contactsIdx = E.contactsIndex(DATA.contacts);
    CACHE.bestPrices = E.bestPriceIndex(DATA.prices);
    CACHE.stockIdx = {};
    DATA.stock.forEach(function (r) { CACHE.stockIdx[r.key] = r; });
    CACHE.salesIdx = {};
    DATA.sales.forEach(function (r) { CACHE.salesIdx[r.key] = r; });
    CACHE.abc = E.abcClassify(DATA.sales.slice());
    CACHE.writeoffSum = DATA.writeoffs.reduce(function (a, r) { return a + num(r.cost); }, 0);
    CACHE.returnSum = DATA.returns.reduce(function (a, r) { return a + num(r.cost); }, 0);
    // долги поставщикам считаем по документам 1С, если они загружены
    CACHE.payments = DATA.invoices1c.length ? E.matchPayments(DATA.invoices1c, DATA.cashOrders) : null;
    CACHE.balance = DATA.invoices1c.length ? E.supplierBalance(DATA.invoices1c, DATA.cashOrders) : null;
    CACHE.cash = DATA.cashOrders.length ? E.cashSummary(DATA.cashOrders) : null;
    CACHE.ownerAll = DATA.owner ? E.ownerTotals(DATA.owner.daily) : null;
    CACHE.bySupplier = {};
    DATA.prices.forEach(function (p) {
      var k = E.norm(p.supplier);
      CACHE.bySupplier[k] = (CACHE.bySupplier[k] || 0) + 1;
    });
  }

  async function loadFiles(fileList) {
    var files = Array.prototype.slice.call(fileList).filter(function (f) {
      return /\.(xls|xlsx|csv)$/i.test(f.name) && !/^~\$/.test(f.name);
    });
    if (!files.length) { toast('В папке не нашлось файлов .xls / .xlsx / .csv'); return; }
    var pr = progress('Синхронизация папки базы', files.length);
    var loaded = [], errors = [];
    for (var i = 0; i < files.length; i++) {
      pr.step(i + 1, files[i].name);
      await new Promise(function (r) { setTimeout(r, 10); }); // даём экрану перерисоваться
      try {
        var buf = await files[i].arrayBuffer();
        loaded.push(ingest(files[i].name, buf, files[i].size, files[i].lastModified));
      } catch (e) {
        errors.push(files[i].name + ': ' + e.message);
      }
    }
    pr.done();
    recompute();
    renderAll();
    var known = loaded.filter(function (f) { return f.kind !== 'unknown'; }).length;
    toast('Загружено файлов: ' + known + ' из ' + files.length +
      (errors.length ? '\nОшибки: ' + errors.join('; ') : '') +
      '\nВыручка 1С: ' + money(CACHE.salesTotals.revenue) + ', склад: ' + money(CACHE.stockTotals.buySum));
  }

  /* --- Автослежение за папкой (если браузер разрешает) -------------------- */
  var watchHandle = null, watchTimer = null, watchState = {};

  async function pickWatchFolder() {
    if (!window.showDirectoryPicker) {
      toast('Слежение за папкой доступно в Chrome/Edge при открытии дашборда через ярлык «Запустить_Дашборд.bat».\nПока пользуйтесь кнопкой «Синхронизировать папку базы».');
      return;
    }
    try {
      watchHandle = await window.showDirectoryPicker();
      await scanWatchFolder(true);
      startWatch();
      toast('Слежу за папкой: новые выгрузки 1С подхватятся сами (проверка каждые ' + (S.settings.autoSyncSeconds || 3) + ' сек).');
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('Не удалось открыть папку: ' + e.message);
    }
  }

  async function scanWatchFolder(force) {
    if (!watchHandle) return;
    var changed = [];
    for await (var entry of watchHandle.values()) {
      if (entry.kind !== 'file' || !/\.(xls|xlsx|csv)$/i.test(entry.name) || /^~\$/.test(entry.name)) continue;
      var file = await entry.getFile();
      var stamp = file.lastModified + ':' + file.size;
      if (force || watchState[entry.name] !== stamp) {
        watchState[entry.name] = stamp;
        changed.push(file);
      }
    }
    if (changed.length) {
      for (var i = 0; i < changed.length; i++) {
        try { ingest(changed[i].name, await changed[i].arrayBuffer(), changed[i].size, changed[i].lastModified); }
        catch (e) { /* битый файл не должен ронять слежение */ }
      }
      recompute();
      renderAll();
      if (!force) toast('Папка обновилась: перечитано файлов — ' + changed.length);
    }
  }

  function startWatch() {
    if (watchTimer) clearInterval(watchTimer);
    var sec = Math.max(1, num(S.settings.autoSyncSeconds) || 3);
    watchTimer = setInterval(function () { scanWatchFolder(false); }, sec * 1000);
  }
  function stopWatch() {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = null; watchHandle = null; watchState = {};
    toast('Слежение за папкой выключено.');
    renderAll();
  }

  /* --- Описание экранов --------------------------------------------------- */
  var VIEWS = [
    { id: 'exec', icon: '👑', name: 'Руководителю', title: 'Главный экран руководителя', section: 'Главное управление' },
    { id: 'ownerbook', icon: '📒', name: 'Моя книга ДДС', title: 'Моя книга: движение денег по сменам (ручной учёт)', section: 'Главное управление' },
    { id: 'shifts', icon: '🕒', name: 'Смены 24/7', title: 'Журнал смен 24/7 (день 09:00–21:00 / ночь 21:00–09:00)', section: 'Главное управление' },
    { id: 'invoices', icon: '📑', name: 'Накладные и долги', title: 'Накладные поставщиков, оплата налом и долги', section: 'Главное управление' },
    { id: 'bep', icon: '⚖️', name: 'Точка безубыточности', title: 'Точка безубыточности (BEP) по периодам', section: 'Главное управление' },

    { id: 'stock', icon: '📦', name: 'Склад и остатки', title: 'Складской учёт и остатки номенклатуры', section: 'Товары и склад' },
    { id: 'abc', icon: '📊', name: 'ABC-анализ', title: 'ABC-анализ ассортимента по выручке', section: 'Товары и склад' },
    { id: 'rop', icon: '🚚', name: 'Автозаказ ROP', title: 'Автозаказ поставщикам (точка перезаказа ROP)', section: 'Товары и склад' },
    { id: 'fefo', icon: '⏰', name: 'Сроки годности', title: 'Сроки годности FEFO (партионный светофор)', section: 'Товары и склад' },
    { id: 'inventory', icon: '📋', name: 'Инвентаризация', title: 'Инвентаризация: сличительная ведомость учёт vs факт', section: 'Товары и склад' },
    { id: 'losses', icon: '🗑️', name: 'Списания и возвраты', title: 'Списания, брак и возвраты (отчёты 1С)', section: 'Товары и склад' },

    { id: 'pnl', icon: '💲', name: 'Финансы и P&L', title: 'Управленческий отчёт о прибылях и убытках (P&L)', section: 'Финансы и цены' },
    { id: 'calendar', icon: '📅', name: 'Платёжный календарь', title: 'Платёжный календарь по счетам поставщиков', section: 'Финансы и цены' },
    { id: 'pricing', icon: '🏷️', name: 'Наценка и KVI', title: 'Управление наценкой и мониторинг KVI-товаров', section: 'Финансы и цены' },
    { id: 'suppliers', icon: '🤝', name: 'Цены поставщиков', title: 'Сравнение цен поставщиков и телефонная книга', section: 'Финансы и цены' },

    { id: 'staff', icon: '👥', name: 'Табель и зарплата', title: 'Кадровый табель 24/7 и расчёт зарплаты (ФОТ)', section: 'Люди и контроль' },
    { id: 'fraud', icon: '🛡️', name: 'Антифрод кассы', title: 'Кассовая дисциплина: недостачи и излишки по кассирам', section: 'Люди и контроль' },
    { id: 'search', icon: '🔎', name: 'Умный поиск', title: 'Сквозной поиск по всем данным', section: 'Люди и контроль' },
    { id: 'data', icon: '🗂️', name: 'Данные 1С', title: 'Данные и синхронизация с папкой выгрузок', section: 'Люди и контроль' },
    { id: 'settings', icon: '⚙️', name: 'Настройки', title: 'Настройки магазина, расходы и правила расчёта', section: 'Люди и контроль' }
  ];

  function noData(what, hint) {
    return '<div class="empty-state"><b>' + esc(what) + '</b><br>' + (hint || '') + '</div>';
  }
  function needSales() {
    return noData('Нет данных из 1С',
      'Нажмите «📂 Синхронизировать папку базы» и укажите папку <b>Данные_1С_и_Excel</b> с выгрузками.<br>' +
      'Нужны отчёты: Продажи, Остатки номенклатуры, Цены поставщиков, Контакты поставщиков.');
  }

  /* --- Маржинальность и BEP ----------------------------------------------- */
  function currentMargin() {
    var manual = num(S.settings.marginManual);
    if (manual > 0) return manual;
    return CACHE.salesTotals ? CACHE.salesTotals.margin : 0;
  }
  // Оборот, приведённый к 30 дням. Источник — книга владельца (она полнее: нал + онлайн),
  // если её нет — отчёт 1С «Продажи».
  function revenueMonth() {
    if (DATA.owner) {
      var t = E.ownerTotals(ownerRows().rows);
      if (t.revenue > 0 && t.dayCount > 0) {
        return { value: E.safeRound(t.revenue / t.dayCount * 30), source: 'ваша книга ДДС', days: t.dayCount };
      }
    }
    var revenue = CACHE.salesTotals ? CACHE.salesTotals.revenue : 0;
    var days = DATA.salesPeriod && DATA.salesPeriod.days ? DATA.salesPeriod.days : 30;
    return { value: days > 0 ? E.safeRound(revenue / days * 30) : revenue, source: 'отчёт 1С «Продажи»', days: days };
  }
  function bepNow() {
    var r = revenueMonth();
    var b = E.bep(S.fixedMonthly(), currentMargin(), r.value);
    b.source = r.source; b.sourceDays = r.days;
    return b;
  }

  /* --- 1. Руководителю ---------------------------------------------------- */
  function viewExec() {
    if (!DATA.sales.length && !S.state.shifts.length) return needSales();
    var t = CACHE.salesTotals || E.salesTotals([]);
    var stock = CACHE.stockTotals || E.stockTotals([]);
    var shifts = E.shiftsTotals(filtered('shifts'));
    var inv = E.invoicesTotals(filtered('invoices'));
    var ownerSel = ownerRows();
    var ownerT = DATA.owner ? E.ownerTotals(ownerSel.rows) : null;
    // долг берём из самого надёжного источника: документы 1С → ваша книга → ручной журнал
    var debt, debtSub;
    if (CACHE.payments) {
      debt = CACHE.payments.totalLeft;
      debtSub = 'По накладным 1С: ' + nf(CACHE.payments.docs.length) + ' шт. за ' + (DATA.invoicesPeriod ? DATA.invoicesPeriod.days + ' дн.' : 'период');
    } else if (ownerT && ownerT.debt) {
      debt = ownerT.debt;
      debtSub = 'По вашей книге ДДС на ' + ownerT.debtDate;
    } else {
      debt = inv.debt;
      debtSub = 'По журналу дашборда: ' + inv.count + ' накладных';
    }
    var b = bepNow();
    var writeMonth = S.settings.writeoffsToMonth && DATA.writeoffsPeriod
      ? E.perMonth(CACHE.writeoffSum, DATA.writeoffsPeriod.days) : CACHE.writeoffSum;
    var payroll = E.payrollSummary(filtered('timesheet'), filtered('payouts'));
    var accrued = payroll.reduce(function (a, r) { return a + r.accrued; }, 0);
    var pl = E.pnl(DATA.sales, S.settings, writeMonth, accrued);

    var h = '';
    h += '<div class="bep-container">' +
      '<div class="bep-header"><span style="color:var(--cyan)">⚖️ Точка безубыточности (месяц): ' + moneyP(b.month) + '</span>' +
      '<span style="color:' + (b.profitable ? 'var(--green)' : 'var(--yellow)') + '">Выручка в пересчёте на месяц: ' +
      moneyP(b.revenue) + ' — ' + pct(b.done) + (b.profitable ? ' (прибыль пошла)' : ' (порог не пройден)') + '</span></div>' +
      '<div class="bep-bar-bg"><div class="bep-bar-fill" style="width:' + Math.max(0, Math.min(100, b.done)) + '%"></div></div>' +
      '<div style="font-size:11px;color:var(--text-muted)">Постоянные расходы ' + money(b.fixedMonth) +
      ' ÷ маржинальность ' + pct(b.margin) + '. Порог закрывается примерно к ' + (b.dayOfMonth || '—') +
      '-му числу месяца. Оборот взят из источника: ' + esc(b.source) + ' (' + b.sourceDays + ' дн.).</div></div>';

    h += '<div class="kpi-grid">' +
      kpi('Выручка (отчёт 1С)', money(t.revenue), periodLabelSales()) +
      kpi('Валовая прибыль', money(t.gross), 'Маржинальность ' + pct(t.margin) + ' • наценка ' + pct(t.markup)) +
      kpi('Склад по себестоимости', money(stock.buySum), nf(stock.sku) + ' SKU • в рознице ' + money(stock.retailSum)) +
      kpi('Долг поставщикам', money(debt), debtSub, 'var(--red)') +
      kpi('Расхождение кассы', money(shifts.diff), 'Смен: ' + shifts.count + ' • недостачи ' + money(shifts.short) + ', излишки ' + money(shifts.over),
        shifts.diff === 0 ? 'var(--green)' : 'var(--yellow)') +
      kpi('Списания (в месяц)', money(writeMonth), DATA.writeoffsPeriod ? 'Из отчёта 1С за ' + DATA.writeoffsPeriod.days + ' дн.' : 'Отчёт списаний не загружен') +
      kpi('Чистая прибыль (месяц)', money(pl.net), 'Рентабельность ' + pct(pl.netMargin), pl.net >= 0 ? 'var(--cyan)' : 'var(--red)') +
      (shifts.count || !ownerT
        ? kpi('Выручка по сменам', money(shifts.revenue), 'Нал ' + money(shifts.zCash) + ' + безнал ' + money(shifts.terminal) + ' • ' + periodName())
        : kpi('Оборот по вашей книге', money(ownerT.revenue), 'Нал ' + money(ownerT.cash) + ' + онлайн ' + money(ownerT.online) +
            ' • ' + ownerT.dayCount + ' дн.' + (ownerSel.whole ? ' (весь файл)' : ''))) +
      (ownerT ? kpi('Прибыль по вашей книге', money(ownerT.profit), 'Закуп ' + money(ownerT.buyTotal) + ' • расходы ' + money(ownerT.expenses),
        ownerT.profit >= 0 ? 'var(--cyan)' : 'var(--red)') : '') +
      '</div>';

    h += '<div class="chart-grid"><div class="chart-box"><canvas id="chartDyn"></canvas></div>' +
      '<div class="chart-box"><canvas id="chartGroups"></canvas></div></div>';

    h += sourcesPanel(ownerT);

    var top = DATA.sales.slice().sort(function (a, b2) { return b2.profit - a.profit; }).slice(0, 10);
    h += panel('Топ-10 позиций по валовой прибыли (отчёт 1С)', table('execTop', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Группа', fn: function (r) { return esc(CACHE.groupIdx[r.key] || '—'); } },
      { title: 'Продано', cls: 'num', fn: function (r) { return nf(r.qty, 2); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return moneyP(r.revenue); } },
      { title: 'Себестоимость', cls: 'num', fn: function (r) { return moneyP(r.cogs); } },
      { title: 'Валовая прибыль', cls: 'num', fn: function (r) { return '<span class="trend-pos private-data">' + money(r.profit) + '</span>'; } },
      { title: 'Маржа', cls: 'center', fn: function (r) { return pct(E.div(r.profit, r.revenue) * 100); } }
    ], top, { step: 10, empty: 'Загрузите отчёт «Продажи»' }));

    h += panel('Выручка по товарным группам', table('execGroups', [
      { title: 'Группа товара', fn: function (r) { return esc(r.group); } },
      { title: 'Позиций', cls: 'num', fn: function (r) { return nf(r.items); } },
      { title: 'Продано', cls: 'num', fn: function (r) { return nf(r.qty, 2); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return moneyP(r.revenue); } },
      { title: 'Валовая прибыль', cls: 'num', fn: function (r) { return moneyP(r.gross); } },
      { title: 'Маржа', cls: 'center', fn: function (r) { return pct(r.margin); } },
      { title: 'Доля выручки', cls: 'center', fn: function (r) { return pct(E.div(r.revenue, t.revenue) * 100); } }
    ], CACHE.byGroup || [], { step: 15, empty: 'Нужны отчёты «Продажи» и «Остатки номенклатуры»' }));

    return h;
  }

  // Честная сверка источников: 1С и ручная книга почти всегда расходятся,
  // и владелец должен видеть насколько, а не получать «одну красивую цифру».
  function sourcesPanel(ownerT) {
    var rows = [];
    var t = CACHE.salesTotals || E.salesTotals([]);
    if (DATA.sales.length) {
      var d = DATA.salesPeriod ? DATA.salesPeriod.days : 30;
      rows.push({ src: 'Отчёт 1С «Продажи»', period: DATA.salesPeriod ? DATA.salesPeriod.from + ' – ' + DATA.salesPeriod.to : '—',
        days: d, sum: t.revenue, perDay: E.div(t.revenue, d), note: 'выручка по чекам из ОРП' });
    }
    if (ownerT && ownerT.revenue) {
      rows.push({ src: 'Ваша книга ДДС', period: ownerT.debtDate ? 'по ' + ownerT.debtDate : '—', days: ownerT.dayCount,
        sum: ownerT.revenue, perDay: ownerT.avgDay, note: 'наличная + онлайн торговля, ручной учёт' });
    }
    var shifts = E.shiftsTotals(filtered('shifts'));
    if (shifts.count) {
      rows.push({ src: 'Журнал смен дашборда', period: periodName(), days: periodDays(), sum: shifts.revenue,
        perDay: E.div(shifts.revenue, periodDays()), note: 'Z-отчёты + терминал, вводится вручную' });
    }
    if (rows.length < 2) return '';
    var max = Math.max.apply(null, rows.map(function (r) { return r.perDay; }));
    var min = Math.min.apply(null, rows.map(function (r) { return r.perDay; }));
    var spread = E.div(max - min, max) * 100;
    return panel('Сверка источников выручки', table('srcTbl', [
      { title: 'Источник', fn: function (r) { return esc(r.src); } },
      { title: 'Период', fn: function (r) { return esc(r.period); } },
      { title: 'Дней', cls: 'num', fn: function (r) { return nf(r.days); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return moneyP(r.sum); } },
      { title: 'В среднем за день', cls: 'num', fn: function (r) { return moneyP(r.perDay); } },
      { title: 'Что это', fn: function (r) { return esc(r.note); } }
    ], rows, { step: 10 })) +
      (spread > 10 ? '<div class="panel"><div class="panel-body" style="color:var(--yellow)">⚠️ Источники расходятся на ' +
        pct(spread) + ' в пересчёте на день. Обычные причины: отчёт 1С выгружен не за весь месяц, ' +
        'часть продаж прошла вне кассы или часть дней в книге не заполнена. Проверьте, за какие даты выгружен отчёт 1С.</div></div>' : '');
  }

  function periodLabelSales() {
    if (!DATA.salesPeriod) return DATA.sales.length ? 'Период отчёта не указан' : 'Отчёт не загружен';
    return 'Отчёт за ' + DATA.salesPeriod.from + ' – ' + DATA.salesPeriod.to + ' (' + DATA.salesPeriod.days + ' дн.)';
  }

  function drawCharts() {
    if (VIEW !== 'exec' || typeof Chart === 'undefined') return;
    var byDay = {};
    filtered('shifts').forEach(function (s) {
      if (!s.date) return;
      if (!byDay[s.date]) byDay[s.date] = { cash: 0, term: 0 };
      byDay[s.date].cash += num(s.zCash); byDay[s.date].term += num(s.terminal);
    });
    var days = Object.keys(byDay).sort();
    var cnv = $('chartDyn');
    if (cnv) {
      if (CHARTS.dyn) CHARTS.dyn.destroy();
      CHARTS.dyn = new Chart(cnv.getContext('2d'), {
        type: 'line',
        data: {
          labels: days.length ? days : ['нет закрытых смен'],
          datasets: [
            { label: 'Наличные (Z-отчёт), ₽', data: days.map(function (d) { return byDay[d].cash; }), borderColor: '#00F2FE', backgroundColor: 'rgba(0,242,254,.12)', fill: true, tension: .3 },
            { label: 'Терминал / СБП, ₽', data: days.map(function (d) { return byDay[d].term; }), borderColor: '#2ECC71', backgroundColor: 'transparent', tension: .3 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#8E9EB5' } }, title: { display: true, text: 'Выручка по сменам (' + periodName() + ')', color: '#00D2D3' } },
          scales: { x: { ticks: { color: '#8E9EB5' }, grid: { color: '#1F3454' } }, y: { ticks: { color: '#8E9EB5' }, grid: { color: '#1F3454' } } }
        }
      });
    }
    var cnv2 = $('chartGroups');
    if (cnv2) {
      var g = (CACHE.byGroup || []).slice(0, 8);
      if (CHARTS.groups) CHARTS.groups.destroy();
      CHARTS.groups = new Chart(cnv2.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: g.length ? g.map(function (x) { return x.group; }) : ['нет данных'],
          datasets: [{ data: g.length ? g.map(function (x) { return Math.round(x.revenue); }) : [1],
            backgroundColor: ['#00F2FE', '#00D2D3', '#2ECC71', '#F1C40F', '#9B59B6', '#FF5E57', '#3498DB', '#E67E22'] }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: '#8E9EB5', font: { size: 10 } } },
            title: { display: true, text: 'Структура выручки по группам', color: '#00D2D3' } }
        }
      });
    }
  }

  /* --- 2. Смены 24/7 ------------------------------------------------------ */
  function viewShifts() {
    var rows = filtered('shifts').sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var t = E.shiftsTotals(rows);
    var h = '';

    h += panel('Закрыть смену (сдача кассы)',
      '<form id="shiftForm"><div class="form-grid">' +
      field('Дата', 'date', 'date', todayISO()) +
      field('Смена', 'shift', 'select', 'Дневная', { options: ['Дневная', 'Ночная', 'Суточная'] }) +
      field('Кассир', 'cashier', 'text', '', { placeholder: 'Фамилия и имя' }) +
      field('Касса №', 'cashbox', 'text', 'Касса №1') +
      field('Остаток в кассе на начало, ₽', 'openCash', 'number', S.settings.openCash, { step: '0.01' }) +
      field('Z-отчёт, наличные, ₽', 'zCash', 'number', '', { step: '0.01' }) +
      field('Выплаты из кассы за смену, ₽', 'payouts', 'number', 0, { step: '0.01' }) +
      field('Факт наличных в ящике, ₽', 'factCash', 'number', '', { step: '0.01' }) +
      field('Терминал / СБП, ₽', 'terminal', 'number', 0, { step: '0.01' }) +
      field('Примечание', 'note', 'text', '') +
      '</div><div class="calc-preview" id="shiftPreview">Расчётный остаток = остаток на начало + Z-отчёт − выплаты</div>' +
      '<div class="form-actions"><button type="submit" class="btn-tool btn-primary">💾 Записать смену</button></div></form>');

    h += panel('Журнал смен ' + esc(periodName().toLowerCase()) + ' — сверка Z-отчёта и фактических денег', table('shiftsTbl', [
      { title: 'Дата', fn: function (r) { return esc(r.date); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift) + '<div class="muted" style="font-size:10px">' + (r.shift === 'Ночная' ? '21:00 – 09:00' : r.shift === 'Суточная' ? '09:00 – 09:00' : '09:00 – 21:00') + '</div>'; } },
      { title: 'Кассир', fn: function (r) { return esc(r.cashier || '—'); } },
      { title: 'Остаток на начало', cls: 'num', fn: function (r) { return moneyP(r.openCash); } },
      { title: 'Z-отчёт нал', cls: 'num', fn: function (r) { return moneyP(r.zCash); } },
      { title: 'Выплаты из кассы', cls: 'num', fn: function (r) { return moneyP(r.payouts); } },
      { title: 'Расчётный остаток', cls: 'num', fn: function (r) { return moneyP(E.shiftCalc(r).expected); } },
      { title: 'Факт в кассе', cls: 'num', fn: function (r) { return moneyP(r.factCash); } },
      { title: 'Терминал/СБП', cls: 'num', fn: function (r) { return moneyP(r.terminal); } },
      { title: 'Разница', cls: 'num', fn: function (r) { var c = E.shiftCalc(r); return '<span class="' + signClass(c.diff) + ' private-data">' + money(c.diff) + '</span>'; } },
      { title: 'Статус сдачи', cls: 'center', fn: function (r) {
        var c = E.shiftCalc(r);
        return badge(c.statusText, c.status === 'ok' ? 'green' : (c.status === 'over' ? 'yellow' : 'red')); } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn-tool btn-mini btn-danger" data-action="del" data-coll="shifts" data-id="' + r.id + '">✕</button>'; } }
    ], rows, {
      step: 60,
      empty: 'Смен за период нет. Закройте первую смену формой выше.',
      totalRow: [
        { html: 'ИТОГО за ' + esc(periodName().toLowerCase()) + ': ' + rows.length + ' смен', span: 3 },
        { html: money(t.openCash), cls: 'num' }, { html: money(t.zCash), cls: 'num' },
        { html: money(t.payouts), cls: 'num' }, { html: money(t.expected), cls: 'num' },
        { html: money(t.factCash), cls: 'num' }, { html: money(t.terminal), cls: 'num' },
        { html: '<span class="' + signClass(t.diff) + '">' + money(t.diff) + '</span>', cls: 'num' },
        { html: badge(t.diff === 0 ? 'Касса сведена' : 'Расхождение ' + money(t.diff), t.diff === 0 ? 'green' : 'yellow'), cls: 'center', span: 2 }
      ]
    }));
    return h;
  }

  /* --- 3. Накладные и долги ----------------------------------------------- */
  function viewInvoices() {
    var head = invoices1cBlock();   // блок по документам 1С, если они загружены
    var rows = filtered('invoices').sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var t = E.invoicesTotals(rows);
    var bySup = E.debtBySupplier(rows);
    var suppliers = DATA.contacts.map(function (c) { return c.name; });

    var h = head + panel('Принять накладную / погасить долг (ручной журнал смены)',
      '<form id="invForm"><div class="form-grid">' +
      field('Дата', 'date', 'date', todayISO()) +
      field('№ документа', 'doc', 'text', '', { placeholder: 'НАКЛ-412' }) +
      field('Поставщик', 'supplier', 'text', '', { placeholder: 'начните вводить название', attrs: ' list="supList"' }) +
      field('Товар / категория', 'goods', 'text', '') +
      field('Сумма накладной, ₽', 'total', 'number', '', { step: '0.01' }) +
      field('Оплачено сразу налом, ₽', 'paidCash', 'number', 0, { step: '0.01' }) +
      field('Погашено старых долгов, ₽', 'paidDebt', 'number', 0, { step: '0.01' }) +
      field('Срок оплаты остатка', 'due', 'date', '') +
      field('Смена приёмки', 'shift', 'select', 'Дневная (09:00-21:00)', { options: ['Дневная (09:00-21:00)', 'Ночная (21:00-09:00)'] }) +
      field('Принял', 'receiver', 'text', '') +
      '</div><datalist id="supList">' + suppliers.slice(0, 700).map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
      '<div class="calc-preview" id="invPreview">Остаток в долг = сумма накладной − оплачено сразу налом</div>' +
      '<div class="form-actions"><button type="submit" class="btn-tool btn-primary">💾 Записать накладную</button></div></form>');

    h += panel('Реестр накладных ' + esc(periodName().toLowerCase()), table('invTbl', [
      { title: 'Дата', fn: function (r) { return esc(r.date); } },
      { title: '№ документа', fn: function (r) { return esc(r.doc || '—'); } },
      { title: 'Поставщик', fn: function (r) {
        var phone = CACHE.contactsIdx ? CACHE.contactsIdx[E.norm(r.supplier)] : '';
        return esc(r.supplier || '—') + (phone ? '<div><a class="tel" href="tel:' + esc(phone) + '">📞 ' + esc(phone) + '</a></div>' : ''); } },
      { title: 'Товар', fn: function (r) { return esc(r.goods || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return moneyP(r.total); } },
      { title: 'Налом сразу', cls: 'num', fn: function (r) { return moneyP(r.paidCash); } },
      { title: 'Погашено долгов', cls: 'num', fn: function (r) { return moneyP(r.paidDebt); } },
      { title: 'Осталось в долг', cls: 'num', fn: function (r) { var c = E.invoiceCalc(r); return '<span class="' + (c.left > 0 ? 'trend-neg' : 'trend-pos') + ' private-data">' + money(c.left) + '</span>'; } },
      { title: 'Смена', fn: function (r) { return esc(r.shift || '—'); } },
      { title: 'Статус', cls: 'center', fn: function (r) {
        var c = E.invoiceCalc(r);
        return badge(c.statusText, c.status === 'paid' || c.status === 'repay' ? 'green' : (c.status === 'part' ? 'yellow' : 'red')); } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn-tool btn-mini btn-danger" data-action="del" data-coll="invoices" data-id="' + r.id + '">✕</button>'; } }
    ], rows, {
      step: 60, empty: 'Накладных за период нет.',
      totalRow: [
        { html: 'ИТОГО: ' + rows.length + ' документов', span: 4 },
        { html: money(t.total), cls: 'num' }, { html: money(t.paidCash), cls: 'num' },
        { html: money(t.paidDebt), cls: 'num' },
        { html: '<span style="color:var(--red)">' + money(t.debt) + '</span>', cls: 'num' },
        { html: badge('Сводный долг магазина', 'red'), cls: 'center', span: 3 }
      ]
    }));

    h += panel('Взаиморасчёты по поставщикам', table('invSup', [
      { title: 'Поставщик', fn: function (r) {
        var phone = CACHE.contactsIdx ? CACHE.contactsIdx[E.norm(r.supplier)] : '';
        return esc(r.supplier) + (phone ? ' <a class="tel" href="tel:' + esc(phone) + '">📞 ' + esc(phone) + '</a>' : ''); } },
      { title: 'Документов', cls: 'num', fn: function (r) { return nf(r.docs); } },
      { title: 'Сумма поставок', cls: 'num', fn: function (r) { return moneyP(r.total); } },
      { title: 'Оплачено налом', cls: 'num', fn: function (r) { return moneyP(r.paidCash); } },
      { title: 'Погашено долгов', cls: 'num', fn: function (r) { return moneyP(r.paidDebt); } },
      { title: 'Текущий долг', cls: 'num', fn: function (r) { return '<span class="' + (r.debt > 0 ? 'trend-neg' : 'trend-pos') + ' private-data">' + money(r.debt) + '</span>'; } },
      { title: 'Статус', cls: 'center', fn: function (r) {
        return badge(r.debt <= 0 ? 'Оплачено 100%' : (r.paidCash > 0 ? 'Частичный долг' : 'Долг 100%'),
          r.debt <= 0 ? 'green' : (r.paidCash > 0 ? 'yellow' : 'red')); } }
    ], bySup, { step: 40, empty: 'Нет данных' }));
    return h;
  }

  /* --- 4. Точка безубыточности -------------------------------------------- */
  function viewBep() {
    var b = bepNow();
    var t = CACHE.salesTotals || E.salesTotals([]);
    var fixed = S.fixedMonthly();
    var rows = [
      { name: 'День / смена', fixed: E.safeRound(fixed / 30), bep: b.day, rev: b.avgDay },
      { name: 'Неделя', fixed: E.safeRound(fixed / 30 * 7), bep: b.week, rev: E.safeRound(b.avgDay * 7) },
      { name: 'Месяц', fixed: fixed, bep: b.month, rev: b.revenue },
      { name: 'Квартал', fixed: E.safeRound(fixed * 3), bep: E.safeRound(b.month * 3), rev: E.safeRound(b.revenue * 3) }
    ];
    var h = '<div class="kpi-grid">' +
      kpi('Постоянные расходы в месяц', money(fixed), 'ФОТ + аренда + коммуналка + налоги + прочее') +
      kpi('Маржинальность', pct(b.margin), num(S.settings.marginManual) > 0 ? 'Задана вручную в настройках' : 'Посчитана по отчёту продаж 1С') +
      kpi('Оборот в месяц', money(b.revenue), 'Источник: ' + b.source) +
      kpi('Порог безубыточности (месяц)', money(b.month), 'В день нужно ' + money(b.day)) +
      kpi('Запас финансовой прочности', pct(b.safety), b.profitable ? 'Выручка выше порога' : 'Выручка ниже порога', b.profitable ? 'var(--green)' : 'var(--red)') +
      '</div>';

    h += panel('Сравнительная матрица BEP по периодам', table('bepTbl', [
      { title: 'Период', fn: function (r) { return '<strong>' + esc(r.name) + '</strong>'; } },
      { title: 'Постоянные расходы', cls: 'num', fn: function (r) { return moneyP(r.fixed); } },
      { title: 'Порог BEP', cls: 'num', fn: function (r) { return moneyP(r.bep); } },
      { title: 'Выручка (' + esc(b.source) + ')', cls: 'num', fn: function (r) { return moneyP(r.rev); } },
      { title: 'Выполнение', cls: 'center', fn: function (r) {
        var d = E.div(r.rev, r.bep) * 100;
        return '<strong class="' + (d >= 100 ? 'trend-pos' : 'trend-neg') + '">' + pct(d) + '</strong>'; } },
      { title: 'Статус', cls: 'center', fn: function (r) {
        var d = E.div(r.rev, r.bep) * 100;
        return badge(d >= 130 ? 'Высокая прибыль' : (d >= 100 ? 'Прибыль идёт' : 'Убыток'), d >= 100 ? 'green' : 'red'); } }
    ], rows, { step: 10 }));

    h += panel('Как это считается',
      '<div class="panel-body">' +
      'BEP (месяц) = постоянные расходы ÷ маржинальность = ' + money(fixed) + ' ÷ ' + pct(b.margin) + ' = <b>' + money(b.month) + '</b>.<br>' +
      'BEP (день) = BEP месяца ÷ 30 = <b>' + money(b.day) + '</b>.<br>' +
      'Запас прочности = (выручка − BEP) ÷ выручка = <b>' + pct(b.safety) + '</b>.<br>' +
      'При среднедневной выручке ' + money(b.avgDay) + ' магазин закрывает постоянные расходы примерно ' +
      '<b>к ' + (b.dayOfMonth || '—') + '-му числу</b>, дальше работает в чистую прибыль.<br>' +
      '<span class="muted">Выручка приведена к 30 дням. Источник — ' + esc(b.source) +
      ', в нём ' + b.sourceDays + ' дн. Маржинальность ' +
      (num(S.settings.marginManual) > 0 ? 'задана вручную в настройках' : 'посчитана по отчёту 1С «Продажи»') + '.</span></div>');
    return h;
  }

  /* --- 5. Склад и остатки -------------------------------------------------- */
  function viewStock() {
    if (!DATA.stock.length) return needSales();
    var t = CACHE.stockTotals;
    var q = ($('globalSearch') && $('globalSearch').value || '').trim();
    var rows = DATA.stock;
    if (q) { var nq = E.norm(q); rows = rows.filter(function (r) {
      return r.key.indexOf(nq) >= 0 || (r.barcode && r.barcode.indexOf(nq) >= 0) || E.norm(r.article).indexOf(nq) >= 0 || (r.code && r.code.indexOf(nq) >= 0); }); }
    rows = rows.slice().sort(function (a, b) { return b.buySum - a.buySum; });

    var h = '<div class="kpi-grid">' +
      kpi('Позиций на складе', nf(t.sku), 'Из них с нулевым остатком: ' + nf(t.zeroSku)) +
      kpi('Склад по себестоимости', money(t.buySum), 'Деньги, замороженные в товаре') +
      kpi('Склад в розничных ценах', money(t.retailSum), 'Потенциальная выручка') +
      kpi('Потенциальная наценка', pct(E.div(t.retailSum - t.buySum, t.buySum) * 100), 'Розница ÷ себестоимость') +
      '</div>';

    h += panel('Остатки номенклатуры' + (q ? ' — фильтр «' + esc(q) + '»' : ''), table('stockTbl', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Группа', fn: function (r) { return esc(r.group); } },
      { title: 'Артикул / код', fn: function (r) { return esc(r.article || r.code || '—'); } },
      { title: 'Штрихкод', fn: function (r) { return esc(r.barcode || '—'); } },
      { title: 'Остаток', cls: 'num', fn: function (r) {
        var cls = r.qty <= 0 ? 'trend-neg' : (r.qty < 3 ? 'trend-warn' : '');
        return '<span class="' + cls + '">' + nf(r.qty, 2) + ' ' + esc(r.unit) + '</span>'; } },
      { title: 'Закупка', cls: 'num', fn: function (r) { return moneyP(r.buyPrice); } },
      { title: 'Розница', cls: 'num', fn: function (r) { return moneyP(r.retailPrice); } },
      { title: 'Наценка', cls: 'center', fn: function (r) { return r.buyPrice > 0 ? pct(E.div(r.retailPrice - r.buyPrice, r.buyPrice) * 100) : '—'; } },
      { title: 'Сумма закупки', cls: 'num', fn: function (r) { return moneyP(r.buySum); } },
      { title: 'Статус', cls: 'center', fn: function (r) {
        return r.qty <= 0 ? badge('Нет в наличии', 'red') : (r.qty < 3 ? badge('Заканчивается', 'yellow') : badge('В наличии', 'green')); } }
    ], rows, { step: 100, empty: 'Ничего не найдено' }));
    return h;
  }

  /* --- 6. ABC-анализ -------------------------------------------------------- */
  function viewAbc() {
    if (!DATA.sales.length) return needSales();
    var rows = CACHE.abc || [];
    var summary = { A: { n: 0, rev: 0 }, B: { n: 0, rev: 0 }, C: { n: 0, rev: 0 } };
    rows.forEach(function (r) { if (summary[r.abc]) { summary[r.abc].n++; summary[r.abc].rev += r.revenue; } });
    var total = CACHE.salesTotals.revenue;

    var h = '<div class="kpi-grid">' +
      kpi('Класс A (80% выручки)', nf(summary.A.n) + ' поз.', money(summary.A.rev) + ' • ' + pct(E.div(summary.A.rev, total) * 100), 'var(--green)') +
      kpi('Класс B (до 95%)', nf(summary.B.n) + ' поз.', money(summary.B.rev) + ' • ' + pct(E.div(summary.B.rev, total) * 100), 'var(--yellow)') +
      kpi('Класс C (хвост)', nf(summary.C.n) + ' поз.', money(summary.C.rev) + ' • ' + pct(E.div(summary.C.rev, total) * 100), 'var(--text-muted)') +
      kpi('Всего позиций в продажах', nf(rows.length), periodLabelSales()) +
      '</div>';

    h += panel('ABC-матрица номенклатуры (по выручке, нарастающим итогом)', table('abcTbl', [
      { title: '№', cls: 'num', fn: function (r, i) { return nf(i + 1); } },
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Группа', fn: function (r) { return esc(CACHE.groupIdx[r.key] || '—'); } },
      { title: 'Продано', cls: 'num', fn: function (r) { return nf(r.qty, 2); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return moneyP(r.revenue); } },
      { title: 'Прибыль', cls: 'num', fn: function (r) { return moneyP(r.profit); } },
      { title: 'Маржа', cls: 'center', fn: function (r) { return pct(E.div(r.profit, r.revenue) * 100); } },
      { title: 'Доля нарастающим', cls: 'center', fn: function (r) { return pct(r.shareCum); } },
      { title: 'ABC', cls: 'center', fn: function (r) { return badge(r.abc, r.abc === 'A' ? 'green' : (r.abc === 'B' ? 'yellow' : 'grey')); } },
      { title: 'XYZ (1С)', cls: 'center', fn: function (r) { return r.xyzSrc ? badge(r.xyzSrc, 'blue') : '<span class="muted">—</span>'; } },
      { title: 'Что делать', fn: function (r) {
        return r.abc === 'A' ? 'Держать запас всегда, не допускать нулей'
          : (r.abc === 'B' ? 'Плановый заказ, следить за маржой' : 'Проверить: не занимает ли полку зря'); } }
    ], rows, { step: 100 }));
    return h;
  }

  /* --- 7. Автозаказ ROP ---------------------------------------------------- */
  function viewRop() {
    if (!DATA.sales.length || !DATA.stock.length) return needSales();
    var days = DATA.salesPeriod ? DATA.salesPeriod.days : 30;
    var rows = E.ropList(DATA.sales, DATA.stock, days, S.settings, CACHE.bestPrices);
    var sum = rows.reduce(function (a, r) { return a + r.sum; }, 0);
    var crit = rows.filter(function (r) { return r.critical; }).length;

    var h = '<div class="kpi-grid">' +
      kpi('Позиций к заказу', nf(rows.length), 'Остаток опустился до точки перезаказа') +
      kpi('Из них уже закончились', nf(crit), 'Нулевой остаток при живом спросе', 'var(--red)') +
      kpi('Сумма заказа', money(sum), 'По лучшим ценам поставщиков') +
      kpi('Правило расчёта', S.settings.leadDays + ' дн. плечо', 'Страховой запас ' + pct(S.settings.safetyPct, 0)) +
      '</div>';

    h += panel('Что заказать сегодня (ROP = спрос × плечо + страховой запас)', table('ropTbl', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Группа', fn: function (r) { return esc(r.group || '—'); } },
      { title: 'Остаток', cls: 'num', fn: function (r) { return '<span class="' + (r.critical ? 'trend-neg' : '') + '">' + nf(r.stock, 2) + '</span>'; } },
      { title: 'Расход/день', cls: 'num', fn: function (r) { return nf(r.demand, 2); } },
      { title: 'Плечо, дн', cls: 'center', fn: function (r) { return nf(r.lead); } },
      { title: 'Точка ROP', cls: 'num', fn: function (r) { return nf(r.rop, 2); } },
      { title: 'Заказать', cls: 'num', fn: function (r) { return '<strong>' + nf(r.order) + '</strong>'; } },
      { title: 'Лучшая цена', cls: 'num', fn: function (r) { return moneyP(r.price); } },
      { title: 'Поставщик', fn: function (r) {
        var phone = CACHE.contactsIdx[E.norm(r.supplier)];
        return esc(r.supplier || '—') + (phone ? '<div><a class="tel" href="tel:' + esc(phone) + '">📞 ' + esc(phone) + '</a></div>' : ''); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return moneyP(r.sum); } },
      { title: 'Статус', cls: 'center', fn: function (r) { return r.critical ? badge('Срочно', 'red') : badge('Заказать', 'yellow'); } }
    ], rows, { step: 80, empty: 'Нечего заказывать: остатки выше точки перезаказа' }));
    return h;
  }

  /* --- 8. Сроки годности FEFO --------------------------------------------- */
  function viewFefo() {
    var rows = (S.state.expiry || []).slice().sort(function (a, b) { return (a.bestBefore || '').localeCompare(b.bestBefore || ''); });
    var stat = { crit: 0, warn: 0, expired: 0, sum: 0 };
    rows.forEach(function (r) {
      var f = E.fefoStatus(r.bestBefore, S.settings);
      if (f.level === 'crit') stat.crit++;
      if (f.level === 'warn') stat.warn++;
      if (f.level === 'expired') { stat.expired++; stat.sum += num(r.qty) * num(r.price); }
    });

    var h = '<div class="kpi-grid">' +
      kpi('Красная зона', nf(stat.crit), 'До ' + S.settings.fefoCrit + ' дн. — уценка ' + pct(S.settings.discountCrit, 0), 'var(--red)') +
      kpi('Жёлтая зона', nf(stat.warn), 'До ' + S.settings.fefoWarn + ' дн. — скидка ' + pct(S.settings.discountWarn, 0), 'var(--yellow)') +
      kpi('Просрочено', nf(stat.expired), 'Снять с полки и списать: ' + money(stat.sum), 'var(--red)') +
      kpi('Партий под контролем', nf(rows.length), 'Ведётся вручную при приёмке') +
      '</div>';

    h += panel('Добавить партию с ограниченным сроком',
      '<form id="fefoForm"><div class="form-grid">' +
      field('Товар', 'name', 'text', '', { placeholder: 'Молоко 3,2% 900 мл', attrs: ' list="stockList"' }) +
      field('Группа', 'group', 'text', '') +
      field('Остаток партии', 'qty', 'number', '', { step: '0.001' }) +
      field('Цена, ₽', 'price', 'number', '', { step: '0.01' }) +
      field('Годен до', 'bestBefore', 'date', '') +
      '</div>' + stockDatalist() +
      '<div class="form-actions"><button type="submit" class="btn-tool btn-primary">💾 Поставить на контроль</button></div></form>');

    h += panel('Партионный светофор FEFO', table('fefoTbl', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Группа', fn: function (r) { return esc(r.group || '—'); } },
      { title: 'Остаток', cls: 'num', fn: function (r) { return nf(r.qty, 2); } },
      { title: 'Годен до', cls: 'center', fn: function (r) { return esc(r.bestBefore); } },
      { title: 'Осталось', cls: 'center', fn: function (r) {
        var f = E.fefoStatus(r.bestBefore, S.settings);
        if (f.days == null) return '—';
        var kindMap = { expired: 'red', crit: 'red', warn: 'yellow', ok: 'green' };
        return badge(f.days < 0 ? 'просрочено' : f.days + ' дн.', kindMap[f.level] || 'grey'); } },
      { title: 'Скидка', cls: 'center', fn: function (r) { var f = E.fefoStatus(r.bestBefore, S.settings); return f.discount ? '−' + f.discount + '%' : '—'; } },
      { title: 'Цена со скидкой', cls: 'num', fn: function (r) {
        var f = E.fefoStatus(r.bestBefore, S.settings);
        return moneyP(num(r.price) * (100 - f.discount) / 100); } },
      { title: 'Сумма партии', cls: 'num', fn: function (r) { return moneyP(num(r.qty) * num(r.price)); } },
      { title: 'Что делать', fn: function (r) { return esc(E.fefoStatus(r.bestBefore, S.settings).action); } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn-tool btn-mini btn-danger" data-action="del" data-coll="expiry" data-id="' + r.id + '">✕</button>'; } }
    ], rows, { step: 60, empty: 'Партии не заведены' }),
      '<button class="btn-tool" data-action="print-labels">🖨️ Печать ценников со скидкой</button>');
    return h;
  }

  function stockDatalist() {
    var names = DATA.stock.slice(0, 1200).map(function (r) { return '<option value="' + esc(r.name) + '">'; }).join('');
    return '<datalist id="stockList">' + names + '</datalist>';
  }

  /* --- Накладные и оплаты из документов 1С -------------------------------- */
  function invoices1cBlock() {
    if (!DATA.invoices1c.length) return '';
    var mp = CACHE.payments, bal = CACHE.balance || [], cash = CACHE.cash;
    var per = DATA.invoicesPeriod ? DATA.invoicesPeriod.from + ' – ' + DATA.invoicesPeriod.to : 'период не указан';

    var h = '<div class="kpi-grid">' +
      kpi('Поставки за период', money(mp.totalSum), nf(mp.docs.length) + ' накладных • ' + per) +
      kpi('Оплачено по этим накладным', money(mp.totalPaid), 'Расходные ордера, привязанные к накладным') +
      kpi('Остаток в долг', money(mp.totalLeft), 'Долг по накладным этого периода', 'var(--red)') +
      kpi('Погашено старых долгов', money(mp.oldDebtPaid), 'Оплаты по накладным прошлых периодов', 'var(--green)') +
      '</div>';

    if (cash) {
      h += panel('Куда ушли наличные из кассы (расходные ордера 1С)', table('cashArt', [
        { title: 'Статья расхода', fn: function (r) { return esc(r.name); } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return moneyP(r.sum); } },
        { title: 'Доля', cls: 'center', fn: function (r) { return pct(r.share); } }
      ], cash.byArticle, { step: 20 })) ;
    }

    h += panel('Накладные 1С: что оплачено, что осталось в долг', table('inv1c', [
      { title: 'Дата', fn: function (r) { return esc(r.date); } },
      { title: 'Документ', fn: function (r) { return esc(r.doc.replace('Приходная накладная ', '')); } },
      { title: 'Поставщик', fn: function (r) {
        var phone = CACHE.contactsIdx[E.norm(r.supplier)];
        return esc(r.supplier) + (phone ? '<div><a class="tel" href="tel:' + esc(phone) + '">📞 ' + esc(phone) + '</a></div>' : ''); } },
      { title: 'Сумма поставки', cls: 'num', fn: function (r) { return moneyP(r.sum); } },
      { title: 'Оплачено', cls: 'num', fn: function (r) { return moneyP(r.paid); } },
      { title: 'Осталось в долг', cls: 'num', fn: function (r) { return '<span class="' + (r.left > 0 ? 'trend-neg' : 'trend-pos') + ' private-data">' + money(r.left) + '</span>'; } },
      { title: 'В рознице', cls: 'num', fn: function (r) { return moneyP(r.retail); } },
      { title: 'Статус', cls: 'center', fn: function (r) {
        return badge(r.statusText, r.status === 'paid' ? 'green' : (r.status === 'part' ? 'yellow' : 'red')); } }
    ], mp.docs, { step: 80 }));

    h += panel('Долг по поставщикам (по документам 1С)', table('bal1c', [
      { title: 'Поставщик', fn: function (r) {
        var phone = CACHE.contactsIdx[E.norm(r.supplier)];
        return esc(r.supplier) + (phone ? ' <a class="tel" href="tel:' + esc(phone) + '">📞 ' + esc(phone) + '</a>' : ''); } },
      { title: 'Накладных', cls: 'num', fn: function (r) { return nf(r.docs); } },
      { title: 'Поставки', cls: 'num', fn: function (r) { return moneyP(r.sum); } },
      { title: 'Оплачено сразу', cls: 'num', fn: function (r) { return moneyP(r.paidNow); } },
      { title: 'Погашение долгов', cls: 'num', fn: function (r) { return moneyP(r.paidDebt); } },
      { title: 'Оплачено всего', cls: 'num', fn: function (r) { return moneyP(r.paid); } },
      { title: 'Текущий долг', cls: 'num', fn: function (r) { return '<span class="' + (r.debt > 0 ? 'trend-neg' : 'trend-pos') + ' private-data">' + money(r.debt) + '</span>'; } },
      { title: 'Статус', cls: 'center', fn: function (r) {
        return badge(r.debt <= 0 ? 'Рассчитались' : (r.paid > 0 ? 'Частичный долг' : 'Долг 100%'),
          r.debt <= 0 ? 'green' : (r.paid > 0 ? 'yellow' : 'red')); } }
    ], bal, { step: 60 }));

    h += '<div class="panel"><div class="panel-body muted">Долг считается так: сумма накладной минус расходные ордера, ' +
      'выписанные на эту накладную. Оплаты по накладным вне периода выгрузки показаны отдельно как погашение старых долгов ' +
      '(' + money(mp.oldDebtPaid) + ').' + (mp.overpaid > 0 ? ' Переплаты по отдельным документам: ' + money(mp.overpaid) + '.' : '') + '</div></div>';
    return h;
  }

  /* --- 9. Инвентаризация --------------------------------------------------- */
  function viewInventory() {
    var rows = (S.state.inventory || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var lost = 0, extra = 0;
    rows.forEach(function (r) {
      var d = (num(r.fact) - num(r.accounted)) * num(r.price);
      if (d < 0) lost += d; else extra += d;
    });

    var h = '<div class="kpi-grid">' +
      kpi('Недостача по факту', money(lost), 'Позиций с минусом: ' + rows.filter(function (r) { return num(r.fact) < num(r.accounted); }).length, 'var(--red)') +
      kpi('Излишки', money(extra), 'Чаще всего — пересортица', 'var(--green)') +
      kpi('Итог инвентаризации', money(lost + extra), 'Разница учёт vs факт') +
      kpi('Позиций проверено', nf(rows.length), 'За ' + periodName().toLowerCase()) +
      '</div>';

    h += panel('Добавить позицию в сличительную ведомость',
      '<form id="invtForm"><div class="form-grid">' +
      field('Дата', 'date', 'date', todayISO()) +
      field('Товар', 'name', 'text', '', { attrs: ' list="stockList"' }) +
      field('Группа', 'group', 'text', '') +
      field('По учёту, шт', 'accounted', 'number', '', { step: '0.001' }) +
      field('По факту, шт', 'fact', 'number', '', { step: '0.001' }) +
      field('Цена, ₽', 'price', 'number', '', { step: '0.01' }) +
      field('Причина', 'reason', 'text', '', { placeholder: 'пересортица, бой, хищение…' }) +
      '</div>' + stockDatalist() +
      '<div class="form-actions"><button type="submit" class="btn-tool btn-primary">💾 Записать</button></div></form>');

    h += panel('Сличительная ведомость: учёт vs факт', table('invtTbl', [
      { title: 'Дата', fn: function (r) { return esc(r.date); } },
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Группа', fn: function (r) { return esc(r.group || '—'); } },
      { title: 'Учёт', cls: 'num', fn: function (r) { return nf(r.accounted, 2); } },
      { title: 'Факт', cls: 'num', fn: function (r) { return nf(r.fact, 2); } },
      { title: 'Разница, шт', cls: 'num', fn: function (r) {
        var d = num(r.fact) - num(r.accounted);
        return '<span class="' + signClass(d) + '">' + (d > 0 ? '+' : '') + nf(d, 2) + '</span>'; } },
      { title: 'Сумма разницы', cls: 'num', fn: function (r) {
        var d = (num(r.fact) - num(r.accounted)) * num(r.price);
        return '<span class="' + signClass(d) + ' private-data">' + money(d) + '</span>'; } },
      { title: 'Причина', fn: function (r) { return esc(r.reason || '—'); } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn-tool btn-mini btn-danger" data-action="del" data-coll="inventory" data-id="' + r.id + '">✕</button>'; } }
    ], rows, { step: 60, empty: 'Инвентаризация не проводилась' }));
    return h;
  }

  /* --- 10. Списания и возвраты (отчёты 1С) --------------------------------- */
  function viewLosses() {
    if (!DATA.writeoffs.length && !DATA.returns.length) {
      return noData('Отчёты списаний и возвратов не загружены',
        'Выгрузите из 1С отчёты <b>«Причины списания»</b> и <b>«Причины возврата»</b> в папку базы и нажмите «Синхронизировать».');
    }
    var wSum = CACHE.writeoffSum, rSum = CACHE.returnSum;
    var wDays = DATA.writeoffsPeriod ? DATA.writeoffsPeriod.days : 30;
    var revenue = CACHE.salesTotals ? CACHE.salesTotals.revenue : 0;
    var salesDays = DATA.salesPeriod ? DATA.salesPeriod.days : 30;
    var wPerDay = E.div(wSum, wDays), revPerDay = E.div(revenue, salesDays);

    var h = '<div class="kpi-grid">' +
      kpi('Списания за период', money(wSum), DATA.writeoffsPeriod ? DATA.writeoffsPeriod.from + ' – ' + DATA.writeoffsPeriod.to + ' (' + wDays + ' дн.)' : '', 'var(--red)') +
      kpi('Списания в месяц', money(E.perMonth(wSum, wDays)), 'В день ' + money(wPerDay)) +
      kpi('Доля от оборота', pct(E.div(wPerDay, revPerDay) * 100), 'Сравнение среднедневных величин',
        E.div(wPerDay, revPerDay) * 100 > 2 ? 'var(--red)' : 'var(--green)') +
      kpi('Возвраты поставщикам', money(rSum), nf(DATA.returns.length) + ' строк возвратов') +
      '</div>';

    h += panel('Списания по причинам', table('woReason', [
      { title: 'Причина', fn: function (r) { return esc(r.reason); } },
      { title: 'Документов', cls: 'num', fn: function (r) { return nf(r.docs); } },
      { title: 'Количество', cls: 'num', fn: function (r) { return nf(r.qty, 2); } },
      { title: 'Сумма по себестоимости', cls: 'num', fn: function (r) { return moneyP(r.cost); } },
      { title: 'В рознице', cls: 'num', fn: function (r) { return moneyP(r.retail); } },
      { title: 'Доля', cls: 'center', fn: function (r) { return pct(r.share); } },
      { title: 'На что смотреть', fn: function (r) {
        var n = E.norm(r.reason);
        if (n.indexOf('инвентариз') >= 0) return 'Потери на полке: пересчёт, воровство, ошибки приёмки';
        if (n.indexOf('просроч') >= 0) return 'Работать сроками годности (экран FEFO)';
        if (n.indexOf('краж') >= 0) return 'Зона видеонаблюдения и выкладка';
        if (n.indexOf('без причины') >= 0) return 'Требовать от сотрудников указывать причину';
        return 'Контроль на месте'; } }
    ], E.byReason(DATA.writeoffs), { step: 20 }));

    h += panel('Топ-30 позиций по сумме списаний', table('woTop', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Списано', cls: 'num', fn: function (r) { return nf(r.qty, 2); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return moneyP(r.cost); } },
      { title: 'В рознице', cls: 'num', fn: function (r) { return moneyP(r.retail); } },
      { title: 'Документов', cls: 'num', fn: function (r) { return nf(r.docs); } },
      { title: 'Причины', fn: function (r) { return esc(r.reason); } }
    ], E.topByCost(DATA.writeoffs, 30), { step: 30 }));

    if (DATA.returns.length) {
      h += panel('Возвраты по причинам', table('retReason', [
        { title: 'Причина возврата', fn: function (r) { return esc(r.reason); } },
        { title: 'Строк', cls: 'num', fn: function (r) { return nf(r.docs); } },
        { title: 'Количество', cls: 'num', fn: function (r) { return nf(r.qty, 2); } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return moneyP(r.cost); } },
        { title: 'Доля', cls: 'center', fn: function (r) { return pct(r.share); } }
      ], E.byReason(DATA.returns), { step: 20 }));

      h += panel('Топ-20 позиций по возвратам', table('retTop', [
        { title: 'Товар', fn: function (r) { return esc(r.name); } },
        { title: 'Возвращено', cls: 'num', fn: function (r) { return nf(r.qty, 2); } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return moneyP(r.cost); } },
        { title: 'Причины', fn: function (r) { return esc(r.reason); } }
      ], E.topByCost(DATA.returns, 20), { step: 20 }));
    }
    return h;
  }

  /* --- 11. Финансы и P&L ---------------------------------------------------- */
  function viewPnl() {
    if (!DATA.sales.length) return needSales();
    var writeMonth = S.settings.writeoffsToMonth && DATA.writeoffsPeriod
      ? E.perMonth(CACHE.writeoffSum, DATA.writeoffsPeriod.days) : CACHE.writeoffSum;
    var payroll = E.payrollSummary(filtered('timesheet'), filtered('payouts'));
    var accrued = payroll.reduce(function (a, r) { return a + r.accrued; }, 0);
    var salesDays = DATA.salesPeriod ? DATA.salesPeriod.days : 30;
    // приводим выручку и себестоимость к месяцу, чтобы сравнивать с месячными расходами
    var scale = 30 / salesDays;
    var scaled = DATA.sales.map(function (r) {
      return { revenue: r.revenue * scale, cogs: r.cogs * scale, qty: r.qty, discount: r.discount * scale };
    });
    var pl = E.pnl(scaled, S.settings, writeMonth, accrued);

    var rows = [
      { name: 'Выручка от продаж (отчёт 1С)', type: 'Доход', value: pl.revenue, share: 100 },
      { name: 'Себестоимость проданного (COGS)', type: 'Прямые', value: -pl.cogs, share: E.div(pl.cogs, pl.revenue) * 100 },
      { name: 'ВАЛОВАЯ ПРИБЫЛЬ', type: 'Итог', value: pl.gross, share: pl.margin, bold: true }
    ];
    pl.opex.forEach(function (o) {
      rows.push({ name: o.name, type: 'OPEX', value: -o.value, share: E.div(o.value, pl.revenue) * 100 });
    });
    rows.push({ name: 'ЧИСТАЯ ПРИБЫЛЬ (за месяц)', type: 'Итог', value: pl.net, share: pl.netMargin, bold: true });

    var h = '<div class="kpi-grid">' +
      kpi('Выручка (месяц)', money(pl.revenue), 'Отчёт за ' + salesDays + ' дн., приведён к 30') +
      kpi('Валовая прибыль', money(pl.gross), 'Маржинальность ' + pct(pl.margin)) +
      kpi('Постоянные расходы + потери', money(pl.opexSum), 'Включая списания ' + money(writeMonth)) +
      kpi('Чистая прибыль', money(pl.net), 'Рентабельность ' + pct(pl.netMargin), pl.net >= 0 ? 'var(--cyan)' : 'var(--red)') +
      '</div>';

    h += panel('Управленческий P&L (в пересчёте на месяц)', table('pnlTbl', [
      { title: 'Статья', fn: function (r) { return r.bold ? '<strong>' + esc(r.name) + '</strong>' : esc(r.name); } },
      { title: 'Тип', cls: 'center', fn: function (r) { return esc(r.type); } },
      { title: 'Сумма', cls: 'num', fn: function (r) {
        return '<span class="' + (r.value >= 0 ? '' : 'trend-neg') + ' private-data">' + money(r.value) + '</span>'; } },
      { title: 'Доля от выручки', cls: 'center', fn: function (r) { return pct(Math.abs(r.share)); } }
    ], rows, { step: 20 }));

    h += panel('Из чего собран отчёт',
      '<div class="panel-body">Выручка и себестоимость — из отчёта 1С «Продажи» за ' + salesDays + ' дн., приведены к 30 дням.<br>' +
      'ФОТ — ' + (accrued > 0 ? 'по табелю смен: ' + money(accrued) : 'из настроек: ' + money(S.settings.fot)) + '.<br>' +
      'Списания — ' + (DATA.writeoffsPeriod ? 'из отчёта 1С за ' + DATA.writeoffsPeriod.days + ' дн., приведены к месяцу' : 'отчёт не загружен') + '.<br>' +
      'Аренда, коммуналка, налоги и прочее — из экрана «Настройки».</div>');
    return h;
  }

  /* --- 12. Платёжный календарь ---------------------------------------------- */
  function viewCalendar() {
    var rows = [];
    (S.state.invoices || []).forEach(function (r) {
      var c = E.invoiceCalc(r);
      if (c.left > 0) rows.push({ due: r.due || r.date, supplier: r.supplier, doc: r.doc, sum: c.left, src: 'журнал' });
    });
    if (CACHE.payments) {
      CACHE.payments.docs.forEach(function (d) {
        if (d.left > 0) rows.push({ due: d.date, supplier: d.supplier, doc: d.doc.replace('Приходная накладная ', ''), sum: d.left, src: '1С' });
      });
    }
    rows.sort(function (a, b) { return (a.due || '').localeCompare(b.due || ''); });
    var total = rows.reduce(function (a, r) { return a + r.sum; }, 0);
    var today = todayISO();
    var overdue = rows.filter(function (r) { return r.due && r.due < today; });

    var h = '<div class="kpi-grid">' +
      kpi('К оплате всего', money(total), nf(rows.length) + ' неоплаченных документов', 'var(--red)') +
      kpi('Просрочено', money(overdue.reduce(function (a, r) { return a + r.sum; }, 0)), nf(overdue.length) + ' документов старше сегодняшней даты', 'var(--red)') +
      kpi('Оплатить сегодня', money(rows.filter(function (r) { return r.due === today; }).reduce(function (a, r) { return a + r.sum; }, 0)), today) +
      kpi('Свободные деньги в кассе', money(E.shiftsTotals(filtered('shifts')).factCash), 'Факт наличных по последним сменам') +
      '</div>';

    h += panel('Платёжный календарь: кому и когда платить', table('calTbl', [
      { title: 'Дата документа / срок', cls: 'center', fn: function (r) {
        var late = r.due && r.due < today;
        return '<span class="' + (late ? 'trend-neg' : '') + '">' + esc(r.due || '—') + '</span>'; } },
      { title: 'Поставщик', fn: function (r) {
        var phone = CACHE.contactsIdx[E.norm(r.supplier)];
        return esc(r.supplier || '—') + (phone ? '<div><a class="tel" href="tel:' + esc(phone) + '">📞 ' + esc(phone) + '</a></div>' : ''); } },
      { title: 'Документ', fn: function (r) { return esc(r.doc || '—'); } },
      { title: 'К оплате', cls: 'num', fn: function (r) { return moneyP(r.sum); } },
      { title: 'Источник', cls: 'center', fn: function (r) { return badge(r.src, r.src === '1С' ? 'blue' : 'grey'); } },
      { title: 'Статус', cls: 'center', fn: function (r) {
        if (!r.due) return badge('Срок не указан', 'grey');
        if (r.due < today) return badge('Просрочено', 'red');
        if (r.due === today) return badge('Оплатить сегодня', 'yellow');
        return badge('Запланировано', 'green'); } }
    ], rows, { step: 80, empty: 'Неоплаченных накладных нет' }));
    return h;
  }

  /* --- 13. Наценка и KVI ---------------------------------------------------- */
  function viewPricing() {
    var kvi = (S.state.kvi || []).map(function (r) {
      var stock = CACHE.stockIdx ? CACHE.stockIdx[E.norm(r.name)] : null;
      var best = CACHE.bestPrices ? CACHE.bestPrices[E.norm(r.name)] : null;
      var cost = num(r.cost) || (stock ? stock.buyPrice : 0) || (best ? best.price : 0);
      var our = num(r.ourPrice) || (stock ? stock.retailPrice : 0);
      return {
        id: r.id, name: r.name, cost: cost, our: our, comp: num(r.competitorPrice),
        markup: cost > 0 ? E.div(our - cost, cost) * 100 : 0,
        margin: our > 0 ? E.div(our - cost, our) * 100 : 0,
        diff: num(r.competitorPrice) > 0 ? E.safeRound(our - num(r.competitorPrice)) : null,
        bestSupplier: best ? best.supplier : ''
      };
    });

    var h = panel('Добавить маркерный товар (KVI) для контроля цены',
      '<form id="kviForm"><div class="form-grid">' +
      field('Товар', 'name', 'text', '', { attrs: ' list="stockList"' }) +
      field('Себестоимость, ₽ (пусто = из 1С)', 'cost', 'number', '', { step: '0.01' }) +
      field('Наша цена, ₽ (пусто = из 1С)', 'ourPrice', 'number', '', { step: '0.01' }) +
      field('Цена у соседей, ₽', 'competitorPrice', 'number', '', { step: '0.01' }) +
      '</div>' + stockDatalist() +
      '<div class="form-actions"><button type="submit" class="btn-tool btn-primary">💾 Добавить в мониторинг</button></div></form>');

    h += panel('KVI: наши цены против конкурентов', table('kviTbl', [
      { title: 'Маркерный товар', fn: function (r) { return esc(r.name); } },
      { title: 'Себестоимость', cls: 'num', fn: function (r) { return moneyP(r.cost); } },
      { title: 'Наша цена', cls: 'num', fn: function (r) { return moneyP(r.our); } },
      { title: 'Наценка', cls: 'center', fn: function (r) { return pct(r.markup); } },
      { title: 'Маржа', cls: 'center', fn: function (r) { return pct(r.margin); } },
      { title: 'У соседей', cls: 'num', fn: function (r) { return r.comp ? moneyP(r.comp) : '<span class="muted">—</span>'; } },
      { title: 'Разница', cls: 'num', fn: function (r) {
        if (r.diff == null) return '<span class="muted">—</span>';
        return '<span class="' + (r.diff <= 0 ? 'trend-pos' : 'trend-neg') + '">' + (r.diff > 0 ? '+' : '') + money(r.diff) + '</span>'; } },
      { title: 'Рекомендация', fn: function (r) {
        if (r.diff == null) return 'Внесите цену конкурента';
        if (r.diff <= 0) return '🟢 Держим цену ниже соседей — так и оставить';
        return '🔴 Дороже соседей на ' + money(r.diff) + ' — снизить или объяснить покупателю'; } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn-tool btn-mini btn-danger" data-action="del" data-coll="kvi" data-id="' + r.id + '">✕</button>'; } }
    ], kvi, { step: 40, empty: 'Маркерные товары не заданы. Обычно это хлеб, молоко, яйца, сахар, вода.' }));

    if (DATA.stock.length) {
      var low = DATA.stock.filter(function (r) { return r.buyPrice > 0 && r.retailPrice > 0 && r.qty > 0; })
        .map(function (r) { return { name: r.name, group: r.group, buy: r.buyPrice, retail: r.retailPrice, qty: r.qty,
          markup: E.div(r.retailPrice - r.buyPrice, r.buyPrice) * 100 }; })
        .sort(function (a, b) { return a.markup - b.markup; }).slice(0, 40);
      h += panel('Товары с самой низкой наценкой (проверить цены)', table('lowMarkup', [
        { title: 'Товар', fn: function (r) { return esc(r.name); } },
        { title: 'Группа', fn: function (r) { return esc(r.group); } },
        { title: 'Остаток', cls: 'num', fn: function (r) { return nf(r.qty, 2); } },
        { title: 'Закупка', cls: 'num', fn: function (r) { return moneyP(r.buy); } },
        { title: 'Розница', cls: 'num', fn: function (r) { return moneyP(r.retail); } },
        { title: 'Наценка', cls: 'center', fn: function (r) {
          return '<span class="' + (r.markup < 10 ? 'trend-neg' : (r.markup < 20 ? 'trend-warn' : '')) + '">' + pct(r.markup) + '</span>'; } }
      ], low, { step: 40 }));
    }
    return h;
  }

  /* --- 14. Цены поставщиков ------------------------------------------------- */
  function viewSuppliers() {
    if (!DATA.prices.length) {
      return noData('Цены поставщиков не загружены',
        'Нужен отчёт 1С <b>«Текущие цены поставщиков»</b> и, желательно, <b>«Контакты поставщиков»</b>.');
    }
    var q = ($('globalSearch') && $('globalSearch').value || '').trim();
    var cmp = CACHE.comparison;
    if (!cmp) { cmp = CACHE.comparison = E.priceComparison(DATA.prices, CACHE.contactsIdx); }
    var rows = cmp;
    if (q) { var nq = E.norm(q); rows = rows.filter(function (r) {
      return r.key.indexOf(nq) >= 0 || (r.barcode && r.barcode.indexOf(nq) >= 0) ||
        r.offers.some(function (o) { return E.norm(o.supplier).indexOf(nq) >= 0; }); }); }

    var multi = cmp.filter(function (r) { return r.suppliers > 1; });
    var save = multi.reduce(function (a, r) { return a + r.spread; }, 0);

    var h = '<div class="kpi-grid">' +
      kpi('Цен в базе', nf(DATA.prices.length), 'Поставщиков: ' + nf(new Set(DATA.prices.map(function (p) { return p.supplier; })).size)) +
      kpi('Товаров с выбором', nf(multi.length), 'Есть предложения от 2+ поставщиков') +
      kpi('Потенциал экономии', money(save), 'Если брать везде по лучшей цене (на единицу)') +
      kpi('Контактов с телефоном', nf(DATA.contacts.filter(function (c) { return c.phone; }).length), 'Звонок прямо из таблицы') +
      '</div>';

    h += panel('Сравнение цен: где дешевле' + (q ? ' — фильтр «' + esc(q) + '»' : ''), table('cmpTbl', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Группа', fn: function (r) { return esc(r.group || '—'); } },
      { title: 'Предложений', cls: 'center', fn: function (r) { return nf(r.suppliers); } },
      { title: 'Лучшая цена', cls: 'num', fn: function (r) { return '<span class="trend-pos private-data">' + money(r.min) + '</span>'; } },
      { title: 'Лучший поставщик', fn: function (r) {
        return esc(r.bestSupplier) + (r.bestPhone ? '<div><a class="tel" href="tel:' + esc(r.bestPhone) + '">📞 ' + esc(r.bestPhone) + '</a></div>' : ''); } },
      { title: 'Дороже всех', cls: 'num', fn: function (r) { return moneyP(r.max); } },
      { title: 'Экономия на единицу', cls: 'num', fn: function (r) {
        return r.spread > 0 ? '<span class="trend-pos private-data">' + money(r.spread) + '</span>' : '<span class="muted">—</span>'; } },
      { title: 'Все предложения', fn: function (r) {
        return r.offers.slice(0, 4).map(function (o, i) {
          return '<div>' + (i === 0 ? '🟢 ' : '🔴 ') + esc(o.supplier) + ' — <span class="private-data">' + money(o.price) + '</span>' +
            (i > 0 ? ' <span class="muted">(+' + money(o.price - r.min) + ')</span>' : '') + '</div>';
        }).join('') + (r.offers.length > 4 ? '<div class="muted">…ещё ' + (r.offers.length - 4) + '</div>' : ''); } }
    ], rows, { step: 40, empty: 'Ничего не найдено' }));

    h += panel('Телефонная книга поставщиков', table('contactsTbl', [
      { title: 'Контрагент', fn: function (r) { return esc(r.name); } },
      { title: 'Телефон', fn: function (r) { return r.phone ? '<a class="tel" href="tel:' + esc(r.phone) + '">📞 ' + esc(r.phone) + '</a>' : '<span class="muted">не указан</span>'; } },
      { title: 'Позиций в прайсе', cls: 'num', fn: function (r) { return nf(CACHE.bySupplier[r.key] || 0); } }
    ], q ? DATA.contacts.filter(function (c) { return c.key.indexOf(E.norm(q)) >= 0 || (c.phone || '').indexOf(q.replace(/\D/g, '')) >= 0; }) : DATA.contacts,
      { step: 50, empty: 'Контакты не загружены' }));
    return h;
  }

  /* --- 15. Табель и зарплата ------------------------------------------------ */
  function viewStaff() {
    var ts = filtered('timesheet').sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var po = filtered('payouts').sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var sum = E.payrollSummary(ts, po);
    var accrued = sum.reduce(function (a, r) { return a + r.accrued; }, 0);
    var paid = sum.reduce(function (a, r) { return a + r.paid; }, 0);
    var hours = sum.reduce(function (a, r) { return a + r.hours; }, 0);

    var h = '<div class="kpi-grid">' +
      kpi('Начислено по табелю', money(accrued), 'За ' + periodName().toLowerCase() + ' • смен: ' + ts.length) +
      kpi('Выплачено', money(paid), 'Авансы и зарплата') +
      kpi('Остаток к выплате', money(accrued - paid), 'Текущий долг перед сотрудниками',
        accrued - paid > 0 ? 'var(--yellow)' : 'var(--green)') +
      kpi('Отработано часов', nf(hours), 'Сотрудников в табеле: ' + sum.length) +
      '</div>';

    h += panel('Отметить смену в табеле',
      '<form id="tsForm"><div class="form-grid">' +
      field('Дата', 'date', 'date', todayISO()) +
      field('Сотрудник', 'employee', 'text', '', { attrs: ' list="staffList"' }) +
      field('Должность', 'position', 'text', 'Кассир') +
      field('Смена', 'shift', 'select', 'Дневная', { options: ['Дневная', 'Ночная', 'Суточная'] }) +
      field('Отработано часов', 'hours', 'number', 12, { step: '0.5' }) +
      field('Ставка, ₽/час', 'rate', 'number', S.settings.rateDay, { step: '0.01' }) +
      field('Штраф / удержание, ₽', 'penalty', 'number', 0, { step: '0.01' }) +
      field('Премия, ₽', 'bonus', 'number', 0, { step: '0.01' }) +
      '</div>' + staffDatalist() +
      '<div class="calc-preview">Начислено за смену = часы × ставка − штраф + премия</div>' +
      '<div class="form-actions"><button type="submit" class="btn-tool btn-primary">💾 Записать смену</button></div></form>');

    h += panel('Выдать аванс или зарплату',
      '<form id="poForm"><div class="form-grid">' +
      field('Дата', 'date', 'date', todayISO()) +
      field('Сотрудник', 'employee', 'text', '', { attrs: ' list="staffList"' }) +
      field('Тип выплаты', 'type', 'select', 'Аванс', { options: ['Аванс', 'Зарплата', 'Премия', 'Прочее'] }) +
      field('Сумма, ₽', 'amount', 'number', '', { step: '0.01' }) +
      field('Форма оплаты', 'form', 'select', 'Наличные из кассы', { options: ['Наличные из кассы', 'Перевод СБП', 'Банковский перевод'] }) +
      field('Основание', 'note', 'text', '') +
      field('Выдал', 'issuedBy', 'text', '') +
      '</div><div class="form-actions"><button type="submit" class="btn-tool btn-primary">💾 Записать выплату</button></div></form>');

    h += panel('Расчётная ведомость', table('payrollTbl', [
      { title: 'Сотрудник', fn: function (r) { return esc(r.employee); } },
      { title: 'Должность', fn: function (r) { return esc(r.position || '—'); } },
      { title: 'Смен', cls: 'num', fn: function (r) { return nf(r.shifts); } },
      { title: 'Часов', cls: 'num', fn: function (r) { return nf(r.hours, 1); } },
      { title: 'Ставка/час', cls: 'num', fn: function (r) { return moneyP(r.rate); } },
      { title: 'Смена 12 ч', cls: 'num', fn: function (r) { return moneyP(r.dayRate); } },
      { title: 'Начислено', cls: 'num', fn: function (r) { return moneyP(r.accrued); } },
      { title: 'Выплачено', cls: 'num', fn: function (r) { return moneyP(r.paid); } },
      { title: 'Осталось выплатить', cls: 'num', fn: function (r) {
        return '<span class="' + (r.left > 0 ? 'trend-warn' : 'trend-pos') + ' private-data">' + money(r.left) + '</span>'; } },
      { title: 'Статус', cls: 'center', fn: function (r) {
        return badge(r.left > 0 ? 'К выплате' : (r.left === 0 ? 'Рассчитан' : 'Переплата'), r.left > 0 ? 'yellow' : (r.left === 0 ? 'green' : 'red')); } }
    ], sum, { step: 40, empty: 'Табель пуст' }));

    h += panel('Табель смен', table('tsTbl', [
      { title: 'Дата', fn: function (r) { return esc(r.date); } },
      { title: 'Сотрудник', fn: function (r) { return esc(r.employee); } },
      { title: 'Должность', fn: function (r) { return esc(r.position || '—'); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift); } },
      { title: 'Часы', cls: 'num', fn: function (r) { return nf(r.hours, 1); } },
      { title: 'Ставка', cls: 'num', fn: function (r) { return moneyP(r.rate); } },
      { title: 'Штраф', cls: 'num', fn: function (r) { return moneyP(r.penalty); } },
      { title: 'Премия', cls: 'num', fn: function (r) { return moneyP(r.bonus); } },
      { title: 'Начислено', cls: 'num', fn: function (r) { return moneyP(E.timesheetCalc(r)); } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn-tool btn-mini btn-danger" data-action="del" data-coll="timesheet" data-id="' + r.id + '">✕</button>'; } }
    ], ts, { step: 60, empty: 'Смен нет' }));

    h += panel('Журнал выплат', table('poTbl', [
      { title: 'Дата', fn: function (r) { return esc(r.date); } },
      { title: 'Сотрудник', fn: function (r) { return esc(r.employee); } },
      { title: 'Тип', fn: function (r) { return esc(r.type); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return moneyP(r.amount); } },
      { title: 'Форма', fn: function (r) { return esc(r.form); } },
      { title: 'Основание', fn: function (r) { return esc(r.note || '—'); } },
      { title: 'Выдал', fn: function (r) { return esc(r.issuedBy || '—'); } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn-tool btn-mini btn-danger" data-action="del" data-coll="payouts" data-id="' + r.id + '">✕</button>'; } }
    ], po, { step: 60, empty: 'Выплат нет' }));
    return h;
  }

  function staffDatalist() {
    var names = {};
    (S.state.timesheet || []).forEach(function (r) { if (r.employee) names[r.employee] = 1; });
    (S.state.payouts || []).forEach(function (r) { if (r.employee) names[r.employee] = 1; });
    return '<datalist id="staffList">' + Object.keys(names).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>';
  }

  /* --- 16. Антифрод кассы --------------------------------------------------- */
  function viewFraud() {
    var shifts = filtered('shifts');
    var map = {};
    shifts.forEach(function (s) {
      var k = s.cashier || '—';
      if (!map[k]) map[k] = { cashier: k, shifts: 0, day: 0, night: 0, z: 0, payouts: 0, fact: 0, diff: 0, short: 0, over: 0 };
      var c = E.shiftCalc(s);
      map[k].shifts++;
      if (s.shift === 'Ночная') map[k].night++; else map[k].day++;
      map[k].z += num(s.zCash); map[k].payouts += num(s.payouts); map[k].fact += num(s.factCash);
      map[k].diff += c.diff;
      if (c.diff < 0) map[k].short += Math.abs(c.diff);
      if (c.diff > 0) map[k].over += c.diff;
    });
    var rows = Object.keys(map).map(function (k) {
      var m = map[k];
      for (var f in m) if (typeof m[f] === 'number') m[f] = E.safeRound(m[f]);
      return m;
    }).sort(function (a, b) { return a.diff - b.diff; });

    var totalShort = rows.reduce(function (a, r) { return a + r.short; }, 0);
    var h = '<div class="kpi-grid">' +
      kpi('Кассиров в периоде', nf(rows.length), 'Смен всего: ' + shifts.length) +
      kpi('Сумма недостач', money(totalShort), 'Удерживается по табелю как штраф', 'var(--red)') +
      kpi('Сумма излишков', money(rows.reduce(function (a, r) { return a + r.over; }, 0)), 'Проверить пробитие чеков', 'var(--yellow)') +
      kpi('Итог по кассе', money(rows.reduce(function (a, r) { return a + r.diff; }, 0)), 'Ноль — идеальная дисциплина') +
      '</div>';

    h += panel('Рейтинг кассовой дисциплины', table('fraudTbl', [
      { title: 'Кассир', fn: function (r) { return esc(r.cashier); } },
      { title: 'Смен', cls: 'center', fn: function (r) { return nf(r.shifts) + ' <span class="muted">(день ' + r.day + ' / ночь ' + r.night + ')</span>'; } },
      { title: 'Z-отчёт нал', cls: 'num', fn: function (r) { return moneyP(r.z); } },
      { title: 'Выплаты из кассы', cls: 'num', fn: function (r) { return moneyP(r.payouts); } },
      { title: 'Сдано фактом', cls: 'num', fn: function (r) { return moneyP(r.fact); } },
      { title: 'Недостачи', cls: 'num', fn: function (r) { return r.short ? '<span class="trend-neg private-data">' + money(r.short) + '</span>' : '<span class="muted">—</span>'; } },
      { title: 'Излишки', cls: 'num', fn: function (r) { return r.over ? '<span class="trend-warn private-data">' + money(r.over) + '</span>' : '<span class="muted">—</span>'; } },
      { title: 'Итог', cls: 'num', fn: function (r) { return '<span class="' + signClass(r.diff) + ' private-data">' + money(r.diff) + '</span>'; } },
      { title: 'Статус', cls: 'center', fn: function (r) {
        if (r.diff === 0) return badge('Идеально', 'green');
        if (r.diff > 0) return badge('Излишек ' + money(r.diff), 'yellow');
        return badge('Недостача ' + money(Math.abs(r.diff)), 'red'); } }
    ], rows, { step: 40, empty: 'Смен за период нет' }));
    return h;
  }

  /* --- 17. Умный поиск ------------------------------------------------------ */
  function viewSearch() {
    var q = ($('globalSearch') && $('globalSearch').value || '').trim();
    var scope = ($('searchScope') && $('searchScope').value) || 'all';
    if (!q) {
      return noData('Введите запрос в строке поиска сверху',
        'Ищет по названию товара, штрихкоду, артикулу, поставщику и телефону — сразу во всех загруженных данных.');
    }
    var res = E.search(q, DATA, scope, 300);
    return panel('Результаты поиска «' + esc(q) + '» — найдено: ' + nf(res.length), table('searchTbl', [
      { title: 'Где найдено', fn: function (r) { return badge(r.type, 'blue'); } },
      { title: 'Название', fn: function (r) { return esc(r.name); } },
      { title: '', fn: function (r) { return esc(r.cols[0] || ''); } },
      { title: '', cls: 'num', fn: function (r) { return '<span class="private-data">' + esc(r.cols[1] || '') + '</span>'; } },
      { title: '', cls: 'num', fn: function (r) { return '<span class="private-data">' + esc(r.cols[2] || '') + '</span>'; } }
    ], res, { step: 100, empty: 'Ничего не найдено' }));
  }

  /* --- 18. Данные и синхронизация ------------------------------------------- */
  var KIND_NAMES = {
    sales: 'Продажи (ОРП)', stock: 'Остатки номенклатуры', prices: 'Цены поставщиков',
    contacts: 'Контакты поставщиков', pricelist: 'Прайс-лист', barcodes: 'Справочник штрихкодов',
    units: 'Справочник единиц измерения', writeoffs1c: 'Причины списания', writeoffs: 'Списания (Excel)',
    returns: 'Причины возврата', invoices1c: 'Приходные накладные', cashout: 'Расходные кассовые ордера',
    cashin: 'Приходные кассовые ордера', journal_shifts: 'Журнал смен и накладных',
    journal_staff: 'Табель и выплаты', owner_book: 'Ваша книга ДДС', unknown: 'Не распознан'
  };

  function viewData() {
    var need = [
      { kind: 'sales', name: 'Продажи', why: 'выручка, прибыль, ABC, автозаказ' },
      { kind: 'stock', name: 'Остатки номенклатуры', why: 'склад, группы товаров, наценка' },
      { kind: 'prices', name: 'Текущие цены поставщиков', why: 'сравнение цен, лучшие предложения' },
      { kind: 'contacts', name: 'Контакты поставщиков', why: 'телефоны для звонка из таблиц' },
      { kind: 'invoices1c', name: 'Приходные накладные', why: 'поставки и долги поставщикам' },
      { kind: 'cashout', name: 'Расходные кассовые ордера', why: 'оплаты налом и погашение долгов' },
      { kind: 'writeoffs1c', name: 'Причины списания', why: 'потери, брак, просрочка' },
      { kind: 'returns', name: 'Причины возврата', why: 'возвраты поставщикам' },
      { kind: 'owner_book', name: 'Ваша книга ДДС (ручная таблица)', why: 'движение денег по сменам, оплаты, долг поставщикам' }
    ];
    var have = {};
    DATA.files.forEach(function (f) { have[f.kind] = f; });

    var h = panel('Как загрузить данные',
      '<div class="panel-body">1. Выгрузите из 1С отчёты в папку <b>Данные_1С_и_Excel</b> рядом с дашбордом.<br>' +
      '2. Нажмите «📂 Синхронизировать папку базы» вверху и укажите эту папку.<br>' +
      '3. Цифры пересчитаются сами. Файлы никуда не отправляются — всё считается на этом компьютере.</div>' +
      '<div class="form-actions" style="justify-content:flex-start">' +
      '<button class="btn-tool btn-primary" data-action="sync-folder">📂 Выбрать папку</button>' +
      '<button class="btn-tool" data-action="sync-files">📄 Выбрать отдельные файлы</button>' +
      (watchHandle
        ? '<button class="btn-tool btn-danger" data-action="watch-stop">⏹️ Остановить слежение</button>'
        : '<button class="btn-tool" data-action="watch-start">🔄 Следить за папкой автоматически</button>') +
      '</div>');

    h += panel('Загруженные файлы', table('filesTbl', [
      { title: 'Файл', fn: function (r) { return esc(r.name); } },
      { title: 'Что это', fn: function (r) { return esc(KIND_NAMES[r.kind] || r.kind); } },
      { title: 'Строк', cls: 'num', fn: function (r) { return nf(r.rows); } },
      { title: 'Период отчёта', cls: 'center', fn: function (r) { return r.period ? esc(r.period.from + ' – ' + r.period.to) : '<span class="muted">—</span>'; } },
      { title: 'Размер', cls: 'num', fn: function (r) { return nf(Math.round(r.size / 1024)) + ' КБ'; } },
      { title: 'Статус', cls: 'center', fn: function (r) {
        return r.kind === 'unknown' ? badge('не распознан', 'red') : badge('загружен', 'green'); } },
      { title: 'Примечание', fn: function (r) { return esc(r.note || ''); } }
    ], DATA.files, { step: 30, empty: 'Файлы ещё не загружены' }));

    h += panel('Каких отчётов не хватает', table('needTbl', [
      { title: 'Отчёт 1С', fn: function (r) { return esc(r.name); } },
      { title: 'Что даёт', fn: function (r) { return esc(r.why); } },
      { title: 'Статус', cls: 'center', fn: function (r) {
        return have[r.kind] ? badge('загружен: ' + nf(have[r.kind].rows) + ' строк', 'green') : badge('нет', 'yellow'); } }
    ], need, { step: 20 }));

    h += panel('Резервная копия базы дашборда',
      '<div class="panel-body">Смены, накладные, табель, выплаты, сроки годности и настройки хранятся в этом браузере. ' +
      'Раз в неделю сохраняйте копию — если браузер переустановят, данные не пропадут.</div>' +
      '<div class="form-actions" style="justify-content:flex-start">' +
      '<button class="btn-tool btn-primary" data-action="backup">💾 Сохранить копию</button>' +
      '<button class="btn-tool" data-action="restore">📥 Загрузить копию</button>' +
      '<button class="btn-tool btn-danger" data-action="wipe">🗑️ Очистить журналы</button></div>');
    return h;
  }

  /* --- 19. Настройки --------------------------------------------------------- */
  function viewSettings() {
    var s = S.settings;
    var h = panel('Профиль магазина и постоянные расходы',
      '<form id="settingsForm"><div class="form-grid">' +
      field('Название магазина', 'storeName', 'text', s.storeName) +
      field('ФОТ сотрудников в месяц, ₽', 'fot', 'number', s.fot) +
      field('Аренда в месяц, ₽', 'rent', 'number', s.rent) +
      field('Коммуналка и свет, ₽', 'utilities', 'number', s.utilities) +
      field('Налоги и фиксированные платежи, ₽', 'taxes', 'number', s.taxes) +
      field('Прочие постоянные расходы, ₽', 'other', 'number', s.other) +
      field('Маржинальность вручную, % (пусто — считать из 1С)', 'marginManual', 'text', s.marginManual) +
      '</div>' +
      '<div class="form-grid">' +
      field('Ставка дневной смены, ₽/час', 'rateDay', 'number', s.rateDay) +
      field('Ставка ночной смены, ₽/час', 'rateNight', 'number', s.rateNight) +
      field('Разменный остаток в кассе, ₽', 'openCash', 'number', s.openCash) +
      field('Плечо доставки поставщика, дней', 'leadDays', 'number', s.leadDays) +
      field('Страховой запас, %', 'safetyPct', 'number', s.safetyPct) +
      field('Красная зона срока годности, дней', 'fefoCrit', 'number', s.fefoCrit) +
      field('Жёлтая зона срока годности, дней', 'fefoWarn', 'number', s.fefoWarn) +
      field('Уценка в красной зоне, %', 'discountCrit', 'number', s.discountCrit) +
      field('Скидка в жёлтой зоне, %', 'discountWarn', 'number', s.discountWarn) +
      field('Списания приводить к месяцу', 'writeoffsToMonth', 'select', s.writeoffsToMonth ? 'да' : 'нет', { options: ['да', 'нет'] }) +
      field('Проверять папку каждые, сек', 'autoSyncSeconds', 'number', s.autoSyncSeconds) +
      '</div>' +
      '<div class="hint">Постоянные расходы за месяц сейчас: <b>' + money(S.fixedMonthly()) + '</b>. ' +
      'Из них считается точка безубыточности и чистая прибыль.</div>' +
      '<div class="form-actions"><button type="submit" class="btn-tool btn-primary">💾 Сохранить и пересчитать</button></div></form>');
    return h;
  }


  /* --- Моя книга ДДС (ручной учёт владельца) -------------------------------- */
  function ownerRows() {
    if (!DATA.owner) return { rows: [], whole: false };
    var rows = DATA.owner.daily.filter(function (r) { return inPeriod(r.date); });
    if (!rows.length) return { rows: DATA.owner.daily, whole: true };  // в периоде пусто — показываем весь файл
    return { rows: rows, whole: false };
  }

  function viewOwnerBook() {
    if (!DATA.owner) {
      return noData('Ваша книга ДДС не загружена',
        'Положите свой файл (листы «ДДС», «ОПЛАТА», «ПЛАТЕЖКА», «ОТЧЁТ») в папку базы и нажмите «Синхронизировать папку базы».<br>' +
        'Дашборд прочитает его как есть — заполнять ничего заново не нужно.');
    }
    var sel = ownerRows(), rows = sel.rows;
    var t = E.ownerTotals(rows);
    var days = {};
    rows.forEach(function (r) { days[r.date] = true; });
    var period = rows.length ? Object.keys(days).sort()[0] + ' – ' + Object.keys(days).sort().pop() : '';

    var pays = DATA.owner.payments.filter(function (r) { return sel.whole || inPeriod(r.date); });
    var paySum = { paidCash: 0, paidDebt: 0, buyCredit: 0, salary: 0, other: 0, total: 0 };
    pays.forEach(function (r) { for (var k in paySum) paySum[k] += num(r[k]); });

    var h = '';
    if (sel.whole) {
      h += '<div class="panel"><div class="panel-body">За выбранный период (' + esc(periodName().toLowerCase()) +
        ') записей в книге нет — показан весь файл: ' + esc(period) + '.</div></div>';
    }

    h += '<div class="kpi-grid">' +
      kpi('Оборот по книге', money(t.revenue), period + ' • в среднем ' + money(t.avgDay) + ' в день') +
      kpi('Наличная торговля', money(t.cash), 'Доля ' + pct(E.div(t.cash, t.revenue) * 100) + ' от оборота') +
      kpi('Онлайн торговля', money(t.online), 'Доля ' + pct(E.div(t.online, t.revenue) * 100) + ' от оборота') +
      kpi('Долг поставщикам', money(t.debt), t.debtDate ? 'На ' + t.debtDate + ' (в начале было ' + money(DATA.owner.openingDebt) + ')' : '', 'var(--red)') +
      kpi('Закуп всего', money(t.buyTotal), 'В долг ' + money(t.buyCredit) + ' • за наличку ' + money(t.buyCash)) +
      kpi('Оплата долгов', money(t.payDebt), 'Погашено поставщикам за период') +
      kpi('Прибыль по книге', money(t.profit), 'Ваша формула: 25% от оборота минус расходы', t.profit >= 0 ? 'var(--cyan)' : 'var(--red)') +
      kpi('Расхождение кассы', money(t.diff), t.diff === 0 ? 'Касса сходится' : 'Проверьте смены', t.diff === 0 ? 'var(--green)' : 'var(--yellow)') +
      '</div>';

    var exp = [
      { name: 'Зарплата', v: t.salary }, { name: 'Аренда', v: t.rent },
      { name: 'Коммунальные услуги', v: t.utilities }, { name: 'Налог', v: t.tax },
      { name: 'Списание продукта', v: t.writeoff }, { name: 'Комиссия банка', v: t.bankFee },
      { name: 'Обед', v: t.lunch }, { name: 'ГСМ', v: t.fuel }, { name: 'Расходники', v: t.supplies }
    ].filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; });

    h += panel('Расходы за период по вашей книге', table('ownerExp', [
      { title: 'Статья', fn: function (r) { return esc(r.name); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return moneyP(r.v); } },
      { title: 'Доля от оборота', cls: 'center', fn: function (r) { return pct(E.div(r.v, t.revenue) * 100); } },
      { title: 'В день', cls: 'num', fn: function (r) { return moneyP(E.div(r.v, t.dayCount)); } }
    ], exp, { step: 20, empty: 'Расходы в книге не заполнены',
      totalRow: [{ html: 'ВСЕГО РАСХОДОВ' }, { html: money(t.expenses), cls: 'num' },
        { html: pct(E.div(t.expenses, t.revenue) * 100), cls: 'center' },
        { html: money(E.div(t.expenses, t.dayCount)), cls: 'num' }] }),
      '<button class="btn-tool" data-action="owner-to-settings">⚙️ Подставить эти расходы в настройки</button>');

    h += panel('Движение денег по сменам', table('ownerDaily', [
      { title: 'Дата', fn: function (r) { return esc(r.date); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift); } },
      { title: 'Наличная', cls: 'num', fn: function (r) { return moneyP(r.cash); } },
      { title: 'Онлайн', cls: 'num', fn: function (r) { return moneyP(r.online); } },
      { title: 'Оборот за день', cls: 'num', fn: function (r) { return r.revenue ? moneyP(r.revenue) : '<span class="muted">—</span>'; } },
      { title: 'Выплата кассы', cls: 'num', fn: function (r) { return moneyP(r.payout); } },
      { title: 'Расхождение', cls: 'num', fn: function (r) { return '<span class="' + signClass(r.diff) + ' private-data">' + money(r.diff) + '</span>'; } },
      { title: 'Закуп за наличку', cls: 'num', fn: function (r) { return moneyP(r.buyCashOffice); } },
      { title: 'Оплата долга', cls: 'num', fn: function (r) { return moneyP(r.payDebtOffice); } },
      { title: 'Закуп в долг', cls: 'num', fn: function (r) { return moneyP(r.buyCredit); } },
      { title: 'Списание', cls: 'num', fn: function (r) { return moneyP(r.writeoff); } },
      { title: 'Прибыль', cls: 'num', fn: function (r) { return r.profit ? '<span class="' + signClass(r.profit) + ' private-data">' + money(r.profit) + '</span>' : '<span class="muted">—</span>'; } },
      { title: 'Долг поставщикам', cls: 'num', fn: function (r) { return r.debt ? moneyP(r.debt) : '<span class="muted">—</span>'; } }
    ], rows.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (a.shift === 'День' ? 1 : -1); }),
      { step: 62, empty: 'Записей нет' }));

    if (pays.length) {
      var byDay = {};
      pays.forEach(function (r) {
        if (!byDay[r.date]) byDay[r.date] = { date: r.date, paidCash: 0, paidDebt: 0, buyCredit: 0, salary: 0, other: 0, total: 0, n: 0 };
        ['paidCash', 'paidDebt', 'buyCredit', 'salary', 'other', 'total'].forEach(function (k) { byDay[r.date][k] += num(r[k]); });
        byDay[r.date].n++;
      });
      var payRows = Object.keys(byDay).sort().reverse().map(function (k) { return byDay[k]; });
      h += panel('Оплаты поставщикам по дням (лист «ОПЛАТА»)', table('ownerPay', [
        { title: 'Дата', fn: function (r) { return esc(r.date); } },
        { title: 'Оплат', cls: 'num', fn: function (r) { return nf(r.n); } },
        { title: 'За наличку', cls: 'num', fn: function (r) { return moneyP(r.paidCash); } },
        { title: 'Оплата долга', cls: 'num', fn: function (r) { return moneyP(r.paidDebt); } },
        { title: 'Закуп в долг', cls: 'num', fn: function (r) { return moneyP(r.buyCredit); } },
        { title: 'Зарплата', cls: 'num', fn: function (r) { return moneyP(r.salary); } },
        { title: 'Прочие', cls: 'num', fn: function (r) { return moneyP(r.other); } },
        { title: 'Итого за день', cls: 'num', fn: function (r) { return moneyP(r.total); } }
      ], payRows, { step: 40,
        totalRow: [{ html: 'ИТОГО', span: 2 }, { html: money(paySum.paidCash), cls: 'num' },
          { html: money(paySum.paidDebt), cls: 'num' }, { html: money(paySum.buyCredit), cls: 'num' },
          { html: money(paySum.salary), cls: 'num' }, { html: money(paySum.other), cls: 'num' },
          { html: money(paySum.total), cls: 'num' }] }));
    }

    if (DATA.owner.payroll.length) {
      h += panel('Платёжная ведомость (лист «ПЛАТЕЖКА»)', table('ownerPayroll', [
        { title: 'Должность', fn: function (r) { return esc(r.position); } },
        { title: 'Сотрудник', fn: function (r) { return esc(r.name || '—'); } },
        { title: 'График', fn: function (r) { return esc(r.schedule || '—'); } },
        { title: 'Ставка за смену', cls: 'num', fn: function (r) { return moneyP(r.rate); } },
        { title: 'В час', cls: 'num', fn: function (r) {
          var hrs = shiftHours(r.schedule);
          return hrs ? moneyP(E.div(r.rate, hrs)) : '<span class="muted">—</span>'; } },
        { title: 'Смена', cls: 'center', fn: function (r) { return r.night ? badge('ночь', 'blue') : badge('день', 'grey'); } }
      ], DATA.owner.payroll, { step: 30 }));
    }

    DATA.owner.monthly.forEach(function (mo, i) {
      if (!mo.rows.length) return;
      h += panel('Ваша сводка из файла — лист «' + esc(mo.sheet) + '» (показан как есть)', table('ownerMon' + i, [
        { title: 'Статья', fn: function (r) { return esc(r.name); } },
        { title: 'Значение', cls: 'num', fn: function (r) { return moneyP(r.value); } }
      ], mo.rows, { step: 30 }));
    });

    h += '<div class="panel"><div class="panel-body muted">Все суммы посчитаны по листу «ДДС» вашего файла. ' +
      'Листы «ОТЧЁТ» — это сводные таблицы Excel: они показываются как есть и могут расходиться с «ДДС», ' +
      'если сводную давно не обновляли. Контрольная сумма по сменам: ' + money(t.shiftSum) + '.</div></div>';
    return h;
  }

  // «09:00-21:00» → 12 часов
  function shiftHours(schedule) {
    var m = String(schedule || '').match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
    if (!m) return 0;
    var a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    var mins = b - a; if (mins <= 0) mins += 24 * 60;
    return E.safeRound(mins / 60);
  }

  /* --- Рендер и навигация ---------------------------------------------------- */
  var RENDERERS = {
    exec: viewExec, ownerbook: viewOwnerBook, shifts: viewShifts, invoices: viewInvoices, bep: viewBep,
    stock: viewStock, abc: viewAbc, rop: viewRop, fefo: viewFefo, inventory: viewInventory,
    losses: viewLosses, pnl: viewPnl, calendar: viewCalendar, pricing: viewPricing,
    suppliers: viewSuppliers, staff: viewStaff, fraud: viewFraud, search: viewSearch,
    data: viewData, settings: viewSettings
  };

  function renderMenu() {
    var html = '', section = '';
    var alerts = menuAlerts();
    VIEWS.forEach(function (v) {
      if (v.section !== section) { section = v.section; html += '<div class="menu-section-title">' + esc(section) + '</div>'; }
      html += '<div class="menu-item' + (v.id === VIEW ? ' active' : '') + '" data-view="' + v.id + '">' +
        '<span>' + v.icon + '</span><span>' + esc(v.name) + '</span>' +
        (alerts[v.id] ? '<span class="menu-badge">' + esc(alerts[v.id]) + '</span>' : '') + '</div>';
    });
    $('menuList').innerHTML = html;
  }

  // Красные счётчики в меню — то, что требует внимания прямо сейчас
  function menuAlerts() {
    var a = {};
    var shifts = filtered('shifts').filter(function (s) { return E.shiftCalc(s).diff !== 0; }).length;
    if (shifts) a.shifts = shifts;
    var fefo = (S.state.expiry || []).filter(function (r) {
      var f = E.fefoStatus(r.bestBefore, S.settings);
      return f.level === 'crit' || f.level === 'expired';
    }).length;
    if (fefo) a.fefo = fefo;
    if (CACHE.payments && CACHE.payments.totalLeft > 0) a.invoices = '₽';
    if (DATA.sales.length && DATA.stock.length) {
      var days = DATA.salesPeriod ? DATA.salesPeriod.days : 30;
      if (!CACHE.ropCount) CACHE.ropCount = E.ropList(DATA.sales, DATA.stock, days, S.settings, CACHE.bestPrices).length;
      if (CACHE.ropCount) a.rop = CACHE.ropCount > 99 ? '99+' : CACHE.ropCount;
    }
    return a;
  }

  function renderPeriods() {
    $('periodPresets').innerHTML = PERIODS.map(function (p) {
      return '<button class="btn-pill' + (p.id === PERIOD ? ' active' : '') + '" data-period="' + p.id + '">' + esc(p.name) + '</button>';
    }).join('');
  }

  function renderView() {
    var v = VIEWS.filter(function (x) { return x.id === VIEW; })[0] || VIEWS[0];
    $('pageTitle').textContent = v.title;
    var fn = RENDERERS[VIEW] || viewExec;
    var html;
    try { html = fn(); }
    catch (err) { html = noData('Ошибка на экране', esc(err.message)); }
    $('content').innerHTML = '<div class="view active">' + html + '</div>';
    drawCharts();
  }

  function renderStatus() {
    var files = DATA.files.filter(function (f) { return f.kind !== 'unknown'; }).length;
    var dot = $('syncBadge').querySelector('.status-dot');
    if (files) dot.classList.remove('off'); else dot.classList.add('off');
    $('syncText').textContent = files
      ? 'Загружено файлов: ' + files + (watchHandle ? ' • слежу за папкой' : '')
      : 'Данные не загружены';
    $('sidebarStoreName').textContent = S.settings.storeName || 'ВАЙ МАРКЕТ';
  }

  function renderAll() {
    CACHE.ropCount = null;
    renderMenu(); renderPeriods(); renderStatus(); renderView();
  }

  function go(viewId) {
    VIEW = viewId;
    PAGE = {};
    renderAll();
    $('content').scrollTop = 0;
  }

  /* --- Экспорт ---------------------------------------------------------------- */
  function exportExcel() {
    var wb = XLSX.utils.book_new();
    function sheet(name, rows) {
      if (!rows || !rows.length) return;
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
    }
    var t = CACHE.salesTotals || E.salesTotals([]);
    var st = CACHE.stockTotals || E.stockTotals([]);
    var b = bepNow();
    var shifts = E.shiftsTotals(filtered('shifts'));
    var debt = CACHE.payments ? CACHE.payments.totalLeft : E.invoicesTotals(filtered('invoices')).debt;

    sheet('Сводка', [
      { Показатель: 'Магазин', Значение: S.settings.storeName },
      { Показатель: 'Отчёт сформирован', Значение: new Date().toLocaleString('ru-RU') },
      { Показатель: 'Период журналов', Значение: periodName() },
      { Показатель: 'Выручка по отчёту 1С, ₽', Значение: t.revenue },
      { Показатель: 'Себестоимость, ₽', Значение: t.cogs },
      { Показатель: 'Валовая прибыль, ₽', Значение: t.gross },
      { Показатель: 'Маржинальность, %', Значение: t.margin },
      { Показатель: 'Склад по себестоимости, ₽', Значение: st.buySum },
      { Показатель: 'Долг поставщикам, ₽', Значение: debt },
      { Показатель: 'Расхождение кассы, ₽', Значение: shifts.diff },
      { Показатель: 'Точка безубыточности (месяц), ₽', Значение: b.month },
      { Показатель: 'Выполнение BEP, %', Значение: b.done }
    ]);
    sheet('Смены', filtered('shifts').map(function (s) {
      var c = E.shiftCalc(s);
      return { Дата: s.date, Смена: s.shift, Кассир: s.cashier, 'Остаток утро': num(s.openCash),
        'Z-отчёт нал': num(s.zCash), 'Выплаты из кассы': num(s.payouts), 'Расчётный остаток': c.expected,
        'Факт в кассе': num(s.factCash), 'Терминал/СБП': num(s.terminal), Разница: c.diff, Статус: c.statusText };
    }));
    sheet('Накладные журнал', filtered('invoices').map(function (r) {
      var c = E.invoiceCalc(r);
      return { Дата: r.date, Документ: r.doc, Поставщик: r.supplier, Товар: r.goods, Сумма: num(r.total),
        'Оплачено налом': num(r.paidCash), 'Погашено долгов': num(r.paidDebt), 'Осталось в долг': c.left, Статус: c.statusText };
    }));
    sheet('Табель', filtered('timesheet').map(function (r) {
      return { Дата: r.date, Сотрудник: r.employee, Должность: r.position, Смена: r.shift, Часы: num(r.hours),
        Ставка: num(r.rate), Штраф: num(r.penalty), Премия: num(r.bonus), Начислено: E.timesheetCalc(r) };
    }));
    sheet('Выплаты', filtered('payouts'));
    sheet('Зарплата свод', E.payrollSummary(filtered('timesheet'), filtered('payouts')));
    sheet('Сроки годности', (S.state.expiry || []).map(function (r) {
      var f = E.fefoStatus(r.bestBefore, S.settings);
      return { Товар: r.name, Группа: r.group, Остаток: num(r.qty), Цена: num(r.price), 'Годен до': r.bestBefore,
        'Дней осталось': f.days, 'Скидка %': f.discount, Действие: f.action };
    }));
    sheet('Инвентаризация', S.state.inventory || []);
    if (CACHE.payments) {
      sheet('Долги по накладным', CACHE.payments.docs);
      sheet('Долг по поставщикам', CACHE.balance);
    }
    if (DATA.owner) {
      sheet('Книга ДДС', DATA.owner.daily.map(function (r) {
        return { Дата: r.date, Смена: r.shift, 'Наличная торговля': r.cash, 'Онлайн торговля': r.online,
          'Оборот за день': r.revenue, 'Выплата кассы': r.payout, 'Расхождение кассы': r.diff,
          'Закуп за наличку': r.buyCashOffice, 'Оплата долга': r.payDebtOffice, 'Закуп в долг': r.buyCredit,
          Списание: r.writeoff, Зарплата: r.salary, Аренда: r.rent, Коммуналка: r.utilities, Налог: r.tax,
          Прибыль: r.profit, 'Долг поставщикам': r.debt };
      }));
      sheet('Оплаты книги', DATA.owner.payments);
      if (DATA.owner.payroll.length) sheet('Платёжка', DATA.owner.payroll);
    }
    if (DATA.writeoffs.length) sheet('Списания по причинам', E.byReason(DATA.writeoffs));
    if (DATA.returns.length) sheet('Возвраты по причинам', E.byReason(DATA.returns));
    if (DATA.sales.length) {
      sheet('Топ-100 продаж', DATA.sales.slice().sort(function (a, c) { return c.revenue - a.revenue; }).slice(0, 100)
        .map(function (r) {
          return { Товар: r.name, Группа: CACHE.groupIdx[r.key] || '', Продано: r.qty, Выручка: r.revenue,
            Себестоимость: r.cogs, 'Валовая прибыль': r.profit };
        }));
      if (DATA.stock.length) {
        var days = DATA.salesPeriod ? DATA.salesPeriod.days : 30;
        sheet('Автозаказ', E.ropList(DATA.sales, DATA.stock, days, S.settings, CACHE.bestPrices).slice(0, 300));
      }
    }
    var name = 'WayMarket_baza_' + todayISO() + '.xlsx';
    XLSX.writeFile(wb, name);
    toast('Файл сохранён: ' + name);
  }

  function printLabels() {
    var rows = (S.state.expiry || []).map(function (r) {
      var f = E.fefoStatus(r.bestBefore, S.settings);
      return { name: r.name, price: num(r.price), disc: f.discount, newPrice: E.safeRound(num(r.price) * (100 - f.discount) / 100), days: f.days };
    }).filter(function (r) { return r.disc > 0; });
    if (!rows.length) { toast('Нет позиций со скидкой — печатать нечего.'); return; }
    var html = '<html><head><meta charset="utf-8"><title>Ценники со скидкой</title><style>' +
      'body{font-family:Arial;margin:10mm;display:flex;flex-wrap:wrap;gap:6mm}' +
      '.lb{background:#FFE600;border:2px solid #000;border-radius:4mm;padding:6mm;width:75mm;height:50mm;display:flex;flex-direction:column;justify-content:space-between}' +
      '.nm{font-size:12pt;font-weight:bold;line-height:1.2}.old{font-size:11pt;text-decoration:line-through;color:#555}' +
      '.new{font-size:26pt;font-weight:900}.dc{font-size:12pt;font-weight:bold}</style></head><body>' +
      rows.map(function (r) {
        return '<div class="lb"><div class="nm">' + esc(r.name) + '</div>' +
          '<div><div class="old">' + E.fmtMoney(r.price) + '</div>' +
          '<div class="new">' + E.fmtMoney(r.newPrice) + '</div></div>' +
          '<div class="dc">СКИДКА −' + r.disc + '% • срок ' + (r.days < 0 ? 'истёк' : r.days + ' дн.') + '</div></div>';
      }).join('') + '</body></html>';
    var w = window.open('', '_blank');
    if (!w) { toast('Браузер заблокировал новое окно. Разрешите всплывающие окна для печати ценников.'); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(function () { w.print(); }, 300);
  }

  function backup() {
    var blob = new Blob([S.exportJSON()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'WayMarket_kopiya_' + todayISO() + '.json';
    a.click();
    toast('Копия сохранена. Храните её вне этого компьютера.');
  }

  function restore() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try { S.importJSON(fr.result); renderAll(); toast('Копия загружена.'); }
        catch (e) { toast('Не получилось прочитать файл копии: ' + e.message); }
      };
      fr.readAsText(f);
    };
    inp.click();
  }

  /* --- Советник (работает офлайн, по загруженным данным) --------------------- */
  function aiAnswer(q) {
    var n = E.norm(q);
    var t = CACHE.salesTotals || E.salesTotals([]);
    var lines = [];

    if (/долг|должн|задолж|кому платить/.test(n)) {
      if (CACHE.payments) {
        lines.push('Долг поставщикам по накладным 1С: ' + money(CACHE.payments.totalLeft) + '.');
        lines.push('Погашено старых долгов за период: ' + money(CACHE.payments.oldDebtPaid) + '.');
        (CACHE.balance || []).slice(0, 5).forEach(function (b2) {
          if (b2.debt > 0) lines.push('• ' + b2.supplier + ' — ' + money(b2.debt) +
            (CACHE.contactsIdx[E.norm(b2.supplier)] ? ' (тел. ' + CACHE.contactsIdx[E.norm(b2.supplier)] + ')' : ''));
        });
      } else if (DATA.owner) {
        var ot = E.ownerTotals(ownerRows().rows);
        lines.push('По вашей книге ДДС долг поставщикам на ' + ot.debtDate + ': ' + money(ot.debt) + '.');
        lines.push('За период закуплено в долг ' + money(ot.buyCredit) + ', погашено ' + money(ot.payDebt) + '.');
      } else {
        var it = E.invoicesTotals(filtered('invoices'));
        lines.push('Долг по журналу дашборда: ' + money(it.debt) + '. Загрузите отчёты 1С «Приходные накладные» и «Расходные кассовые ордера» — тогда долг посчитается по документам.');
      }
    } else if (/что заказ|заказать|автозаказ|закончил|кончает/.test(n)) {
      var days = DATA.salesPeriod ? DATA.salesPeriod.days : 30;
      var rop = E.ropList(DATA.sales, DATA.stock, days, S.settings, CACHE.bestPrices);
      lines.push('К заказу ' + rop.length + ' позиций на ' + money(rop.reduce(function (a, r) { return a + r.sum; }, 0)) + '. Самое срочное:');
      rop.slice(0, 7).forEach(function (r) {
        lines.push('• ' + r.name + ' — остаток ' + (r.stock <= 0 ? 'нулевой' : nf(r.stock, 1)) + ', заказать ' + nf(r.order) +
          (r.supplier ? ' у «' + r.supplier + '»' : '') + ' на ' + money(r.sum));
      });
    } else if (/дешевл|лучшая цена|где купить|поставщик по/.test(n)) {
      var term = n.replace(/.*(дешевле|лучшая цена|где купить|поставщик по)\s*/, '').trim();
      if (!term) { lines.push('Уточните товар: «где дешевле молоко».'); }
      else {
        var cmp = E.priceComparison(DATA.prices.filter(function (p) { return p.key.indexOf(term) >= 0; }), CACHE.contactsIdx, 6);
        if (!cmp.length) lines.push('По запросу «' + term + '» предложений в базе цен не нашлось.');
        cmp.forEach(function (c) {
          lines.push('• ' + c.name + ': дешевле всего у «' + c.bestSupplier + '» — ' + money(c.min) +
            (c.bestPhone ? ' (тел. ' + c.bestPhone + ')' : '') + (c.spread > 0 ? ', дороже всех ' + money(c.max) : ''));
        });
      }
    } else if (/прибыл|доходн|зараб|марж|наценк/.test(n)) {
      lines.push('Выручка ' + money(t.revenue) + ', валовая прибыль ' + money(t.gross) +
        ', маржинальность ' + pct(t.margin) + ', наценка ' + pct(t.markup) + '.');
      DATA.sales.slice().sort(function (a, b2) { return b2.profit - a.profit; }).slice(0, 5).forEach(function (r) {
        lines.push('• ' + r.name + ' — прибыль ' + money(r.profit) + ' при выручке ' + money(r.revenue));
      });
    } else if (/недостач|касс|смен|излиш/.test(n)) {
      var sh = E.shiftsTotals(filtered('shifts'));
      lines.push('Смен за ' + periodName().toLowerCase() + ': ' + sh.count + '. Z-отчёт нал ' + money(sh.zCash) +
        ', выплаты из кассы ' + money(sh.payouts) + ', итог расхождения ' + money(sh.diff) + '.');
      lines.push('Недостачи ' + money(sh.short) + ', излишки ' + money(sh.over) + '.');
    } else if (/зарплат|аванс|сотрудник|фот|табел/.test(n)) {
      var pay = E.payrollSummary(filtered('timesheet'), filtered('payouts'));
      lines.push('Начислено ' + money(pay.reduce(function (a, r) { return a + r.accrued; }, 0)) +
        ', выплачено ' + money(pay.reduce(function (a, r) { return a + r.paid; }, 0)) + '.');
      pay.slice(0, 6).forEach(function (r) { lines.push('• ' + r.employee + ' — к выплате ' + money(r.left)); });
    } else if (/списа|потер|брак|воров|укра|краж|порч/.test(n)) {
      if (!DATA.writeoffs.length) lines.push('Отчёт «Причины списания» не загружен.');
      else {
        lines.push('Списано на ' + money(CACHE.writeoffSum) +
          (DATA.writeoffsPeriod ? ' за ' + DATA.writeoffsPeriod.days + ' дн. (в месяц ' + money(E.perMonth(CACHE.writeoffSum, DATA.writeoffsPeriod.days)) + ')' : '') + '. По причинам:');
        E.byReason(DATA.writeoffs).slice(0, 6).forEach(function (r) { lines.push('• ' + r.reason + ' — ' + money(r.cost) + ' (' + pct(r.share) + ')'); });
      }
    } else if (/срок|просроч|годност|fefo/.test(n)) {
      var exp = (S.state.expiry || []).map(function (r) { return { r: r, f: E.fefoStatus(r.bestBefore, S.settings) }; })
        .filter(function (x) { return x.f.level === 'crit' || x.f.level === 'expired'; });
      lines.push(exp.length ? 'Срочно уценить или снять с полки: ' + exp.length + ' позиций.' : 'Критичных сроков годности нет.');
      exp.slice(0, 8).forEach(function (x) { lines.push('• ' + x.r.name + ' — ' + (x.f.days < 0 ? 'просрочено' : x.f.days + ' дн.') + ', ' + x.f.action); });
    } else if (/безубыт|bep|порог|окуп/.test(n)) {
      var b = bepNow();
      lines.push('Порог безубыточности: ' + money(b.month) + ' в месяц (' + money(b.day) + ' в день).');
      lines.push('Выручка в пересчёте на месяц ' + money(b.revenue) + ' — это ' + pct(b.done) + ' от порога, запас прочности ' + pct(b.safety) + '.');
      lines.push('Расходы закрываются примерно к ' + b.dayOfMonth + '-му числу месяца.');
    } else {
      var res = E.search(q, DATA, 'all', 8);
      if (res.length) {
        lines.push('Нашлось по запросу «' + q + '»:');
        res.forEach(function (r) { lines.push('• [' + r.type + '] ' + r.name + ' — ' + r.cols.filter(Boolean).join(', ')); });
      } else {
        lines.push('Не понял вопрос. Спросите проще, например:');
        lines.push('• какой долг поставщикам');
        lines.push('• что заказать сегодня');
        lines.push('• где дешевле сахар');
        lines.push('• сколько списали и почему');
        lines.push('• какая точка безубыточности');
      }
    }
    return lines.join('\n');
  }

  /* --- Обработчики ------------------------------------------------------------ */
  function bind() {
    // навигация, кнопки внутри экранов
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-view],[data-period],[data-action]') : null;
      if (!el) return;
      if (el.dataset.view) { go(el.dataset.view); return; }
      if (el.dataset.period) { PERIOD = el.dataset.period; PAGE = {}; renderAll(); return; }
      var a = el.dataset.action;
      if (a === 'more') { PAGE[el.dataset.id] = (PAGE[el.dataset.id] || +el.dataset.step) + (+el.dataset.step); renderView(); }
      else if (a === 'del') {
        if (confirm('Удалить запись? Отменить будет нельзя.')) { S.remove(el.dataset.coll, el.dataset.id); renderAll(); }
      }
      else if (a === 'sync-folder') { $('folderInput').click(); }
      else if (a === 'sync-files') { $('filesInput').click(); }
      else if (a === 'watch-start') { pickWatchFolder(); }
      else if (a === 'watch-stop') { stopWatch(); }
      else if (a === 'backup') { backup(); }
      else if (a === 'restore') { restore(); }
      else if (a === 'wipe') {
        if (confirm('Очистить смены, накладные, табель и выплаты? Настройки останутся. Сначала сохраните копию!')) {
          S.COLLECTIONS.forEach(function (c) { S.clear(c); });
          renderAll(); toast('Журналы очищены.');
        }
      }
      else if (a === 'print-labels') { printLabels(); }
      else if (a === 'owner-to-settings') {
        var sel = ownerRows(), t2 = E.ownerTotals(sel.rows);
        if (!t2.dayCount) { toast('В книге нет заполненных дней.'); return; }
        var k = 30 / t2.dayCount;   // приводим расходы книги к месяцу
        S.setSetting('fot', Math.round(t2.salary * k));
        S.setSetting('rent', Math.round(t2.rent * k));
        S.setSetting('utilities', Math.round(t2.utilities * k));
        S.setSetting('taxes', Math.round(t2.tax * k));
        S.setSetting('other', Math.round((t2.lunch + t2.fuel + t2.supplies + t2.bankFee) * k));
        renderAll();
        toast('Расходы из книги перенесены в настройки (в пересчёте на 30 дней): ' + money(S.fixedMonthly()) + ' в месяц.');
      }
    });

    // формы ввода
    document.addEventListener('submit', function (e) {
      var f = e.target;
      if (!f.id) return;
      e.preventDefault();
      var v = formValues(f);
      if (f.id === 'shiftForm') {
        if (!v.zCash && !v.factCash) { toast('Заполните Z-отчёт и фактические деньги в кассе.'); return; }
        S.add('shifts', v);
        var c = E.shiftCalc(v);
        toast('Смена записана. Расчётный остаток ' + money(c.expected) + ', факт ' + money(v.factCash) + ' → ' + c.statusText);
      } else if (f.id === 'invForm') {
        if (!v.total && !v.paidDebt) { toast('Укажите сумму накладной или сумму погашения долга.'); return; }
        S.add('invoices', v);
        toast('Накладная записана. Остаётся в долг: ' + money(E.invoiceCalc(v).left));
      } else if (f.id === 'fefoForm') {
        if (!v.name || !v.bestBefore) { toast('Нужны товар и дата «годен до».'); return; }
        S.add('expiry', v);
        var fs = E.fefoStatus(v.bestBefore, S.settings);
        toast('Партия на контроле. ' + (fs.days < 0 ? 'Просрочено!' : 'Осталось ' + fs.days + ' дн.') + ' ' + fs.action);
      } else if (f.id === 'invtForm') {
        if (!v.name) { toast('Укажите товар.'); return; }
        S.add('inventory', v);
        toast('Записано в сличительную ведомость.');
      } else if (f.id === 'kviForm') {
        if (!v.name) { toast('Укажите товар.'); return; }
        S.add('kvi', v); toast('Товар добавлен в мониторинг цен.');
      } else if (f.id === 'tsForm') {
        if (!v.employee) { toast('Укажите сотрудника.'); return; }
        S.add('timesheet', v);
        toast('Смена в табеле. Начислено: ' + money(E.timesheetCalc(v)));
      } else if (f.id === 'poForm') {
        if (!v.employee || !v.amount) { toast('Нужны сотрудник и сумма.'); return; }
        S.add('payouts', v); toast('Выплата записана.');
      } else if (f.id === 'settingsForm') {
        Object.keys(v).forEach(function (k) {
          if (k === 'writeoffsToMonth') S.setSetting(k, v[k] === 'да');
          else S.setSetting(k, v[k]);
        });
        if (watchHandle) startWatch();
        toast('Настройки сохранены. Постоянные расходы: ' + money(S.fixedMonthly()) + ' в месяц.');
      } else { return; }
      renderAll();
    });

    // живой расчёт в форме смены и накладной
    document.addEventListener('input', function (e) {
      var f = e.target.form;
      if (!f) return;
      if (f.id === 'shiftForm') {
        var v = formValues(f), c = E.shiftCalc(v);
        var p = $('shiftPreview');
        if (p) p.innerHTML = 'Расчётный остаток: ' + money(c.expected) + ' • факт: ' + money(v.factCash) +
          ' • разница: <span class="' + signClass(c.diff) + '">' + money(c.diff) + '</span> — ' + c.statusText;
      } else if (f.id === 'invForm') {
        var v2 = formValues(f), left = Math.max(0, num(v2.total) - num(v2.paidCash));
        var p2 = $('invPreview');
        if (p2) p2.innerHTML = 'Остаётся в долг: <span class="' + (left > 0 ? 'trend-neg' : 'trend-pos') + '">' + money(left) + '</span>';
      }
    });

    // поиск
    var searchTimer = null;
    $('globalSearch').addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        var q = $('globalSearch').value.trim();
        if (['stock', 'suppliers', 'search'].indexOf(VIEW) >= 0) { PAGE = {}; renderView(); }
        else if (q.length >= 2) { go('search'); }
      }, 300);
    });
    $('searchScope').addEventListener('change', function () { if (VIEW === 'search') renderView(); });

    // советник
    $('aiPrompt').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var q = $('aiPrompt').value.trim();
      if (!q) return;
      var answer = aiAnswer(q);
      overlay('<div class="overlay-title">🤖 Советник по вашим данным</div>' +
        '<div style="font-size:12.5px;line-height:1.7;white-space:pre-line">' + esc(answer) + '</div>' +
        '<div class="form-actions" style="padding:14px 0 0"><button class="btn-tool" onclick="document.querySelector(\'.overlay\').remove()">Закрыть</button></div>');
      $('aiPrompt').value = '';
    });

    // верхняя панель
    $('privacyBtn').addEventListener('click', function () {
      var on = document.body.classList.toggle('privacy-active');
      $('privacyBtn').textContent = on ? '👁️ Приватность: ВКЛ' : '👁️ Приватность: ВЫКЛ';
      try { localStorage.setItem('wm_privacy', on ? '1' : '0'); } catch (err) { /* не критично */ }
    });
    $('exportExcelBtn').addEventListener('click', exportExcel);
    $('printBtn').addEventListener('click', function () { window.print(); });
    $('syncBtn').addEventListener('click', function () { $('folderInput').click(); });
    $('folderInput').addEventListener('change', function (e) { loadFiles(e.target.files); e.target.value = ''; });
    $('filesInput').addEventListener('change', function (e) { loadFiles(e.target.files); e.target.value = ''; });

    // Esc закрывает всплывающее окно
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeOverlay(); });
  }

  /* --- Запуск ------------------------------------------------------------------ */
  function init() {
    if (typeof XLSX === 'undefined') {
      document.getElementById('content').innerHTML =
        '<div class="empty-state"><b>Не найдена папка vendor рядом с дашбордом.</b><br>' +
        'Копируйте папку целиком: файл «Дашборд_ВайМаркет.html» работает вместе с папками vendor и js.</div>';
      return;
    }
    try {
      if (localStorage.getItem('wm_privacy') === '1') {
        document.body.classList.add('privacy-active');
        $('privacyBtn').textContent = '👁️ Приватность: ВКЛ';
      }
    } catch (e) { /* приватный режим браузера */ }
    recompute();
    bind();
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
