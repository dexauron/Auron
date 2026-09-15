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
  var SETS = null;            // откуда брать сохранённые наборы («мой понедельник»)

  /* Значки приходят снаружи, как и наборы: файл фильтров ни от чего не зависит
     и работает даже без них. Раньше ic() здесь просто вызывался, хотя нигде не
     был определён, — и экран падал, как только фильтр становился активным. */
  var ICON = function () { return ''; };
  function useIcons(fn) { ICON = typeof fn === 'function' ? fn : function () { return ''; }; }
  function ic(name, size) { return ICON(name, size); }

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

  /* --- 116. Сохранённые наборы фильтров -------------------------------------
     Владелец каждый понедельник ставит одни и те же три фильтра. Пусть
     поставит один раз, назовёт «мой понедельник» и дальше жмёт одну кнопку.
     Сам список наборов хранит программа (js/ui.js) — сюда он приходит
     готовым, чтобы файл фильтров ни от чего не зависел.
     ---------------------------------------------------------------------- */
  function snapshot(id) {
    var b = bag(id), out = {};
    for (var k in b) if (b[k]) out[k] = b[k];
    return { state: out, text: text(id) };
  }
  function restore(id, snap) {
    snap = snap || {};
    STATE[id] = {};
    var st = snap.state || {};
    for (var k in st) STATE[id][k] = st[k];
    TEXT[id] = snap.text || '';
  }
  // ui.js передаёт сюда функцию, которая по экрану отдаёт список наборов
  function useSets(fn) { SETS = typeof fn === 'function' ? fn : null; }
  function sameAs(id, snap) {
    var a = snapshot(id), b = snap || {};
    if ((a.text || '') !== (b.text || '')) return false;
    var x = a.state, y = b.state || {}, k;
    for (k in x) if (norm(x[k]) !== norm(y[k])) return false;
    for (k in y) if (norm(x[k] || '') !== norm(y[k])) return false;
    return true;
  }

  /* ==========================================================================
     УМНЫЙ ПОИСК — как в браузере

     Раньше поиск искал строку целиком: «моло 3.2» не находило «Молоко 3.2%»,
     потому что в названии между словами стоит пробел, а не то, что набрали.
     Владелец при этом решает, что товара нет.

     Теперь набранное разбирается на части, и строка подходит, если подходят
     ВСЕ части. Порядок слов значения не имеет.

       молоко 3.2      — оба куска, в любом порядке и в любом месте строки
       "молоко 3.2"    — в кавычках: ровно эта фраза подряд
       -козье          — минус: строки с этим словом убрать
       >1000           — число больше 1000 (по любому числу строки)
       <50  >=10  <=5  — так же
       =0              — ровно ноль: чем удобно искать «ничего не продалось»

     Числовые части сравниваются с числами строки — их даёт экран
     (numsFn). Не дал — числовые части просто никого не отсеивают.
     ---------------------------------------------------------------------- */
  function parseQuery(q) {
    var parts = [], m;
    var src = String(q == null ? '' : q);
    // Сначала выкусываем фразы в кавычках — внутри них пробел значим
    var re = /"([^"]*)"|(\S+)/g;
    while ((m = re.exec(src))) {
      if (m[1] !== undefined) {
        var phrase = norm(m[1]);
        if (phrase) parts.push({ kind: 'phrase', text: phrase });
        continue;
      }
      var w = m[2];
      var neg = false;
      if (w.charAt(0) === '-' && w.length > 1 && !/^-\d/.test(w)) { neg = true; w = w.slice(1); }

      var num = w.match(/^(>=|<=|>|<|=)(-?[\d\s.,]+)$/);
      if (num) {
        var v = parseFloat(String(num[2]).replace(/\s/g, '').replace(',', '.'));
        if (!isNaN(v)) { parts.push({ kind: 'num', op: num[1], value: v, neg: neg }); continue; }
      }
      var t = norm(w);
      if (t) parts.push({ kind: 'word', text: t, neg: neg });
    }
    return parts;
  }

  function numOk(op, a, b) {
    if (op === '>') return a > b;
    if (op === '<') return a < b;
    if (op === '>=') return a >= b;
    if (op === '<=') return a <= b;
    return Math.abs(a - b) < 0.0001;         // '='
  }

  /* Подходит ли строка. haystack — всё, что у строки можно прочитать словами;
     nums — числа строки (суммы, количества), если экран их дал. */
  function matches(parts, haystack, nums) {
    var hay = norm(haystack);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], ok;
      if (p.kind === 'num') {
        ok = false;
        for (var j = 0; nums && j < nums.length; j++) {
          if (numOk(p.op, Number(nums[j]), p.value)) { ok = true; break; }
        }
        // Экран чисел не дал — числовая часть никого не отсеивает
        if (!nums || !nums.length) ok = !p.neg;
      } else {
        ok = hay.indexOf(p.text) >= 0;
      }
      if (p.neg ? ok : !ok) return false;
    }
    return true;
  }

  /* Подсветка найденного — чтобы глаз сразу видел, за что зацепилось.
     Работает по уже экранированному тексту, поэтому теги не ломаются. */
  function highlight(value, q) {
    var safe = esc(value);
    var parts = parseQuery(q).filter(function (p) {
      return (p.kind === 'word' || p.kind === 'phrase') && !p.neg && p.text.length > 1;
    });
    if (!parts.length) return safe;
    // Ищем по нормализованной копии, а режем по исходной — длины совпадают,
    // потому что norm только меняет регистр и ё на е, но не длину строки
    var low = norm(safe), marks = [];
    parts.forEach(function (p) {
      var from = 0, at;
      while ((at = low.indexOf(p.text, from)) >= 0) {
        marks.push([at, at + p.text.length]);
        from = at + p.text.length;
      }
    });
    if (!marks.length) return safe;
    marks.sort(function (a, b) { return a[0] - b[0]; });
    var out = '', pos = 0;
    marks.forEach(function (mk) {
      if (mk[0] < pos) { if (mk[1] > pos) pos = pos; return; }   // пересечения пропускаем
      out += safe.slice(pos, mk[0]) + '<mark>' + safe.slice(mk[0], mk[1]) + '</mark>';
      pos = mk[1];
    });
    return out + safe.slice(pos);
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

  /* Отфильтровать строки по выбранным кнопкам и строке поиска.
     searchFn(r) — что у строки читать словами.
     numsFn(r)   — какие числа строки сравнивать с «>1000» и подобным.  */
  function apply(id, rows, defs, searchFn, numsFn) {
    var b = bag(id), q = text(id);
    var out = (rows || []).filter(function (r) {
      for (var i = 0; i < defs.length; i++) {
        var v = b[defs[i].key];
        if (v && !pass(defs[i], v, r)) return false;
      }
      return true;
    });
    if (q && searchFn) {
      var parts = parseQuery(q);
      if (parts.length) {
        out = out.filter(function (r) {
          return matches(parts, searchFn(r), numsFn ? numsFn(r) : null);
        });
      }
    }
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
      /* Подсказка про то, что поиск умеет больше, чем кажется. Без неё про
         «-козье» и «>1000» никто не узнает: догадаться неоткуда. */
      h += '<div class="filter-line"><span class="filter-name">Поиск</span>' +
        '<input class="filter-input" type="search" data-filter-text="' + esc(id) + '" value="' +
        esc(text(id)) + '" placeholder="' + esc(opts.search) + '">' +
        '<span class="search-tip" title="Слова можно писать в любом порядке и кусками. ' +
        'Минус убирает: молоко -козье. Кавычки ищут фразу целиком. ' +
        'Больше и меньше ищут по числам: &gt;1000, &lt;10, =0.">' +
        'моло 3.2 · -козье · &quot;ровно так&quot; · &gt;1000</span></div>';
    }
    if (!h) return '';
    // Сохранённые наборы — своя строка кнопок над остальными.
    // Кнопка «запомнить» живёт в шапке, а не среди кнопок-фильтров: она не
    // фильтрует, а сохраняет, и путать их нельзя.
    var saved = SETS ? (SETS(id) || []) : [];
    if (saved.length) {
      var line = '<div class="filter-line"><span class="filter-name">Мои наборы</span><div class="chips">';
      saved.forEach(function (st) {
        line += '<button class="chip' + (sameAs(id, st) ? ' active' : '') +
          '" data-filterset="' + esc(id) + '|' + esc(st.id) + '">' + ic('star') + ' ' + esc(st.name) +
          '<small data-filterset-del="' + esc(st.id) + '" title="Убрать набор">' + ic('close') + '</small></button>';
      });
      h = line + '</div></div>' + h;
    }
    var head = '<div class="filter-head"><span>Фильтры' + (any ? ' · выбрано ' + any : '') + '</span>' +
      '<span class="filter-acts">' +
      (any && SETS ? '<button class="btn btn-sm" data-filterset-save="' + esc(id) +
        '">' + ic('star') + ' Запомнить набор</button> ' : '') +
      (any ? '<button class="btn btn-sm" data-filter-clear="' + esc(id) + '">Сбросить</button>' : '') +
      '</span></div>';
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
    snapshot: snapshot, restore: restore, useSets: useSets, useIcons: useIcons, sameAs: sameAs,
    autoOptions: autoOptions, optionsOf: optionsOf, norm: norm,
    parseQuery: parseQuery, matches: matches, highlight: highlight
  };
});
