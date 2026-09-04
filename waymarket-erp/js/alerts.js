/* ============================================================================
   Что горит прямо сейчас — строка под шапкой, видная с любого экрана.

   Владельцу не нужно заходить на экран «Сегодня», чтобы узнать, что три
   накладные просрочены, смена не закрыта, а в кассе лежит больше денег,
   чем он разрешил. Всё это считается здесь и складывается в одну строку.

   Каждая тревога знает: насколько срочно (red / warn / info), куда вести
   по нажатию и как объясняется человеку.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMAlerts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/ё/g, 'е'); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function addDays(d, n) {
    var x = new Date(d || today()); x.setDate(x.getDate() + n);
    return x.toISOString().slice(0, 10);
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  /* --- Сколько денег в кассе прямо сейчас ------------------------------------
     Не «на конец последнего дня», а с учётом всего, что уже записано сегодня.
     Отдельно показываем, сколько наличных ждёт инкассации.
     ---------------------------------------------------------------------- */
  function cashNow(state, settings, FIN) {
    var rows = state.dds || [];
    var open = {
      cash: num(settings.openCashStart), card: num(settings.openCardStart),
      transfer: num(settings.openTransferStart)
    };
    var bal = FIN.balances(rows, open);
    var t = today();
    var todayRows = rows.filter(function (r) { return r.date === t; });
    var tt = FIN.totals(todayRows);
    return {
      cash: bal.map['Наличные'] || 0,
      card: bal.map['Карта'] || 0,
      transfer: bal.map['Перевод'] || 0,
      total: bal.total,
      todayIn: tt.income, todayOut: tt.expense,
      limit: num(settings.cashLimit)
    };
  }

  /* --- Смена не закрыта ------------------------------------------------------ */
  function shiftMissing(state, settings) {
    var t = today();
    var hour = new Date().getHours();
    var after = num(settings.shiftRemindHour) || 22;
    var has = (state.dds || []).some(function (r) {
      return r.date === t && norm(r.type) === 'приход' && (r.shift || r.cashier);
    });
    if (has || hour < after) return null;
    return { hour: after };
  }

  /* --- Сумма накладной сильно выше обычной для этой фирмы --------------------
     Считаем обычную сумму как медиану прошлых накладных: одна случайная
     крупная поставка не сдвигает норму, а вот опечатка в нуле — видна.
     ---------------------------------------------------------------------- */
  function median(list) {
    if (!list.length) return 0;
    var s = list.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function oddDocs(docs, settings) {
    var times = num(settings.docOddTimes) || 5;   // во сколько раз выше обычного
    var byFirm = {};
    (docs || []).forEach(function (d) {
      var k = norm(d.firm);
      if (!k || !d.sum) return;
      (byFirm[k] = byFirm[k] || []).push(d);
    });
    var out = [];
    Object.keys(byFirm).forEach(function (k) {
      var list = byFirm[k];
      if (list.length < 5) return;                 // мало данных — не судим
      var med = median(list.map(function (d) { return d.sum; }));
      if (med <= 0) return;
      list.forEach(function (d) {
        if (d.sum >= med * times) {
          out.push({ id: d.id, doc: d.doc, firm: d.firm, date: d.date, sum: d.sum,
            usual: Math.round(med), times: Math.round(d.sum / med * 10) / 10 });
        }
      });
    });
    return out.sort(function (a, b) { return b.sum - a.sum; });
  }

  /* --- Проверка базы: что в ней сломано --------------------------------------
     Запускается при старте. Не чинит молча — показывает список и предлагает.
     ---------------------------------------------------------------------- */
  function checkBase(state) {
    var out = [];
    function add(kind, text, coll, ids) {
      out.push({ kind: kind, text: text, coll: coll, ids: ids, count: ids.length });
    }
    var noFirm = (state.docs || []).filter(function (d) { return !String(d.firm || '').trim(); });
    if (noFirm.length) add('docs-no-firm', 'накладные без поставщика', 'docs', noFirm.map(function (d) { return d.id; }));

    var noDate = (state.docs || []).concat(state.pays || [])
      .filter(function (r) { return !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')); });
    if (noDate.length) add('no-date', 'документы без даты', '', noDate.map(function (r) { return r.id; }));

    var zero = (state.docs || []).filter(function (d) { return !num(d.sum); });
    if (zero.length) add('docs-zero', 'накладные с нулевой суммой', 'docs', zero.map(function (d) { return d.id; }));

    var future = (state.dds || []).filter(function (r) { return r.date > today(); });
    if (future.length) add('dds-future', 'записи о деньгах с будущей датой', 'dds', future.map(function (r) { return r.id; }));

    // дубли документов по номеру — один и тот же ПФ дважды
    var seen = {}, dup = [];
    (state.docs || []).forEach(function (d) {
      var k = norm(d.key || d.doc);
      if (!k) return;
      if (seen[k]) dup.push(d.id); else seen[k] = 1;
    });
    if (dup.length) add('docs-dup', 'накладные с одинаковым номером', 'docs', dup);

    var noName = (state.supreg || []).filter(function (f) { return !String(f.name || '').trim(); });
    if (noName.length) add('firm-no-name', 'фирмы без названия', 'supreg', noName.map(function (f) { return f.id; }));

    return out;
  }

  /* --- Всё вместе: строка тревог --------------------------------------------- */
  function build(ctx) {
    var state = ctx.state, settings = ctx.settings, sup = ctx.sup, FIN = ctx.FIN;
    var items = [], t = today();
    var docs = (sup && sup.docs) || [];

    var overdue = docs.filter(function (d) { return d.overdue; });
    if (overdue.length) {
      items.push({ level: 'red', icon: '🔴',
        text: 'просрочено ' + overdue.length + ' ' + plural(overdue.length, 'накладная', 'накладные', 'накладных'),
        money: overdue.reduce(function (a, d) { return a + d.left; }, 0), go: 'suppliers' });
    }
    var dueToday = docs.filter(function (d) { return d.dueToday; });
    if (dueToday.length) {
      items.push({ level: 'warn', icon: '📅', text: 'платить сегодня: ' + dueToday.length,
        money: dueToday.reduce(function (a, d) { return a + d.left; }, 0), go: 'finpay' });
    }
    // завтрашние выплаты: чтобы деньги были готовы заранее
    var tom = addDays(t, 1);
    var dueTom = docs.filter(function (d) { return d.confirmed && d.left > 0 && d.due === tom; });
    if (dueTom.length) {
      items.push({ level: 'info', icon: '⏰', text: 'завтра платить: ' + dueTom.length,
        money: dueTom.reduce(function (a, d) { return a + d.left; }, 0), go: 'finpay' });
    }
    var sh = shiftMissing(state, settings);
    if (sh) {
      items.push({ level: 'warn', icon: '💵', text: 'смена за сегодня не закрыта', go: 'cash', form: 'cashShift' });
    }
    var cash = cashNow(state, settings, FIN);
    if (cash.limit > 0 && cash.cash > cash.limit) {
      items.push({ level: 'warn', icon: '🏦', text: 'в кассе больше порога',
        money: cash.cash, go: 'cash' });
    }
    var debtors = (sup && sup.debtors) || null;
    if (debtors && debtors.old > 0) {
      items.push({ level: 'info', icon: '📓', text: 'старые долги покупателей',
        money: debtors.old, go: 'debtors' });
    }
    var odd = oddDocs(docs, settings);
    if (odd.length) {
      items.push({ level: 'warn', icon: '❓', text: odd.length + ' ' +
        plural(odd.length, 'накладная сильно дороже обычной', 'накладные сильно дороже обычных', 'накладных сильно дороже обычных'),
        go: 'conflicts' });
    }
    var level = items.some(function (i) { return i.level === 'red'; }) ? 'red'
      : (items.some(function (i) { return i.level === 'warn'; }) ? 'warn' : 'info');
    return { items: items, level: level, cash: cash, odd: odd };
  }

  return {
    build: build, cashNow: cashNow, shiftMissing: shiftMissing,
    oddDocs: oddDocs, checkBase: checkBase, median: median
  };
});
