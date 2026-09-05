/* ============================================================================
   Умный ручной ввод: чтобы записывать было быстро и не думать.
   — справочники собираются сами из того, что вы уже записывали;
   — любое новое слово (категория, кассир, сотрудник) запоминается;
   — подставляются последние значения: дата, смена, кассир, способ оплаты;
   — недописанная форма не теряется, а похожая запись за день — предупреждает.
   ========================================================================== */
/* Ядро нужно, чтобы не предлагать статьи, которые тратой не являются. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.WMQuick = factory(root.WM);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  // Статья, которая тратой не является (закуп, долг, инкассация)
  function E_NOT_A_COST(v) { return !!(E && E.notACost && E.notACost(v)); }

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
      category: {}, cashier: {}, shift: {}, method: {}, employee: {}, supplier: {}
    };
    function put(bag, key, value) {
      var v = txt(value); if (!v) return;
      if (!bag[norm(v)]) bag[norm(v)] = { name: v, n: 0 };
      bag[norm(v)].n++;
      counts[key][norm(v)] = (counts[key][norm(v)] || 0) + 1;
    }
    var cat = {}, cash = {}, shift = {}, meth = {}, emp = {}, sup = {};

    dds.forEach(function (r) {
      put(cat, 'category', r.category);
      put(cash, 'cashier', r.cashier);
      put(shift, 'shift', r.shift);
      put(meth, 'method', r.method);
    });
    (state.debtors || []).forEach(function (r) { put(cash, 'cashier', r.cashier); });
    (state.cashcount || []).forEach(function (r) { put(cash, 'cashier', r.cashier); });
    (state.staff || []).forEach(function (r) { if (!r.fired) put(emp, 'employee', r.name); });
    (state.plans || []).forEach(function (r) { put(sup, 'supplier', r.supplier); });

    // Скрытые значения справочника в подсказки не идут: владелец их убрал
    // намеренно, а старые записи с ними остались как были.
    var off = {};
    (state.dictoff || []).forEach(function (r) {
      if (!r || !r.name) return;
      off[r.kind + '|' + norm(r.name)] = true;
    });
    function merge(fromSettings, bag, key, fallback, offKey) {
      var seen = {}, list = [];
      splitDict(fromSettings).concat(Object.keys(bag).map(function (k) { return bag[k].name; }))
        .concat(fallback || []).forEach(function (v) {
          if (!v || seen[norm(v)]) return;
          if (offKey && off[offKey + '|' + norm(v)]) return;
          seen[norm(v)] = 1; list.push(v);
        });
      return byUse(list, counts[key]);
    }

    /* Подсказки статей расхода. Закупа, оплаты поставщикам и «выплаты из
       кассы» здесь нет намеренно: закуп вводится в «Итогах дня», долги — там
       же, а «выплата из кассы» — это способ оплаты, а не статья. Стоило им
       появиться в списке — и владелец выбирал их, а прибыль занижалась на
       ту же сумму дважды. */
    out.categories = merge(settings.finCategories, cat, 'category',
      ['ЗП', 'Аренда', 'Коммунальные', 'Налоги', 'Комиссия банка', 'Обед',
        'ГСМ', 'Расходники', 'Списания', 'Реклама', 'Прочее'], 'categories')
      .filter(function (v) { return !E_NOT_A_COST(v); });
    out.cashiers = merge(settings.finCashiers, cash, 'cashier', [], 'cashiers');
    out.shifts = merge(settings.finShifts, shift, 'shift', ['День', 'Ночь'], 'shifts');
    out.methods = merge(settings.finMethods, meth, 'method', ['Наличные', 'Карта', 'СБП', 'Перевод'], 'methods');
    // уволенных и поставщиков, которые больше не возят, в подсказках нет
    var goneEmp = {}, goneSup = {};
    (state.staff || []).forEach(function (r) { if (r.fired) goneEmp[norm(r.name)] = 1; });
    (state.supreg || []).forEach(function (r) { if (r.archived) goneSup[norm(r.name)] = 1; });
    out.employees = merge(settings.finEmployees, emp, 'employee', [], 'employees')
      .filter(function (v) { return !goneEmp[norm(v)]; });
    out.suppliers = merge(settings.finSuppliers, sup, 'supplier', [], 'suppliers')
      .filter(function (v) { return !goneSup[norm(v)]; });
    return out;
  }

  // Настройка-справочник, куда дописывать новое слово
  var DICT_SETTING = {
    categories: 'finCategories', cashiers: 'finCashiers', shifts: 'finShifts',
    methods: 'finMethods', employees: 'finEmployees', suppliers: 'finSuppliers'
  };

  /* Запомнить новое значение в справочнике настроек (true, если что-то изменилось).
     Принимает и одно слово, и список — в форме кассы выплат бывает несколько,
     и раньше они склеивались в одну строку через запятую.
     Если слово было скрыто, а владелец вписал его снова — значит, оно снова
     нужно: снимаем пометку, иначе в подсказках оно так и не появится. */
  function learn(settings, dict, value, state) {
    var key = DICT_SETTING[dict];
    if (!key || !settings || value == null) return false;
    if (Object.prototype.toString.call(value) === '[object Array]') {
      var any = false;
      for (var j = 0; j < value.length; j++) if (learn(settings, dict, value[j], state)) any = true;
      return any;
    }
    var v = txt(value);
    if (!v || v.indexOf(',') >= 0) return false;   // запятая ломает список — такое не запоминаем
    var changed = false;
    if (state && state.dictoff) {
      var before = state.dictoff.length;
      state.dictoff = state.dictoff.filter(function (r) {
        return !(r && r.kind === dict && norm(r.name) === norm(v));
      });
      if (state.dictoff.length !== before) changed = true;
    }
    var list = splitDict(settings[key]);
    for (var i = 0; i < list.length; i++) if (norm(list[i]) === norm(v)) return changed;
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

  // Смена по времени суток: границы задаются в настройках («день с», «ночь с»)
  function hourOf(time, def) {
    var m = String(time || '').match(/^(\d{1,2})/);
    return m ? +m[1] : def;
  }
  function shiftNow(dicts_, settings) {
    var h = new Date().getHours();
    var dayStart = hourOf(settings && settings.dayStart, 9);
    var nightStart = hourOf(settings && settings.nightStart, 21);
    var night = nightStart > dayStart ? (h >= nightStart || h < dayStart) : (h >= nightStart && h < dayStart);
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
      base.shift = shiftNow(d, settings);
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

  // Проверка суммы перед записью: пусто, буквы, минус, «1e100» — всё это ошибки.
  // Возвращает текст ошибки или null, если сумма нормальная.
  var MAX_MONEY = 1000000000;      // миллиард рублей — верхняя граница здравого смысла
  function checkAmount(value, opts) {
    opts = opts || {};
    var raw = txt(value);
    if (!raw) return opts.allowEmpty ? null : 'Укажите сумму.';
    if (!/^-?[\d\s.,]+$/.test(raw)) return 'Сумма должна быть числом, а не текстом.';
    var n = num(raw);
    if (!isFinite(n)) return 'Сумма не похожа на число.';
    if (n < 0 && !opts.allowNegative) return 'Сумма не может быть отрицательной.';
    if (Math.abs(n) > MAX_MONEY) return 'Сумма слишком большая — проверьте, не лишний ли ноль.';
    if (!n && !opts.allowZero) return 'Сумма не может быть нулевой.';
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
    dicts: dicts, learn: learn, last: last, shiftNow: shiftNow, hourOf: hourOf, defaults: defaults,
    duplicate: duplicate, warnings: warnings, shiftMath: shiftMath,
    checkAmount: checkAmount, MAX_MONEY: MAX_MONEY,
    saveDraft: saveDraft, loadDraft: loadDraft, clearDraft: clearDraft,
    DICT_SETTING: DICT_SETTING
  };
});
