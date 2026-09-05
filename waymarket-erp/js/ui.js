/* ============================================================================
   Вай Маркет — интерфейс. Оформление в стиле iOS: крупные цифры, списки,
   минимум лишнего. Расчёты — js/engine.js, журналы — js/store.js,
   сохранение в файлы — js/filestore.js.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.WM, S = window.WMStore, F = window.WMFiles, BOOK = window.WMBook;
  S.load();

  /* --- Данные выгрузок (в памяти) ----------------------------------------- */
  /* КОНТУР 2: данные из 1С. Живут только в памяти браузера, пока открыта
     программа. В базу оперативных записей и в книгу «Бухгалтерия.xlsx» они
     не попадают — ручной учёт и товарная аналитика не смешиваются. */
  var D = {
    sales: [], salesPeriod: null, stock: [], prices: [], contacts: [], pricelist: [],
    barcodes: [], units: [], writeoffs: [], writeoffsPeriod: null, returns: [], returnsPeriod: null,
    invoices1c: [], invoicesPeriod: null, cashOrders: [], dead: [], deadPeriod: null,
    incexp: null, files: []
  };
  var Q = window.WMQuick;     // умный ввод: справочники, подстановки, черновики
  function DICT() { return Q.dicts(S.state, S.settings); }
  function learn(map) {
    var changed = false;
    Object.keys(map).forEach(function (d) { if (Q.learn(S.settings, d, map[d], S.state)) changed = true; });
    if (changed) S.save();
  }
  var C = {};                 // производные расчёты
  var FLT = window.WMFilter;  // кнопки фильтров, одинаковые на всех экранах
  var NUM = window.WMNum;     // счёт в поле, разряды и понятные даты
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

  function readWorkbook(buffer) {
    var wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    return { wb: wb, names: wb.SheetNames,
      matrix: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }) };
  }
  function sheetOf(wb, name) {
    return wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) : null;
  }


  /* Прочитать один файл 1С. Данные ложатся ТОЛЬКО в память (D) — в базу
     оперативных записей и в книгу «Бухгалтерия.xlsx» они не попадают.
     Закрыли программу — товарная аналитика ушла, ручной учёт остался. */
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
    else if (kind === 'writeoffs1c') {
      // Синхронизация, а не «загрузить поверх»: за свой период файл главный,
      // за прошлые месяцы уже посчитанные списания остаются на месте.
      r = E.parseWriteoffs1C(m.matrix);
      var sync = E.syncWriteoffs(D.writeoffs, r.rows, r.period);
      D.writeoffs = sync.rows;
      D.writeoffsPeriod = r.period;
      info.period = r.period;
      info.note = 'обновлено ' + sync.stats.updated + ', добавлено ' + sync.stats.added +
        (sync.stats.removed ? ', убрано из аналитики ' + sync.stats.removed : '');
    }
    else if (kind === 'returns') { r = E.parseReturns(m.matrix); D.returns = r.rows; D.returnsPeriod = r.period; info.period = r.period; }
    else if (kind === 'invoices1c') {
      r = E.parseIncomingInvoices(m.matrix); D.invoices1c = r.rows; D.invoicesPeriod = r.period; info.period = r.period;
      info.note = 'накладных ' + r.rows.length;
    }
    else if (kind === 'cashout' || kind === 'cashin') {
      r = E.parseCashOrders(m.matrix, kind === 'cashin' ? 'in' : 'out'); D.cashOrders = r.rows; info.period = r.period;
      info.note = 'ордеров ' + r.rows.length;
    }
    else if (kind === 'writeoffs') {
      r = E.parseWriteoffs(m.matrix);
      D.writeoffs = r.rows.map(function (x) {
        return { name: x.name, reason: x.reason || 'Без причины', qty: x.qty, cost: x.sum, retail: 0, key: E.norm(x.name) };
      });
    } else { info.note = 'формат не распознан'; }
    info.rows = r && r.rows ? r.rows.length : 0;
    D.files = D.files.filter(function (f) { return f.name !== name; });
    D.files.push(info);
    return info;
  }

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

  /* Пересчёт: ручной учёт считается на лету в js/engine.js, а здесь готовим
     товарную аналитику из того, что лежит в памяти после загрузки файлов 1С. */
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
    C.writeoffSum = E.safeRound(D.writeoffs.reduce(function (a, r) { return a + num(r.cost); }, 0));
    C.returnSum = E.safeRound(D.returns.reduce(function (a, r) { return a + num(r.cost); }, 0));
    C.dead = D.dead.length ? E.deadStockList(D.dead, C.stockIdx, S.settings) : null;
    C.incexp = D.incexp ? E.incomeExpenseSummary(D.incexp.rows) : null;
    C.supplies = D.invoices1c.length ? E.supplierBalance(D.invoices1c, D.cashOrders) : null;
    C.bySupplier = {};
    D.prices.forEach(function (p) { var k = E.norm(p.supplier); C.bySupplier[k] = (C.bySupplier[k] || 0) + 1; });
  }

  /* Загрузка выгрузок 1С. Всё, что прочитали, ложится в память (D):
     товарная аналитика оживает, ручной учёт при этом не меняется ни на рубль. */
  async function loadFiles(list) {
    var all = Array.prototype.slice.call(list || []);
    var json = all.filter(function (f) { return /\.json$/i.test(f.name); })[0];
    if (json) {
      var fr = new FileReader();
      fr.onload = function () {
        try { S.importJSON(fr.result); recompute(); render(); toast('База загружена из копии.'); }
        catch (e) { toast('Не получилось прочитать файл: ' + e.message); }
      };
      fr.readAsText(json);
      return;
    }
    var files = all.filter(function (f) {
      return /\.(xls|xlsx|csv)$/i.test(f.name) && !/^~\$/.test(f.name) &&
        E.norm(f.name).indexOf(E.norm(BOOK.FILE)) < 0;
    });
    if (!files.length) { toast('Файлов 1С не нашлось. Нужны .xls, .xlsx или .csv'); return; }
    var b = sheet('Читаю файлы', '<div class="card"><div class="card-pad" id="progText">Подождите…</div></div>');
    var okCount = 0;
    for (var i = 0; i < files.length; i++) {
      var t = $('progText');
      if (t) t.textContent = (i + 1) + ' из ' + files.length + ': ' + files[i].name;
      try {
        var info = ingest(files[i].name, await files[i].arrayBuffer(), files[i].size);
        if (info.kind !== 'unknown') okCount++;
      } catch (e) {
        // Один битый файл не должен остановить остальные, но и молчать нельзя:
        // иначе владелец решит, что отчёт загрузился, а его нет.
        D.files = D.files.filter(function (f) { return f.name !== files[i].name; });
        D.files.push({ name: files[i].name, kind: 'unknown', rows: 0, size: files[i].size,
          note: 'не прочитался: ' + e.message });
      }
    }
    closeSheet(); recompute(); render();
    toast('Прочитано файлов: ' + okCount + ' из ' + files.length +
      '. Товарная аналитика обновлена; касса и зарплаты не тронуты.', 9000);
  }

  function bookWorkbook() {
    var sheets = BOOK.build(S.state, S.settings);
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
    /* «Быстрая настройка»: пять полей, без которых программа считает
       неправильно. Кнопка на экране настроек была, а формы за ней не было. */
    setupWizard: {
      title: 'Быстрая настройка', icon: '🧭',
      body: function (v) {
        var s2 = S.settings; v = v || {};
        return fieldRow('Название магазина', 'storeName', 'text',
          v.storeName != null ? v.storeName : s2.storeName) +
          fieldRow('Денежные ящики', 'tills', 'text',
            v.tills != null ? v.tills : s2.tills,
            { hint: 'через запятую: «Касса 1, Касса 2»' }) +
          fieldRow('Названия смен', 'shiftNames', 'text',
            v.shiftNames != null ? v.shiftNames : s2.shiftNames,
            { hint: 'по порядку, от первой к последней: «День, Ночь»' }) +
          fieldRow('Наличных в кассах сейчас', 'openCashStart', 'number',
            v.openCashStart != null ? v.openCashStart : s2.openCashStart,
            { hint: 'сложите деньги во всех ящиках' }) +
          fieldRow('Наличных в сейфе сейчас', 'openSafeStart', 'number',
            v.openSafeStart != null ? v.openSafeStart : s2.openSafeStart) +
          fieldRow('Долг поставщикам сейчас', 'openDebtStart', 'number',
            v.openDebtStart != null ? v.openDebtStart : s2.openDebtStart,
            { hint: 'общей суммой по магазину' });
      },
      hint: 'Это тот минимум, без которого остаток наличных и долг начнутся с нуля, ' +
        'а не с того, что есть на самом деле. Остальное настраивается ниже, на экране.',
      save: function (v) {
        if (!E.txt(v.tills)) return 'Впишите хотя бы один денежный ящик.';
        if (!E.txt(v.shiftNames)) return 'Впишите хотя бы одну смену.';
        ['storeName', 'tills', 'shiftNames'].forEach(function (k) {
          S.setSetting(k, E.txt(v[k]));
        });
        ['openCashStart', 'openSafeStart', 'openDebtStart'].forEach(function (k) {
          S.setSetting(k, E.num(v[k]));
        });
        S.setSetting('finShifts', E.txt(v.shiftNames));
        applyLook(); recompute();
        return { ok: 'Готово. Программа считает от ' + money(E.num(v.openCashStart)) +
          ' в кассах и долга ' + money(E.num(v.openDebtStart)) + '.' };
      }
    },

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
    }
  };

  // Все рабочие формы приходят из js/finviews.js и js/dictviews.js
  if (window.WM_EXTRA_FORMS) {
    for (var fk in window.WM_EXTRA_FORMS) FORMS[fk] = window.WM_EXTRA_FORMS[fk];
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
    // полоска «осталась незаконченная запись» не должна закрывать кнопку «Сохранить»
    var oldBar = document.querySelector('.draft-bar'); if (oldBar) oldBar.remove();
    EDIT = edit || null;
    var lists = '';
    sheet(f.title,
      tplBar(id) +
      '<form id="wmForm" data-fid="' + id + '"><div class="form-list">' + f.body(prefill) + '</div>' +
      (f.hint ? '<div class="form-hint">' + esc(f.hint) + '</div>' : '') + lists +
      '<div class="form-actions"><button type="button" class="btn" data-act="close-sheet">Отмена</button>' +
      '<button type="submit" class="btn btn-primary btn-lg">' + (edit ? 'Сохранить изменения' : 'Сохранить') + '</button></div></form>');
  }
  /* --- Долги к оплате (ручные записи + документы 1С) -------------------------- */
  /* --- Экран «Сегодня» --------------------------------------------------------- */
  /* --- Экран «Поставщики» ------------------------------------------------------- */
  /* --- Касса и смены ------------------------------------------------------------ */
  // Смены собираются из базы операций: записи одной смены сгруппированы
  // по дате, смене и кассиру — как строки «Ввод_Касса» в вашей таблице.
  /* --- Расходы и книга ДДС -------------------------------------------------------- */
  /* --- Зарплата ------------------------------------------------------------------- */
  /* --- Склад ---------------------------------------------------------------------- */
  /* --- Заказы (ROP) ---------------------------------------------------------------- */
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
  /* --- Списания и возвраты ---------------------------------------------------------- */
  /* --- Прибыль (P&L) ----------------------------------------------------------- */
  /* --- Точка безубыточности ------------------------------------------------------ */
  /* --- ABC ---------------------------------------------------------------------- */
  /* --- Цены поставщиков ---------------------------------------------------------- */
  // Красивая цена: закуп + наценка, округлённые по вашему правилу
  /* --- Поиск ------------------------------------------------------------------------ */
  /* --- Данные и файлы ---------------------------------------------------------------- */
  /* --- Данные и копии --------------------------------------------------------
     Раньше здесь загружались выгрузки 1С. Теперь у программы один файл —
     своя книга «Бухгалтерия.xlsx» плюс копии базы. */
  var KINDS_1C = {
    sales: 'Продажи', stock: 'Остатки номенклатуры', prices: 'Цены поставщиков',
    contacts: 'Контакты поставщиков', pricelist: 'Прайс-лист', barcodes: 'Штрихкоды',
    units: 'Единицы измерения', writeoffs1c: 'Причины списания', writeoffs: 'Списания',
    returns: 'Причины возвратов', invoices1c: 'Приходные накладные',
    cashout: 'Расходные ордера', cashin: 'Приходные ордера',
    deadstock: 'Неликвидные товары', incexp1c: 'Доходы и расходы',
    unknown: 'Не распознан'
  };
  function viewData() {
    var st = saveState();
    var h = pageHead('Данные и копии', 'Где лежит ваша база и как сделать копию');

    var note, button;
    if (st.ok) {
      note = 'Папка: ' + esc(F.dirName) + ' → ' + F.DATA_DIR + '/' + F.DATA_FILE +
        '. Рядом лежит книга «' + BOOK.FILE + '» — это та же база, только читаемая в Excel.';
      button = '<button class="btn" data-act="folder-forget">Отключить</button>';
    } else if (st.lost) {
      note = 'Папка «' + esc(F.dirName || 'программы') + '», которую программа помнит, переименована, ' +
        'перенесена или удалена. <b>Ваши записи целы</b> — они хранятся внутри браузера. ' +
        'Нажмите «Выбрать папку заново» и укажите ту папку, где сейчас лежит программа.';
      button = '<button class="btn btn-primary" data-act="folder-connect">Выбрать папку заново</button>' +
        ' <button class="btn" data-act="folder-forget">Больше не искать</button>';
    } else {
      note = 'Пока записи хранятся только внутри браузера. Подключите папку — и всё будет ' +
        'лежать файлом рядом с программой.';
      button = '<button class="btn btn-primary" data-act="' +
        (F.state === 'needs-permission' ? 'folder-reconnect' : 'folder-connect') + '">Подключить папку</button>';
    }
    h += '<div class="banner ' + (st.ok ? 'green' : '') + '">' +
      '<span>' + (st.ok ? '✅' : '⚠️') + '</span><div><b>' + esc(st.text) + '</b>' +
      '<div class="card-note">' + note + '</div></div>' + button + '</div>';

    var counts = S.COLLECTIONS.filter(function (c) { return S.COLL_RU[c]; }).map(function (c) {
      return { name: S.COLL_RU[c], coll: c, n: (S.state[c] || []).length };
    }).filter(function (x) { return x.n; });
    h += card('Аналитика из 1С', listOf([
      listRow({ icon: '📂', title: 'Прочитать папку с выгрузками',
        sub: 'Продажи, Остатки, Цены, Контакты, Накладные, Причины списания — имена любые',
        value: '<button class="btn btn-sm btn-primary" data-act="pick-folder">Выбрать папку</button>' }),
      listRow({ icon: '📄', title: 'Загрузить отдельные файлы', sub: 'если нужно обновить один отчёт',
        value: '<button class="btn btn-sm" data-act="pick-files">Выбрать файлы</button>' }),
      F.state === 'ready' ? listRow({ icon: '🔄', title: 'Перечитать подключённую папку',
        sub: 'берёт только изменившиеся файлы',
        value: '<button class="btn btn-sm" data-act="folder-sync">Обновить</button>' }) : ''
    ].filter(Boolean), ''),
      D.files.length ? 'Загружено файлов: ' + D.files.length : '');

    if (D.files.length) {
      h += card('Что прочитано из 1С', table('filesT', [
        { title: 'Файл', fn: function (r) { return esc(r.name); } },
        { title: 'Что это', fn: function (r) { return esc(KINDS_1C[r.kind] || r.kind); } },
        { title: 'Строк', cls: 'num', fn: function (r) { return nf(r.rows); } },
        { title: 'Период', fn: function (r) { return r.period ? esc(r.period.from + ' – ' + r.period.to) : '—'; } },
        { title: '', cls: 'center', fn: function (r) {
          return r.kind === 'unknown' ? badge('не понял', 'red') : badge('готово', 'green'); } }
      ], D.files, { step: 30 }),
        'Эти данные живут в памяти и пропадут при закрытии программы — ' +
        'касса, зарплаты и долг они не трогают');
    }

    h += card('Что в базе', listOf(counts.map(function (x) {
      return listRow({ icon: '📄', title: esc(x.name), value: nf(x.n) });
    }), 'База пока пуста'));

    h += card('Книга «' + BOOK.FILE + '»', listOf([
      listRow({ icon: '📗', title: 'Записать книгу заново', sub: 'пересобрать все листы из базы',
        value: '<button class="btn btn-sm" data-act="book-save">Записать</button>' }),
      listRow({ icon: '📖', title: 'Прочитать правки из книги', sub: 'если правили её в Excel',
        value: '<button class="btn btn-sm" data-act="book-read">Прочитать</button>' }),
      listRow({ icon: '🧱', title: 'Собрать базу из книги', sub: 'если файл базы потерялся',
        value: '<button class="btn btn-sm" data-act="book-restore">Собрать</button>' })
    ], ''), 'Листы: ' + BOOK.SHEETS.map(function (x) { return x.name; }).join(', '));

    h += card('Копии и перенос', listOf([
      listRow({ icon: '⤓', title: 'Скачать этот экран в Excel', sub: 'то, что видно на экране',
        value: '<button class="btn btn-sm" data-act="export-screen">Скачать</button>' }),
      listRow({ icon: '💾', title: 'Сохранить копию базы', sub: 'файл .json — положите на флешку',
        value: '<button class="btn btn-sm" data-act="backup">Скачать</button>' }),
      listRow({ icon: '📥', title: 'Загрузить базу из копии', sub: 'заменит текущие записи',
        value: '<button class="btn btn-sm" data-act="restore">Загрузить</button>' }),
      listRow({ icon: '🗑', title: 'Очистить всю базу', sub: 'копия сохранится в папке',
        value: '<button class="btn btn-sm btn-danger" data-act="wipe">Очистить</button>' })
    ], ''));
    return h;
  }

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
  /* --- Неликвиды: что лежит без движения ------------------------------------ */
  /* --- Доходы и расходы по данным 1С ---------------------------------------- */
  // Помощники рисования отдаём экранам (js/finviews.js, js/dictviews.js)
  window.WMUI = {
    esc: esc, money: money, priv: priv, nf: nf, pct: pct, num: num, cls: cls, badge: badge,
    dateRu: dateRu, plural: plural, today: today,
    card: card, listRow: listRow, listOf: listOf, table: table, stat: stat, hero: hero,
    fieldRow: fieldRow, pairValues: pairValues, pageHead: pageHead, toast: toast,
    sheet: sheet, closeSheet: closeSheet,
    periodRange: periodRange, periodName: periodName, periodDays: periodDays, inPeriod: inPeriod,
    go: function (id) { go(id); }, render: function () { render(); },
    tab: function (key, def) { return TAB[key] || def; },
    rowMenu: function (coll, id, opts) { return rowMenu(coll, id, opts); },
    pasteClip: function (formId) { pasteClip(formId); },
    page: function (id, step) { return PAGE[id] || step; },
    editing: function () { return EDIT; },
    // Контур 2 живёт в памяти: экраны товаров читают его отсюда
    data: function () { return D; }, calc: function () { return C; },
    // Полный список экранов — независимо от того, что сейчас в меню
    views: function () {
      return VIEWS.map(function (v) {
        return { id: v.id, name: v.name, group: v.group, main: isMain(v) };
      });
    },
    openForm: function (id, prefill, edit) { openForm(id, prefill, edit); },
    form: function (id) { return FORMS[id]; },
    pickFiles: function () { $('filesInput').click(); },
    saveBook: function () { return saveBookNow(); },
    readBook: function () { return readBook(); },
    recompute: function () { recompute(); }
  };

  /* --- Навигация ---------------------------------------------------------------- */
  var VIEWS = [
    { id: 'data', icon: '🗂', name: 'Данные и копии', group: 'Ещё', render: viewData },
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
  var GROUP_ORDER = ['Каждый день', 'Деньги', 'Люди', 'Товары', 'Отчёты', 'Ещё'];
  VIEWS = VIEWS.map(function (v, i) { return { v: v, i: i }; })
    .sort(function (a, b) {
      var ga = GROUP_ORDER.indexOf(a.v.group), gb = GROUP_ORDER.indexOf(b.v.group);
      if (ga < 0) ga = GROUP_ORDER.length;          // незнакомый раздел — в конец
      if (gb < 0) gb = GROUP_ORDER.length;
      return ga - gb || a.i - b.i;
    })
    .map(function (x) { return x.v; });

  /* Красные кружки в меню: сколько дел ждёт на каждом экране */
  function counters() {
    var c = {}, t = today();
    var pt = E.planTotals(S.state.plans || [], t);
    if (pt.overdueCount) c.finpay = pt.overdueCount > 99 ? '99+' : pt.overdueCount;
    var deb = E.debtorTotals(S.state.debtors || [], t);
    var oldN = (S.state.debtors || []).filter(function (d) {
      return num(d.sum) - num(d.paid) > 0 &&
        E.daysBetween(d.date, t) > (num(S.settings.debtorOldDays) || 30);
    }).length;
    if (oldN) c.debtors = oldN > 99 ? '99+' : oldN;
    var bad = E.shiftsOf(S.state.dds || [], null, S.settings).filter(function (r) {
      return !E.shiftCalc(r).ok && E.daysBetween(r.date, t) <= 30;
    }).length;
    if (bad) c.cashiers = bad > 99 ? '99+' : bad;
    return c;
  }
  /* ==========================================================================
     РАБОЧИЙ НАБОР ЭКРАНОВ

     Экранов в программе сорок, а магазином управляют полутора десятками.
     Остальные — отчёты «на посмотреть» и товарная аналитика, которая нужна
     раз в месяц. Держать их все в меню значит каждый день пролистывать
     тридцать пунктов ради четырёх.

     Поэтому меню показывает рабочий набор, а всё остальное — за одной
     кнопкой внизу. Ничего не удалено: экран открывается и по прямой ссылке,
     и через поиск, и счётчик дел на нём считается как раньше.
     ====================================================================== */
  var MAIN_VIEWS = {
    pulse: 1, morning: 1, evening: 1, finpay: 1,            // каждый день
    ledger: 1, cashiers: 1, debtors: 1, suppliers: 1,       // деньги
    timesheet: 1, payroll: 1,                               // люди
    pnl: 1, monthclose: 1, owner: 1,                        // отчёты
    data: 1, dicts: 1, settings: 1                          // служебное
  };
  function showAll() { return E.norm(S.settings.showAllViews) === 'да'; }
  function isMain(v) { return !!MAIN_VIEWS[v.id]; }

  function renderNav() {
    var c = counters(), group = '', html = '';
    var all = showAll();
    var shown = VIEWS.filter(function (v) { return all || isMain(v) || v.id === VIEW; });
    var hidden = VIEWS.length - shown.length;

    shown.forEach(function (v) {
      if (v.group !== group) { group = v.group; html += '<div class="nav-group">' + esc(group) + '</div>'; }
      html += '<div class="nav-item' + (v.id === VIEW ? ' active' : '') + '" data-go="' + v.id + '">' +
        '<span class="nav-icon">' + v.icon + '</span><span>' + esc(v.name) + '</span>' +
        (c[v.id] ? '<span class="nav-count">' + c[v.id] + '</span>' : '') + '</div>';
    });

    // Красный кружок на скрытом экране виден и в свёрнутом виде: дело не
    // должно потеряться только потому, что экран убран из меню
    var hiddenCount = 0;
    VIEWS.forEach(function (v) { if (!all && !isMain(v) && c[v.id]) hiddenCount++; });

    if (hidden > 0) {
      html += '<div class="nav-item nav-more" data-act="views-all">' +
        '<span class="nav-icon">⋯</span><span>Показать все экраны</span>' +
        '<span class="nav-count' + (hiddenCount ? '' : ' nav-count-quiet') + '">' +
        (hiddenCount ? hiddenCount : hidden) + '</span></div>';
    } else if (all) {
      html += '<div class="nav-item nav-more" data-act="views-main">' +
        '<span class="nav-icon">⌃</span><span>Оставить только рабочие</span></div>';
    }
    $('nav').innerHTML = html;
    $('brandName').textContent = S.settings.storeName || 'Вай Маркет';
    var st = saveState();
    $('saveState').innerHTML = '<span class="saved-dot ' + st.dot + '"></span><span>' + esc(st.text) + '</span>';
    renderAlerts();
  }

  // Строка под шапкой: что горит прямо сейчас. Видна с любого экрана,
  // поэтому просроченную оплату нельзя не заметить, чем бы вы ни занимались.
  /* Строка под шапкой: что горит прямо сейчас. Видна с любого экрана. */
  function renderAlerts() {
    var bar = $('alertBar'); if (!bar) return;
    var t = today(), items = [];
    var pt = E.planTotals(S.state.plans || [], t);
    if (pt.overdue) items.push({ icon: '🔴', text: 'Просрочены выплаты на ' + money(pt.overdue),
      go: 'finpay' });
    if (pt.dueToday) items.push({ icon: '📅', text: 'Сегодня платить ' + money(pt.dueToday), go: 'finpay' });

    // смена не закрыта: за вчера нет ни одной сверки
    var yest = E.addDays(t, -1);
    var closedYest = (S.state.dds || []).some(function (r) { return E.isShift(r) && r.date === yest; });
    if (!closedYest && (S.state.dds || []).length) {
      items.push({ icon: '🧮', text: 'За ' + dateRu(yest) + ' смена не сверена', go: 'morning' });
    }
    var crit = num(S.settings.diffCrit) || 1000;
    var bad = E.shiftsOf(S.state.dds || [], null, S.settings).filter(function (r) {
      return E.daysBetween(r.date, t) <= 7 && Math.abs(E.shiftCalc(r).diff) >= crit;
    });
    if (bad.length) items.push({ icon: '⚠️', text: 'Крупные расхождения кассы: ' + bad.length +
      ' за неделю', go: 'cashiers' });
    var cash = E.cashOnHand(S.state.dds || [], S.settings);
    var limit = num(S.settings.cashLimit);
    if (limit && cash > limit) items.push({ icon: '💰', text: 'Наличных в кассе ' + money(cash) +
      ' — больше вашего порога', go: 'morning' });
    var debt = E.supplierDebt(S.state.dds || [], S.settings);
    if (num(S.settings.debtCrit) && debt.debt >= num(S.settings.debtCrit)) {
      items.push({ icon: '💼', text: 'Долг поставщикам ' + money(debt.debt), go: 'evening' });
    }
    if (!items.length) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = items.slice(0, 4).map(function (a) {
      return '<button class="alert-item" data-go="' + esc(a.go) + '"><span>' + a.icon +
        '</span><span>' + esc(a.text) + '</span></button>';
    }).join('') + '<span class="alert-cash">в кассе сейчас <b class="private">' +
      money(cash) + '</b></span>';
  }
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
    var cur = VIEWS.filter(function (x) { return x.id === VIEW; })[0];
    if (cur && cur.onDraw) { try { cur.onDraw(); } catch (e) { /* график не критичен */ } }
  }
  function go(id) { VIEW = id; PAGE = {}; render(); $('scroll').scrollTop = 0; }

  /* --- Экспорт и копии ------------------------------------------------------------- */
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
  /* Меню на телефоне. Тот же рабочий набор, что и слева на компьютере:
     листать сорок пунктов пальцем — худшее, что можно предложить человеку,
     который зашёл записать смену. */
  function openMenuSheet() {
    var c = counters(), all = showAll(), group = '', rows = [];
    var shown = VIEWS.filter(function (v) { return all || isMain(v); });
    var hidden = VIEWS.length - shown.length;

    shown.forEach(function (v) {
      if (v.group !== group) { group = v.group; rows.push('<div class="nav-group">' + esc(group) + '</div>'); }
      rows.push(listRow({ icon: v.icon, title: esc(v.name), tap: true,
        value: c[v.id] ? '<span class="nav-count">' + c[v.id] + '</span>' : '',
        attrs: ' data-go="' + v.id + '"' }));
    });

    if (hidden > 0) {
      rows.push('<div class="nav-group">Остальное</div>');
      rows.push(listRow({ icon: '⋯', title: 'Показать все экраны',
        sub: 'ещё ' + hidden + ' — отчёты и товарная аналитика', tap: true,
        attrs: ' data-act="views-all"' }));
    } else if (all) {
      rows.push('<div class="nav-group">Меню</div>');
      rows.push(listRow({ icon: '⌃', title: 'Оставить только рабочие',
        sub: 'чтобы не листать лишнее', tap: true, attrs: ' data-act="views-main"' }));
    }

    var actions = [
      listRow({ icon: '📂', title: 'Обновить из 1С', sub: 'прочитать папку с выгрузками', tap: true, attrs: ' data-act="pick-files"' }),
      listRow({ icon: '💾', title: 'Сохранить копию базы', sub: 'файл .json', tap: true, attrs: ' data-act="backup"' })
    ];
    sheet('Экраны', '<div class="list">' + rows.join('') + '</div>' +
      '<div class="nav-group">Действия</div><div class="list">' + actions.join('') + '</div>');
  }
  /* Кнопка «＋ Записать» — главный вход на телефоне. Каждый пункт здесь
     обязан открывать существующую форму: раньше девять из десяти вели в
     пустоту, потому что остались от прошлой версии программы. */
  function openAddSheet() {
    var items = [
      ['💵', 'Сверка кассы за смену', 'Z-отчёт, выплаты, факт в ящике', 'shiftClose'],
      ['🌙', 'Итоги дня', 'товар за наличные, долги поставщикам', 'dayTotals'],
      ['🧾', 'Расход', 'аренда, ЗП, ГСМ, обеды', 'moneyOut'],
      ['💰', 'Приход денег', 'прочие поступления', 'moneyIn'],
      ['🚛', 'Инкассация', 'увезли в сейф или банк', 'moveCash'],
      ['👛', 'Забрал владелец', 'деньги из оборота', 'moneyDraw'],
      ['📅', 'Выплата поставщику', 'план платежа', 'payPlan'],
      ['📓', 'Долг покупателя', 'тетрадка у кассы', 'debtor'],
      ['🧮', 'Пересчёт кассы', 'по купюрам', 'cashCount'],
      ['🗒', 'Смена в табель', 'часы, премия, удержание', 'timesheetRow'],
      ['💵', 'Выдать зарплату', 'аванс или расчёт', 'payoutRow'],
      ['👤', 'Новый сотрудник', 'карточка со ставкой', 'staffCard']
    ];
    // показываем только то, что действительно есть: если файл экрана не
    // подключён, пункт не рисуем, а не ведём владельца в пустоту
    var live = items.filter(function (i) { return !!FORMS[i[3]]; });
    sheet('Что записать?', listOf(live.map(function (i) {
      return listRow({ icon: i[0], title: esc(i[1]), sub: esc(i[2]), tap: true,
        attrs: ' data-form="' + esc(i[3]) + '"' });
    }), 'Формы ввода не подключились — переоткройте программу.'));
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
      else if (a === 'export-screen') exportScreen();
      else if (a === 'restore') restore();
      else if (a === 'print') window.print();
      else if (a === 'del-shift') {
        if (confirm('Удалить смену целиком?')) {
          el.dataset.ids.split(',').forEach(function (id) { S.remove('dds', id); });
          render();
        }
      }
      else if (a === 'conflict-theirs') {
        closeSheet(); conflictShown = false; conflictOther = null;
        F.loadSaved().then(function (data) {
          if (data) { S.replaceAll(data); recompute(); render(); toast('Взяли версию из файла.'); }
        });
      }
      else if (a === 'q-repeat') {
        /* «Повторить сегодня»: та же запись с сегодняшней датой. Открываем
           форму заполненной, а не сохраняем молча — суммы почти всегда
           надо поправить, да и молчаливая запись пугает. */
        var src2 = (S.state[el.dataset.coll] || []).filter(function (x) {
          return x.id === el.dataset.id;
        })[0];
        if (!src2) { toast('Запись не найдена — возможно, её уже удалили.'); return; }
        var form2 = el.dataset.target;
        if (!form2 || !FORMS[form2]) { toast('Для этой записи нет формы ввода.'); return; }
        var copy = JSON.parse(JSON.stringify(src2));
        delete copy.id;
        copy.date = today();
        if (copy.due) copy.due = today();
        closeRowMenu();
        openForm(form2, copy);
        toast('Дата поставлена сегодняшняя — проверьте суммы и сохраните.');
      }
      else if (a === 'views-all' || a === 'views-main') {
        var onSheet = !!document.querySelector('.sheet');
        S.setSetting('showAllViews', a === 'views-all' ? 'да' : 'нет');
        renderNav();
        if (onSheet) { closeSheet(); openMenuSheet(); }
        toast(a === 'views-all'
          ? 'Показаны все ' + VIEWS.length + ' экранов. Свернуть обратно — кнопка внизу меню.'
          : 'В меню остались рабочие экраны. Остальные — за кнопкой «Показать все».');
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
      else if (a === 'settings-wizard') openForm('setupWizard');
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
    var startMap = { 'пульт': 'pulse', 'сегодня': 'pulse', 'утро': 'morning',
      'вечер': 'evening', 'план выплат': 'finpay', 'база операций': 'ledger' };
    var periodMap = { 'сегодня': 'today', 'неделя': 'week', 'месяц': 'month', 'квартал': 'quarter', 'все': 'all' };
    var sv = startMap[E.norm(S.settings.startView)];
    if (sv) VIEW = sv;
    var pd = periodMap[E.norm(S.settings.defaultPeriod)];
    if (pd) PERIOD = pd;

    recompute(); bind(); render();

    // сохранение в файл: подписываемся на любые изменения журналов
    S.onChange(function () {
      F.scheduleSave(function () { return S.state; });
      scheduleBook();
    });
    /* Окно закрывают или прячут — дописываем файл немедленно, не дожидаясь
       задержки. Сама база к этому моменту уже в localStorage: он пишется
       синхронно, в той же строке, где владелец нажал «Сохранить». */
    F.bindLifecycle(function () { return S.state; });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'hidden') return;
      if (bookTimer) { clearTimeout(bookTimer); bookTimer = null;
        try { F.saveBook(bookBytes()); } catch (e) { /* книга не должна мешать */ } }
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
      /* Сверка при запуске. Раньше здесь стояло безусловное «взять файл», и
         запись, сделанная за секунду до закрытия окна, пропадала: файл ещё
         не успевал записаться, а localStorage затирался его старым
         содержимым. Теперь сравниваем отпечатки и берём то, что новее. */
      var saved = await F.loadSaved();
      var cmp = S.compare(saved);
      if (saved && cmp.verdict === 'file') {
        S.replaceAll(saved);
      } else if (saved && cmp.verdict === 'local') {
        // в браузере свежее — не трогаем базу, а дописываем файл
        await F.flushNow(function () { return S.state; });
        if (cmp.onlyMine) {
          setTimeout(function () {
            toast('Восстановлено ' + nf(cmp.onlyMine) + ' ' +
              plural(cmp.onlyMine, 'запись', 'записи', 'записей') +
              ': в файл они попасть не успели, программу закрыли слишком быстро. ' +
              'Сейчас всё на месте и записано в папку.', 11000);
          }, 1200);
        }
      } else if (saved && cmp.verdict === 'ask') {
        // и в браузере, и в файле есть своё — это две вкладки или два
        // компьютера. Молча выбирать нельзя, пропадёт чужая работа.
        conflictAsk({ text: JSON.stringify({ data: saved }), data: saved,
          onlyMine: cmp.onlyMine, onlyTheirs: cmp.onlyTheirs });
      }
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
