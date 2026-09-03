/* ============================================================================
   Фильтры для любого экрана.
   Один набор кнопок работает одинаково везде: выбрали «Просрочено» — в таблице
   остались только просроченные, итоги под таблицей пересчитались.

   Как пользоваться из экрана:
     var defs = [
       { key: 'status', name: 'Состояние', options: [
           { v: 'debt', name: 'В долг', test: function (r) { return r.left > 0; } } ] },
       { key: 'firm', name: 'Поставщик', auto: function (r) { return r.firm; } }
     ];
     h += WMFilter.bar('suppliers', defs, rows);       // кнопки
     var rows2 = WMFilter.apply('suppliers', rows, defs);

   «auto» строит список кнопок сам из данных (самые частые значения),
   «options» задаёт кнопки вручную. Выбор хранится по экрану и не теряется
   при перерисовке.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMFilter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATE = {};             // { screenId: { key: value } }
  var TEXT = {};              // { screenId: 'строка поиска' }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/ё/g, 'е'); }
  function nf(n) { return Math.round(n).toLocaleString('ru-RU'); }

  function bag(id) { if (!STATE[id]) STATE[id] = {}; return STATE[id]; }

  /* --- Чтение и запись выбора ---------------------------------------------- */
  function get(id, key) { return bag(id)[key] || ''; }
  function set(id, key, value) {
    var b = bag(id);
    if (b[key] === value) delete b[key];      // повторное нажатие снимает фильтр
    else b[key] = value;
  }
  function setText(id, v) { TEXT[id] = String(v || ''); }
  function text(id) { return TEXT[id] || ''; }
  function clear(id) { STATE[id] = {}; TEXT[id] = ''; }
  function clearAll() { STATE = {}; TEXT = {}; }
  function active(id) {
    var b = bag(id), n = 0, k;
    for (k in b) if (b[k]) n++;
    if (text(id)) n++;
    return n;
  }

  /* --- Список кнопок по данным --------------------------------------------- */
  // Самые частые значения поля: показываем не больше limit кнопок,
  // иначе панель фильтров превращается в простыню
  function autoOptions(rows, getter, limit) {
    var map = {}, i, v, k;
    for (i = 0; i < rows.length; i++) {
      v = getter(rows[i]);
      if (v == null || v === '') continue;
      k = norm(v);
      if (!map[k]) map[k] = { v: String(v), n: 0 };
      map[k].n++;
    }
    var out = [];
    for (k in map) out.push(map[k]);
    out.sort(function (a, b) { return b.n - a.n || a.v.localeCompare(b.v, 'ru'); });
    return out.slice(0, limit || 12).map(function (o) {
      return { v: o.v, name: o.v, count: o.n };
    });
  }

  // Готовые наборы кнопок для каждого определения фильтра
  function optionsOf(def, rows) {
    if (def.options) {
      return def.options.map(function (o) {
        var n = 0;
        if (rows && o.test) for (var i = 0; i < rows.length; i++) if (o.test(rows[i])) n++;
        return { v: o.v, name: o.name, count: o.test ? n : undefined };
      });
    }
    if (def.auto) return autoOptions(rows || [], def.auto, def.limit);
    return [];
  }

  /* --- Проверка строки ------------------------------------------------------ */
  function pass(def, value, row) {
    if (def.options) {
      for (var i = 0; i < def.options.length; i++) {
        if (def.options[i].v === value) return def.options[i].test ? !!def.options[i].test(row) : true;
      }
      return true;                       // выбранной кнопки больше нет — не фильтруем
    }
    if (def.auto) return norm(def.auto(row)) === norm(value);
    return true;
  }

  // Отфильтровать строки по выбранным кнопкам и строке поиска
  function apply(id, rows, defs, searchFn) {
    var b = bag(id), q = norm(text(id));
    var out = (rows || []).filter(function (r) {
      for (var i = 0; i < defs.length; i++) {
        var v = b[defs[i].key];
        if (v && !pass(defs[i], v, r)) return false;
      }
      return true;
    });
    if (q && searchFn) out = out.filter(function (r) { return norm(searchFn(r)).indexOf(q) >= 0; });
    return out;
  }

  /* --- Рисование ------------------------------------------------------------ */
  function bar(id, defs, rows, opts) {
    opts = opts || {};
    var b = bag(id), h = '', any = active(id);
    defs.forEach(function (def) {
      var list = optionsOf(def, rows);
      if (!list.length) return;
      h += '<div class="filter-line"><span class="filter-name">' + esc(def.name) + '</span>' +
        '<div class="chips">' +
        '<button class="chip' + (b[def.key] ? '' : ' active') + '" data-filter="' +
          esc(id) + '|' + esc(def.key) + '|">Все</button>';
      list.forEach(function (o) {
        h += '<button class="chip' + (norm(b[def.key]) === norm(o.v) ? ' active' : '') + '" data-filter="' +
          esc(id) + '|' + esc(def.key) + '|' + esc(o.v) + '">' + esc(o.name) +
          (o.count !== undefined ? ' <small>' + nf(o.count) + '</small>' : '') + '</button>';
      });
      h += '</div></div>';
    });
    if (opts.search) {
      h += '<div class="filter-line"><span class="filter-name">Поиск</span>' +
        '<input class="filter-input" type="search" data-filter-text="' + esc(id) + '" value="' +
        esc(text(id)) + '" placeholder="' + esc(opts.search) + '"></div>';
    }
    if (!h) return '';
    var head = '<div class="filter-head"><span>Фильтры' + (any ? ' · выбрано ' + any : '') + '</span>' +
      (any ? '<button class="btn btn-sm" data-filter-clear="' + esc(id) + '">Сбросить</button>' : '') + '</div>';
    return '<div class="filters">' + head + h + '</div>';
  }

  // Строка «показано N из M» — чтобы фильтр не обманывал глаз
  function note(shown, total, extraHtml) {
    if (shown === total) return extraHtml || '';
    return '<div class="filter-note">Показано ' + nf(shown) + ' из ' + nf(total) +
      (extraHtml ? ' · ' + extraHtml : '') + '</div>';
  }

  return {
    get: get, set: set, text: text, setText: setText, clear: clear, clearAll: clearAll,
    active: active, apply: apply, bar: bar, note: note,
    autoOptions: autoOptions, optionsOf: optionsOf, norm: norm
  };
});
