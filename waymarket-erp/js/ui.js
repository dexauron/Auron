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
    invoices1c: [], invoicesPeriod: null, cashOrders: [], owner: null, files: [],
    dead: [], deadPeriod: null, incexp: null
  };
  var Q = window.WMQuick;     // умный ввод: справочники, подстановки, черновики
  function DICT() { return Q.dicts(S.state, S.settings); }
  function learn(map) {
    var changed = false;
    Object.keys(map).forEach(function (d) { if (Q.learn(S.settings, d, map[d], S.state)) changed = true; });
    if (changed) S.save();
  }
  var C = {};                 // производные расчёты
  var SUP = window.WMSupply;  // поставки, оплаты и справочник фирм
  var FLT = window.WMFilter;  // кнопки фильтров, одинаковые на всех экранах
  var DET = window.WMDetail;  // окно «Подробнее» для любой цифры
  var NUM = window.WMNum;     // счёт в поле, разряды и понятные даты
  var AL = window.WMAlerts;   // что горит прямо сейчас
  var IN = window.WMInput;    // сканер штрихкодов, шаблоны, горячие клавиши
  var X = window.WMExtra;     // сравнения, спарклайны, ведомости
  var EN = window.WMEntry;    // разбор строки, буфер, массовый ввод, отмена

  /* --- 44. Меню «⋮» у строки: все действия в одном месте ---------------------- */
  function rowMenu(coll, id, opts) {
    opts = opts || {};
    var acts = EN.rowMenu({ more: opts.more, form: opts.form, extra: opts.extra });
    return '<span class="row-menu"><button class="row-menu-btn" data-menu="' +
      esc(coll) + ':' + esc(id) + ':' + esc(opts.form || '') + ':' +
      esc(opts.more ? opts.more.kind + '|' + opts.more.key : '') + '" title="Действия">⋮</button></span>';
  }

  function openRowMenu(btn) {
    closeRowMenu();
    var p = btn.dataset.menu.split(':');
    var coll = p[0], id = p[1], form = p[2], more = p[3];
    var rec = (S.state[coll] || []).filter(function (x) { return x.id === id; })[0];
    var items = [];
    if (more) items.push(['more', '👁', 'Подробнее', 'data-more="' + esc(more) + '"']);
    if (form) items.push(['edit', '✎', 'Изменить', 'data-edit="' + esc(coll + ':' + id + ':' + form) + '"']);
    if (form) items.push(['repeat', '↻', 'Повторить сегодня',
      'data-act="q-repeat" data-coll="' + esc(coll) + '" data-id="' + esc(id) + '" data-target="' + esc(form) + '"']);
    items.push(['copy', '⧉', 'Копировать', 'data-act="rec-copy" data-coll="' + esc(coll) + '" data-id="' + esc(id) + '"']);
    if (EN.clip()) items.push(['paste', '📋', 'Вставить скопированное',
      'data-act="rec-paste" data-form="' + esc(form) + '"']);
    items.push(['del', '🗑', 'Удалить', 'data-del="' + esc(coll + ':' + id) + '"', true]);

    var box = document.createElement('div');
    box.className = 'row-menu-list';
    box.innerHTML = items.map(function (i) {
      return '<button ' + i[3] + (i[4] ? ' class="danger"' : '') + '>' +
        '<span>' + i[1] + '</span><span>' + esc(i[2]) + '</span></button>';
    }).join('');
    document.body.appendChild(box);
    var r = btn.getBoundingClientRect();
    var top = r.bottom + 6, left = Math.min(r.left, window.innerWidth - 210);
    if (top + box.offsetHeight > window.innerHeight - 10) top = Math.max(10, r.top - box.offsetHeight - 6);
    box.style.top = top + 'px'; box.style.left = Math.max(10, left) + 'px';
    setTimeout(function () { document.addEventListener('click', closeRowMenu, { once: true }); }, 0);
    if (rec) box.dataset.rec = id;
  }
  function closeRowMenu() {
    var m = document.querySelector('.row-menu-list');
    if (m) m.remove();
  }

  // «412 000 ₽ ▲ 31 000 (8%)» — цифра рядом с тем, как было раньше
  function delta(now, was, asMoney) {
    if (!X) return '';
    var d = X.delta(num(now), num(was));
    if (!d.has || d.dir === 'flat') return '';
    return '<span class="delta ' + d.dir + '">' + (d.dir === 'up' ? '▲' : '▼') + ' ' +
      (asMoney === false ? nf(Math.abs(d.diff)) : money(Math.abs(d.diff))) +
      (d.pct === null ? '' : ' (' + Math.abs(d.pct) + '%)') + '</span>';
  }

  // Итоги за такой же период перед нынешним — чтобы было с чем сравнивать
  function prevTotals() {
    if (!X) return null;
    var r = periodRange(), p = X.prevRange(r.from, r.to);
    var rows = (S.state.dds || []).filter(function (x) { return x.date >= p.from && x.date <= p.to; });
    return window.WMFin.totals(rows);
  }
  var LAST_IMPORT = [];       // что распознали в последней загрузке файлов
  var AGAIN = false;          // после сохранения открыть такую же форму (Ctrl+Enter)
  var DRAFT_BACK = null;      // незаконченная запись, оставшаяся с прошлого раза
  var VIEW = 'today';
  var PERIOD = 'month';
  var PAGE = {};              // сколько строк показано в таблицах
  var SEARCH_T = null;        // пауза перед поиском, пока владелец печатает
  var EXPORT_ALL = false;     // на время выгрузки в Excel показываем таблицы целиком
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
  // дата «столько-то дней назад» — для фильтров «за месяц», «за три месяца»
  function addDaysStr(days) {
    var d = new Date(today()); d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  // Готовый набор кнопок «когда» для любого экрана: поле с датой задаётся снаружи
  function whenDefs(field, name) {
    function v(r) { return r[field] || ''; }
    return { key: 'when', name: name || 'Когда', options: [
      { v: 'd', name: 'Сегодня', test: function (r) { return v(r) === today(); } },
      { v: 'w', name: 'Неделя', test: function (r) { return v(r) >= addDaysStr(-7); } },
      { v: 'm', name: 'Месяц', test: function (r) { return v(r) >= addDaysStr(-30); } },
      { v: 'q', name: 'Три месяца', test: function (r) { return v(r) >= addDaysStr(-90); } },
      { v: 'y', name: 'Год', test: function (r) { return v(r) >= addDaysStr(-365); } }
    ] };
  }
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

    // Окно закрывается по щелчку мимо него — но ТОЛЬКО если и нажали мимо.
    // Раньше хватало отпустить кнопку мыши за пределами формы (выделяли текст
    // в поле и увели курсор за край окна) — и наполовину заполненная форма
    // исчезала вместе с введённым.
    var pressedOutside = false;
    b.addEventListener('mousedown', function (e) { pressedOutside = e.target === b; });
    b.addEventListener('touchstart', function (e) { pressedOutside = e.target === b; }, { passive: true });
    b.addEventListener('click', function (e) {
      if (e.target !== b || !pressedOutside) { pressedOutside = false; return; }
      pressedOutside = false;
      askClose();
    });
    document.body.appendChild(b);
    var first = b.querySelector('input,select,textarea');
    if (first) setTimeout(function () { first.focus(); }, 60);
    return b;
  }

  /* --- 28. Вставить скопированную запись в форму ------------------------------ */
  function pasteClip(formId) {
    var c = EN.clip();
    if (!c) { toast('Сначала скопируйте запись кнопкой «⋮» → «Копировать».'); return; }
    var form = document.getElementById('wmForm');
    if (!form) {
      if (!formId) { toast('Откройте форму, куда вставлять.'); return; }
      openForm(formId);
      setTimeout(function () { pasteClip(); }, 150);
      return;
    }
    var n = 0;
    Object.keys(c.values).forEach(function (k) {
      var el = form.querySelector('[name="' + k + '"]');
      if (!el || k === 'date') return;
      el.value = c.values[k];
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      n++;
    });
    toast(n ? 'Вставлено полей: ' + n + '. Проверьте и сохраните.'
      : 'В этой форме нет таких полей — скопированное сюда не подходит.');
  }

  /* --- 35. Отмена последнего действия (Ctrl+Z) -------------------------------- */
  function undoLast() {
    var row = EN.lastUndoable(S.state.log || []);
    if (!row) { toast('Отменять нечего — последние действия уже отменены.'); return; }
    var what = row.what + ' · ' + row.collName + (row.title ? ' · ' + row.title : '');
    if (!confirm('Отменить последнее действие?\n\n' + what)) return;
    S.logUndo(row.id);
    recompute(); render();
    toast('Отменено: ' + what + '. Вернуть обратно можно на экране «Проверка базы».', 8000);
  }

  // Вставить шаблон в открытую форму
  function applyTemplate(tplId) {
    var t = (S.state.templates || []).filter(function (x) { return x.id === tplId; })[0];
    var form = document.getElementById('wmForm');
    if (!t || !form) return;
    Object.keys(t.values).forEach(function (k) {
      var el = form.querySelector('[name="' + k + '"]');
      if (!el) return;
      el.value = t.values[k];
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    t.used = (t.used || 0) + 1;
    S.save();
    toast('Шаблон «' + t.name + '» вставлен. Проверьте и сохраните.');
  }

  function saveTemplate(formId) {
    var form = document.getElementById('wmForm');
    if (!form) return;
    var v = formValues(form);
    var name = prompt('Название шаблона:', IN.templateName(v));
    if (name === null) return;
    var t = IN.templateFrom(formId, v, String(name).trim() || IN.templateName(v));
    S.add('templates', t);
    render();
    toast('Шаблон «' + t.name + '» сохранён. В следующий раз вставится одной кнопкой.');
  }

  function manageTemplates(formId) {
    var list = IN.templatesFor(S.state.templates || [], formId);
    sheet('Шаблоны', '<div class="detail">' + listOf(list.map(function (t) {
      return listRow({ icon: '☆', title: esc(t.name),
        sub: 'вставляли ' + nf(t.used || 0) + ' ' + plural(t.used || 0, 'раз', 'раза', 'раз'),
        value: '<button class="btn btn-sm btn-danger" data-del="templates:' + esc(t.id) + '">Убрать</button>' });
    }), 'Шаблонов пока нет') + '</div>');
  }


  /* --- Калькулятор с крупными кнопками --------------------------------------
     Открывается кнопкой 🧮 у любого числового поля. Считает то же самое, что
     и поле, но пальцем по большим клавишам — и не закрывает форму под собой.
     ---------------------------------------------------------------------- */
  function openCalc(fieldName) {
    var field = document.querySelector('.num-input[name="' + fieldName + '"]');
    if (!field) return;
    var label = '';
    var row = field.closest('.form-row');
    if (row && row.querySelector('label')) label = row.querySelector('label').childNodes[0].textContent.trim();

    var box = document.createElement('div');
    box.className = 'backdrop calc-back';
    box.innerHTML = '<div class="sheet calc-sheet">' +
      '<div class="sheet-head"><div class="sheet-title">🧮 ' + esc(label || 'Калькулятор') + '</div>' +
      '<button class="btn btn-sm" data-calc-act="close">Закрыть</button></div>' +
      '<div class="sheet-body">' +
      '<div class="calc-screen"><input id="calcLine" type="text" inputmode="decimal" value="' +
        esc(field.value) + '"><div class="calc-result" id="calcRes"></div></div>' +
      '<div class="calc-quick">' + NUM.QUICK.map(function (q) {
        return '<button class="btn btn-sm" data-calc-add="' + q + '">+' + NUM.group(q) + '</button>';
      }).join('') + '<button class="btn btn-sm" data-calc-act="clear">Стереть</button></div>' +
      '<div class="calc-pad">' + NUM.KEYS.map(function (rowKeys) {
        return rowKeys.map(function (k) {
          var cls = k === '=' ? ' calc-eq' : (/[÷×−+]/.test(k) ? ' calc-op' : '');
          return '<button class="calc-key' + cls + '" data-calc-key="' + esc(k) + '">' + esc(k) + '</button>';
        }).join('');
      }).join('') + '<button class="calc-key calc-back-key" data-calc-act="back">⌫</button>' +
      '<button class="calc-key" data-calc-key="(">(</button>' +
      '<button class="calc-key" data-calc-key=")">)</button>' +
      '<button class="calc-key" data-calc-key="%">%</button></div>' +
      '<div class="form-actions"><button class="btn" data-calc-act="close">Отмена</button>' +
      '<button class="btn btn-primary btn-lg" data-calc-act="use">Подставить в поле</button></div>' +
      '</div></div>';
    document.body.appendChild(box);

    var line = box.querySelector('#calcLine'), res = box.querySelector('#calcRes');
    function show() {
      var v = NUM.calc(line.value);
      res.innerHTML = !line.value.trim() ? '<span class="c-muted">введите сумму</span>'
        : (v === null ? '<span class="c-red">не получается посчитать</span>'
          : '<b>' + esc(NUM.money(v)) + '</b>' +
            (Math.abs(v) >= 1000 ? '<small>' + esc(NUM.words(v)) + '</small>' : ''));
    }
    function put(t) { line.value += t; show(); line.focus(); }
    show();
    setTimeout(function () { line.focus(); line.select(); }, 60);

    box.addEventListener('click', function (e) {
      var k = e.target.closest('[data-calc-key],[data-calc-act],[data-calc-add]');
      if (!k) { if (e.target === box) box.remove(); return; }
      if (k.dataset.calcKey === '=') {
        var v = NUM.calc(line.value);
        if (v !== null) line.value = v;
        show(); return;
      }
      if (k.dataset.calcKey) { put(k.dataset.calcKey); return; }
      if (k.dataset.calcAdd) {
        var cur = NUM.calc(line.value);
        line.value = (cur === null ? 0 : cur) + +k.dataset.calcAdd;
        show(); return;
      }
      var a = k.dataset.calcAct;
      if (a === 'close') box.remove();
      else if (a === 'clear') { line.value = ''; show(); }
      else if (a === 'back') { line.value = line.value.slice(0, -1); show(); }
      else if (a === 'use') {
        var val = NUM.calc(line.value);
        if (val === null) { toast('Не получается посчитать — проверьте выражение.'); return; }
        field.value = val;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        box.remove();
        field.focus();
      }
    });
    line.addEventListener('input', show);
    line.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        box.querySelector('[data-calc-act="use"]').click();
      }
    });
  }

  // Что-нибудь уже введено в открытой форме?
  function sheetHasInput() {
    var f = document.getElementById('wmForm');
    if (!f) return false;
    var dirty = false;
    Array.prototype.forEach.call(f.querySelectorAll('input,textarea'), function (i) {
      if (i.type === 'hidden' || i.type === 'checkbox' || i.type === 'radio') return;
      // дата и подставленные значения не считаются: они стоят там сами
      // подставленное программой (дата, кассир, категория) правкой не считается
      if ((i.dataset.prefilled || '') === (i.value || '')) return;
      if (String(i.value || '').trim()) dirty = true;
    });
    return dirty;
  }

  // Закрыть окно, спросив, если владелец уже что-то написал
  function askClose() {
    if (sheetHasInput() && !confirm('Закрыть форму? Введённое не сохранится.')) return false;
    DET.reset();
    closeSheet();
    return true;
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
  /* Таблица. На компьютере и планшете это обычная таблица, а на телефоне
     каждая строка превращается в карточку «подпись — значение»: восемь
     столбцов на экран шириной 39 мм всё равно не помещаются, а крутить
     таблицу вбок и гадать, чья это цифра, — мучение. Название столбца
     кладём в data-подпись каждой ячейки, дальше всё делает разметка. */
  function table(id, cols, rows, opts) {
    opts = opts || {};
    var step = opts.step || 40, limit = EXPORT_ALL ? rows.length : (PAGE[id] || step);
    var h = '<div class="table-wrap"><table class="data"><thead><tr>';
    cols.forEach(function (c) { h += '<th class="' + (c.cls || '') + '">' + esc(c.title) + '</th>'; });
    h += '</tr></thead><tbody>';
    if (!rows.length) h += '<tr class="plain"><td colspan="' + cols.length + '"><div class="empty">' + (opts.empty || 'Пока пусто') + '</div></td></tr>';
    rows.slice(0, limit).forEach(function (r, i) {
      h += '<tr>';
      cols.forEach(function (c) {
        h += '<td class="' + (c.cls || '') + '" data-label="' + esc(c.title) + '">' +
          (c.fn ? c.fn(r, i) : esc(r[c.key])) + '</td>';
      });
      h += '</tr>';
    });
    if (opts.total) {
      h += '<tr class="total">';
      opts.total.forEach(function (c) {
        h += '<td class="' + (c.cls || '') + '"' + (c.span ? ' colspan="' + c.span + '"' : '') +
          ' data-label="' + esc(c.label || '') + '">' + (c.html || '') + '</td>';
      });
      h += '</tr>';
    }
    if (rows.length > limit) {
      h += '<tr class="plain"><td colspan="' + cols.length + '"><div class="more"><button class="btn btn-sm" data-act="more" data-id="' +
        esc(id) + '" data-step="' + step + '">Показать ещё (' + nf(rows.length - limit) + ')</button></div></td></tr>';
    }
    return h + '</tbody></table></div>';
  }

  var LIST_N = 0;

  // Что написать под числовым полем: сумму с пробелами и прописью,
  // а для выражения — ещё и результат счёта
  function numHint(raw) {
    var txt = String(raw == null ? '' : raw).trim();
    if (!txt) return '';
    var v = NUM.calc(txt);
    if (v === null) return '<span class="c-red">не получается посчитать</span>';
    var out = '<b>' + esc(NUM.money(v)) + '</b>';
    if (NUM.isExpr(txt)) out = esc(txt) + ' = ' + out;
    if (Math.abs(v) >= 1000) out += ' <span class="c-muted">' + esc(NUM.words(v)) + '</span>';
    return out;
  }

  /* Одна строка списка «за что + сколько». Так устроен список выплат из кассы
     за смену: «Ване на такси 300», «за воду 250» — сколько строк нужно,
     столько и добавляем, а не одна общая сумма без объяснения. */
  function pairRow(name, i, it, dlid, ph) {
    it = it || {};
    return '<div class="pair-row">' +
      '<input type="text" name="' + esc(name) + '_n' + i + '" value="' + esc(it.name == null ? '' : it.name) + '"' +
      (dlid ? ' list="' + dlid + '"' : '') + ' placeholder="' + esc((ph && ph[0]) || 'за что') + '">' +
      '<input type="text" inputmode="decimal" class="num-input" name="' + esc(name) + '_a' + i + '"' +
      ' value="' + esc(it.sum == null || it.sum === '' ? '' : it.sum) + '" placeholder="' + esc((ph && ph[1]) || 'сумма') + '">' +
      '<button type="button" class="btn btn-sm pair-del" data-pairdel="1" title="Убрать строку">✕</button>' +
      '</div>';
  }

  // Собрать список пар обратно из значений формы
  function pairValues(v, name) {
    var out = [];
    for (var i = 0; i < 60; i++) {
      var n = v[name + '_n' + i], a = v[name + '_a' + i];
      if (n === undefined && a === undefined) continue;
      var sum = num(a);
      if (!String(n || '').trim() && !sum) continue;
      out.push({ name: String(n || '').trim(), sum: sum });
    }
    return out;
  }

  function fieldRow(label, name, type, value, opts) {
    opts = opts || {};
    var h = '<div class="form-row"><label>' + esc(label) +
      (opts.hint ? '<small style="display:block;font-size:12px;color:var(--label-2);font-weight:400">' + esc(opts.hint) + '</small>' : '') +
      '</label>';
    if (type === 'list') {
      // свой список: можно выбрать из своих значений, а можно вписать новое —
      // новое слово программа запомнит в справочнике
      var lid = 'dl-' + name + '-' + (++LIST_N);
      h += '<input type="text" name="' + name + '" value="' + esc(value == null ? '' : value) + '" list="' + lid + '"' +
        ' data-prefilled="' + esc(value == null ? '' : value) + '"' +
        (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '>' +
        '<datalist id="' + lid + '">' + (opts.options || []).map(function (o) {
          return '<option value="' + esc(o) + '">';
        }).join('') + '</datalist>';
    } else if (type === 'select') {
      h += '<select name="' + name + '">' + (opts.options || []).map(function (o) {
        var v = typeof o === 'string' ? o : o.value, t = typeof o === 'string' ? o : o.text;
        return '<option value="' + esc(v) + '"' + (String(value) === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>';
      }).join('') + '</select>';
    } else if (type === 'number') {
      // Числовое поле принимает и выражение: «1250*3+400». Считается на месте,
      // под полем сразу видно сумму с разделением разрядов и прописью.
      var start = value == null || value === '' ? '' : String(value);
      h += '<div class="num-field">' +
        '<input type="text" inputmode="decimal" class="num-input" name="' + name + '"' +
        ' value="' + esc(start) + '" data-prefilled="' + esc(start) + '"' +
        (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '>' +
        '<button type="button" class="btn btn-sm num-calc" data-calc="' + esc(name) + '" title="Калькулятор">🧮</button>' +
        '</div><div class="num-hint" data-hint-for="' + esc(name) + '">' + numHint(start) + '</div>';
    } else if (type === 'pairs') {
      var plid = (opts.options && opts.options.length) ? 'dl-' + name + '-' + (++LIST_N) : '';
      var items = (opts.rows && opts.rows.length) ? opts.rows : [{ name: '', sum: '' }];
      h += '<div class="pair-box">' +
        '<div class="pair-list" data-pairs="' + esc(name) + '"' +
        (plid ? ' data-plist="' + plid + '"' : '') + '>' +
        items.map(function (it, i) { return pairRow(name, i, it, plid, opts.placeholders); }).join('') +
        '</div>' +
        (plid ? '<datalist id="' + plid + '">' + (opts.options || []).map(function (o) {
          return '<option value="' + esc(o) + '">'; }).join('') + '</datalist>' : '') +
        '<button type="button" class="btn btn-sm" data-pairadd="' + esc(name) + '">+ ещё строка</button>' +
        '</div>';
    } else if (type === 'date') {
      h += '<input type="date" name="' + name + '" value="' + esc(value == null ? '' : value) + '"' +
        ' data-prefilled="' + esc(value == null ? '' : value) + '">' +
        '<div class="num-hint" data-hint-for="' + esc(name) + '">' + esc(NUM.dateFull(value)) + '</div>';
    } else {
      h += '<input type="' + type + '" name="' + name + '" value="' + esc(value == null ? '' : value) + '"' +
        ' data-prefilled="' + esc(value == null ? '' : value) + '"' +
        (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
        (opts.list ? ' list="' + opts.list + '"' : '') + '>';
    }
    return h + '</div>';
  }
  function formValues(form) {
    var out = {};
    Array.prototype.forEach.call(form.querySelectorAll('input,select,textarea'), function (i) {
      if (!i.name) return;
      if (i.classList && i.classList.contains('num-input')) {
        // «1250*3+400» превращается в 4150 ровно здесь, при сохранении
        var v = NUM.calc(i.value);
        out[i.name] = v === null ? num(i.value) : v;
      } else if (i.type === 'number') out[i.name] = num(i.value);
      else out[i.name] = i.value.trim();
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
    (S.state.supreg || []).forEach(function (f) { set[f.name] = 1; });   // фирмы из справочника
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
    else if (kind === 'deadstock') {
      r = E.parseDeadStock(m.matrix); D.dead = r.rows; D.deadPeriod = r.period; info.period = r.period;
      info.note = 'позиций ' + r.rows.length;
    }
    else if (kind === 'incexp1c') {
      r = E.parseIncomeExpense(m.matrix);
      D.incexp = { rows: r.rows, totals: r.totals, period: r.period };
      info.period = r.period;
      info.note = 'приход ' + money(r.totals.income) + ', расход ' + money(r.totals.expense);
    }
    else if (kind === 'writeoffs1c') { r = E.parseWriteoffs1C(m.matrix); D.writeoffs = r.rows; D.writeoffsPeriod = r.period; info.period = r.period; }
    else if (kind === 'returns') { r = E.parseReturns(m.matrix); D.returns = r.rows; D.returnsPeriod = r.period; info.period = r.period; }
    else if (kind === 'invoices1c') {
      r = E.parseIncomingInvoices(m.matrix); D.invoices1c = r.rows; D.invoicesPeriod = r.period; info.period = r.period;
      var sd = SUP.mergeDocs(S.state, r.rows, name, S.state.supreg, S.settings);
      // если владелец попросил не подтверждать каждую накладную вручную
      if (E.norm(S.settings.autoConfirm) === 'да') {
        (S.state.docs || []).forEach(function (d) { if (!d.confirmed) d.confirmed = true; });
      }
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
    C.dead = D.dead.length ? E.deadStockList(D.dead, C.stockIdx, S.settings) : null;
    C.incexp = D.incexp ? E.incomeExpenseSummary(D.incexp.rows) : null;
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
  // Долг всегда один — по общей базе документов. Ваши записи и выгрузки 1С
  // лежат в ней вместе, поэтому двух разных цифр больше не бывает.
  function debtNow() {
    var man = E.manualTotals(S.state.invoices || [], S.state.payments || []);
    if (C.sup && C.sup.totals.docs) {
      var own = C.sup.docs.filter(function (d) { return d.source !== '1c'; }).length;
      var from1c = C.sup.totals.docs - own;
      var src = own && from1c ? 'по вашим записям и накладным 1С'
        : (own ? 'по вашим записям' : 'по накладным 1С');
      return { value: C.sup.totals.left, source: src, own: own, from1c: from1c,
        over: C.sup.totals.over, manual: 0, hasBoth: false };
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
      var why = F.humanError(e);
      render();
      if (why) toast(why, 11000);
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
    } catch (e) {
      var why = F.humanError(e);
      render();
      if (why) toast(why, 11000);
    }
  }

  // Прочитать выгрузки 1С из подключённой папки (только изменившиеся файлы)
  async function syncFolder(silent) {
    if (F.state !== 'ready') return false;
    var book = null, files;
    try {
      book = E.norm(S.settings.bookAutoRead) === 'нет' ? null : await F.bookChangedOutside();
      if (book) await readBook(book, silent);
      files = await F.listExports();
    } catch (e) {
      // папка исчезла посреди работы — объясняем и перерисовываем экран
      var why = F.humanError(e);
      render();
      if (why && !silent) toast(why, 11000);
      return false;
    }
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

  /* --- Книга «Бухгалтерия.xlsx»: она же база ---------------------------------
     Пишем её после каждой записи, читаем обратно, если владелец правил в Excel. */
  var BOOK = window.WMBook, bookTimer = null;

  function bookWorkbook() {
    var sheets = BOOK.build(S.state, S.settings, { stock: D.stock });
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (sh) {
      var ws = XLSX.utils.aoa_to_sheet(sh.aoa);
      ws['!cols'] = (sh.aoa[0] || []).map(function (t) {
        return { wch: Math.min(34, Math.max(11, String(t).length + 3)) };
      });
      ws['!freeze'] = { xSplit: 0, ySplit: 1 };
      XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
    });
    return wb;
  }
  function bookBytes() {
    return XLSX.write(bookWorkbook(), { bookType: 'xlsx', type: 'array' });
  }
  function scheduleBook() {
    if (F.state !== 'ready') return;
    if (E.norm(S.settings.bookAutoSave) === 'нет') return;   // владелец отключил автозапись
    if (bookTimer) clearTimeout(bookTimer);
    bookTimer = setTimeout(function () {
      try { F.saveBook(bookBytes()); } catch (e) { /* книга не должна ломать работу */ }
    }, 1200);
  }
  async function saveBookNow() {
    if (F.state !== 'ready') { toast('Сначала подключите папку на экране «Данные и файлы».'); return false; }
    var ok = await F.saveBook(bookBytes());
    toast(ok ? 'Книга сохранена: ' + F.dirName + '/' + F.BOOK_FILE : 'Не получилось записать книгу.');
    renderNav();
    return ok;
  }

  // Прочитать книгу из папки: правки владельца в Excel возвращаются в программу
  async function readBook(file, silent) {
    var f = file || await F.rootFile(F.BOOK_FILE);
    if (!f) { if (!silent) toast('Книги «' + F.BOOK_FILE + '» в папке ещё нет — она появится после первой записи.'); return false; }
    try {
      var wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellDates: true });
      var mats = {};
      wb.SheetNames.forEach(function (n) {
        mats[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
      });
      // страховка: перед тем как принять правки, кладём копию нынешней базы
      await F.writeFile('база-до-чтения-книги.json',
        JSON.stringify({ saved: new Date().toISOString(), data: S.state }, null, 2), 'копии');
      var rep = BOOK.parse(function (n) { return mats[n] || null; }, S.state, S.settings);
      S.save();
      recompute(); render();
      if (!silent || rep.rows) {
        toast('Прочитал книгу: ' + rep.sheets.map(function (x) { return x.name + ' — ' + x.rows; }).join(', ') +
          (rep.skipped.length ? '\nПропущено: ' + rep.skipped.join('; ') : ''), 7000);
      }
      return true;
    } catch (e) {
      toast('Не получилось прочитать книгу: ' + e.message);
      return false;
    }
  }

  /* --- Замок: пароль из 4 цифр от посторонних за этим компьютером -----------
     Это не шифрование: файл базы и книга Excel остаются обычными файлами.
     Пароль хранится только на этом компьютере, в базу и в книгу не попадает. */
  var PIN_KEY = 'wm_pin', lockTimer = null;

  function pinHash(code) {
    var h = 5381, s = 'wm:' + String(code || '');
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return String(h);
  }
  function pinSaved() {
    try { return localStorage.getItem(PIN_KEY) || ''; } catch (e) { return ''; }
  }
  function pinSet(code) {
    try { localStorage.setItem(PIN_KEY, pinHash(code)); } catch (e) {}
  }
  function pinOn() { return E.norm(S.settings.askPin) === 'да' && !!pinSaved(); }

  function lockScreen(askNew) {
    var box = document.createElement('div');
    box.className = 'backdrop lock-screen';
    box.innerHTML = '<div class="sheet" style="max-width:360px;text-align:center">' +
      '<div class="sheet-body" style="padding:26px 22px 22px">' +
      '<div style="font-size:40px">🔒</div>' +
      '<div class="sheet-title" style="margin-top:8px">' + esc(S.settings.storeName || 'Вай Маркет') + '</div>' +
      '<div class="card-note" style="margin:6px 0 16px">' +
      (askNew ? 'Придумайте пароль из 4 цифр' : 'Введите пароль') + '</div>' +
      '<input id="pinInput" type="password" inputmode="numeric" maxlength="4" ' +
      'style="font-size:28px;letter-spacing:10px;text-align:center;width:150px;border:none;' +
      'border-bottom:2px solid var(--separator);background:none;outline:none">' +
      '<div id="pinMsg" class="card-note" style="min-height:18px;margin-top:10px"></div>' +
      '<button class="btn btn-primary btn-lg" id="pinOk" style="margin-top:12px;width:100%">' +
      (askNew ? 'Сохранить' : 'Войти') + '</button></div></div>';
    document.body.appendChild(box);
    var input = box.querySelector('#pinInput'), msg = box.querySelector('#pinMsg');
    setTimeout(function () { input.focus(); }, 80);
    function done() {
      var v = input.value.trim();
      if (!/^\d{4}$/.test(v)) { msg.textContent = 'Нужны ровно 4 цифры.'; return; }
      if (askNew) { pinSet(v); box.remove(); toast('Пароль задан. Он хранится только на этом компьютере.'); return; }
      if (pinHash(v) !== pinSaved()) { msg.textContent = 'Пароль не подошёл.'; input.value = ''; return; }
      box.remove();
    }
    box.querySelector('#pinOk').addEventListener('click', done);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') done(); });
  }

  // Автоблокировка по простою
  function armLock() {
    var mins = num(S.settings.lockMinutes);
    if (lockTimer) clearTimeout(lockTimer);
    if (!pinOn() || mins <= 0) return;
    lockTimer = setTimeout(function () {
      if (!document.querySelector('.lock-screen')) lockScreen(false);
    }, mins * 60000);
  }

  // Внешний вид по настройкам: тема, крупный шрифт
  function applyLook() {
    var s = S.settings, t = E.norm(s.theme || '');
    var mode = t.indexOf('тем') >= 0 ? 'dark' : (t.indexOf('свет') >= 0 ? 'light' : '');
    // «по расписанию»: днём светлая, вечером тёмная — границы из настроек
    if (t.indexOf('распис') >= 0) {
      var hour = new Date().getHours();
      var dayFrom = Q.hourOf(s.themeDayFrom, 7), nightFrom = Q.hourOf(s.themeNightFrom, 20);
      var night = nightFrom > dayFrom ? (hour >= nightFrom || hour < dayFrom)
        : (hour >= nightFrom && hour < dayFrom);
      mode = night ? 'dark' : 'light';
    }
    if (mode) document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
    // «Крупный режим» — одна настройка на всё: буквы, кнопки, поля, таблицы
    document.body.classList.toggle('big', E.norm(s.bigText) === 'да');
  }

  // Файл базы изменил кто-то ещё (вторая вкладка или другой компьютер).
  // Молча затирать нельзя — спрашиваем владельца.
  var conflictShown = false, conflictOther = null;
  function conflictAsk(other) {
    if (conflictShown) return;
    conflictShown = true;
    conflictOther = other;
    var when = '', theirCount = 0;
    try {
      var o = JSON.parse(other.text);
      when = new Date(o.saved).toLocaleString('ru-RU').slice(0, 16);
      var d = o.data || o;
      S.COLLECTIONS.forEach(function (c) { theirCount += (d[c] || []).length; });
    } catch (e) {}
    var myCount = S.COLLECTIONS.reduce(function (n, c) { return n + (S.state[c] || []).length; }, 0);
    sheet('База изменилась не в этой вкладке',
      '<div class="card"><div class="card-pad">Файл <b>' + esc(F.DATA_FILE) + '</b> в папке новее того, ' +
      'что открыто здесь' + (when ? ' (там запись от ' + esc(when) + ')' : '') + '.<br><br>' +
      'Так бывает, когда программа открыта в двух вкладках или на двух компьютерах: ' +
      'дома записали расход, в магазине — смену.<br><br>' +
      'Здесь <b>' + nf(myCount) + '</b> ' + plural(myCount, 'запись', 'записи', 'записей') +
      ', в файле — <b>' + nf(theirCount) + '</b>.<br><br>' +
      '<b>Объединить</b> — самый безопасный выбор: у каждой записи свой номер, ' +
      'поэтому ничего не пропадёт. Записи, которых нет здесь, добавятся; ' +
      'удалённые не воскреснут. Если одну и ту же запись правили в обоих местах — ' +
      'останется версия из более позднего файла, и программа скажет, сколько таких было.' +
      '</div></div>' +
      '<div class="form-actions">' +
      '<button class="btn" data-act="conflict-mine">Оставить только моё</button>' +
      '<button class="btn" data-act="conflict-theirs">Взять только из файла</button>' +
      '<button class="btn btn-primary" data-act="conflict-merge">Объединить</button></div>');
  }

  /* --- 125. Собрать базу заново из книги «Бухгалтерия.xlsx» --------------------
     Файл базы — служебный, его легко удалить не глядя. Книга лежит на виду и
     в ней те же записи: из неё базу можно собрать обратно.
     -------------------------------------------------------------------- */
  function offerBookRestore(bookFile) {
    var when = bookFile && bookFile.lastModified
      ? new Date(bookFile.lastModified).toLocaleString('ru-RU').slice(0, 16) : '';
    setTimeout(function () {
      sheet('Записей нет, а книга есть',
        '<div class="card"><div class="card-pad">В папке не нашлось файла базы <b>' +
        esc(F.DATA_FILE) + '</b>, зато лежит книга <b>' + esc(F.BOOK_FILE) + '</b>' +
        (when ? ' (изменена ' + esc(when) + ')' : '') + '.<br><br>' +
        'В книге те же записи, что и в базе: смены, расходы, накладные, оплаты. ' +
        'Программа может собрать базу обратно из неё — ничего не потеряется, ' +
        'кроме того, что вы в книгу не записывали.</div></div>' +
        '<div class="form-actions">' +
        '<button class="btn" data-act="close-sheet">Не сейчас</button>' +
        '<button class="btn btn-primary" data-act="book-restore">Собрать базу из книги</button></div>');
    }, 900);
  }

  function saveState() {
    var st = F.state, when = F.lastSaved;
    if (st === 'ready') {
      return { dot: '', text: 'Сохраняется в папку' + (when ? ' · ' + when.toLocaleTimeString('ru-RU').slice(0, 5) : ''), ok: true };
    }
    if (st === 'lost') return { dot: 'off', lost: true,
      text: 'Папка не найдена — записи только в браузере', ok: false };
    if (st === 'needs-permission') return { dot: 'off', text: 'Нажмите, чтобы продолжить сохранение в папку', ok: false };
    if (st === 'unsupported') return { dot: 'off', text: 'Сохранение в файл: только Chrome / Edge', ok: false };
    return { dot: 'off', text: 'Сохранение в папку не подключено', ok: false };
  }

  /* --- Формы ручного ввода ---------------------------------------------------- */
  var FILTERSET_VIEW = '';    // для какого экрана сейчас сохраняем набор фильтров
  // Человеческое имя экрана по его коду — для подписей в формах и сообщениях
  function viewName(id) {
    var v = (VIEWS || []).filter(function (x) { return x.id === id; })[0];
    return v ? v.name : id;
  }

  var FORMS = {
    // Имя сохранённого набора фильтров спрашиваем своей формой, а не окном
    // браузера: системное окно выглядит чужеродно и в части браузеров
    // блокируется, а здесь всё как в остальной программе.
    filterSetName: {
      title: 'Запомнить набор фильтров', icon: '⭐',
      body: function (v) {
        v = v || {};
        return fieldRow('Название набора', 'name', 'text', v.name || '',
          { placeholder: 'мой понедельник',
            hint: 'для экрана «' + esc(viewName(FILTERSET_VIEW)) + '»' });
      },
      hint: 'Набор запомнит и выбранные кнопки, и период сверху. ' +
        'Потом одна кнопка над фильтрами вернёт всё как было.',
      save: function (v) { return saveFilterSet(FILTERSET_VIEW, v.name); }
    },
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
          fieldRow('Поставщик', 'supplier', 'list', v.supplier || '', { placeholder: 'название', options: supplierNames() }) +
          fieldRow('Номер накладной', 'doc', 'text', v.doc || '', { placeholder: 'например 412' }) +
          fieldRow('Что привезли', 'goods', 'text', v.goods || '', { placeholder: 'молочка, хлеб…' }) +
          fieldRow('Сумма накладной', 'total', 'number', v.total || '') +
          fieldRow('Отдали сразу наличными', 'paidCash', 'number', v.paidCash || 0) +
          fieldRow('Оплатить до', 'due', 'date', v.due || '');
      },
      hint: 'Остаток в долг = сумма накладной − отдали сразу. Ваша запись ложится в ту же базу, ' +
        'что и накладные из 1С, — долг считается одной суммой.',
      save: function (v) {
        if (!v.total) return 'Укажите сумму накладной.';
        if (!v.supplier) return 'Укажите поставщика.';
        learn({ suppliers: v.supplier });
        var rec = SUP.addOwnDoc(S.state, {
          doc: v.doc, date: v.date, supplier: v.supplier, sum: num(v.total),
          payDate: v.due, note: v.goods
        }, S.settings);
        // «отдали сразу» — это оплата по этой же накладной, а не отдельная жизнь
        if (num(v.paidCash) > 0) {
          SUP.addOwnPay(S.state, { date: v.date, supplier: v.supplier,
            sum: num(v.paidCash), basis: rec.doc, note: 'отдали сразу при приёмке' }, S.settings);
        }
        S.save(); recompute();
        var left = Math.max(0, num(v.total) - num(v.paidCash));
        return { ok: 'Записано. Остаётся долг ' + money(left) + ' перед «' + v.supplier + '»' };
      }
    },
    payment: {
      title: 'Оплата поставщику', icon: '💸',
      body: function (v) {
        v = v || {};
        return fieldRow('Дата', 'date', 'date', v.date || today()) +
          fieldRow('Поставщик', 'supplier', 'list', v.supplier || '', { placeholder: 'название', options: supplierNames() }) +
          fieldRow('Сумма', 'amount', 'number', v.amount || '') +
          fieldRow('За что', 'kind', 'select', v.kind || 'погашение долга',
            { options: ['погашение долга', 'оплата сразу при приёмке', 'предоплата'] }) +
          fieldRow('Чем платили', 'form', 'select', v.form || 'наличными из кассы',
            { options: ['наличными из кассы', 'переводом', 'картой'] }) +
          fieldRow('По накладной №', 'doc', 'text', v.doc || '', { placeholder: 'если известна' }) +
          fieldRow('Заметка', 'note', 'text', v.note || '');
      },
      hint: 'Оплата уменьшает долг перед поставщиком. Запись попадает в ту же базу, ' +
        'что и расходные ордера из 1С.',
      save: function (v) {
        if (!v.supplier) return 'Укажите поставщика.';
        if (!v.amount) return 'Укажите сумму.';
        learn({ suppliers: v.supplier });
        SUP.addOwnPay(S.state, {
          date: v.date, supplier: v.supplier, sum: num(v.amount),
          basis: v.doc, cashbox: v.form, note: v.note,
          operation: v.kind
        }, S.settings);
        S.save(); recompute();
        var c = SUP.compute(S.state, S.settings);
        var f = c.firms.filter(function (b) { return E.norm(b.firm) === E.norm(v.supplier); })[0];
        return { ok: 'Оплата записана. Долг перед «' + v.supplier + '»: ' + money(f ? f.left : 0) };
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
          fieldRow('Товар или группа', 'name', 'text', v.name || '', { list: 'dl-goods', placeholder: 'молочка, хлеб…' }) +
          fieldRow('Количество', 'qty', 'number', v.qty || '') +
          fieldRow('Сумма по себестоимости', 'cost', 'number', v.cost || '') +
          fieldRow('Причина', 'reason', 'list', v.reason || DICT().reasons[0], { options: DICT().reasons });
      },
      hint: 'Списание уменьшает прибыль. Причины можно добавлять свои — они запоминаются.',
      save: function (v) {
        if (!v.name) return 'Укажите товар.';
        var badCost = Q.checkAmount(v.cost); if (badCost) return badCost;
        learn({ reasons: v.reason });
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
          fieldRow('Часов', 'hours', 'number', v.hours || S.settings.shiftHours || 12) +
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
        var pre = Q.defaults(S.state, S.settings, 'payout');
        return fieldRow('Дата', 'date', 'date', v.date || pre.date) +
          fieldRow('Сотрудник', 'employee', 'list', v.employee || pre.employee, { options: DICT().employees }) +
          fieldRow('Что выдаём', 'type', 'list', v.type || 'Аванс', { options: ['Аванс', 'Зарплата', 'Премия', 'Прочее'] }) +
          fieldRow('Сумма', 'amount', 'number', v.amount || '') +
          fieldRow('Чем', 'form', 'list', v.form || pre.form,
            { options: ['Наличные из кассы', 'Перевод СБП', 'Банковский перевод'] }) +
          fieldRow('Основание', 'note', 'text', v.note || '');
      },
      hint: 'Аванс уменьшает сумму к выплате в конце месяца.',
      save: function (v) {
        if (!v.employee) return 'Укажите сотрудника.';
        var badPay = Q.checkAmount(v.amount); if (badPay) return badPay;
        learn({ employees: v.employee });
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

  /* --- Шаблоны частых записей ------------------------------------------------
     «Аренда 168 000, 5 числа» вбивается раз в месяц одинаково. Сохранили
     шаблон — дальше вставляется одной кнопкой, дата всегда сегодняшняя.
     ------------------------------------------------------------------------ */
  function tplBar(formId) {
    var list = IN.templatesFor(S.state.templates || [], formId);
    var h = '<div class="tpl-bar">';
    if (list.length) {
      h += '<span class="tpl-label">Готовые:</span>' + list.slice(0, 8).map(function (t) {
        return '<button type="button" class="chip" data-tpl="' + esc(t.id) + '">' + esc(t.name) +
          '</button>';
      }).join('');
    }
    h += '<button type="button" class="btn btn-sm tpl-save" data-tpl-save="' + esc(formId) +
      '" title="Запомнить как шаблон">☆ В шаблоны</button>';
    if (list.length) h += '<button type="button" class="btn btn-sm" data-tpl-manage="' + esc(formId) + '">Убрать лишние</button>';
    return h + '</div>';
  }

  function openForm(id, prefill, edit) {
    var f = FORMS[id]; if (!f) return;
    DET.reset();               // форма открывается поверх «Подробнее» — след стираем
    // полоска «осталась незаконченная запись» не должна закрывать кнопку «Сохранить»
    var oldBar = document.querySelector('.draft-bar'); if (oldBar) oldBar.remove();
    EDIT = edit || null;
    var lists = datalist('dl-sup', supplierNames()) +
      datalist('dl-staff', staffNames()) +
      datalist('dl-goods', D.stock.slice(0, 900).map(function (r) { return r.name; }));
    sheet(f.title,
      tplBar(id) +
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
    fieldRow: fieldRow, pairValues: pairValues, pageHead: pageHead, toast: toast, sheet: sheet, closeSheet: closeSheet,
    periodRange: periodRange, periodName: periodName, periodDays: periodDays, inPeriod: inPeriod,
    go: function (id) { go(id); }, render: function () { render(); },
    lastImport: function () { return LAST_IMPORT; },
    tab: function (key, def) { return TAB[key] || def; },
    rowMenu: function (coll, id, opts) { return rowMenu(coll, id, opts); },
    pasteClip: function (formId) { pasteClip(formId); },
    page: function (id, step) { return PAGE[id] || step; },
    data: function () { return D; }, calc: function () { return C; },
    openForm: function (id, prefill, edit) { openForm(id, prefill, edit); },
    form: function (id) { return FORMS[id]; },
    pickFiles: function () { $('filesInput').click(); },
    saveBook: function () { return saveBookNow(); },
    readBook: function () { return readBook(); },
    recompute: function () { recompute(); }
  };

  function quickBar() {
    return '<div class="quick">' +
      '<button class="btn btn-primary" data-form="cashShift">💵 Касса за смену</button>' +
      '<button class="btn" data-act="repeat-shift">↻ Как в прошлый раз</button>' +
      '<button class="btn" data-form="cashCount">🧾 Пересчитать кассу</button>' +
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
    // много наличных в кассе — пора инкассировать
    var cashLimit = num(S.settings.cashLimit);
    var bal = window.WMFin.balances(S.state.dds || [], {
      cash: num(S.settings.openCashStart), card: num(S.settings.openCardStart), transfer: num(S.settings.openTransferStart)
    });
    if (cashLimit > 0 && bal.map['Наличные'] > cashLimit) {
      items.push({ icon: '🏦', title: 'Много наличных в кассе',
        sub: 'больше вашего порога ' + money(cashLimit) + ' — пора инкассировать',
        value: '<span class="c-orange private">' + money(bal.map['Наличные']) + '</span>', view: 'cash' });
    }
    // списания выше нормы, которую вы задали
    var normPct = num(S.settings.writeoffNormPct);
    var ledPeriod = (S.state.dds || []).filter(function (r) { return inPeriod(r.date); });
    var incomePeriod = window.WMFin.totals(ledPeriod).income;
    if (normPct > 0 && C.writeoffSum > 0 && incomePeriod > 0) {
      var lossPct = C.writeoffSum / incomePeriod * 100;
      if (lossPct > normPct) {
        items.push({ icon: '🗑', title: 'Списания выше нормы',
          sub: pct(lossPct) + ' от выручки при вашей норме ' + pct(normPct),
          value: '<span class="c-red private">' + money(C.writeoffSum) + '</span>', view: 'losses' });
      }
    }
    // дни аванса и зарплаты
    var dayNum = new Date().getDate();
    if (num(S.settings.advanceDay) === dayNum) items.push({ icon: '💰', title: 'Сегодня день аванса',
      sub: 'вы поставили эту дату в настройках', value: '', view: 'staff' });
    if (num(S.settings.salaryDay) === dayNum) items.push({ icon: '💰', title: 'Сегодня день зарплаты',
      sub: 'вы поставили эту дату в настройках', value: '', view: 'staff' });

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
    if (F.state !== 'ready') {
      items.push({
        icon: '💾',
        title: F.state === 'lost' ? 'Папка программы не найдена' : 'Данные не сохраняются в файл',
        sub: F.state === 'unsupported' ? 'Откройте дашборд в Chrome или Edge'
          : (F.state === 'lost' ? 'Папку переименовали или перенесли. Записи целы — выберите папку заново'
            : 'Подключите папку — записи будут храниться в файле'),
        value: '<button class="btn btn-sm btn-primary" data-act="' +
          (F.state === 'needs-permission' ? 'folder-reconnect' : 'folder-connect') + '">' +
          (F.state === 'lost' ? 'Выбрать заново' : 'Подключить') + '</button>'
      });
    }
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
    h += kpiCards();

    if (X && (S.state.dds || []).length) {
      var daily = X.dailyRevenue(S.state.dds, 30, window.WMFin.isIncome);
      var sums = daily.map(function (d) { return d.sum; });
      var best = daily.slice().sort(function (a, b) { return b.sum - a.sum; })[0];
      var lastDay = daily[daily.length - 1];
      if (sums.some(function (v) { return v > 0; })) {
        h += card('Выручка за 30 дней по ' + dateRu(lastDay.date), '<div class="card-pad" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
          X.spark(sums, 320, 54) +
          '<div><div class="card-note">лучший день — ' + esc(dateRu(best.date)) + ': <b class="private">' +
          money(best.sum) + '</b></div>' +
          '<div class="card-note">в среднем <b class="private">' +
          money(sums.reduce(function (a, v) { return a + v; }, 0) / Math.max(1, sums.filter(function (v) { return v > 0; }).length)) +
          '</b> в день, когда была выручка</div></div></div>',
          DET.btn('month', today().slice(0, 7), 'Итоги месяца'));
      }
    }

    h += '<div class="quick">' + DET.btn('day', today(), '📅 Что было сегодня') + ' ' +
      DET.btn('month', today().slice(0, 7), '🗓 Итоги месяца') + ' ' +
      (lastDate && lastDate !== today() ? DET.btn('day', lastDate, '📅 Последний день с записями') : '') + '</div>';

    var prev = prevTotals();
    h += '<div class="stat-grid">' +
      stat('Наличные в кассе', priv(cashNow), ledger.length ? 'На ' + dateRu(lastDate) + ' по базе операций' : 'Запишите кассу за смену') +
      stat('Выручка', priv(fin.income || (ownerT && ownerT.revenue) || t.revenue),
        (fin.income ? 'По базе операций · ' + fin.days + ' ' + plural(fin.days, 'день', 'дня', 'дней')
          : (ownerT && ownerT.revenue ? 'По вашей книге, ' + ownerT.dayCount + ' дн.' : 'По отчёту 1С')) +
        (prev ? ' ' + delta(fin.income, prev.income) : '')) +
      stat('Прибыль', priv(fin.income ? fin.profit : t.gross),
        (fin.income ? 'Рентабельность ' + pct(fin.profitability) : (t.revenue ? 'Маржа ' + pct(t.margin) : 'Нужны данные')) +
        (prev ? ' ' + delta(fin.profit, prev.profit) : ''),
        (fin.income ? fin.profit : t.gross) >= 0 ? 'c-green' : 'c-red') +
      stat('Куплено товара', priv(man.totals.supplies || (C.payments1c ? C.payments1c.totalSum : 0)),
        man.totals.docs ? man.totals.docs + ' ' + plural(man.totals.docs, 'накладная', 'накладные', 'накладных') + ' за ' + periodName().toLowerCase() : 'По накладным 1С') +
      '</div>';

    // выполнение плана месяца, если вы его задали в настройках
    var planRev = num(S.settings.planRevenue), planProf = num(S.settings.planProfit);
    if (planRev > 0 || planProf > 0) {
      var mStart = today().slice(0, 8) + '01';
      var mRows = ledger.filter(function (r) { return (r.date || '') >= mStart; });
      var mt = Fin.totals(mRows);
      var dayNo = new Date().getDate(), daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
      var passed = dayNo / daysInMonth;
      function goalRow(name, fact, plan) {
        if (plan <= 0) return '';
        var done = E.div(fact, plan) * 100;
        var ahead = done >= passed * 100;
        return listRow({ icon: ahead ? '🎯' : '⏳', title: esc(name) + ': ' + pct(done) + ' плана',
          sub: 'прошло ' + pct(passed * 100) + ' месяца · план ' + money(plan) +
            (ahead ? ' · идём с опережением' : ' · отстаём'),
          value: '<span class="' + (ahead ? 'c-green' : 'c-orange') + ' private">' + money(fact) + '</span>' });
      }
      var goals = [goalRow('Выручка', mt.income, planRev), goalRow('Прибыль', mt.profit, planProf)].filter(Boolean);
      if (goals.length) h += card('Цели месяца', listOf(goals, ''), 'из ваших настроек');
    }

    if (att.length) {
      h += card('Требует внимания', listOf(att.map(function (a) {
        return listRow({ icon: a.icon, title: esc(a.title), sub: esc(a.sub), value: a.value,
          tap: !!a.view, attrs: a.view ? ' data-go="' + a.view + '"' : '' });
      }), 'Всё спокойно'));
    }

    var topDebt = (C.balance1c || man.balance).filter(function (b) { return b.debt > 0; }).slice(0, 6);
    if (topDebt.length) {
      h += card('Кому платить в первую очередь', listOf(topDebt.map(function (b) {
        return listRow({ icon: '🤝', title: DET.link('firm', E.norm(b.supplier), b.supplier),
          sub: (phoneLink(b.supplier) || 'телефон не найден') + ' · поставки на ' + money(b.sum),
          value: '<span class="c-red private">' + money(b.debt) + '</span>' +
            '<small><button class="btn btn-sm" data-form="payment" data-supplier="' + esc(b.supplier) + '">Оплатить</button> ' +
            DET.btn('firm', E.norm(b.supplier)) + '</small>' });
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
    // одна база вместо двух вкладок: «мои» и «из 1С» — теперь обычный фильтр
    var tab = C.sup && C.sup.totals.docs ? '1c' : 'my';
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

    if (tab === '1c' && C.sup && C.sup.totals.docs) {
      var sp = C.sup, tt = sp.totals;
      var ownDocs = sp.docs.filter(function (d) { return d.source !== '1c'; }).length;
      h += '<div class="stat-grid">' +
        stat('Поставки в базе', priv(tt.sum), nf(tt.docs) + ' ' + plural(tt.docs, 'накладная', 'накладные', 'накладных') +
          (ownDocs ? ' · ваших ' + nf(ownDocs) : '')) +
        stat('Оплачено по ним', priv(tt.paid), 'ваши записи и ордера 1С вместе') +
        stat('Долг сейчас', priv(tt.left), 'одна сумма по всей базе', tt.left > 0 ? 'c-red' : 'c-green') +
        stat('Погашено старых долгов', priv(sp.linkStat.oldSum), 'по накладным вне выгрузок', 'c-green') +
        // переплата не гасит долг по другим накладным — показываем её отдельно,
        // иначе лишние деньги молча «съедали» бы чужой долг
        (tt.over > 0 ? stat('Переплата', priv(tt.over), 'заплатили больше, чем в накладной', 'c-orange') : '') +
        '</div>';

      var fixed = sp.docs.filter(function (d) { return d.mine && d.mine.length; }).length;
      if (fixed) {
        h += '<div class="banner blue"><span>✋</span><span>' + nf(fixed) + ' ' +
          plural(fixed, 'накладная исправлена', 'накладные исправлены', 'накладных исправлено') +
          ' вами вручную — долг считается по вашим цифрам, а не по 1С.</span>' +
          '<button class="btn" data-go="conflicts">Показать расхождения</button></div>';
      }

      if (sp.confirm.length) {
        h += '<div class="banner"><span>✅</span><span>' + sp.confirm.length + ' ' +
          plural(sp.confirm.length, 'накладная ждёт', 'накладные ждут', 'накладных ждут') +
          ' подтверждения даты выплаты — до этого они не попадают в план.</span>' +
          '<button class="btn" data-go="confirm">Подтвердить</button></div>';
      }

      // фильтры работают сразу и на список фирм, и на таблицу накладных
      var docDefs = [
        { key: 'st', name: 'Состояние', options: [
          { v: 'debt', name: 'В долг', test: function (r) { return r.left > 0; } },
          { v: 'part', name: 'Частично', test: function (r) { return r.status === 'part'; } },
          { v: 'paid', name: 'Оплачено', test: function (r) { return r.left <= 0; } },
          { v: 'over', name: 'Просрочено', test: function (r) { return r.overdue; } },
          { v: 'today', name: 'Платить сегодня', test: function (r) { return r.dueToday; } },
          { v: 'wait', name: 'Ждут подтверждения', test: function (r) { return r.awaiting; } },
          { v: 'plus', name: 'С переплатой', test: function (r) { return r.over > 0; } }
        ] },
        { key: 'firm', name: 'Поставщик', auto: function (r) { return r.firm; }, limit: 14 },
        // «Данные 1С мешают видеть чистую картину» — вот кнопки, чтобы их убрать
        { key: 'src', name: 'Откуда запись', options: [
          { v: 'my', name: 'Только мои', test: function (r) { return r.source !== '1c'; } },
          { v: '1c', name: 'Только из 1С', test: function (r) { return r.source === '1c'; } },
          { v: 'fixed', name: 'Исправленные мной', test: function (r) { return !!(r.mine && r.mine.length); } }
        ] },
        whenDefs('date', 'Когда привезли')
      ];
      var docsF = FLT.apply('sup1c', sp.docs, docDefs, function (r) {
        return (r.firm || '') + ' ' + (r.doc || '') + ' ' + (r.supplier || '') + ' ' + (r.incomingNo || '');
      });
      h += FLT.bar('sup1c', docDefs, sp.docs, { search: 'фирма, номер накладной' });

      // фирмы пересчитываются по отфильтрованным накладным — цифры честные
      var firmsF = FLT.active('sup1c')
        ? SUP.firmDebt({ docs: docsF, advance: sp.calc.advance }, sp.reg)
        : sp.firms;

      // долг считается по фирме: все написания имени из 1С сложены вместе
      h += card('Долг по поставщикам', listOf(firmsF.filter(function (f) { return f.left > 0 || f.overdue > 0; })
        .slice(0, 200).map(function (f) {
          var sub = [];
          if (f.phone || phoneLink(f.firm)) sub.push(f.phone ? '<a class="phone" href="tel:' + esc(f.phone) + '">' + esc(phoneFmt(f.phone)) + '</a>' : phoneLink(f.firm));
          sub.push(f.docs + ' ' + plural(f.docs, 'накладная', 'накладные', 'накладных'));
          if (f.reps.length) sub.push(f.reps.length + ' ' + plural(f.reps.length, 'имя', 'имени', 'имён') + ' в 1С');
          sub.push(f.term === null ? 'отсрочка не задана' : 'отсрочка ' + f.term + ' дн.');
          if (f.due) sub.push('ближайший срок ' + dateRu(f.due));
          else if (f.awaiting) sub.push(f.awaiting + ' ' + plural(f.awaiting, 'накладная ждёт', 'накладные ждут', 'накладных ждут') + ' подтверждения');
          if (f.over > 0) sub.push('<span class="c-orange">переплата ' + money(f.over) + '</span>');
          return listRow({ icon: f.overdue > 0 ? '🔴' : (f.left > 0 ? '🟠' : '🟢'),
            title: DET.link('firm', E.norm(f.firm), f.firm),
            sub: sub.join(' · '),
            value: '<span class="' + (f.overdue > 0 ? 'c-red' : '') + ' private">' + money(f.left) + '</span>' +
              (f.overdue > 0 ? '<small class="c-red private">просрочено ' + money(f.overdue) + '</small>'
                : (f.awaiting ? '<small class="c-muted">ждут подтверждения</small>' : '')) +
              '<small>' + DET.btn('firm', E.norm(f.firm)) + '</small>' });
        }), FLT.active('sup1c') ? 'Под фильтр ничего не подошло' : 'Долгов нет — всё оплачено'),
        '<button class="btn btn-sm" data-go="terms">Отсрочки</button>');

      h += card('Накладные из 1С' + (FLT.active('sup1c') ? ' — отобрано ' + nf(docsF.length) : ''),
        FLT.note(docsF.length, sp.docs.length,
          'на сумму ' + money(docsF.reduce(function (a, d) { return a + d.sum; }, 0)) +
          ', долг ' + money(docsF.reduce(function (a, d) { return a + d.left; }, 0))) +
        table('inv1c', [
        { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
        { title: 'Поставщик', fn: function (r) { return DET.link('firm', E.norm(r.firm), r.firm); } },
        { title: 'Документ', fn: function (r) {
          return DET.link('doc', r.id, r.doc) +
            (r.source !== '1c' ? ' ' + badge('моя', 'green') : '') +
            (r.mine && r.mine.length ? ' ' + badge('исправлена', 'orange') : ''); } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.sum); } },
        { title: 'Оплачено', cls: 'num', fn: function (r) { return priv(r.paid); } },
        { title: 'Долг', cls: 'num', fn: function (r) { return '<span class="' + (r.left > 0 ? 'c-red' : 'c-green') + ' private">' + money(r.left) + '</span>'; } },
        { title: 'Платить', fn: function (r) {
          if (r.left <= 0) return '—';
          if (!r.confirmed) return '<span class="c-muted">' + esc(dateRu(r.due)) + ' (не подтв.)</span>';
          return '<span class="' + (r.overdue ? 'c-red' : '') + '">' + esc(dateRu(r.due)) + '</span>'; } },
        { title: '', cls: 'center', fn: function (r) { return badge(r.statusText, r.status === 'paid' ? 'green' : (r.status === 'part' ? 'orange' : 'red')); } },
        { title: '', cls: 'center', fn: function (r) { return DET.btn('doc', r.id, 'Подробнее'); } }
      ], docsF, { step: 40, empty: 'Под фильтр ничего не подошло' }));
      return h;
    }

    var mt = man.totals;
    h += '<div class="stat-grid">' +
      stat('Привезли за период', priv(mt.supplies), mt.docs + ' ' + plural(mt.docs, 'накладная', 'накладные', 'накладных')) +
      stat('Оплатили', priv(mt.paid), mt.payments + ' ' + plural(mt.payments, 'платёж', 'платежа', 'платежей')) +
      stat('Осталось должны', priv(mt.debt), 'По моим записям', mt.debt > 0 ? 'c-red' : 'c-green') +
      stat('Средний чек накладной', priv(mt.docs ? mt.supplies / mt.docs : 0), 'За ' + periodName().toLowerCase()) + '</div>';

    h += card('Долг по поставщикам', listOf(man.balance.map(function (b) {
      return listRow({ icon: b.debt > 0 ? '🔴' : '🟢', title: DET.link('firm', E.norm(b.supplier), b.supplier),
        sub: (phoneLink(b.supplier) ? phoneLink(b.supplier) + ' · ' : '') + 'привезли ' + money(b.sum) + ' · оплатили ' + money(b.paid),
        value: '<span class="' + (b.debt > 0 ? 'c-red' : 'c-green') + ' private">' + money(b.debt) + '</span>' +
          '<small><button class="btn btn-sm" data-form="payment" data-supplier="' + esc(b.supplier) + '">Оплатить</button></small>' });
    }), 'Пока никаких записей. Нажмите «Записать приход» после первой поставки.'));

    h += card('Накладные', table('manDocs', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Поставщик', fn: function (r) { return DET.link('firm', E.norm(r.supplier), r.supplier); } },
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
        z: 0, diff: 0, payouts: 0, cash: 0, card: 0, sbp: 0, transfer: 0, ids: [] };
      var g = map[key];
      g.ids.push(r.id);
      if (Fin.isIncome(r)) {
        g.z += num(r.amount); g.diff += num(r.diff);
        if (r.method === 'Наличные') g.cash += num(r.amount);
        else if (r.method === 'Карта') g.card += num(r.amount);
        else if (r.method === 'СБП') g.sbp += num(r.amount);
        else g.transfer += num(r.amount);
      } else if (Fin.isExpense(r) && (E.norm(r.src) === 'касса' ||
          E.norm(r.category).indexOf('выплата из кассы') >= 0)) {
        // всё, что выдали из ящика в смену: хоть «на такси», хоть «за воду»
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
    var all = shiftsFromLedger();
    // фильтры стоят до подсчёта итогов: отобрали ночные смены — итоги стали по ночным
    var defs = [
      { key: 'shift', name: 'Смена', auto: function (r) { return r.shift; }, limit: 8 },
      { key: 'cashier', name: 'Кассир', auto: function (r) { return r.cashier; }, limit: 12 },
      { key: 'diff', name: 'Касса', options: [
        { v: 'ok', name: 'Сходится', test: function (r) { return r.diff === 0; } },
        { v: 'short', name: 'Недостача', test: function (r) { return r.diff < 0; } },
        { v: 'over', name: 'Излишек', test: function (r) { return r.diff > 0; } },
        { v: 'pay', name: 'Были выплаты', test: function (r) { return r.payouts > 0; } }
      ] },
      whenDefs('date', 'Когда')
    ];
    var rows = FLT.apply('cash', all, defs, function (r) { return r.cashier + ' ' + r.shift + ' ' + r.date; });
    var t = { count: rows.length, zCash: 0, factCash: 0, payouts: 0, diff: 0, terminal: 0, short: 0, over: 0 };
    rows.forEach(function (g) {
      t.zCash += g.cash; t.terminal += g.card + g.sbp + g.transfer; t.payouts += g.payouts;
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

    h += FLT.bar('cash', defs, all, { search: 'кассир, смена или дата' });

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
            '<small>' + (p.diff === 0 ? 'всё сходится' : (p.diff < 0 ? 'недостача' : 'излишек')) + '</small>' +
            '<small>' + DET.btn('employee', p.name) + '</small>' });
      }), 'Нет закрытых смен'));
    }

    h += card('Журнал смен', FLT.note(rows.length, all.length, 'выручка ' + money(t.revenue)) +
      table('shiftsT', [
      { title: 'Дата', fn: function (r) { return DET.link('day', r.date, dateRu(r.date)); } },
      { title: 'Смена', fn: function (r) { return DET.link('shift', r.date + '~' + (r.shift === '—' ? '' : r.shift), r.shift); } },
      { title: 'Кассир', fn: function (r) { return DET.link('employee', r.cashier, r.cashier); } },
      { title: 'Наличные', cls: 'num', fn: function (r) { return priv(r.cash); } },
      { title: 'Карта', cls: 'num', fn: function (r) { return priv(r.card); } },
      { title: 'СБП', cls: 'num', fn: function (r) { return priv(r.sbp); } },
      { title: 'Перевод', cls: 'num', fn: function (r) { return priv(r.transfer); } },
      { title: 'Выручка смены', cls: 'num', fn: function (r) { return priv(r.z); } },
      { title: 'Выдано', cls: 'num', fn: function (r) { return priv(r.payouts); } },
      { title: 'Факт', cls: 'num', fn: function (r) { return priv(r.fact); } },
      { title: 'Расхождение', cls: 'num', fn: function (r) { return '<span class="' + cls(r.diff) + ' private">' + money(r.diff) + '</span>'; } },
      { title: '', cls: 'center', fn: function (r) {
        return DET.btn('shift', r.date + '~' + (r.shift === '—' ? '' : r.shift), 'Подробнее') + ' ' +
          '<button class="btn btn-sm btn-danger" data-act="del-shift" data-ids="' + r.ids.join(',') + '">✕</button>'; } }
    ], rows, { step: 30, empty: FLT.active('cash') ? 'Под фильтр ничего не подошло' : 'Смен за период нет. Нажмите «Закрыть смену».',
      total: [{ html: 'Итого', span: 3 }, { html: money(t.zCash), cls: 'num' },
        { html: money(rows.reduce(function (a, r) { return a + r.card; }, 0)), cls: 'num' },
        { html: money(rows.reduce(function (a, r) { return a + r.sbp; }, 0)), cls: 'num' },
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
    var allExp = ledger.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var defs = [
      { key: 'cat', name: 'Статья', auto: function (r) { return r.category || 'Прочее'; }, limit: 14 },
      { key: 'method', name: 'Чем платили', auto: function (r) { return r.method || '—'; }, limit: 8 },
      { key: 'size', name: 'Размер', options: [
        { v: 'big', name: 'Крупные (от 10 000)', test: function (r) { return num(r.amount) >= 10000; } },
        { v: 'mid', name: '1 000 – 10 000', test: function (r) { return num(r.amount) >= 1000 && num(r.amount) < 10000; } },
        { v: 'small', name: 'До 1 000', test: function (r) { return num(r.amount) < 1000; } }
      ] },
      whenDefs('date', 'Когда')
    ];
    var exp = FLT.apply('dds', allExp, defs, function (r) {
      return (r.category || '') + ' ' + (r.note || '') + ' ' + (r.method || '');
    });
    var byCat = {};
    exp.forEach(function (e) { byCat[e.category || 'Прочее'] = (byCat[e.category || 'Прочее'] || 0) + num(e.amount); });
    var cats = Object.keys(byCat).map(function (k) { return { name: k, sum: E.safeRound(byCat[k]) }; })
      .sort(function (a, b) { return b.sum - a.sum; });
    var expSum = cats.reduce(function (a, c) { return a + c.sum; }, 0);
    var sel = ownerRows(), ot = D.owner ? E.ownerTotals(sel.rows) : null;

    var h = '<div class="page-head"><div><div class="page-title">Расходы</div>' +
      '<div class="page-sub">Куда уходят деньги магазина</div></div>' +
      '<button class="btn btn-primary" data-form="ddsExpense">＋ Записать расход</button></div>';

    h += FLT.bar('dds', defs, allExp, { search: 'статья, заметка' });

    h += '<div class="stat-grid">' +
      stat('Расходы за период', priv(expSum), exp.length + ' ' + plural(exp.length, 'запись', 'записи', 'записей')) +
      stat('Постоянные расходы в месяц', priv(S.fixedMonthly()), 'Аренда, зарплата, налоги — из настроек') +
      (ot ? stat('Оборот по книге ДДС', priv(ot.revenue), ot.dayCount + ' дн.' + (sel.whole ? ' (весь файл)' : '')) : '') +
      (ot ? stat('Прибыль по книге', priv(ot.profit), 'Ваш расчёт: 25% минус расходы', ot.profit >= 0 ? 'c-green' : 'c-red') : '') +
      '</div>';

    if (cats.length) {
      h += card('По статьям', listOf(cats.map(function (c) {
        return listRow({ icon: '🧾', title: DET.link('category', c.name, c.name),
          sub: pct(E.div(c.sum, expSum) * 100) + ' от расходов',
          value: priv(c.sum) + '<small>' + DET.btn('category', c.name) + '</small>' });
      }), ''));
    }

    h += card('Записи расходов', FLT.note(exp.length, allExp.length, 'на сумму ' + money(expSum)) +
      table('expT', [
      { title: 'Дата', fn: function (r) { return DET.link('day', r.date, dateRu(r.date)); } },
      { title: 'Статья', fn: function (r) { return DET.link('category', r.category, r.category); } },
      { title: 'Чем платили', fn: function (r) { return r.method ? DET.link('method', r.method, r.method) : '—'; } },
      { title: 'Заметка', fn: function (r) { return esc(r.note || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.amount); } },
      { title: '', cls: 'center', fn: function (r) {
        return DET.btn('day', r.date, 'Подробнее') +
          ' <button class="btn btn-sm" data-edit="dds:' + r.id + ':ddsExpense">✎</button>' +
          ' <button class="btn btn-sm btn-danger" data-del="dds:' + r.id + '">✕</button>'; } }
    ], exp, { step: 30, empty: FLT.active('dds') ? 'Под фильтр ничего не подошло' : 'Расходов пока не записано' }));

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
      { title: 'Дата', fn: function (r) { return DET.link('day', r.date, dateRu(r.date)); } },
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
    var tsAll = jrn('timesheet'), poAll = jrn('payouts');
    var defs = [
      { key: 'emp', name: 'Сотрудник', auto: function (r) { return r.employee; }, limit: 14 },
      { key: 'shift', name: 'Смена', auto: function (r) { return r.shift; }, limit: 8 },
      { key: 'mark', name: 'Отметки', options: [
        { v: 'bonus', name: 'С премией', test: function (r) { return num(r.bonus) > 0; } },
        { v: 'pen', name: 'Со штрафом', test: function (r) { return num(r.penalty) > 0; } }
      ] },
      whenDefs('date', 'Когда')
    ];
    // фильтр по сотруднику должен убирать его выплаты тоже, иначе свод врёт
    var ts = FLT.apply('staff', tsAll, defs, function (r) { return (r.employee || '') + ' ' + (r.shift || ''); });
    var empPick = FLT.get('staff', 'emp');
    var po = poAll.filter(function (r) {
      if (empPick && E.norm(r.employee) !== E.norm(empPick)) return false;
      var w = FLT.get('staff', 'when');
      if (w) {
        var days = { d: 0, w: 7, m: 30, q: 90, y: 365 }[w];
        if (days === 0) return r.date === today();
        if (days) return (r.date || '') >= addDaysStr(-days);
      }
      return true;
    });
    var sum = E.payrollSummary(ts, po);
    var accrued = sum.reduce(function (a, r) { return a + r.accrued; }, 0);
    var paid = sum.reduce(function (a, r) { return a + r.paid; }, 0);

    var h = '<div class="page-head"><div><div class="page-title">Зарплата</div>' +
      '<div class="page-sub">Смены, начисления и выплаты</div></div>' +
      '<div><button class="btn" data-form="timesheet">＋ Смена</button> ' +
      '<button class="btn btn-primary" data-form="payout">＋ Выплата</button></div></div>';

    h += FLT.bar('staff', defs, tsAll, { search: 'сотрудник или смена' });

    h += '<div class="stat-grid">' +
      stat('Начислено', priv(accrued), ts.length + ' ' + plural(ts.length, 'смена', 'смены', 'смен') + ' за ' + periodName().toLowerCase()) +
      stat('Выплачено', priv(paid), po.length + ' ' + plural(po.length, 'выплата', 'выплаты', 'выплат')) +
      stat('Осталось выплатить', priv(accrued - paid), 'Долг перед сотрудниками', accrued - paid > 0 ? 'c-orange' : 'c-green') +
      stat('Людей в табеле', nf(sum.length), 'За ' + periodName().toLowerCase()) + '</div>';

    // премия процентом от выручки — если задали в настройках
    var bonusPct = num(S.settings.bonusPercent);
    if (bonusPct > 0) {
      var led = (S.state.dds || []).filter(function (r) { return inPeriod(r.date); });
      var rev = window.WMFin.totals(led).income;
      h += '<div class="banner blue"><span>🎁</span><span>Премия <b>' + pct(bonusPct) + '</b> от выручки за ' +
        periodName().toLowerCase() + ': <b class="private">' + money(E.safeRound(rev * bonusPct / 100)) +
        '</b> на всех. Ставка смены — ' + nf(S.settings.shiftHours) + ' ч по ' +
        money(S.settings.rateDay) + '/час днём и ' + money(S.settings.rateNight) + '/час ночью.</span></div>';
    }

    h += card('По сотрудникам', listOf(sum.map(function (r) {
      return listRow({ icon: '👤', title: DET.link('employee', r.employee, r.employee),
        sub: (r.position || 'сотрудник') + ' · ' + nf(r.hours, 0) + ' ч · начислено ' + money(r.accrued) + ' · выдано ' + money(r.paid),
        value: '<span class="' + (r.left > 0 ? 'c-orange' : 'c-green') + ' private">' + money(r.left) + '</span>' +
          '<small><button class="btn btn-sm" data-form="payout" data-employee="' + esc(r.employee) + '">Выдать</button> ' +
          DET.btn('employee', r.employee) + '</small>' });
    }), 'Табель пуст — нажмите «＋ Смена»'));

    if (D.owner && D.owner.payroll.length) {
      h += card('Ставки из вашей платёжки', listOf(D.owner.payroll.map(function (r) {
        return listRow({ icon: r.night ? '🌙' : '☀️', title: esc(r.name || r.position),
          sub: esc(r.position + (r.schedule ? ' · ' + r.schedule : '')), value: priv(r.rate) + '<small>за смену</small>' });
      }), ''));
    }

    h += card('Табель', FLT.note(ts.length, tsAll.length) + table('tsT', [
      { title: 'Дата', fn: function (r) { return DET.link('day', r.date, dateRu(r.date)); } },
      { title: 'Сотрудник', fn: function (r) { return DET.link('employee', r.employee, r.employee); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift); } },
      { title: 'Часы', cls: 'num', fn: function (r) { return nf(r.hours, 1); } },
      { title: 'Ставка', cls: 'num', fn: function (r) { return priv(r.rate); } },
      { title: 'Штраф', cls: 'num', fn: function (r) { return priv(r.penalty); } },
      { title: 'Премия', cls: 'num', fn: function (r) { return priv(r.bonus); } },
      { title: 'Начислено', cls: 'num', fn: function (r) { return priv(E.timesheetCalc(r)); } },
      { title: '', cls: 'center', fn: function (r) {
        return '<button class="btn btn-sm" data-edit="timesheet:' + r.id + ':timesheet">✎</button> ' +
          '<button class="btn btn-sm btn-danger" data-del="timesheet:' + r.id + '">✕</button>'; } }
    ], ts.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }),
      { step: 30, empty: FLT.active('staff') ? 'Под фильтр ничего не подошло' : 'Смен нет' }));

    h += card('Выплаты', FLT.note(po.length, poAll.length) + table('poT', [
      { title: 'Дата', fn: function (r) { return DET.link('day', r.date, dateRu(r.date)); } },
      { title: 'Сотрудник', fn: function (r) { return DET.link('employee', r.employee, r.employee); } },
      { title: 'Что', fn: function (r) { return esc(r.type); } },
      { title: 'Чем', fn: function (r) { return esc(r.form); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.amount); } },
      { title: '', cls: 'center', fn: function (r) {
        return '<button class="btn btn-sm" data-edit="payouts:' + r.id + ':payout">✎</button> ' +
          '<button class="btn btn-sm btn-danger" data-del="payouts:' + r.id + '">✕</button>'; } }
    ], po.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }),
      { step: 30, empty: FLT.active('staff') ? 'Под фильтр ничего не подошло' : 'Выплат нет' }));
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

      // оборачиваемость: за сколько раз в год «прокручивается» товар на полке
      if (C.sales && C.sales.cogs && C.stock.buySum) {
        var daysS = D.salesPeriod ? D.salesPeriod.days : 30;
        var turns = E.safeRound(C.sales.cogs / daysS * 365 / C.stock.buySum);
        var good = num(S.settings.turnoverGood) || 20;
        var daysOnShelf = turns ? Math.round(365 / turns) : 0;
        h += '<div class="banner ' + (turns >= good ? 'green' : '') + '"><span>' + (turns >= good ? '✅' : '🐢') + '</span>' +
          '<span>Оборачиваемость <b>' + nf(turns, 1) + ' раз в год</b> — товар лежит на полке в среднем ' +
          daysOnShelf + ' ' + plural(daysOnShelf, 'день', 'дня', 'дней') + '. ' +
          (turns >= good ? 'Это лучше вашей планки ' + nf(good) + '.'
            : 'Ваша планка — ' + nf(good) + ' раз в год: деньги застревают в товаре.') + '</span></div>';
      }

      var q = ($('search') && $('search').value || '').trim();
      var rows = D.stock;
      if (q) { var nq = E.norm(q); rows = rows.filter(function (r) {
        return r.key.indexOf(nq) >= 0 || (r.barcode && r.barcode.indexOf(nq) >= 0) || E.norm(r.article).indexOf(nq) >= 0; }); }

      var stDefs = [
        { key: 'group', name: 'Группа', auto: function (r) { return r.group; }, limit: 16 },
        { key: 'qty', name: 'Остаток', options: [
          { v: 'zero', name: 'Закончилось', test: function (r) { return r.qty <= 0; } },
          { v: 'low', name: 'Мало (до 3)', test: function (r) { return r.qty > 0 && r.qty < 3; } },
          { v: 'ok', name: 'Есть', test: function (r) { return r.qty >= 3; } }
        ] },
        { key: 'mk', name: 'Наценка', options: [
          { v: 'no', name: 'Нет наценки', test: function (r) { return r.buyPrice > 0 && r.retailPrice <= r.buyPrice; } },
          { v: 'lo', name: 'До 20%', test: function (r) { return r.buyPrice > 0 && r.retailPrice / r.buyPrice - 1 < 0.2 && r.retailPrice > r.buyPrice; } },
          { v: 'hi', name: 'Больше 40%', test: function (r) { return r.buyPrice > 0 && r.retailPrice / r.buyPrice - 1 > 0.4; } },
          { v: 'noprice', name: 'Без цены закупа', test: function (r) { return !r.buyPrice; } }
        ] },
        { key: 'money', name: 'Денег на полке', options: [
          { v: 'big', name: 'От 10 000', test: function (r) { return r.buySum >= 10000; } },
          { v: 'mid', name: '1 000 – 10 000', test: function (r) { return r.buySum >= 1000 && r.buySum < 10000; } }
        ] }
      ];
      var allStock = rows.slice();
      rows = FLT.apply('stock', rows, stDefs, function (r) { return r.name + ' ' + (r.barcode || '') + ' ' + (r.article || ''); })
        .sort(function (a, b) { return b.buySum - a.buySum; });
      h += FLT.bar('stock', stDefs, allStock, { search: 'товар, штрихкод, артикул' });

      // минусовой остаток в 1С — это проданное, но не оприходованное:
      // деньги за товар пришли, а прихода нет. Про это лучше знать сразу.
      var minus = allStock.filter(function (r) { return r.qty < 0; });
      if (minus.length) {
        var minusSum = E.safeRound(minus.reduce(function (a, r) { return a + r.buySum; }, 0));
        h += '<div class="banner"><span>⚠️</span><span>В 1С <b>' + nf(minus.length) + '</b> ' +
          plural(minus.length, 'позиция стоит', 'позиции стоят', 'позиций стоят') +
          ' с минусовым остатком на <b class="private">' + money(Math.abs(minusSum)) + '</b>. ' +
          'Обычно это значит: товар продали, а приход не провели — не хватает накладной. ' +
          'Нажмите «Закончилось», чтобы посмотреть список.</span>' +
          '<button class="btn" data-filter="stock|qty|zero">Показать</button></div>';
      }

      h += card('Остатки' + (q ? ' — «' + esc(q) + '»' : ''),
        FLT.note(rows.length, allStock.length,
          'на ' + money(rows.reduce(function (a, r) { return a + r.buySum; }, 0)) + ' в закупе') +
        table('stockT', [
        { title: 'Товар', fn: function (r) { return DET.link('product', r.key, r.name); } },
        { title: 'Группа', fn: function (r) { return r.group ? DET.link('group', r.group, r.group) : '—'; } },
        { title: 'Штрихкод', fn: function (r) { return esc(r.barcode || '—'); } },
        { title: 'Остаток', cls: 'num', fn: function (r) {
          return '<span class="' + (r.qty <= 0 ? 'c-red' : (r.qty < 3 ? 'c-orange' : '')) + '">' + nf(r.qty, 2) + ' ' + esc(r.unit) + '</span>'; } },
        { title: 'Закупка', cls: 'num', fn: function (r) { return priv(r.buyPrice); } },
        { title: 'Розница', cls: 'num', fn: function (r) { return priv(r.retailPrice); } },
        { title: 'Наценка', cls: 'num', fn: function (r) { return r.buyPrice > 0 ? pct(E.div(r.retailPrice - r.buyPrice, r.buyPrice) * 100) : '—'; } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.buySum); } },
        { title: '', cls: 'center', fn: function (r) { return DET.btn('product', r.key, 'Подробнее'); } }
      ], rows, { step: 50, empty: 'Ничего не найдено' }));
    }

    if (inv.length) {
      var lost = 0, extra = 0;
      inv.forEach(function (r) { var d = (num(r.fact) - num(r.accounted)) * num(r.price); if (d < 0) lost += d; else extra += d; });
      h += card('Пересчёты и списания', table('invT', [
        { title: 'Дата', fn: function (r) { return DET.link('day', r.date, dateRu(r.date)); } },
        { title: 'Товар', fn: function (r) { return DET.link('product', E.norm(r.name), r.name); } },
        { title: 'Учёт', cls: 'num', fn: function (r) { return nf(r.accounted, 2); } },
        { title: 'Факт', cls: 'num', fn: function (r) { return nf(r.fact, 2); } },
        { title: 'Разница', cls: 'num', fn: function (r) {
          var d = num(r.fact) - num(r.accounted);
          return '<span class="' + cls(d) + '">' + (d > 0 ? '+' : '') + nf(d, 2) + '</span>'; } },
        { title: 'Деньгами', cls: 'num', fn: function (r) {
          var d = (num(r.fact) - num(r.accounted)) * num(r.price);
          return '<span class="' + cls(d) + ' private">' + money(d) + '</span>'; } },
        { title: 'Причина', fn: function (r) { return esc(r.reason || '—'); } },
        { title: '', cls: 'center', fn: function (r) {
          return DET.btn('product', E.norm(r.name), 'Подробнее') +
            ' <button class="btn btn-sm" data-edit="inventory:' + r.id + ':inventory">✎</button>' +
            ' <button class="btn btn-sm btn-danger" data-del="inventory:' + r.id + '">✕</button>'; } }
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
    var allRop = E.ropList(D.sales, D.stock, days, S.settings, C.bestPrices);
    var ropDefs = [
      { key: 'sup', name: 'Поставщик', auto: function (r) { return r.supplier || 'не указан'; }, limit: 14 },
      { key: 'group', name: 'Группа', auto: function (r) { return r.group; }, limit: 14 },
      { key: 'urg', name: 'Срочность', options: [
        { v: 'zero', name: 'Уже кончилось', test: function (r) { return r.critical; } },
        { v: 'soon', name: 'Хватит на 1–3 дня', test: function (r) { return !r.critical && r.demand > 0 && r.stock / r.demand <= 3; } }
      ] },
      { key: 'sum', name: 'Сумма заказа', options: [
        { v: 'big', name: 'От 5 000', test: function (r) { return r.sum >= 5000; } },
        { v: 'mid', name: '1 000 – 5 000', test: function (r) { return r.sum >= 1000 && r.sum < 5000; } }
      ] }
    ];
    var rows = FLT.apply('orders', allRop, ropDefs, function (r) { return r.name + ' ' + (r.supplier || ''); });
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

    h += FLT.bar('orders', ropDefs, allRop, { search: 'товар или поставщик' });

    h += card('Кому звонить', listOf(sups.slice(0, 12).map(function (s) {
      return listRow({ icon: '📞', title: DET.link('firm', E.norm(s.name), s.name),
        sub: phoneLink(s.name) || 'телефон не найден',
        value: priv(s.sum) + '<small>' + s.items + ' ' + plural(s.items, 'позиция', 'позиции', 'позиций') +
          ' ' + DET.btn('firm', E.norm(s.name)) + '</small>' });
    }), ''));

    h += card('Список заказа', FLT.note(rows.length, allRop.length, 'на ' + money(sum)) + table('ropT', [
      { title: 'Товар', fn: function (r) { return DET.link('product', r.key, r.name); } },
      { title: 'Осталось', cls: 'num', fn: function (r) { return '<span class="' + (r.critical ? 'c-red' : '') + '">' + nf(r.stock, 1) + '</span>'; } },
      { title: 'Продаём в день', cls: 'num', fn: function (r) { return nf(r.demand, 1); } },
      { title: 'Заказать', cls: 'num', fn: function (r) { return '<b>' + nf(r.order) + '</b>'; } },
      { title: 'Цена', cls: 'num', fn: function (r) { return priv(r.price); } },
      { title: 'Поставщик', fn: function (r) { return r.supplier ? DET.link('firm', E.norm(r.supplier), r.supplier) : '—'; } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.sum); } },
      { title: '', cls: 'center', fn: function (r) { return DET.btn('product', r.key, 'Подробнее'); } }
    ], rows, { step: 40, empty: FLT.active('orders') ? 'Под фильтр ничего не подошло' : 'Всё в наличии' }));
    return h;
  }

  function pageHead(title, sub, right) {
    return printHead() + '<div class="page-head"><div><div class="page-title">' + esc(title) + '</div>' +
      (sub ? '<div class="page-sub">' + esc(sub) + '</div>' : '') + '</div>' + (right || '') + '</div>';
  }

  // Шапка для печати: реквизиты из настроек. На экране не видна.
  function printHead() {
    var s = S.settings;
    var line = [s.legalName, s.inn ? 'ИНН ' + s.inn : '', s.address, s.phone].filter(Boolean).join(' · ');
    if (!line && !s.storeName) return '';
    return '<div class="print-head">' + esc(s.storeName || '') +
      (line ? '<div class="print-sub">' + esc(line) + '</div>' : '') +
      '<div class="print-sub">Напечатано ' + new Date().toLocaleString('ru-RU').slice(0, 16) + '</div></div>';
  }

  /* --- Сроки годности --------------------------------------------------------------- */
  function viewExpiry() {
    var allRows = (S.state.expiry || []).map(function (r) {
      return { r: r, f: E.fefoStatus(r.bestBefore, S.settings) };
    }).sort(function (a, b) { return (a.r.bestBefore || '').localeCompare(b.r.bestBefore || ''); });
    var defs = [
      { key: 'lvl', name: 'Срочность', options: [
        { v: 'exp', name: 'Просрочено', test: function (x) { return x.f.level === 'expired'; } },
        { v: 'crit', name: 'Уценить срочно', test: function (x) { return x.f.level === 'crit'; } },
        { v: 'warn', name: 'Скоро', test: function (x) { return x.f.level === 'warn'; } },
        { v: 'ok', name: 'В порядке', test: function (x) { return x.f.level === 'ok'; } }
      ] },
      { key: 'group', name: 'Группа', auto: function (x) { return x.r.group; }, limit: 12 },
      { key: 'money', name: 'Денег в партии', options: [
        { v: 'big', name: 'От 3 000', test: function (x) { return num(x.r.qty) * num(x.r.price) >= 3000; } },
        { v: 'mid', name: 'До 3 000', test: function (x) { return num(x.r.qty) * num(x.r.price) < 3000; } }
      ] }
    ];
    var rows = FLT.apply('expiry', allRows, defs, function (x) { return x.r.name + ' ' + (x.r.group || ''); });
    var crit = rows.filter(function (x) { return x.f.level === 'crit' || x.f.level === 'expired'; });

    var h = pageHead('Сроки годности', 'Что уценить сегодня',
      '<div><button class="btn" data-act="print-labels">🖨 Ценники</button> ' +
      '<button class="btn btn-primary" data-form="expiryItem">＋ Товар</button></div>');

    h += FLT.bar('expiry', defs, allRows, { search: 'товар или группа' });

    h += '<div class="stat-grid">' +
      stat('Уценить срочно', nf(crit.length), 'До ' + S.settings.fefoCrit + ' дн. — скидка ' + pct(S.settings.discountCrit, 0), crit.length ? 'c-red' : 'c-green') +
      stat('Скоро закончится', nf(rows.filter(function (x) { return x.f.level === 'warn'; }).length),
        'До ' + S.settings.fefoWarn + ' дн. — скидка ' + pct(S.settings.discountWarn, 0), 'c-orange') +
      stat('Под контролем', nf(rows.length), 'Всего партий') +
      stat('Денег в этих партиях', priv(rows.reduce(function (a, x) { return a + num(x.r.qty) * num(x.r.price); }, 0)), '') +
      '</div>';

    h += FLT.note(rows.length, allRows.length) + card('Партии', listOf(rows.map(function (x) {
      var kind = x.f.level === 'ok' ? 'green' : (x.f.level === 'warn' ? 'orange' : 'red');
      return listRow({ icon: x.f.level === 'ok' ? '🟢' : (x.f.level === 'warn' ? '🟠' : '🔴'),
        title: DET.link('product', E.norm(x.r.name), x.r.name),
        sub: esc(x.f.action) + ' · годен до ' + dateRu(x.r.bestBefore),
        value: badge(x.f.days == null ? '—' : (x.f.days < 0 ? 'просрочено' : x.f.days + ' ' + plural(x.f.days, 'день', 'дня', 'дней')), kind) +
          '<small>' + (x.f.discount ? 'скидка ' + x.f.discount + '% → ' + money(num(x.r.price) * (100 - x.f.discount) / 100) : money(x.r.price)) +
          ' ' + DET.btn('product', E.norm(x.r.name)) +
          ' <button class="btn btn-sm" data-edit="expiry:' + x.r.id + ':expiryItem">✎</button>' +
          ' <button class="btn btn-sm btn-danger" data-del="expiry:' + x.r.id + '">✕</button></small>' });
    }), FLT.active('expiry') ? 'Под фильтр ничего не подошло' : 'Пока пусто. Добавьте товар с коротким сроком при приёмке.'));
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

    var lossDefs = [
      { key: 'reason', name: 'Причина', auto: function (r) { return r.reason; }, limit: 12 },
      { key: 'size', name: 'Сумма', options: [
        { v: 'big', name: 'От 1 000', test: function (r) { return num(r.cost) >= 1000; } },
        { v: 'mid', name: 'До 1 000', test: function (r) { return num(r.cost) < 1000; } }
      ] }
    ];
    var woAll = D.writeoffs;
    var wo = FLT.apply('losses', woAll, lossDefs, function (r) { return (r.name || '') + ' ' + (r.reason || ''); });
    h += FLT.bar('losses', lossDefs, woAll, { search: 'товар или причина' });

    h += card('Причины списаний', listOf(E.byReason(wo).map(function (r) {
      return listRow({ icon: '🗑', title: esc(r.reason), sub: nf(r.docs) + ' ' + plural(r.docs, 'запись', 'записи', 'записей') + ' · ' + pct(r.share) + ' от потерь',
        value: priv(r.cost) });
    }), 'Под фильтр ничего не подошло'));

    h += card('Больше всего теряем на этом',
      FLT.note(wo.length, woAll.length, 'на ' + money(wo.reduce(function (a, r) { return a + num(r.cost); }, 0))) +
      table('woTop', [
      { title: 'Товар', fn: function (r) { return DET.link('product', E.norm(r.name), r.name); } },
      { title: 'Количество', cls: 'num', fn: function (r) { return nf(r.qty, 2); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.cost); } },
      { title: 'Причины', fn: function (r) { return esc(r.reason); } },
      { title: '', cls: 'center', fn: function (r) { return DET.btn('product', E.norm(r.name), 'Подробнее'); } }
    ], E.topByCost(wo, 40), { step: 20 }));

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

    // налог считается по выбранной системе налогообложения
    var preTaxCosts = num(S.settings.rent) + num(S.settings.utilities) + num(S.settings.taxes) +
      num(S.settings.other) + writeMonth + E.safeRound(expMonth) + (accrued > 0 ? accrued : num(S.settings.fot));
    var tax = window.WMFin.taxAmount(S.settings, revenue, cogs + preTaxCosts);
    var costs = [
      { name: 'Зарплата', v: accrued > 0 ? accrued : num(S.settings.fot) },
      { name: 'Аренда', v: num(S.settings.rent) },
      { name: 'Коммунальные', v: num(S.settings.utilities) },
      { name: 'Прочие налоги и взносы', v: num(S.settings.taxes) },
      { name: 'Прочие постоянные', v: num(S.settings.other) },
      { name: 'Списания и потери', v: writeMonth },
      { name: 'Мои записанные расходы', v: E.safeRound(expMonth) },
      { name: tax.name + (tax.rate ? ' · ' + nf(tax.rate) + '% от ' + money(tax.base) : ''), v: tax.sum }
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
          return listRow({ icon: '🧾', title: DET.link('category', c.name, c.name),
            sub: pct(E.div(c.v, revenue) * 100) + ' от выручки',
            value: '<span class="c-red private">−' + money(c.v) + '</span>' +
              '<small>' + DET.btn('category', c.name) + '</small>' });
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
    var defs = [
      { key: 'cls', name: 'Класс', options: [
        { v: 'A', name: 'A — главные', test: function (r) { return r.abc === 'A'; } },
        { v: 'B', name: 'B — средние', test: function (r) { return r.abc === 'B'; } },
        { v: 'C', name: 'C — хвост', test: function (r) { return r.abc === 'C'; } }
      ] },
      { key: 'group', name: 'Группа', auto: function (r) { return C.groupIdx[r.key]; }, limit: 16 },
      { key: 'marg', name: 'Прибыльность', options: [
        { v: 'loss', name: 'В минус', test: function (r) { return r.profit < 0; } },
        { v: 'low', name: 'Маржа до 15%', test: function (r) { return r.revenue > 0 && r.profit / r.revenue < 0.15 && r.profit >= 0; } },
        { v: 'high', name: 'Маржа от 30%', test: function (r) { return r.revenue > 0 && r.profit / r.revenue >= 0.3; } }
      ] }
    ];
    var all = C.abc;
    var rows = FLT.apply('abc', all, defs, function (r) { return r.name; });
    var sum = { A: 0, B: 0, C: 0 }, cnt = { A: 0, B: 0, C: 0 };
    rows.forEach(function (r) { sum[r.abc] += r.revenue; cnt[r.abc]++; });
    var h = pageHead('ABC-анализ', 'Какие товары дают выручку');
    h += FLT.bar('abc', defs, all, { search: 'название товара' });
    h += '<div class="stat-grid">' +
      stat('A — главные', nf(cnt.A) + ' поз.', money(sum.A) + ' · 80% выручки', 'c-green') +
      stat('B — средние', nf(cnt.B) + ' поз.', money(sum.B) + ' · до 95%', 'c-orange') +
      stat('C — хвост', nf(cnt.C) + ' поз.', money(sum.C) + ' · последние 5%', 'c-muted') +
      stat('Всего в продаже', nf(rows.length) + ' поз.', 'За ' + (D.salesPeriod ? D.salesPeriod.days + ' дн.' : 'период отчёта')) + '</div>';
    h += card('Список',
      FLT.note(rows.length, all.length, 'выручка ' + money(rows.reduce(function (a, r) { return a + r.revenue; }, 0))) +
      table('abcT', [
      { title: '№', cls: 'num', fn: function (r, i) { return nf(i + 1); } },
      { title: 'Товар', fn: function (r) { return DET.link('product', r.key, r.name); } },
      { title: 'Группа', fn: function (r) { return C.groupIdx[r.key] ? DET.link('group', C.groupIdx[r.key], C.groupIdx[r.key]) : '—'; } },
      { title: 'Продано', cls: 'num', fn: function (r) { return nf(r.qty, 1); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return priv(r.revenue); } },
      { title: 'Доля', cls: 'num', fn: function (r) { return r.share + '%'; } },
      { title: 'Прибыль', cls: 'num', fn: function (r) { return priv(r.profit); } },
      { title: 'Класс', cls: 'center', fn: function (r) { return badge(r.abc, r.abc === 'A' ? 'green' : (r.abc === 'B' ? 'orange' : 'gray')); } },
      { title: '', cls: 'center', fn: function (r) { return DET.btn('product', r.key, 'Подробнее'); } }
    ], rows, { step: 50, empty: 'Под фильтр ничего не подошло' }));
    return h;
  }

  /* --- Цены поставщиков ---------------------------------------------------------- */
  // Красивая цена: закуп + наценка, округлённые по вашему правилу
  function suggestPrice(buy) {
    return E.priceFor(buy, S.settings.markupDefault,
      parseFloat(String(S.settings.priceRound || '1').replace(',', '.')));
  }

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
      var cmpDefs = [
        { key: 'choice', name: 'Выбор', options: [
          { v: 'multi', name: 'Есть из кого выбрать', test: function (r) { return r.suppliers > 1; } },
          { v: 'one', name: 'Один поставщик', test: function (r) { return r.suppliers === 1; } }
        ] },
        { key: 'save', name: 'Экономия', options: [
          { v: 'big', name: 'Больше 10 ₽', test: function (r) { return r.spread > 10; } },
          { v: 'any', name: 'Любая', test: function (r) { return r.spread > 0; } }
        ] },
        { key: 'best', name: 'Где дешевле', auto: function (r) { return r.bestSupplier; }, limit: 12 }
      ];
      var allCmp = rows.slice();
      rows = FLT.apply('pricecmp', rows, cmpDefs, function (r) { return r.name + ' ' + (r.bestSupplier || ''); });
      var multi = C.cmp.filter(function (r) { return r.suppliers > 1; });
      h += '<div class="stat-grid">' +
        stat('Цен в базе', nf(D.prices.length), 'Поставщиков: ' + nf(Object.keys(C.bySupplier).length)) +
        stat('Есть выбор', nf(multi.length), 'Товаров с 2+ поставщиками') +
        stat('Можно сэкономить', priv(multi.reduce(function (a, r) { return a + r.spread; }, 0)), 'Если брать по лучшей цене') +
        stat('Телефонов', nf(D.contacts.filter(function (c) { return c.phone; }).length), 'Звонок прямо из таблицы') + '</div>';
      h += FLT.bar('pricecmp', cmpDefs, allCmp, { search: 'товар или поставщик' });
      h += card('Сравнение цен' + (q ? ' — «' + esc(q) + '»' : ''),
        FLT.note(rows.length, allCmp.length) + table('cmpT', [
        { title: 'Товар', fn: function (r) { return DET.link('product', r.key, r.name); } },
        { title: 'Дешевле всего', cls: 'num', fn: function (r) { return '<span class="c-green private">' + money(r.min) + '</span>'; } },
        { title: 'У кого', fn: function (r) { return DET.link('firm', E.norm(r.bestSupplier), r.bestSupplier) + (r.bestPhone ? ' · <a class="phone" href="tel:' + esc(r.bestPhone) + '">' + esc(r.bestPhone) + '</a>' : ''); } },
        { title: 'Дороже всего', cls: 'num', fn: function (r) { return priv(r.max); } },
        { title: 'Разница', cls: 'num', fn: function (r) { return r.spread ? '<span class="c-green private">' + money(r.spread) + '</span>' : '—'; } },
        { title: 'Ставить в зал', cls: 'num', fn: function (r) { return priv(suggestPrice(r.min)); } },
        { title: 'Предложений', cls: 'center', fn: function (r) { return nf(r.suppliers); } },
        { title: '', cls: 'center', fn: function (r) { return DET.btn('product', r.key, 'Подробнее'); } }
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
        return listRow({ icon: r.diff == null ? '⚪️' : (r.diff <= 0 ? '🟢' : '🔴'),
          title: DET.link('product', E.norm(r.name), r.name),
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
    // Своё поле прямо на экране: на телефоне строки поиска сверху нет,
    // там её место заняла нижняя панель.
    h += '<div class="card"><div class="card-pad"><div class="search page-search">' +
      '<span>🔍</span><input type="search" id="pageSearch" value="' + esc(q) +
      '" placeholder="Товар, поставщик, штрихкод, телефон"></div></div></div>';
    if (!q) return h + '<div class="card"><div class="empty">Впишите, что ищете — ' +
      'товар, поставщика, штрихкод или телефон.</div></div>';
    var resAll = E.search(q, D, 'all', 300);
    var sDefs = [{ key: 'type', name: 'Где нашли', auto: function (r) { return r.type; }, limit: 10 }];
    var res = FLT.apply('search', resAll, sDefs, function (r) { return r.name; });
    h += FLT.bar('search', sDefs, resAll);
    h += card('Найдено: ' + nf(res.length) + (res.length !== resAll.length ? ' из ' + nf(resAll.length) : ''),
      listOf(res.slice(0, 120).map(function (r) {
      // товар открывается карточкой товара, поставщик — карточкой фирмы
      var kind = E.norm(r.type).indexOf('поставщ') >= 0 || E.norm(r.type).indexOf('контрагент') >= 0 ? 'firm' : 'product';
      return listRow({ icon: '🔎', title: DET.link(kind, E.norm(r.name), r.name),
        sub: esc(r.type) + ' · ' + r.cols.filter(Boolean).join(' · '),
        value: DET.btn(kind, E.norm(r.name)) });
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

    var note, button;
    if (st.ok) {
      note = 'Папка: ' + esc(F.dirName) + ' → ' + F.DATA_DIR + '/' + F.DATA_FILE + '. Копия базы сохраняется раз в день.';
      button = '<button class="btn" data-act="folder-forget">Отключить</button>';
    } else if (st.lost) {
      // самая частая история: папку распаковали заново в другое место,
      // а программа помнит прежнюю. Записи при этом целы — они в браузере.
      note = 'Папка «' + esc(F.dirName || 'программы') + '», которую программа помнит, переименована, ' +
        'перенесена или удалена. <b>Ваши записи целы</b> — они хранятся внутри браузера. ' +
        'Нажмите «Выбрать папку заново» и укажите ту папку, где сейчас лежит программа, — ' +
        'запись в файл продолжится.';
      button = '<button class="btn btn-primary" data-act="folder-connect">Выбрать папку заново</button>' +
        ' <button class="btn" data-act="folder-forget">Больше не искать</button>';
    } else {
      note = 'Пока записи хранятся только внутри браузера. Подключите папку — и всё будет лежать файлом рядом с программой.';
      button = '<button class="btn btn-primary" data-act="' +
        (F.state === 'needs-permission' ? 'folder-reconnect' : 'folder-connect') + '">Подключить папку</button>';
    }
    h += '<div class="banner ' + (st.ok ? 'green' : '') + '">' +
      '<span>' + (st.ok ? '✅' : '⚠️') + '</span><div><b>' + esc(st.text) + '</b>' +
      '<div class="card-note">' + note + '</div></div>' + button + '</div>';

    h += card('Загрузить выгрузки 1С', listOf([
      listRow({ icon: '📂', title: 'Прочитать папку с выгрузками', sub: 'Файлы .xls, .xlsx, .csv — имена любые',
        value: '<button class="btn btn-sm btn-primary" data-act="pick-folder">Выбрать папку</button>' }),
      listRow({ icon: '📄', title: 'Загрузить отдельные файлы', sub: 'Если нужно обновить один отчёт',
        value: '<button class="btn btn-sm" data-act="pick-files">Выбрать файлы</button>' }),
      F.state === 'ready' ? listRow({ icon: '🔄', title: 'Перечитать подключённую папку', sub: 'Берёт только изменившиеся файлы',
        value: '<button class="btn btn-sm" data-act="folder-sync">Обновить</button>' }) : ''
    ].filter(Boolean), ''));

    var fDefs = [
      { key: 'kind', name: 'Что это', auto: function (r) { return KINDS[r.kind] || r.kind; }, limit: 14 },
      { key: 'ok', name: 'Разобрано', options: [
        { v: 'yes', name: 'Программа поняла', test: function (r) { return r.kind !== 'unknown'; } },
        { v: 'no', name: 'Не поняла', test: function (r) { return r.kind === 'unknown'; } }
      ] }
    ];
    var files = FLT.apply('files', D.files, fDefs, function (r) { return r.name; });
    h += FLT.bar('files', fDefs, D.files, { search: 'имя файла' });
    h += card('Загруженные файлы', FLT.note(files.length, D.files.length) + table('filesT', [
      { title: 'Файл', fn: function (r) { return esc(r.name); } },
      { title: 'Что это', fn: function (r) { return esc(KINDS[r.kind] || r.kind); } },
      { title: 'Строк', cls: 'num', fn: function (r) { return nf(r.rows); } },
      { title: 'Период', fn: function (r) { return r.period ? esc(r.period.from + ' – ' + r.period.to) : '—'; } },
      { title: '', cls: 'center', fn: function (r) { return r.kind === 'unknown' ? badge('не понял', 'red') : badge('готово', 'green'); } }
    ], files, { step: 30, empty: FLT.active('files') ? 'Под фильтр ничего не подошло' : 'Пока ничего не загружено' }));

    h += card('Сохранить и перенести', listOf([
      listRow({ icon: '📊', title: 'Выгрузить всё в Excel', sub: 'Смены, накладные, оплаты, зарплата, заказы',
        value: '<button class="btn btn-sm" data-act="export-excel">Скачать</button>' }),
      listRow({ icon: '💾', title: 'Сохранить копию базы', sub: 'Файл .json — положите на флешку',
        value: '<button class="btn btn-sm" data-act="backup">Скачать</button>' }),
      listRow({ icon: '📥', title: 'Загрузить базу из копии', sub: 'Заменит текущие записи',
        value: '<button class="btn btn-sm" data-act="restore">Выбрать файл</button>' }),
      listRow({ icon: '🖨', title: 'Распечатать текущий экран', sub: 'В окне печати выберите «Сохранить как PDF»',
        value: '<button class="btn btn-sm" data-act="print">Печать</button>' }),
      listRow({ icon: '🧑‍💼', title: 'Файл для бухгалтера',
        sub: 'Один Excel за выбранный период: сводка, дни, статьи, поставщики, зарплата, налог',
        value: '<button class="btn btn-sm btn-primary" data-act="export-buh">Скачать</button>' })
    ], ''));
    return h;
  }

  /* --- Настройки --------------------------------------------------------------------- */
  // Тип из каталога → тип поля ввода
  function setInput(item, value) {
    var t = item.type, opts = { hint: item.hint };
    if (t === 'select') { opts.options = item.options || []; return fieldRow(item.label, item.key, 'select', value, opts); }
    if (t === 'yesno') { opts.options = ['да', 'нет']; return fieldRow(item.label, item.key, 'select', value || 'нет', opts); }
    if (t === 'money' || t === 'percent' || t === 'days' || t === 'number') return fieldRow(item.label, item.key, 'number', value, opts);
    if (t === 'time') return fieldRow(item.label, item.key, 'time', value, opts);
    return fieldRow(item.label, item.key, 'text', value, opts);
  }

  function viewSettings() {
    var s = S.settings, SET = window.WMSettings;
    var h = pageHead('Настройки', 'Настройте программу под свой магазин — считать она будет по этим правилам',
      '<button class="btn" data-act="settings-wizard">🧭 Быстрая настройка</button> ' +
      '<button class="btn" data-act="settings-reset">Сбросить всё</button>');

    h += '<div class="banner blue"><span>💡</span><span>Все настройки лежат и в книге «Бухгалтерия.xlsx» ' +
      'на листе «Настройки» — можно править и там.</span></div>';

    h += '<form id="setForm">';
    SET.GROUPS.forEach(function (g) {
      h += card(g.icon + '  ' + g.name,
        (g.note ? '<div class="form-hint">' + esc(g.note) + '</div>' : '') +
        '<div class="form-list">' + g.items.map(function (it) {
          var item = { key: it[0], label: it[1], type: it[2], hint: it[3] || '', options: it[4] || null };
          return setInput(item, s[item.key]);
        }).join('') + '</div>');
    });
    h += '<div class="form-actions"><button type="submit" class="btn btn-primary btn-lg">Сохранить настройки</button></div></form>';

    h += card('Что получилось', '<div class="card-body">' +
      'Постоянные расходы: <b>' + money(S.fixedMonthly()) + '</b> в месяц.<br>' +
      'Налог: <b>' + esc(String(s.taxMode)) + '</b>' +
      (E.norm(s.taxMode).indexOf('усн') >= 0 ? ' по ставке ' + nf(s.taxRate) + '%' : '') + '.<br>' +
      'Отсрочка по умолчанию: <b>' + nf(s.termDaysDefault) + ' дн.</b>, ' +
      'смены: день с ' + esc(s.dayStart) + ', ночь с ' + esc(s.nightStart) + '.' +
      '</div>');

    h += card('О программе', '<div class="card-body">Вай Маркет — учёт магазина. Работает без интернета: ' +
      'папку можно скопировать на флешку и открыть на любом компьютере.<br>' +
      'Записи хранятся в книге ' + F.BOOK_FILE + ' и в файле ' + F.DATA_DIR + '/' + F.DATA_FILE + '.</div>');
    return h;
  }

  // Быстрая настройка: несколько вопросов, чтобы программа сразу считала верно
  function settingsWizard() {
    var SET = window.WMSettings, s = S.settings;
    var rows = SET.WIZARD.map(function (key) {
      var it = SET.byKey(key);
      return it ? setInput(it, s[key]) : '';
    }).join('');
    sheet('Быстрая настройка',
      '<form id="setForm"><div class="form-hint">Ответьте на несколько вопросов — остальное можно оставить как есть ' +
      'и поправить позже в «Настройках».</div><div class="form-list">' + rows + '</div>' +
      '<div class="form-actions"><button type="button" class="btn" data-act="close-sheet">Позже</button>' +
      '<button type="submit" class="btn btn-primary btn-lg">Готово</button></div></form>');
  }

  /* --- Неликвиды: что лежит без движения ------------------------------------ */
  function viewDead() {
    var h = pageHead('Неликвиды', 'Товар, который лежит и не продаётся — в нём стоят ваши деньги',
      '<button class="btn" data-act="print">🖨 Печать</button>');
    if (!D.dead.length) {
      return h + '<div class="card"><div class="empty"><b>Нужен отчёт 1С «Неликвидные товары»</b><br>' +
        'В нём есть приход, продажи, остаток и дата последнего поступления по каждой позиции.<br>' +
        'Загрузите его на экране «Импорт из 1С» — программа посчитает, сколько денег стоит на полке.</div></div>';
    }
    var d0 = C.dead || E.deadStockList(D.dead, C.stockIdx, S.settings);
    var defs = [
      { key: 'why', name: 'Почему в списке', options: [
        { v: 'nosale', name: 'Совсем не продавался', test: function (r) { return r.sold <= 0; } },
        { v: 'slow', name: 'Продаётся плохо', test: function (r) { return r.sold > 0; } },
        { v: 'old', name: 'Давно не завозили', test: function (r) { return r.age >= num(S.settings.deadDays); } }
      ] },
      { key: 'group', name: 'Группа', auto: function (r) { return r.group; }, limit: 14 },
      { key: 'money', name: 'Сколько денег лежит', options: [
        { v: 'big', name: 'От 5 000', test: function (r) { return r.money >= 5000; } },
        { v: 'mid', name: '1 000 – 5 000', test: function (r) { return r.money >= 1000 && r.money < 5000; } },
        { v: 'small', name: 'До 1 000', test: function (r) { return r.money < 1000; } }
      ] }
    ];
    var deadRows = FLT.apply('dead', d0.list, defs, function (r) { return r.name + ' ' + (r.group || ''); });
    var d = { list: deadRows, total: E.safeRound(deadRows.reduce(function (a, r) { return a + r.money; }, 0)),
      count: deadRows.length, noSale: deadRows.filter(function (r) { return r.sold <= 0; }).length };
    var hasPrice = d.list.filter(function (r) { return r.money > 0; }).length;
    h += FLT.bar('dead', defs, d0.list, { search: 'товар или группа' });

    h += hero('Заморожено в неликвидах', priv(d.total),
      nf(d.count) + ' ' + plural(d.count, 'позиция', 'позиции', 'позиций') +
      ' · без продаж совсем ' + nf(d.noSale) +
      (hasPrice ? '' : ' · загрузите «Остатки номенклатуры», чтобы увидеть сумму'),
      d.total > 0 ? 'c-orange' : 'c-green');

    var top = d.list.slice(0, 12);
    h += '<div class="stat-grid">' +
      stat('Позиций в отчёте', nf(D.dead.length), D.deadPeriod ? 'за ' + D.deadPeriod.days + ' дн.' : 'из 1С') +
      stat('Совсем без продаж', nf(d.noSale), 'лежат мёртвым грузом', d.noSale ? 'c-red' : 'c-green') +
      stat('Топ-12 позиций', priv(top.reduce(function (a, r) { return a + r.money; }, 0)), 'самые дорогие остатки') +
      stat('Порог', pct(num(S.settings.deadSoldPct)) + ' / ' + nf(S.settings.deadDays) + ' дн.',
        'продажи от остатка и давность завоза') + '</div>';

    h += card('Что делать с этим товаром',
      FLT.note(d.list.length, d0.list.length, 'на ' + money(d.total)) + table('deadT', [
      { title: 'Товар', fn: function (r) { return DET.link('product', r.key, r.name); } },
      { title: 'Группа', fn: function (r) { return r.group ? DET.link('group', r.group, r.group) : '—'; } },
      { title: 'Остаток', cls: 'num', fn: function (r) { return nf(r.left, 2); } },
      { title: 'Продано', cls: 'num', fn: function (r) { return nf(r.sold, 2); } },
      { title: 'Цена закупа', cls: 'num', fn: function (r) { return r.price ? priv(r.price) : '—'; } },
      { title: 'Денег лежит', cls: 'num', fn: function (r) { return '<span class="c-orange private">' + money(r.money) + '</span>'; } },
      { title: 'Последний завоз', fn: function (r) { return r.lastIn ? esc(dateRu(r.lastIn)) + (r.age ? ' · ' + r.age + ' дн.' : '') : '—'; } },
      { title: 'Почему в списке', fn: function (r) { return badge(r.reason, r.sold <= 0 ? 'red' : 'orange'); } },
      { title: '', cls: 'center', fn: function (r) { return DET.btn('product', r.key, 'Подробнее'); } }
    ], d.list, { step: 40, empty: FLT.active('dead') ? 'Под фильтр ничего не подошло' : 'Неликвидов нет — весь товар в обороте' }));

    h += '<div class="banner"><span>💡</span><span>Что с этим делать: уценить и поставить на видное место, ' +
      'вернуть поставщику, добавить в акцию или просто не заказывать снова. ' +
      'Порог «неликвида» меняется в настройках, раздел «Товар и заказы».</span></div>';
    return h;
  }

  /* --- Доходы и расходы по данным 1С ---------------------------------------- */
  function viewIncExp() {
    var h = pageHead('Доходы и расходы (1С)', 'Обороты из отчёта «Общие доходы и расходы» — откуда деньги пришли и куда ушли',
      '<button class="btn" data-act="print">🖨 Печать</button>');
    if (!D.incexp) {
      return h + '<div class="card"><div class="empty"><b>Нужен отчёт 1С «Общие доходы и расходы»</b><br>' +
        'Программа разложит его по видам операций, статьям и контрагентам.</div></div>';
    }
    var ie = D.incexp, sum = C.incexp || E.incomeExpenseSummary(ie.rows);
    var net = E.safeRound(ie.totals.income - ie.totals.expense);

    h += '<div class="grid-2">' +
      hero('Приход', priv(ie.totals.income),
        (ie.period ? 'за ' + ie.period.days + ' дн. · ' + ie.period.from + ' — ' + ie.period.to : 'по отчёту 1С'), 'c-green') +
      hero('Расход', priv(ie.totals.expense), nf(ie.rows.length) + ' документов', 'c-red') + '</div>';

    h += '<div class="stat-grid">' +
      stat('Разница', priv(net), 'приход минус расход', net >= 0 ? 'c-green' : 'c-red') +
      stat('Видов операций', nf(sum.byOperation.length), 'поступление, продажа, списание…') +
      stat('Контрагентов и статей', nf(sum.byGroup.length), 'в разрезе отчёта') +
      stat('Документов', nf(ie.rows.length), 'накладные, ордера, чеки') + '</div>';

    h += card('По видам операций', table('ieOp', [
      { title: 'Вид операции', fn: function (r) { return r.name ? DET.link('operation', r.name, r.name) : '—'; } },
      { title: 'Приход', cls: 'num', fn: function (r) { return r.income ? '<span class="c-green private">' + money(r.income) + '</span>' : '—'; } },
      { title: 'Расход', cls: 'num', fn: function (r) { return r.expense ? '<span class="c-red private">' + money(r.expense) + '</span>' : '—'; } },
      { title: 'Документов', cls: 'num', fn: function (r) { return nf(r.count); } },
      { title: '', cls: 'center', fn: function (r) { return r.name ? DET.btn('operation', r.name, 'Подробнее') : ''; } }
    ], sum.byOperation, { step: 20 }));

    h += card('По контрагентам и статьям', table('ieGrp', [
      { title: 'Кто или за что', fn: function (r) { return r.name ? DET.link('party', r.name, r.name) : 'не указано'; } },
      { title: 'Приход', cls: 'num', fn: function (r) { return r.income ? priv(r.income) : '—'; } },
      { title: 'Расход', cls: 'num', fn: function (r) { return r.expense ? priv(r.expense) : '—'; } },
      { title: 'Итого', cls: 'num', fn: function (r) { return '<span class="' + cls(r.net) + ' private">' + money(r.net) + '</span>'; } },
      { title: 'Документов', cls: 'num', fn: function (r) { return nf(r.count); } },
      { title: '', cls: 'center', fn: function (r) { return r.name ? DET.btn('party', r.name, 'Подробнее') : ''; } }
    ], sum.byGroup, { step: 30 }));

    var q = ($('search') && $('search').value || '').trim();
    var docs = ie.rows.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    if (q) { var nq = E.norm(q); docs = docs.filter(function (r) {
      return E.norm(r.doc).indexOf(nq) >= 0 || E.norm(r.group).indexOf(nq) >= 0 || E.norm(r.operation).indexOf(nq) >= 0; }); }
    var ieDefs = [
      { key: 'side', name: 'Сторона', options: [
        { v: 'in', name: 'Только приход', test: function (r) { return r.income > 0; } },
        { v: 'out', name: 'Только расход', test: function (r) { return r.expense > 0; } }
      ] },
      { key: 'op', name: 'Вид операции', auto: function (r) { return r.operation; }, limit: 12 },
      { key: 'party', name: 'Кто или за что', auto: function (r) { return r.group; }, limit: 14 },
      whenDefs('date', 'Когда')
    ];
    var allDocs = docs.slice();
    docs = FLT.apply('incexp', docs, ieDefs,
      function (r) { return (r.doc || '') + ' ' + (r.group || '') + ' ' + (r.operation || ''); });
    h += FLT.bar('incexp', ieDefs, allDocs, { search: 'документ, контрагент, операция' });
    h += card('Документы' + (q ? ' — «' + esc(q) + '»' : ''),
      FLT.note(docs.length, allDocs.length,
        'приход ' + money(docs.reduce(function (a, r) { return a + r.income; }, 0)) +
        ', расход ' + money(docs.reduce(function (a, r) { return a + r.expense; }, 0))) +
      table('ieDocs', [
      { title: 'Дата', fn: function (r) { return r.date ? DET.link('day', r.date, dateRu(r.date)) : '—'; } },
      { title: 'Документ', fn: function (r) { return esc(SUP.shortDoc(r.doc)); } },
      { title: 'Вид операции', fn: function (r) { return r.operation ? DET.link('operation', r.operation, r.operation) : '—'; } },
      { title: 'Кто или за что', fn: function (r) { return r.group ? DET.link('party', r.group, r.group) : '—'; } },
      { title: 'Приход', cls: 'num', fn: function (r) { return r.income ? priv(r.income) : '—'; } },
      { title: 'Расход', cls: 'num', fn: function (r) { return r.expense ? priv(r.expense) : '—'; } }
    ], docs, { step: 40, empty: 'Ничего не найдено' }));
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
    { id: 'dead', icon: '🧊', name: 'Неликвиды', group: 'Товары', render: viewDead },
    { id: 'pnl', icon: '📈', name: 'Прибыль', group: 'Отчёты', render: viewPnl },
    { id: 'bep', icon: '⚖️', name: 'Безубыточность', group: 'Отчёты', render: viewBep },
    { id: 'abc', icon: '🏆', name: 'ABC-анализ', group: 'Отчёты', render: viewAbc },
    { id: 'pricecmp', icon: '🏷', name: 'Цены поставщиков', group: 'Отчёты', render: viewPriceCmp },
    { id: 'incexp', icon: '📒', name: 'Доходы и расходы (1С)', group: 'Отчёты', render: viewIncExp },
    { id: 'search', icon: '🔍', name: 'Поиск', group: 'Ещё', render: viewSearch },
    { id: 'data', icon: '🗂', name: 'Данные и файлы', group: 'Ещё', render: viewData },
    { id: 'settings', icon: '⚙️', name: 'Настройки', group: 'Ещё', render: viewSettings }
  ];

  // Экраны финансового учёта встают рядом со своими соседями
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
  /* Порядок разделов в меню задаём явно, а внутри раздела оставляем тот, в
     каком экраны встали выше. Без этой сортировки экран товаров, поставленный
     рядом с отчётом, разрывал список — и «Товары» в меню появлялись дважды.
     Сначала то, чем пользуются каждый день, служебное — в конце. */
  var GROUP_ORDER = ['Главное', 'Деньги', 'Товары', 'Отчёты',
    'Данные из 1С', 'Ручной ввод', 'Ещё'];
  VIEWS = VIEWS.map(function (v, i) { return { v: v, i: i }; })
    .sort(function (a, b) {
      var ga = GROUP_ORDER.indexOf(a.v.group), gb = GROUP_ORDER.indexOf(b.v.group);
      if (ga < 0) ga = GROUP_ORDER.length;          // незнакомый раздел — в конец
      if (gb < 0) gb = GROUP_ORDER.length;
      return ga - gb || a.i - b.i;
    })
    .map(function (x) { return x.v; });

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
    renderAlerts();
  }

  // Строка под шапкой: что горит прямо сейчас. Видна с любого экрана,
  // поэтому просроченную оплату нельзя не заметить, чем бы вы ни занимались.
  function renderAlerts() {
    var bar = $('alertBar'); if (!bar || !AL) return;
    var a;
    try {
      a = AL.build({ state: S.state, settings: S.settings, sup: C.sup, FIN: window.WMFin });
    } catch (e) { bar.hidden = true; return; }
    if (!a.items.length) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    bar.className = 'alert-bar ' + a.level;
    bar.innerHTML = a.items.map(function (i) {
      return '<span class="alert-item"' +
        (i.form ? ' data-form="' + esc(i.form) + '"' : (i.go ? ' data-go="' + esc(i.go) + '"' : '')) + '>' +
        i.icon + ' ' + esc(i.text) +
        (i.money ? ' <b class="private">' + money(i.money) + '</b>' : '') + '</span>';
    }).join('') +
      '<span class="alert-more">в кассе сейчас <b class="private">' + money(a.cash.cash) + '</b></span>';
  }

  // Нижняя панель на телефоне: подсвечиваем вкладку того экрана, где стоим
  function renderTabbar() {
    var bar = $('tabbar'); if (!bar) return;
    Array.prototype.forEach.call(bar.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('active', t.dataset.go === VIEW);
    });
  }

  function renderPeriods() {
    var html = PERIODS.map(function (p) {
      return '<button class="' + (p.id === PERIOD ? 'active' : '') + '" data-period="' + p.id + '">' + esc(p.name) + '</button>';
    }).join('');
    $('periods').innerHTML = html;
  }

  function render() {
    applyLook();          // тема и крупный режим могли поменяться в настройках
    var v = VIEWS.filter(function (x) { return x.id === VIEW; })[0] || VIEWS[0];
    C.ropCount = null; C.cmp = C.cmp || null;
    var html;
    try { html = v.render(); }
    catch (e) { html = pageHead('Ошибка', e.message) + '<div class="card"><div class="empty">Что-то пошло не так на этом экране.<br>' + esc(e.message) + '</div></div>'; }
    $('page').innerHTML = readOnlyBar() + html;
    document.body.classList.toggle('readonly', readOnly());
    renderNav(); renderPeriods(); renderTabbar();
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

  /* --- 133. Режим «только чтение» ---------------------------------------------
     Приходит проверяющий — программу надо показать, но не дать в ней ничего
     нажать. В этом режиме видно всё, а кнопки записи, правки и удаления не
     работают. Режим держится в памяти вкладки: закрыл окно — он снялся, так
     что запереть себя навсегда нельзя. Если задан PIN — выход по PIN.
     -------------------------------------------------------------------- */
  var RO_KEY = 'wm_readonly';
  function readOnly() {
    try { return sessionStorage.getItem(RO_KEY) === '1'; } catch (e) { return false; }
  }
  function setReadOnly(on) {
    try { sessionStorage.setItem(RO_KEY, on ? '1' : '0'); } catch (e) {}
    document.body.classList.toggle('readonly', !!on);
    render();
  }
  // Что можно нажимать в режиме показа: только смотреть, печатать и выгружать
  var RO_ALLOWED = {
    'print': 1, 'export-screen': 1, 'export-excel': 1, 'share-screen': 1,
    'close-sheet': 1, 'more-back': 1, 'readonly-off': 1, 'share-copy': 1,
    'share-whatsapp': 1, 'share-telegram': 1
  };
  function roBlock(el) {
    if (!readOnly()) return false;
    var d = el.dataset;
    if (d.go !== undefined || d.period !== undefined || d.tab !== undefined ||
        d.more !== undefined || d.filter !== undefined || d.filterClear !== undefined ||
        d.filterset !== undefined) return false;
    if (d.act && RO_ALLOWED[d.act]) return false;
    toast('Включён режим показа: смотреть можно, менять — нет. ' +
      'Выключить — кнопка «Выйти из режима показа» наверху.', 7000);
    return true;
  }
  function readOnlyBar() {
    if (!readOnly()) return '';
    return '<div class="ro-bar"><span>🔒 Режим показа: записи видны, менять ничего нельзя</span>' +
      '<button class="btn btn-sm" data-act="readonly-off">Выйти из режима показа</button></div>';
  }
  function readOnlyOff() {
    if (pinOn()) {
      var v = prompt('Введите PIN, чтобы выйти из режима показа:');
      if (v === null) return;
      if (pinHash(String(v)) !== pinSaved()) { toast('PIN не подошёл.'); return; }
    }
    setReadOnly(false);
    toast('Режим показа выключен — снова можно записывать.');
  }

  /* --- 134. Отправить отчёт в WhatsApp или Telegram ----------------------------
     Собираем короткий текст из того, что на экране, и открываем мессенджер с
     готовым сообщением. Для этого нужен интернет — программа сама работает
     без него, поэтому если интернета нет, текст можно просто скопировать.
     -------------------------------------------------------------------- */
  function screenText() {
    var page = $('page');
    var title = (page.querySelector('.page-title') || { textContent: 'Отчёт' }).textContent.trim();
    var sub = (page.querySelector('.page-sub') || { textContent: '' }).textContent.trim();
    var lines = [(S.settings.storeName || 'Магазин') + ' — ' + title];
    if (sub) lines.push(sub);
    lines.push('');
    Array.prototype.forEach.call(page.querySelectorAll('.stat'), function (st) {
      var lab = st.querySelector('.stat-label'), val = st.querySelector('.stat-value');
      if (lab && val) lines.push(lab.textContent.trim() + ': ' + val.textContent.replace(/\s+/g, ' ').trim());
    });
    // если карточек-цифр нет, берём первые строки первой таблицы
    if (lines.length <= 3) {
      var tbl = page.querySelector('table.data');
      if (tbl) {
        Array.prototype.forEach.call(tbl.querySelectorAll('tbody tr'), function (tr, i) {
          if (i >= 10) return;
          var cells = Array.prototype.map.call(tr.querySelectorAll('td'), function (td) {
            return td.textContent.replace(/\s+/g, ' ').trim();
          }).filter(Boolean);
          if (cells.length) lines.push('• ' + cells.slice(0, 3).join(' — '));
        });
      }
    }
    lines.push('');
    lines.push(new Date().toLocaleString('ru-RU').slice(0, 16));
    return lines.join('\n');
  }
  function shareSheet() {
    var text = screenText();
    if (document.body.classList.contains('priv')) {
      toast('Сейчас включён режим «спрятать суммы» — в сообщение попадут те же цифры, ' +
        'что на экране. Проверьте текст перед отправкой.', 8000);
    }
    sheet('Отправить отчёт',
      '<div class="card"><div class="card-pad">' +
      '<textarea id="shareText" rows="12" style="width:100%;border:.5px solid var(--separator);' +
      'border-radius:10px;padding:10px;background:var(--bg-inset);resize:vertical">' +
      esc(text) + '</textarea>' +
      '<div class="card-note" style="margin-top:8px">Текст можно поправить перед отправкой. ' +
      'WhatsApp и Telegram открываются в браузере — для этого нужен интернет. ' +
      'Без интернета нажмите «Скопировать» и вставьте в мессенджер на телефоне.</div>' +
      '</div></div>' +
      '<div class="form-actions">' +
      '<button class="btn" data-act="share-copy">📋 Скопировать</button>' +
      '<button class="btn" data-act="share-telegram">✈️ Telegram</button>' +
      '<button class="btn btn-primary" data-act="share-whatsapp">💬 WhatsApp</button>' +
      '</div>');
  }
  function shareVia(where) {
    var box = $('shareText');
    var text = box ? box.value : screenText();
    if (where === 'copy') {
      var done = function () { toast('Текст скопирован — вставьте его в мессенджер.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
          if (box) { box.select(); toast('Нажмите Ctrl+C — текст уже выделен.'); }
        });
      } else if (box) { box.select(); toast('Нажмите Ctrl+C — текст уже выделен.'); }
      return;
    }
    var url = where === 'telegram'
      ? 'https://t.me/share/url?url=&text=' + encodeURIComponent(text)
      : 'https://wa.me/?text=' + encodeURIComponent(text);
    var win = window.open(url, '_blank', 'noopener');
    if (!win) toast('Браузер не дал открыть окно. Нажмите «Скопировать» и вставьте текст сами.');
    else toast('Открываю ' + (where === 'telegram' ? 'Telegram' : 'WhatsApp') + '. Нужен интернет.');
  }

  /* --- 114. Скачать в Excel то, что на экране --------------------------------
     Работает на любом экране и не требует отдельного кода под каждый: берём
     то, что уже нарисовано — карточки-цифры и все таблицы. На время выгрузки
     таблицы разворачиваются целиком, иначе в файл попали бы только первые
     сорок строк, которые видно на экране.
     -------------------------------------------------------------------- */
  function tableToRows(tbl) {
    var head = [], rows = [];
    var ths = tbl.querySelectorAll('thead th');
    Array.prototype.forEach.call(ths, function (th, i) {
      head.push(th.textContent.trim() || ('Столбец ' + (i + 1)));
    });
    Array.prototype.forEach.call(tbl.querySelectorAll('tbody tr'), function (tr) {
      var tds = tr.querySelectorAll('td');
      if (!tds.length || tds.length === 1) return;         // строка «пока пусто»
      var o = {}, empty = true;
      Array.prototype.forEach.call(tds, function (td, i) {
        var v = td.textContent.replace(/\s+/g, ' ').trim();
        if (v) empty = false;
        o[head[i] || ('Столбец ' + (i + 1))] = numOrText(v);
      });
      if (!empty) rows.push(o);
    });
    return rows;
  }
  // «168 000 ₽» в Excel должно попасть числом, иначе по нему не посчитать сумму
  function numOrText(v) {
    if (!v) return '';
    var s = v.replace(/[\s\u00A0]/g, '').replace('₽', '').replace(',', '.');
    if (/^-?\d+(\.\d+)?%$/.test(s)) return v;
    if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 15) return parseFloat(s);
    return v;
  }
  function uniqueSheet(wb, name) {
    var base = (name || 'Лист').replace(/[\\\/\?\*\[\]:]/g, ' ').trim().slice(0, 28) || 'Лист';
    var n = base, i = 2;
    while (wb.SheetNames.indexOf(n) >= 0) n = (base.slice(0, 26) + ' ' + i++).slice(0, 31);
    return n;
  }
  function exportScreen() {
    if (typeof XLSX === 'undefined') { toast('Excel-библиотека не загрузилась — перезапустите программу.'); return; }
    EXPORT_ALL = true;
    try { render(); } finally { EXPORT_ALL = false; }
    var page = $('page');
    var title = (page.querySelector('.page-title') || { textContent: 'Экран' }).textContent.trim();
    var wb = XLSX.utils.book_new(), sheets = 0;

    // карточки с цифрами — отдельным листом «Главное»
    var stats = [];
    Array.prototype.forEach.call(page.querySelectorAll('.stat'), function (st) {
      var lab = st.querySelector('.stat-label'), val = st.querySelector('.stat-value'),
        sub = st.querySelector('.stat-sub');
      if (!lab || !val) return;
      stats.push({ Показатель: lab.textContent.trim(),
        Значение: numOrText(val.textContent.replace(/\s+/g, ' ').trim()),
        Пояснение: sub ? sub.textContent.replace(/\s+/g, ' ').trim() : '' });
    });
    if (stats.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stats), uniqueSheet(wb, 'Главное'));
      sheets++;
    }
    // все таблицы экрана — по листу на таблицу, имя берём из заголовка карточки
    Array.prototype.forEach.call(page.querySelectorAll('table.data'), function (tbl, i) {
      var rows = tableToRows(tbl);
      if (!rows.length) return;
      var card = tbl.closest('.card'), ct = card ? card.querySelector('.card-title') : null;
      var name = ct ? ct.textContent.trim() : (title + ' ' + (i + 1));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), uniqueSheet(wb, name));
      sheets++;
    });
    // полосы «куда ушли деньги» — тоже данные, просто нарисованы не таблицей
    var flow = [];
    Array.prototype.forEach.call(page.querySelectorAll('.flow-row'), function (fr) {
      var n = fr.querySelector('.flow-name'), v = fr.querySelector('.flow-sum');
      if (!n) return;
      flow.push({ Строка: n.textContent.replace(/\s+/g, ' ').trim(),
        Сумма: fr.dataset.sum !== undefined ? num(fr.dataset.sum)
          : (v ? v.textContent.replace(/\s+/g, ' ').trim() : ''),
        Осталось: fr.dataset.left !== undefined ? num(fr.dataset.left) : '' });
    });
    if (flow.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flow), uniqueSheet(wb, 'Куда ушли деньги'));
      sheets++;
    }
    // строки-списки собираем в один лист, с указанием, из какой они карточки
    var list = [];
    Array.prototype.forEach.call(page.querySelectorAll('.list .row'), function (r) {
      var t = r.querySelector('.row-title'), sb = r.querySelector('.row-sub'), v = r.querySelector('.row-value');
      if (!t) return;
      var card = r.closest('.card'), ct = card ? card.querySelector('.card-title') : null;
      list.push({ Раздел: ct ? ct.textContent.trim() : '',
        Что: t.textContent.replace(/\s+/g, ' ').trim(),
        Пояснение: sb ? sb.textContent.replace(/\s+/g, ' ').trim() : '',
        Значение: v ? numOrText(v.textContent.replace(/\s+/g, ' ').trim()) : '' });
    });
    if (list.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list), uniqueSheet(wb, 'Списки'));
      sheets++;
    }
    render();                                    // вернули обычный вид со «Показать ещё»
    if (!sheets) { toast('На этом экране нечего выгружать — здесь нет ни таблиц, ни цифр.'); return; }
    var stamp = today();
    XLSX.writeFile(wb, (title + ' ' + stamp).replace(/[\\\/\?\*\[\]:]/g, ' ') + '.xlsx');
    toast('Экран «' + title + '» сохранён в Excel: ' + sheets + ' ' +
      plural(sheets, 'лист', 'листа', 'листов') + '.');
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

  /* --- 117. Свои показатели на главном экране ---------------------------------
     Владелец сам задаёт формулу словами — «выручка - закуп - зп» — и цифра
     встаёт рядом с остальными. Считается тем же разборщиком, что и суммы в
     полях: никакого выполнения чужого кода.
     -------------------------------------------------------------------- */
  function kpiContext() {
    var Fin = window.WMFin;
    var ledger = (S.state.dds || []).filter(function (r) { return inPeriod(r.date); });
    if (!ledger.length) ledger = S.state.dds || [];
    var tot = Fin.totals(ledger);
    return {
      dds: ledger, bank: S.state.bank || [], settings: S.settings,
      opening: { cash: num(S.settings.openCashStart), card: num(S.settings.openCardStart),
        sbp: num(S.settings.openSbpStart), transfer: num(S.settings.openTransferStart) },
      writeoffSum: C.writeoffSum || 0,
      tax: Fin.taxAmount(S.settings, tot.income, tot.expense).sum
    };
  }
  function kpiUnit(v, unit) {
    if (unit === '%') return pct(v);
    if (unit === 'штук') return nf(v);
    return priv(v);
  }
  function kpiCards() {
    var list = (S.state.kpis || []).filter(function (k) { return k.name && k.formula; });
    if (!list.length) return '';
    var R = window.WMReports;
    if (!R) return '';
    var vals = R.kpiValues(kpiContext());
    var cards = list.map(function (k) {
      var res = R.kpiEval(k.formula, vals);
      if (res.error) {
        return stat(k.name, '—', 'формула не считается: ' + esc(res.error).slice(0, 60), 'c-orange');
      }
      return stat(k.name, kpiUnit(res.value, k.unit), esc(k.formula) +
        ' · ' + periodName().toLowerCase(),
        k.good === 'больше' ? (res.value >= num(k.target) ? 'c-green' : 'c-orange')
          : k.good === 'меньше' ? (res.value <= num(k.target) ? 'c-green' : 'c-orange') : '');
    }).join('');
    return '<div class="stat-grid">' + cards + '</div>';
  }

  /* --- 116. Сохранённые наборы фильтров ---------------------------------------
     «Мой понедельник»: выбрал фильтры один раз, назвал — дальше одна кнопка.
     Вместе с фильтрами запоминается и период сверху, иначе набор бы врал.
     -------------------------------------------------------------------- */
  function filterSets(view) {
    return (S.state.filtersets || []).filter(function (f) { return f.view === view; });
  }
  FLT.useSets(filterSets);

  function saveFilterSet(view, rawName) {
    var name = String(rawName == null ? '' : rawName).trim();
    if (!name) return 'Дайте набору название — например «мой понедельник».';
    if (!view) return 'Не понял, для какого экрана сохранять набор.';
    var snap = FLT.snapshot(view);
    var same = filterSets(view).filter(function (f) { return E.norm(f.name) === E.norm(name); })[0];
    if (same) {
      same.state = snap.state; same.text = snap.text; same.period = PERIOD;
      S.save();
      return { ok: 'Набор «' + name + '» перезаписан.' };
    }
    S.add('filtersets', { view: view, name: name, state: snap.state, text: snap.text, period: PERIOD });
    S.save();
    return { ok: 'Набор «' + name + '» сохранён. Теперь он кнопкой над фильтрами.' };
  }
  function applyFilterSet(view, id) {
    var st = filterSets(view).filter(function (f) { return f.id === id; })[0];
    if (!st) return;
    if (FLT.sameAs(view, st)) { FLT.clear(view); toast('Набор снят — показываю всё.'); }
    else {
      FLT.restore(view, st);
      if (st.period) PERIOD = st.period;
      toast('Набор «' + st.name + '» применён.');
    }
    PAGE = {}; render();
  }


  /* --- Меню экранов и «Что записать?» --------------------------------------
     Одни и те же списки открываются и с кнопки сверху, и с нижней панели
     на телефоне, поэтому вынесены в отдельные функции.
     -------------------------------------------------------------------- */
  function openMenuSheet() {
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
  }
  function openAddSheet() {
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
  }

  /* --- Обработчики ------------------------------------------------------------------ */
  function bind() {
    document.addEventListener('click', function (e) {
      var fsDel = e.target.closest('[data-filterset-del]');
      if (fsDel) {
        e.stopPropagation();
        var fsName = (S.state.filtersets || []).filter(function (f) { return f.id === fsDel.dataset.filtersetDel; })[0];
        if (fsName && confirm('Убрать набор «' + fsName.name + '»? Сами фильтры останутся.')) {
          S.remove('filtersets', fsDel.dataset.filtersetDel);
          render(); toast('Набор убран.');
        }
        return;
      }
      var fsApply = e.target.closest('[data-filterset]');
      if (fsApply) {
        var fp2 = fsApply.dataset.filterset.split('|');
        applyFilterSet(fp2[0], fp2.slice(1).join('|'));
        return;
      }
      var fsSave = e.target.closest('[data-filterset-save]');
      if (fsSave) {
        FILTERSET_VIEW = fsSave.dataset.filtersetSave;
        openForm('filterSetName');
        return;
      }
      var pAdd = e.target.closest('[data-pairadd]'), pDel = e.target.closest('[data-pairdel]');
      if (pAdd) {
        var box = document.querySelector('[data-pairs="' + pAdd.dataset.pairadd + '"]');
        if (box) {
          box.insertAdjacentHTML('beforeend',
            pairRow(pAdd.dataset.pairadd, box.children.length, null, box.dataset.plist || ''));
          var fresh = box.lastElementChild.querySelector('input');
          if (fresh) fresh.focus();
        }
        return;
      }
      if (pDel) {
        var prow = pDel.closest('.pair-row'), pbox = prow && prow.parentNode;
        if (pbox && pbox.children.length > 1) prow.remove();
        else if (prow) Array.prototype.forEach.call(prow.querySelectorAll('input'), function (i) { i.value = ''; });
        return;
      }
      var el = e.target.closest('[data-go],[data-period],[data-act],[data-form],[data-tab],[data-del],[data-edit],[data-more],[data-filter],[data-filter-clear],[data-calc],[data-tpl],[data-tpl-save],[data-tpl-manage],[data-menu]');
      if (!el) return;
      if (roBlock(el)) { e.preventDefault(); return; }
      // «Подробнее»: одно окно для любой цифры — что с ней связано
      if (el.dataset.more) {
        e.preventDefault();
        var mp = el.dataset.more.split('|');
        DET.open(mp[0], mp.slice(1).join('|'));
        return;
      }
      if (el.dataset.filter !== undefined && el.dataset.filter !== '') {
        var fp = el.dataset.filter.split('|');
        FLT.set(fp[0], fp[1], fp.slice(2).join('|'));
        PAGE = {}; render(); return;
      }
      if (el.dataset.filterClear) { FLT.clear(el.dataset.filterClear); PAGE = {}; render(); return; }
      if (el.dataset.calc) { openCalc(el.dataset.calc); return; }
      if (el.dataset.menu) { e.stopPropagation(); openRowMenu(el); return; }
      if (el.dataset.tpl) { applyTemplate(el.dataset.tpl); return; }
      if (el.dataset.tplSave) { saveTemplate(el.dataset.tplSave); return; }
      if (el.dataset.tplManage) { manageTemplates(el.dataset.tplManage); return; }
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
        if (el.dataset.moreName) pre.name = el.dataset.moreName;
        if (el.dataset.moreFirm) { pre.name = el.dataset.moreFirm; pre.firm = el.dataset.moreFirm; }
        openForm(el.dataset.form, pre);
        return;
      }
      if (el.dataset.del) {
        var d = el.dataset.del.split(':');
        if (confirm('Удалить запись? Её можно будет вернуть из корзины на экране «Все записи».')) {
          S.remove(d[0], d[1]);
          recompute(); render();
          toast('Удалено. Вернуть можно на экране «Все записи» → Корзина.');
        }
        return;
      }
      var a = el.dataset.act;
      if (a === 'close-sheet') askClose();
      else if (a === 'more-back') DET.back();
      else if (a === 'rec-copy') {
        var src = (S.state[el.dataset.coll] || []).filter(function (x) { return x.id === el.dataset.id; })[0];
        if (!src) { toast('Запись не найдена.'); return; }
        EN.copy(src, el.dataset.coll);
        toast('Скопировано. Откройте любую форму и нажмите «Вставить» — поля заполнятся.');
      }
      else if (a === 'rec-paste') { pasteClip(el.dataset.form); }
      else if (a === 'undo-last') { undoLast(); }
      else if (a === 'draft-open') {
        var b = document.querySelector('.draft-bar'); if (b) b.remove();
        if (DRAFT_BACK) openForm(DRAFT_BACK.id, DRAFT_BACK.values);
      }
      else if (a === 'draft-drop') {
        var b2 = document.querySelector('.draft-bar'); if (b2) b2.remove();
        if (DRAFT_BACK) Q.clearDraft(DRAFT_BACK.id);
        DRAFT_BACK = null;
      }
      else if (a === 'pick-files' || a === 'backup') { closeSheet(); if (a === 'backup') backup(); else $('filesInput').click(); }
      else if (a === 'more') { PAGE[el.dataset.id] = (PAGE[el.dataset.id] || +el.dataset.step) + (+el.dataset.step) * 3; render(); }
      else if (a === 'pick-folder') $('folderInput').click();
      else if (a === 'folder-connect') connectFolder();
      else if (a === 'folder-reconnect') reconnectFolder();
      else if (a === 'folder-sync') syncFolder(false);
      else if (a === 'folder-forget') { if (confirm('Отключить папку? Записи останутся в браузере и в уже сохранённом файле.')) { F.forget(); render(); } }
      else if (a === 'export-excel') exportExcel();
      else if (a === 'export-screen') exportScreen();
      else if (a === 'restore') restore();
      else if (a === 'print') window.print();
      else if (a === 'del-shift') {
        if (confirm('Удалить смену целиком?')) {
          el.dataset.ids.split(',').forEach(function (id) { S.remove('dds', id); });
          render();
        }
      }
      else if (a === 'print-labels') printLabels();
      else if (a === 'conflict-theirs') {
        closeSheet(); conflictShown = false; conflictOther = null;
        F.loadSaved().then(function (data) {
          if (data) { S.replaceAll(data); recompute(); render(); toast('Взяли версию из файла.'); }
        });
      }
      else if (a === 'add-record') openAddSheet();
      else if (a === 'open-menu') openMenuSheet();
      else if (a === 'readonly-on') {
        setReadOnly(true);
        toast('Режим показа включён: смотреть можно, менять — нет. ' +
          'Он снимется сам, когда закроете это окно браузера.', 9000);
      }
      else if (a === 'readonly-off') readOnlyOff();
      else if (a === 'share-screen') shareSheet();
      else if (a === 'share-copy') shareVia('copy');
      else if (a === 'share-telegram') shareVia('telegram');
      else if (a === 'share-whatsapp') shareVia('whatsapp');
      else if (a === 'book-restore') {
        closeSheet();
        (async function () {
          var had = S.COLLECTIONS.reduce(function (n, c) { return n + (S.state[c] || []).length; }, 0);
          if (had && !confirm('В базе уже есть ' + nf(had) + ' записей. Собрать её заново из книги? ' +
            'Нынешняя база сохранится в копиях.')) return;
          var ok = await readBook(null, false);
          if (!ok) return;
          var now = S.COLLECTIONS.reduce(function (n, c) { return n + (S.state[c] || []).length; }, 0);
          await F.saveNow(function () { return S.state; }, true);
          recompute(); render();
          toast('База собрана из книги: ' + nf(now) + ' ' +
            plural(now, 'запись', 'записи', 'записей') + '.', 9000);
        })();
      }
      else if (a === 'conflict-merge') {
        closeSheet(); conflictShown = false;
        if (!conflictOther) { toast('Чужая версия не прочиталась — попробуйте ещё раз.'); return; }
        try {
          var rep = S.reconcileWith(conflictOther.text);
          conflictOther = null;
          F.saveNow(function () { return S.state; }, true).then(function () {
            recompute(); render();
            var bits = ['Объединили: всего ' + nf(rep.total) + ' ' +
              plural(rep.total, 'запись', 'записи', 'записей')];
            if (rep.added) bits.push('добавлено из файла ' + nf(rep.added));
            if (rep.conflicts) bits.push('спорных ' + nf(rep.conflicts) +
              ' — взяли версию из более позднего файла');
            if (rep.removed) bits.push('удалённых не вернули ' + nf(rep.removed));
            toast(bits.join(' · ') + '.', 12000);
          });
        } catch (err) {
          toast('Не получилось объединить: ' + err.message + '. Файл в папке не тронут.');
        }
      }
      else if (a === 'conflict-mine') {
        closeSheet(); conflictShown = false; conflictOther = null;
        F.saveNow(function () { return S.state; }, true).then(function () {
          toast('Записали вашу версию поверх файла. Прежняя лежит в копиях.');
        });
      }
      else if (a === 'settings-wizard') settingsWizard();
      else if (a === 'settings-reset') {
        if (confirm('Вернуть все настройки к стандартным? Записи и документы не тронутся.')) {
          Object.keys(S.DEFAULT_SETTINGS).forEach(function (k) { S.setSetting(k, S.DEFAULT_SETTINGS[k]); });
          applyLook(); recompute(); render();
          toast('Настройки сброшены к стандартным.');
        }
      }
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
        window.WM_LAST_SAVE = { form: id, ok: typeof res !== 'string' };
        if (typeof res === 'string') { toast(res); return; }
        // При правке форма обычно добавляет новую запись — старую убираем.
        // Формы с пометкой editsInPlace правят запись сами, их трогать нельзя.
        if (EDIT && !def.editsInPlace) { S.remove(EDIT.coll, EDIT.id, true); }
        EDIT = null;
        Q.clearDraft(id);
        closeSheet(); render(); toast(res.ok);
        // Ctrl+Enter: сохранили — и сразу такая же пустая форма,
        // чтобы забивать накладные или расходы подряд
        if (AGAIN === id) { AGAIN = false; setTimeout(function () { openForm(id); }, 120); }
      } else if (f.id === 'setForm') {
        var v = formValues(f);
        Object.keys(v).forEach(function (k) { S.setSetting(k, v[k]); });
        closeSheet(); applyLook(); F.setKeepBackups(S.settings.keepBackups); recompute(); render();
        if (E.norm(S.settings.askPin) === 'да' && !pinSaved()) lockScreen(true);
        armLock();
        toast('Настройки сохранены. Постоянные расходы: ' + money(S.fixedMonthly()) + ' в месяц.');
      }
    });

    document.addEventListener('change', function (e) {
      if (window.WM_EXTRA_CHANGE && window.WM_EXTRA_CHANGE(e.target)) { render(); }
    });

    // пока печатаем в числовом поле — под ним пересчитывается сумма
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (!el.classList) return;
      if (el.classList.contains('num-input')) {
        var hint = document.querySelector('[data-hint-for="' + el.name + '"]');
        if (hint) hint.innerHTML = numHint(el.value);
      } else if (el.type === 'date' && el.name) {
        var dh = document.querySelector('[data-hint-for="' + el.name + '"]');
        if (dh) dh.textContent = NUM.dateFull(el.value);
      }
    });

    /* --- Горячие клавиши -----------------------------------------------------
       Ctrl+S — сохранить форму, Ctrl+Enter — сохранить и сразу открыть такую же
       (подряд забивать накладные или расходы), Ctrl+K — поиск.
       ---------------------------------------------------------------------- */
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var key = (e.key || '').toLowerCase();
      var form = document.getElementById('wmForm');
      if ((key === 's' || key === 'ы') && form) {
        e.preventDefault();
        AGAIN = false;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      } else if (key === 'enter' && form) {
        e.preventDefault();
        AGAIN = form.dataset.fid;          // после сохранения откроем такую же
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      } else if (key === 'k' || key === 'л') {
        e.preventDefault();
        $('search').focus(); $('search').select();
      } else if ((key === 'z' || key === 'я') && !form) {
        // в форме Ctrl+Z — это отмена набора текста, туда не лезем
        e.preventDefault();
        undoLast();
      } else if ((key === 'v' || key === 'м') && form && EN.clip() &&
        !/input|textarea/i.test((e.target || {}).tagName || '')) {
        e.preventDefault();
        pasteClip();
      }
    });

    /* --- Сканер штрихкодов ---------------------------------------------------
       Сканер печатает код за доли секунды и жмёт Enter — по скорости и
       отличаем его от человека. Код ищем в остатках и прайсах.
       ---------------------------------------------------------------------- */
    var onScan = IN.scanner(function (code) {
      var found = IN.findByCode(code, D.stock, D.prices);
      var field = document.querySelector('#wmForm input[name="name"]');
      if (field) {
        // форма открыта — подставляем товар прямо в неё
        field.value = found ? found.name : code;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        toast(found ? 'Сканер: ' + found.name : 'Сканер: код ' + code + ' в базе не найден');
        var qty = document.querySelector('#wmForm .num-input[name="qty"]');
        if (qty) qty.focus();
        return;
      }
      if (!found) { toast('Штрихкод ' + code + ' в базе не найден.'); return; }
      DET.open('product', E.norm(found.name));     // иначе показываем карточку товара
    }, { minLen: 6 });

    document.addEventListener('keydown', function (e) {
      // в обычных полях не мешаем: сканер узнаётся по скорости, а Enter
      // в открытой форме и так отправляет её
      if (e.target && /input|textarea|select/i.test(e.target.tagName) &&
        !e.target.classList.contains('scan-here')) {
        if (e.key !== 'Enter') { onScan(e); return; }
        return;
      }
      if (onScan(e)) e.preventDefault();
    });

    /* --- 27. Недописанная форма возвращается после закрытия программы --------
       Черновик лежит в браузере и переживает перезапуск. При старте
       предлагаем вернуться к нему, а не молча забываем.
       -------------------------------------------------------------------- */
    setTimeout(function () {
      // Пока открыта форма, полоску не показываем: она стоит внизу по центру
      // и накрывает собой кнопку «Сохранить».
      if (document.getElementById('wmForm')) return;
      var found = null;
      Object.keys(FORMS).forEach(function (id) {
        if (found) return;
        var d = Q.loadDraft(id);
        if (!d) return;
        var filled = Object.keys(d).filter(function (k) {
          return k !== 'date' && String(d[k] || '').trim();
        });
        if (filled.length >= 2) found = { id: id, values: d, filled: filled.length };
      });
      if (!found) return;
      var name = (FORMS[found.id] || {}).title || found.id;
      var bar = document.createElement('div');
      bar.className = 'draft-bar';
      bar.innerHTML = '<span>📝 Осталась незаконченная запись: <b>' + esc(name) + '</b> — ' +
        found.filled + ' ' + plural(found.filled, 'поле заполнено', 'поля заполнено', 'полей заполнено') + '</span>' +
        '<button class="btn btn-sm btn-primary" data-act="draft-open">Продолжить</button>' +
        '<button class="btn btn-sm" data-act="draft-drop">Не нужно</button>';
      document.body.appendChild(bar);
      DRAFT_BACK = found;
    }, 2200);

    // черновик формы сохраняется сам, а не только при вводе
    setInterval(function () {
      var f = document.getElementById('wmForm');
      if (!f || !f.dataset.fid) return;
      try { Q.saveDraft(f.dataset.fid, formValues(f)); } catch (err) {}
    }, 3000);

    // калькулятор: 🧮 у поля, а также «=» прямо в поле
    document.addEventListener('keydown', function (e) {
      var el = e.target;
      if (!el.classList || !el.classList.contains('num-input')) return;
      if (e.key === '=' || (e.key === 'Enter' && NUM.isExpr(el.value))) {
        var v = NUM.calc(el.value);
        if (v !== null) {
          e.preventDefault();
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });

    // поиск внутри фильтров: печатаем — список сужается, курсор остаётся на месте
    var fTimer = null;
    document.addEventListener('input', function (e) {
      var box = e.target;
      if (!box.dataset || !box.dataset.filterText) return;
      var id = box.dataset.filterText, pos = box.selectionStart;
      FLT.setText(id, box.value);
      clearTimeout(fTimer);
      fTimer = setTimeout(function () {
        PAGE = {}; render();
        var again = document.querySelector('[data-filter-text="' + id + '"]');
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (err) {} }
      }, 260);
    });

    var timer = null;
    // поле поиска на самом экране «Поиск» пишет в ту же строку
    document.addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'pageSearch') return;
      var box = $('search');
      if (box) { box.value = e.target.value; }
      clearTimeout(SEARCH_T);
      SEARCH_T = setTimeout(function () {
        var pos = e.target.selectionStart;
        render();
        var again = $('pageSearch');
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (err) {} }
      }, 280);
    });
    $('search').addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var q = $('search').value.trim();
        if (['stock', 'pricecmp', 'search', 'finbase'].indexOf(VIEW) >= 0) { PAGE = {}; render(); }
        else if (q.length >= 2) go('search');
      }, 280);
    });
    $('menuBtn').addEventListener('click', openMenuSheet);
    $('addBtn').addEventListener('click', openAddSheet);
    $('syncBtn').addEventListener('click', function () {
      if (F.state === 'ready') syncFolder(false);
      else if (F.state === 'needs-permission') reconnectFolder();
      else if (F.state === 'lost') { go('data'); toast(F.humanError({ name: 'NotFoundError' }), 11000); }
      else $('folderInput').click();
    });
    $('privacyBtn').addEventListener('click', function () {
      var on = document.body.classList.toggle('priv');
      try { localStorage.setItem('wm_priv', on ? '1' : '0'); } catch (e) {}
      $('privacyBtn').textContent = on ? '🙈' : '👁';
    });
    $('filesInput').addEventListener('change', function (e) { loadFiles(e.target.files); e.target.value = ''; });
    $('folderInput').addEventListener('change', function (e) { loadFiles(e.target.files); e.target.value = ''; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') askClose(); });
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
      if (f === 'сбп' || f.indexOf('сбп') >= 0 || f.indexOf('qr') >= 0) return 'СБП';
      if (f.indexOf('перевод') >= 0) return 'Перевод';
      if (f.indexOf('карт') >= 0 || f.indexOf('эквайр') >= 0) return 'Карта';
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

  // Прежние ручные накладные и оплаты жили отдельно от документов 1С — из-за
  // этого долг показывался двумя разными числами. Переносим их в общую базу:
  // одна база — один долг. Поля помечаются как ваши, 1С их не перезапишет.
  function migrateSupply() {
    if (S.state.migratedSupply) return 0;
    var moved = 0;
    (S.state.invoices || []).forEach(function (r) {
      var rec = SUP.addOwnDoc(S.state, {
        doc: r.doc, date: r.date, supplier: r.supplier, sum: num(r.total),
        payDate: r.due, note: r.goods
      }, S.settings);
      moved++;
      if (num(r.paidCash) > 0) {
        SUP.addOwnPay(S.state, { date: r.date, supplier: r.supplier, sum: num(r.paidCash),
          basis: rec.doc, note: 'отдали сразу при приёмке' }, S.settings);
        moved++;
      }
    });
    (S.state.payments || []).forEach(function (r) {
      SUP.addOwnPay(S.state, { date: r.date, supplier: r.supplier, sum: num(r.amount),
        basis: r.doc, cashbox: r.form, operation: r.kind, note: r.note }, S.settings);
      moved++;
    });
    S.state.migratedSupply = true;
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
    applyLook();
    // пароль спрашиваем до того, как показать цифры
    if (E.norm(S.settings.askPin) === 'да') lockScreen(!pinSaved());
    ['click', 'keydown', 'input'].forEach(function (ev) {
      document.addEventListener(ev, armLock, true);
    });
    armLock();
    var privSaved = null;
    try { privSaved = localStorage.getItem('wm_priv'); } catch (e) {}
    var privOn = privSaved === null ? E.norm(S.settings.privacyDefault) === 'да' : privSaved === '1';
    if (privOn) { document.body.classList.add('priv'); $('privacyBtn').textContent = '🙈'; }

    // экран и период, с которых начинаем — из настроек
    var startMap = { 'сегодня': 'today', 'пульт': 'finpulse', 'поставщики': 'suppliers',
      'записать': 'manual', 'касса и смены': 'cash', 'склад': 'stock' };
    var periodMap = { 'сегодня': 'today', 'неделя': 'week', 'месяц': 'month', 'квартал': 'quarter', 'все': 'all' };
    var sv = startMap[E.norm(S.settings.startView)];
    if (sv) VIEW = sv;
    var pd = periodMap[E.norm(S.settings.defaultPeriod)];
    if (pd) PERIOD = pd;

    var moved = migrateToLedger();
    var movedSup = migrateSupply();
    recompute(); bind(); render();
    if (movedSup) toast('Ваши накладные и оплаты перенесены в общую базу: ' + movedSup +
      '. Теперь долг поставщикам считается одной суммой — и по вашим записям, и по 1С.', 9000);
    if (moved) toast('Прежние записи о кассе и расходах перенесены в базу операций: ' + moved + '.', 7000);

    // сохранение в файл: подписываемся на любые изменения журналов
    S.onChange(function () {
      F.scheduleSave(function () { return S.state; });
      scheduleBook();
    });
    F.onChange(function (st, when, other) {
      renderNav();
      if (other) conflictAsk(other);
    });
    F.setKeepBackups(S.settings.keepBackups);

    // вторая вкладка той же программы: подхватываем её записи
    window.addEventListener('storage', function (e) {
      if (e.key !== S.KEY || !e.newValue) return;
      try {
        S.replaceAll(JSON.parse(e.newValue));
        recompute(); render();
        toast('Данные обновились: запись сделана в другой вкладке.');
      } catch (err) { /* повреждённое значение игнорируем */ }
    });

    var st = await F.restore();
    if (st === 'ready') {
      var saved = await F.loadSaved();
      if (saved) S.replaceAll(saved);
      // 125. Базы нет, а книга есть — предлагаем собрать базу из книги.
      // Так бывает, когда файл базы случайно удалили или почистили папку:
      // книга «Бухгалтерия.xlsx» лежит на виду и её удаляют реже.
      else if (!S.COLLECTIONS.some(function (c) { return (S.state[c] || []).length; })) {
        var bookFile = await F.rootFile(F.BOOK_FILE);
        if (bookFile) offerBookRestore(bookFile);
      }
      // книгу, изменённую в Excel после последнего сохранения, читаем сразу
      var book = await F.bookChangedOutside();
      if (book && (!F.lastSaved || book.lastModified > F.lastSaved.getTime())) await readBook(book, true);
      await syncFolder(true);
      recompute(); render();
      if (!book) scheduleBook();
    }

    // вторая папка (флешка, облачный диск): кладём копию по расписанию
    try {
      var bs = await F.restoreBackupDir();
      if (bs === 'ready' && F.backupDue(S.settings.backupEveryHours)) {
        var copied = await F.copyToBackup(function () { return S.state; }, 'по расписанию');
        if (copied) {
          F.markCopied();
          setTimeout(function () {
            toast('Копия базы положена во вторую папку: ' + copied, 7000);
          }, 2500);
        }
      }
    } catch (e) { /* вторая папка — приятное дополнение, а не обязанность */ }

    if (st === 'lost') {
      // папку перенесли или распаковали заново в другое место: говорим сразу,
      // пока владелец не решил, что записи пропали
      render();
      setTimeout(function () {
        if (F.state === 'lost') toast(F.humanError({ name: 'NotFoundError' }), 12000);
      }, 1200);
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
