/* ============================================================================
   Умный ручной ввод: чтобы записывать было быстро и не думать.
   — справочники собираются сами из того, что вы уже записывали;
   — любое новое слово (категория, кассир, сотрудник) запоминается;
   — подставляются последние значения: дата, смена, кассир, способ оплаты;
   — недописанная форма не теряется, а похожая запись за день — предупреждает.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMQuick = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function txt(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return txt(v).toLowerCase().replace(/ё/g, 'е'); }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v == null ? '' : v).replace(/\s/g, '').replace(/₽|руб\.?/gi, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }
  function today() { return new Date().toISOString().slice(0, 10); }

  function splitDict(v) {
    if (typeof v !== 'string' || !v.trim()) return [];
    return v.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  // Значения по частоте: то, что вы пишете чаще, стоит первым
  function byUse(list, counts) {
    return list.slice().sort(function (a, b) {
      var d = (counts[norm(b)] || 0) - (counts[norm(a)] || 0);
      return d || a.localeCompare(b, 'ru');
    });
  }

  /* --- Справочники ---------------------------------------------------------- */
  // Список = что задано в настройках + что реально встречалось в записях
  function dicts(state, settings) {
    state = state || {}; settings = settings || {};
    var dds = state.dds || [], out = {}, counts = {
      category: {}, cashier: {}, shift: {}, method: {}, employee: {}, supplier: {}, reason: {}
    };
    function put(bag, key, value) {
      var v = txt(value); if (!v) return;
      if (!bag[norm(v)]) bag[norm(v)] = { name: v, n: 0 };
      bag[norm(v)].n++;
      counts[key][norm(v)] = (counts[key][norm(v)] || 0) + 1;
    }
    var cat = {}, cash = {}, shift = {}, meth = {}, emp = {}, sup = {}, reason = {};

    dds.forEach(function (r) {
      put(cat, 'category', r.category);
      put(cash, 'cashier', r.cashier);
      put(shift, 'shift', r.shift);
      put(meth, 'method', r.method);
    });
    (state.payouts || []).forEach(function (r) { put(emp, 'employee', r.employee); });
    (state.timesheet || []).forEach(function (r) { put(emp, 'employee', r.employee); });
    (state.debtors || []).forEach(function (r) { put(cash, 'cashier', r.cashier); });
    (state.supreg || []).forEach(function (r) { put(sup, 'supplier', r.name); });
    (state.plans || []).forEach(function (r) { put(sup, 'supplier', r.supplier); });
    (state.inventory || []).forEach(function (r) { put(reason, 'reason', r.reason); });

    function merge(fromSettings, bag, key, fallback) {
      var seen = {}, list = [];
      splitDict(fromSettings).concat(Object.keys(bag).map(function (k) { return bag[k].name; }))
        .concat(fallback || []).forEach(function (v) {
          if (!v || seen[norm(v)]) return;
          seen[norm(v)] = 1; list.push(v);
        });
      return byUse(list, counts[key]);
    }

    out.categories = merge(settings.finCategories, cat, 'category',
      ['Закуп товара', 'Оплата ТП', 'ЗП', 'Аренда', 'Коммуналка', 'Налоги', 'Хозтовары', 'Другое']);
    out.cashiers = merge(settings.finCashiers, cash, 'cashier', []);
    out.shifts = merge(settings.finShifts, shift, 'shift', ['День 09:00–21:00', 'Ночь 21:00–09:00']);
    out.methods = merge(settings.finMethods, meth, 'method', ['Наличные', 'Карта', 'Перевод']);
    out.employees = merge(settings.finEmployees, emp, 'employee', []);
    out.suppliers = merge(settings.finSuppliers, sup, 'supplier', []);
    out.reasons = merge(settings.finReasons, reason, 'reason',
      ['Просрочка', 'Бой и порча', 'Недостача', 'Дегустация', 'Своё потребление']);
    return out;
  }

  // Настройка-справочник, куда дописывать новое слово
  var DICT_SETTING = {
    categories: 'finCategories', cashiers: 'finCashiers', shifts: 'finShifts',
    methods: 'finMethods', employees: 'finEmployees', suppliers: 'finSuppliers',
    reasons: 'finReasons'
  };

  // Запомнить новое значение в справочнике настроек (возвращает true, если добавили)
  function learn(settings, dict, value) {
    var key = DICT_SETTING[dict], v = txt(value);
    if (!key || !v || !settings) return false;
    var list = splitDict(settings[key]);
    for (var i = 0; i < list.length; i++) if (norm(list[i]) === norm(v)) return false;
    list.push(v);
    settings[key] = list.join(', ');
    return true;
  }

  /* --- Что подставлять по умолчанию ----------------------------------------- */

  // Последнее записанное значение поля (по свежей дате, а не по порядку ввода)
  function last(state, field, coll) {
    var rows = (state && state[coll || 'dds']) || [];
    for (var i = rows.length - 1; i >= 0; i--) {
      if (txt(rows[i][field])) return txt(rows[i][field]);
    }
    return '';
  }

  // Смена по времени суток: до 9 утра и после 21:00 — ночная
  function shiftNow(dicts_) {
    var h = new Date().getHours();
    var night = h >= 21 || h < 9;
    var list = (dicts_ && dicts_.shifts) || [];
    for (var i = 0; i < list.length; i++) {
      var n = norm(list[i]);
      if (night && n.indexOf('ноч') >= 0) return list[i];
      if (!night && (n.indexOf('ден') >= 0 || n.indexOf('утр') >= 0)) return list[i];
    }
    return list[0] || '';
  }

  // Значения, с которых открывается форма
  function defaults(state, settings, form) {
    var d = dicts(state, settings);
    var base = { date: today() };
    if (form === 'cashShift') {
      base.shift = shiftNow(d);
      base.cashier = last(state, 'cashier');
    } else if (form === 'ddsExpense' || form === 'freeOp') {
      base.category = last(state, 'category') || d.categories[0] || '';
      base.method = last(state, 'method') || d.methods[0] || 'Наличные';
      base.cashier = last(state, 'cashier');
    } else if (form === 'payout') {
      base.employee = last(state, 'employee', 'payouts');
      base.form = last(state, 'form', 'payouts') || 'Наличные из кассы';
    } else if (form === 'debtor') {
      base.cashier = last(state, 'cashier');
    } else if (form === 'ownerDraw') {
      base.method = 'Наличные';
    }
    return base;
  }

  /* --- Подсказки и защита от ошибок ----------------------------------------- */

  // Похожая запись за тот же день: та же сумма и та же категория
  function duplicate(state, coll, rec) {
    var rows = (state && state[coll]) || [];
    var amount = num(rec.amount != null ? rec.amount : rec.sum);
    if (!amount) return null;
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      var a = num(r.amount != null ? r.amount : r.sum);
      if (a !== amount || r.date !== rec.date) continue;
      if (rec.category && norm(r.category) !== norm(rec.category)) continue;
      if (rec.name && norm(r.name) !== norm(rec.name)) continue;
      if (rec.employee && norm(r.employee) !== norm(rec.employee)) continue;
      return r;
    }
    return null;
  }

  // Понятные предупреждения: не ошибка, но стоит взглянуть
  function warnings(rec) {
    var out = [], t = today();
    var amount = num(rec.amount != null ? rec.amount : rec.sum);
    if (rec.date && rec.date > t) out.push('дата в будущем');
    if (rec.date && rec.date < '2020-01-01') out.push('дата раньше 2020 года');
    if (amount && amount > 1000000) out.push('сумма больше миллиона');
    if (amount && amount < 0) out.push('сумма отрицательная');
    return out;
  }

  // Итог смены: выручка, расхождение с Z-отчётом и сколько наличных останется
  // «Факт» в форме — это фактическая выручка по способу, а не деньги в ящике:
  // расхождение = факт − Z-отчёт, остаток в кассе = наличные − выплаты из кассы.
  function shiftMath(v) {
    var r = function (x) { return Math.round(x * 100) / 100; };
    var zCash = num(v.zCash), zCard = num(v.zCard), zTrans = num(v.zTrans);
    var fCash = num(v.fCash), fCard = num(v.fCard), fTrans = num(v.fTrans);
    var payout = num(v.payout);
    var hasFact = !!(fCash || fCard || fTrans);
    var diff = r((fCash ? fCash - zCash : 0) + (fCard ? fCard - zCard : 0) + (fTrans ? fTrans - zTrans : 0));
    return {
      revenue: r(zCash + zCard + zTrans),
      cash: r((hasFact && fCash ? fCash : zCash) - payout),   // наличные минус выплаты из кассы
      payout: r(payout),
      diff: diff,
      hasFact: hasFact,
      status: !hasFact ? 'нет факта' : (diff === 0 ? 'сходится' : (diff > 0 ? 'излишек' : 'недостача'))
    };
  }

  /* --- Черновик формы ------------------------------------------------------- */
  var DRAFT = 'waymarket_draft_';
  function saveDraft(form, values) {
    try { localStorage.setItem(DRAFT + form, JSON.stringify(values)); } catch (e) {}
  }
  function loadDraft(form) {
    try {
      var raw = localStorage.getItem(DRAFT + form);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearDraft(form) {
    try { localStorage.removeItem(DRAFT + form); } catch (e) {}
  }

  return {
    txt: txt, norm: norm, num: num, today: today, splitDict: splitDict,
    dicts: dicts, learn: learn, last: last, shiftNow: shiftNow, defaults: defaults,
    duplicate: duplicate, warnings: warnings, shiftMath: shiftMath,
    saveDraft: saveDraft, loadDraft: loadDraft, clearDraft: clearDraft,
    DICT_SETTING: DICT_SETTING
  };
});
