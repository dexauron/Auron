/* ============================================================================
   Ввод: разбор строки, буфер записи, массовый ввод таблицей, отмена.

   27 — недописанная форма возвращается после закрытия программы;
   28 — запись копируется и вставляется в другую форму;
   29 — массовый ввод: таблица прямо на экране вместо формы на каждую строку;
   31 — «аренда 168000 переводом» одной строкой без полей;
   35 — Ctrl+Z отменяет последнее действие;
   44 — у каждой строки кнопка «⋮» со всеми действиями сразу.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMEntry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/ё/g, 'е'); }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function addDays(d, n) {
    var x = new Date(d || today()); x.setDate(x.getDate() + n);
    return x.toISOString().slice(0, 10);
  }

  /* --- 31. Разбор строки «аренда 168000 переводом» ---------------------------
     Владелец пишет как думает, программа раскладывает по полям. Ничего не
     угадывает молча: что поняла — показывает, остальное оставляет пустым.
     ---------------------------------------------------------------------- */
  // Слова сверяем целиком, слово за словом: «комму-нал-ка» не должна
  // становиться «наличными», а «карт-ошка» — «картой»
  var RU = '[а-яё]';        // в JS «\\w» кириллицу буквой не считает — пишем явно
  var METHOD_WORDS = [
    { value: 'Перевод', words: [/^переводом?$/, /^безнал[а-яё]*$/, /^расчетн[а-яё]+$/, /^р\/с$/] },
    { value: 'Карта', words: [/^карт(а|ой|ы)?$/, /^терминал[а-яё]*$/, /^эквайринг[а-яё]*$/] },
    { value: 'Наличные', words: [/^наличн[а-яё]*$/, /^налом$/, /^нал$/, /^кассой$/] }
  ];
  var TYPE_WORDS = [
    { value: 'Приход', words: [/^приход[а-яё]*$/, /^поступил[а-яё]*$/, /^внес[а-яё]*$/,
      /^получил[а-яё]*$/, /^выручк[а-яё]*$/] },
    { value: 'Долг', words: [/^долг$/, /^отсрочк[а-яё]*$/, /^вдолг$/] },
    { value: 'Забор', words: [/^забор$/, /^забрал$/, /^вывел$/] }
  ];
  var DAY_WORDS = [
    { re: /позавчера/i, days: -2 }, { re: /вчера/i, days: -1 },
    { re: /сегодня/i, days: 0 }, { re: /завтра/i, days: 1 }
  ];
  var MONTHS = ['январ', 'феврал', 'март', 'апрел', 'мая|май', 'июн', 'июл',
    'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

  // «12.09» и «12 сентября» → 2026-09-12
  function grabDate(text) {
    var m = text.match(/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/);
    if (m) {
      var y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : today().slice(0, 4);
      var d = ('0' + m[1]).slice(-2), mo = ('0' + m[2]).slice(-2);
      if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) {
        return { date: y + '-' + mo + '-' + d, cut: m[0] };
      }
    }
    for (var i = 0; i < DAY_WORDS.length; i++) {
      var w = text.match(DAY_WORDS[i].re);
      if (w) return { date: addDays(today(), DAY_WORDS[i].days), cut: w[0] };
    }
    for (var k = 0; k < MONTHS.length; k++) {
      var mm = text.match(new RegExp('(\\d{1,2})\\s+(' + MONTHS[k] + ')\\w*', 'i'));
      if (mm) {
        return { date: today().slice(0, 4) + '-' + ('0' + (k + 1)).slice(-2) + '-' + ('0' + mm[1]).slice(-2),
          cut: mm[0] };
      }
    }
    return null;
  }

  // Сумма: самое крупное число строки. «5 тыс» и «5к» — это 5 000.
  function grabAmount(text) {
    var best = null;
    var re = /(\d[\d\s]{0,12}(?:[.,]\d{1,2})?)\s*(тыс\w*|т\.?р\.?|к|руб\w*|р\.?|₽)?/gi, m;
    while ((m = re.exec(text))) {
      var v = num(m[1]);
      if (!v) continue;
      var unit = (m[2] || '').toLowerCase();
      if (/^(тыс|т\.?р|к$)/.test(unit)) v *= 1000;
      if (!best || v > best.value) best = { value: v, cut: m[0].trim() };
    }
    return best;
  }

  function pick(list, text) {
    for (var i = 0; i < list.length; i++) if (list[i].re.test(text)) return list[i];
    return null;
  }

  // Главная: строка → поля. dicts — справочники (категории, поставщики…).
  // Разбираем по словам, а не регулярками по всей строке: так «коммуналка»
  // не превращается в «наличные», а «картой» не съедает соседнее число.
  function parseLine(text, dicts) {
    dicts = dicts || {};
    var src = String(text || '').trim();
    if (!src) return null;
    var out = { date: today(), type: 'Расход' }, got = [];

    // 1. дата — вырезаем из строки целиком, вместе со словом «вчера»
    var rest = src;
    var d = grabDate(rest);
    if (d) { out.date = d.date; rest = rest.replace(d.cut, ' '); got.push('дата'); }

    // 2. режем на слова и разбираем каждое.
    // «1 250,50» — это одна сумма, а не «1» и «250,50»: склеиваем разряды
    rest = rest.replace(/(\d)\s+(?=\d{3}(?!\d))/g, '$1');
    var words = rest.replace(/[^\wа-яА-ЯёЁ.,\/-]+/g, ' ').split(/\s+/).filter(Boolean);
    var used = new Array(words.length);
    var amount = null;

    // «тыс», «т.р.», «к» — тысячи; «руб», «р», «₽» — просто рубли
    function unitMult(w) {
      var n = norm(w).replace(/[.\s]/g, '');
      if (/^(тыс[а-яё]*|тр|к)$/.test(n)) return 1000;
      if (/^(руб[а-яё]*|р|₽)$/.test(n)) return 1;
      return 0;
    }

    for (var i = 0; i < words.length; i++) {
      var w = words[i], n = norm(w);
      // число — возможная сумма; следующее слово может оказаться «тыс» или «к»
      var bare = w.replace(/[₽]/g, '').replace(',', '.');
      if (/^\d+(\.\d+)?$/.test(bare)) {
        var v = num(bare);
        var next = words[i + 1] || '';
        // «5 тыс» и «5к»: множитель отдельным словом или слипшийся с числом
        var mult = unitMult(next);
        if (mult) { v *= mult; used[i + 1] = true; }
        if (!amount || v > amount.value) amount = { value: v, at: i };
        used[i] = true;
        continue;
      }
      var glued = w.match(/^(\d+(?:[.,]\d+)?)([а-яё.]+|₽)$/i);
      if (glued) {
        var gm = unitMult(glued[2]);
        if (gm) {
          var gv = num(glued[1]) * gm;
          if (!amount || gv > amount.value) amount = { value: gv, at: i };
          used[i] = true;
          continue;
        }
      }
      // способ оплаты и тип операции — по целому слову
      var meth = pickWord(METHOD_WORDS, n);
      if (meth && !out.method) { out.method = meth; used[i] = true; got.push('способ'); continue; }
      var typ = pickWord(TYPE_WORDS, n);
      if (typ && typ !== 'Расход') { out.type = typ; used[i] = true; got.push('тип'); continue; }
    }
    if (amount) { out.amount = amount.value; got.push('сумма'); }

    // 3. что осталось — ищем в справочниках
    var left = words.filter(function (w, i) { return !used[i]; });
    var hay = ' ' + norm(left.join(' ')) + ' ';
    function findIn(list) {
      var best = null;
      (list || []).forEach(function (v) {
        var n2 = norm(v);
        if (n2.length < 2) return;
        var hit = hay.indexOf(' ' + n2 + ' ') >= 0 || hay.indexOf(' ' + n2) >= 0;
        if (!hit && n2.length >= 4) {
          var st = stem(v);
          hit = st.length >= 4 && hay.indexOf(' ' + st) >= 0;
        }
        if (hit && (!best || n2.length > norm(best).length)) best = v;
      });
      return best;
    }
    var cat = findIn(dicts.categories);
    if (cat) { out.category = cat; got.push('статья'); }
    var sup = findIn(dicts.suppliers);
    if (sup) { out.supplier = sup; got.push('поставщик'); }
    var emp = findIn(dicts.employees);
    if (emp) { out.employee = emp; got.push('сотрудник'); }

    // 4. остаток — в комментарий, чтобы ничего не потерялось
    var noteText = ' ' + left.join(' ') + ' ';
    [cat, sup, emp].forEach(function (v) {
      if (!v) return;
      // убираем и целиком («Молоко Юг»), и по каждому слову с окончанием
      var whole = new RegExp('\\s' + norm(v).split(/\s+/).join('\\s+') + '[а-яё]*\\s', 'i');
      noteText = noteText.replace(whole, ' ');
      norm(v).split(/\s+/).forEach(function (part) {
        if (part.length < 3) return;
        noteText = noteText.replace(new RegExp('\\s' + stem(part) + '[а-яё]*\\s', 'ig'), ' ');
      });
    });
    // предлоги сами по себе смысла не несут
    var note = noteText.split(/\s+/).filter(function (w) {
      return w && !/^(в|на|за|из|от|по|для|и|с|у)$/i.test(norm(w));
    }).join(' ').trim();
    if (note.length > 2) out.note = note;
    if (!out.category && note.length > 2) out.category = note.charAt(0).toUpperCase() + note.slice(1);

    out.__got = got;
    out.__ok = !!out.amount;
    return out;
  }

  function stem(v) { return norm(v).replace(/(ой|ей|ам|ям|ом|ем|ы|и|а|я|у|ю|е)$/, ''); }
  function pickWord(list, word) {
    for (var i = 0; i < list.length; i++) {
      for (var j = 0; j < list[i].words.length; j++) {
        if (list[i].words[j].test(word)) return list[i].value;
      }
    }
    return null;
  }

  // Куда такая строка ложится: приход, расход, долг или забор
  function formFor(parsed) {
    if (!parsed) return 'ddsExpense';
    if (parsed.type === 'Приход') return 'ddsIncome';
    if (parsed.type === 'Забор') return 'ownerDraw';
    return 'ddsExpense';
  }

  /* --- 29. Массовый ввод таблицей --------------------------------------------
     Строка = запись. Пустые строки пропускаем, кривые показываем красным
     и не сохраняем, пока владелец не поправит.
     ---------------------------------------------------------------------- */
  function parseBulk(lines, dicts) {
    return String(lines || '').split('\n').map(function (line, i) {
      var s = line.trim();
      if (!s) return null;
      var p = parseLine(s, dicts);
      return { no: i + 1, raw: s, parsed: p, ok: !!(p && p.__ok),
        why: p && p.__ok ? '' : 'не нашлась сумма' };
    }).filter(Boolean);
  }

  /* --- 28. Буфер: копировать запись и вставить в другую форму ---------------- */
  var CLIP = null;
  function copy(rec, from) {
    if (!rec) return null;
    var v = {};
    Object.keys(rec).forEach(function (k) {
      if (k === 'id' || k === 'key' || k.charAt(0) === '_') return;
      if (rec[k] !== '' && rec[k] != null && typeof rec[k] !== 'object') v[k] = rec[k];
    });
    CLIP = { values: v, from: from || '', at: Date.now() };
    return CLIP;
  }
  function clip() { return CLIP; }
  function clearClip() { CLIP = null; }

  /* --- 35. Отмена последнего действия ---------------------------------------- */
  // Последнее записанное в журнал действие, которое можно отменить
  function lastUndoable(log) {
    var rows = log || [];
    for (var i = rows.length - 1; i >= 0; i--) {
      if (!rows[i].undone && rows[i].before) return rows[i];
    }
    return null;
  }

  /* --- 44. Меню действий у строки -------------------------------------------- */
  // Одинаковый набор действий для любой записи: смотреть, править, повторить,
  // копировать, удалить. Экран добавляет своё через extra.
  function rowMenu(o) {
    var acts = [];
    if (o.more) acts.push({ act: 'more', kind: o.more.kind, key: o.more.key, icon: '👁', name: 'Подробнее' });
    if (o.form) acts.push({ act: 'edit', icon: '✎', name: 'Изменить' });
    if (o.form) acts.push({ act: 'repeat', icon: '↻', name: 'Повторить сегодня' });
    acts.push({ act: 'copy', icon: '⧉', name: 'Копировать' });
    if (o.extra) acts = acts.concat(o.extra);
    acts.push({ act: 'del', icon: '🗑', name: 'Удалить', danger: true });
    return acts;
  }

  return {
    parseLine: parseLine, parseBulk: parseBulk, formFor: formFor,
    copy: copy, clip: clip, clearClip: clearClip,
    lastUndoable: lastUndoable, rowMenu: rowMenu,
    grabDate: grabDate, grabAmount: grabAmount
  };
});
