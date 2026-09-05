/* ============================================================================
   Хранилище оперативных журналов и настроек магазина.
   Всё лежит в браузере (localStorage) — интернет не нужен.
   Выгрузки 1С здесь НЕ хранятся: они большие и читаются из папки заново.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'waymarket_erp_v1';

  var DEFAULT_SETTINGS = {
    /* --- Магазин ------------------------------------------------------- */
    storeName: 'ВАЙ МАРКЕТ',
    legalName: '', inn: '', address: '', phone: '',
    workMode: 'Круглосуточно',
    tills: 'Касса 1, Касса 2',          // сколько денежных ящиков в магазине
    shiftNames: 'День, Ночь',
    dayStart: '09:00', nightStart: '21:00',

    /* --- Начальные остатки: с чего программа начинает считать ----------
       Их вписывают один раз, при запуске. Без них остаток наличных и долг
       поставщикам начнутся с нуля, а не с того, что есть на самом деле. */
    openCashStart: 0,       // сколько наличных в ящиках на старте
    openDebtStart: 0,       // сколько уже должны поставщикам на старте

    /* --- Пороги, по которым программа предупреждает --------------------- */
    diffCrit: 1000,         // расхождение кассы, после которого это ЧП
    cashLimit: 0,           // наличных в кассе больше этого — пора убрать в сейф
    debtWarn: 200000,       // долг поставщикам: внимание
    debtCrit: 500000,       // долг поставщикам: критично
    dueWarn: 7,             // за сколько дней напоминать о выплате
    debtorOldDays: 30,      // с какого возраста долг покупателя считается старым

    /* --- Справочники: подставляются в формах ---------------------------- */
    finCategories: 'Закуп товара, Оплата ТП, ЗП, Аренда, Коммуналка, Интернет, Хозрасходы, Реклама, Налоги, Комиссия банка, Выплата из кассы, Другое',
    finCashiers: '',
    finShifts: 'День, Ночь',
    finMethods: 'Наличные, Карта, СБП, Перевод',
    finSuppliers: '',
    finEmployees: '',

    /* --- Зарплата кассиров ---------------------------------------------- */
    rateDay: 200,           // ставка дневной смены, ₽/час
    rateNight: 220,         // ставка ночной смены, ₽/час
    shiftHours: 12,

    /* --- Налоги (прикидочно, для понимания порядка суммы) --------------- */
    taxMode: 'УСН 6% (доходы)', taxRate: 6, patentMonth: 0,

    /* --- Постоянные расходы: для прикидки, сколько надо заработать ------ */
    fot: 280000, rent: 110000, utilities: 35000, taxes: 40000, other: 0,
    planRevenue: 0,

    /* --- Данные и копии -------------------------------------------------- */
    keepBackups: 30, backupEveryHours: 24, autoSyncSeconds: 3,

    /* --- Доступ ---------------------------------------------------------- */
    askPin: 'нет', lockMinutes: 1,

    /* --- Внешний вид ----------------------------------------------------- */
    theme: 'Авто', themeDayFrom: '07:00', themeNightFrom: '20:00',
    bigText: 'нет', privacyDefault: 'нет',
    startView: 'Пульт', defaultPeriod: 'Месяц'
  };

  /* Пять рабочих коллекций — больше учёту магазина не нужно:
       dds       — движение денег: смены, итоги дня, приходы и расходы;
       plans     — план выплат поставщикам (календарь);
       staff     — кассиры: ставка, телефон, когда принят и уволен;
       debtors   — долги покупателей, бывшая тетрадка у кассы;
       cashcount — пересчёты денег в ящике по купюрам.
     Остальные — служебные: журнал правок, корзина, скрытое в справочниках,
     сохранённые наборы фильтров и шаблоны частых записей. */
  var COLLECTIONS = ['dds', 'plans', 'staff', 'debtors', 'cashcount',
    'log', 'templates', 'dictoff', 'filtersets', 'trash'];

  function emptyState() {
    var s = { settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), version: 1 };
    for (var i = 0; i < COLLECTIONS.length; i++) s[COLLECTIONS[i]] = [];
    return s;
  }

  var state = emptyState();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        state = merge(emptyState(), parsed);
      }
    } catch (e) { /* повреждённое хранилище не должно ломать запуск */ }
    return state;
  }

  // Ключи, которыми можно подменить прототип объекта: в базе им не место
  function unsafeKey(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype'; }

  function merge(base, patch) {
    for (var k in patch) {
      if (unsafeKey(k) || !Object.prototype.hasOwnProperty.call(patch, k)) continue;
      if (k === 'settings') {
        for (var s in patch.settings) { if (!unsafeKey(s)) base.settings[s] = patch.settings[s]; }
      } else if (Object.prototype.toString.call(patch[k]) === '[object Array]') {
        base[k] = patch[k];
      } else if (patch[k] !== null && typeof patch[k] === 'object') {
        base[k] = merge(base[k] || {}, patch[k]);
      } else {
        base[k] = patch[k];
      }
    }
    return base;
  }

  var changeHooks = [];
  // на изменение подписывается сохранение в файл (js/filestore.js)
  function onChange(fn) { changeHooks.push(fn); }

  function save() {
    var ok = true;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      ok = false; // например, переполнено хранилище браузера
    }
    changeHooks.forEach(function (fn) { try { fn(state); } catch (e) {} });
    return ok;
  }

  // Заменить всё содержимое базы (например, прочитанное из файла в папке)
  function replaceAll(data) {
    state = merge(emptyState(), data || {});
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    return state;
  }

  function uid() { return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* --- Журнал действий -------------------------------------------------------
     Каждая правка, добавление и удаление оставляют след: что было до, что
     стало после. Отсюда «Отменить» возвращает одну запись, не трогая базу
     целиком, и видно, кто что менял.
     ------------------------------------------------------------------------ */
  var LOG_MAX = 500;
  var COLL_RU = {
    dds: 'Касса и деньги', plans: 'План выплат', staff: 'Кассиры',
    debtors: 'Долги покупателей', cashcount: 'Пересчёт кассы',
    templates: 'Шаблоны', dictoff: 'Скрытое в справочниках',
    filtersets: 'Наборы фильтров'
  };
  // Как записать строку в журнал, чтобы через месяц было понятно
  function logTitle(rec) {
    if (!rec) return '';
    return String(rec.name || rec.firm || rec.supplier || rec.employee ||
      rec.category || rec.doc || rec.title || '').slice(0, 60);
  }
  function logSum(rec) {
    if (!rec) return 0;
    var v = rec.amount != null ? rec.amount : (rec.sum != null ? rec.sum : rec.counted);
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  function writeLog(what, coll, rec, before) {
    if (coll === 'log' || coll === 'trash') return;
    state.log = state.log || [];
    state.log.push({
      id: uid(), at: new Date().toISOString(), what: what, coll: coll,
      collName: COLL_RU[coll] || coll, recId: rec && rec.id,
      title: logTitle(rec), sum: logSum(rec),
      before: before ? JSON.parse(JSON.stringify(before)) : null
    });
    if (state.log.length > LOG_MAX) state.log = state.log.slice(-LOG_MAX);
  }

  function add(coll, item) {
    if (!state[coll]) state[coll] = [];
    if (!item.id) item.id = uid();
    state[coll].push(item);
    writeLog('добавление', coll, item, null);
    save();
    return item;
  }

  function addMany(coll, items, replace) {
    if (!state[coll]) state[coll] = [];
    if (replace) state[coll] = [];
    for (var i = 0; i < items.length; i++) {
      if (!items[i].id) items[i].id = uid();
      state[coll].push(items[i]);
    }
    save();
    return state[coll].length;
  }

  function update(coll, id, patch) {
    var rows = state[coll] || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) {
        var before = JSON.parse(JSON.stringify(rows[i]));
        for (var k in patch) rows[i][k] = patch[k];
        writeLog('правка', coll, rows[i], before);
        save(); return rows[i];
      }
    }
    return null;
  }

  var TRASH_MAX = 200;      // сколько удалённых записей помним

  // Удаление не стирает запись насовсем: она уезжает в корзину,
  // откуда её можно вернуть одной кнопкой.
  function remove(coll, id, forever) {
    var rows = state[coll] || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) {
        var rec = rows[i];
        rows.splice(i, 1);
        writeLog('удаление', coll, rec, rec);
        if (!forever && coll !== 'trash') {
          state.trash = state.trash || [];
          state.trash.push({ id: uid(), coll: coll, at: new Date().toISOString(), rec: rec });
          if (state.trash.length > TRASH_MAX) state.trash = state.trash.slice(-TRASH_MAX);
        }
        save();
        return rec;
      }
    }
    return null;
  }

  // Вернуть запись из корзины на место
  function restore(trashId) {
    var t = state.trash || [];
    for (var i = 0; i < t.length; i++) {
      if (t[i].id === trashId) {
        var item = t.splice(i, 1)[0];
        state[item.coll] = state[item.coll] || [];
        state[item.coll].push(item.rec);
        save();
        return item;
      }
    }
    return null;
  }

  // Вернуть последнее удалённое
  function undo() {
    var t = state.trash || [];
    return t.length ? restore(t[t.length - 1].id) : null;
  }

  function emptyTrash() { state.trash = []; save(); }

  function clear(coll) {
    if (coll) state[coll] = []; else state = emptyState();
    save();
  }

  // Отменить одно действие из журнала: вернуть запись, какой она была до
  function logUndo(logId) {
    var log = state.log || [];
    var row = null;
    for (var i = 0; i < log.length; i++) if (log[i].id === logId) row = log[i];
    if (!row || !row.before) return null;
    var rows = state[row.coll] = state[row.coll] || [];
    var found = false;
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].id === row.before.id) { rows[j] = JSON.parse(JSON.stringify(row.before)); found = true; break; }
    }
    if (!found) rows.push(JSON.parse(JSON.stringify(row.before)));   // удалённую возвращаем на место
    row.undone = true;
    save();
    return row.before;
  }

  function setSetting(key, value) { state.settings[key] = value; save(); }

  // Резервная копия: журналы и настройки одним файлом
  /* --- 126. Работа на двух компьютерах: примирение изменений ------------------
     Дома записали расход, в магазине — смену. Раньше выбор был «оставить моё»
     или «взять из файла», и одна из работ пропадала. Теперь записи
     объединяются: у каждой свой номер, поэтому пропасть ничего не может.
     Если одну и ту же запись правили в обоих местах — берём ту, что из более
     позднего файла, и говорим, сколько таких было. Удаления не теряются:
     корзина помнит, что и когда удалили.
     ------------------------------------------------------------------------ */
  function reconcile(mine, theirs, opts) {
    opts = opts || {};
    mine = mine || {}; theirs = theirs || {};
    // чей файл записан позже — тот и главный в спорных записях
    var mineNewer = !opts.theirsSaved || (opts.mineSaved && opts.mineSaved >= opts.theirsSaved);
    var out = emptyState();
    var res = { added: 0, kept: 0, conflicts: 0, removed: 0, collections: {} };

    // что удалено на каждой стороне — по корзине
    function deletedIds(st) {
      var map = {};
      (st.trash || []).forEach(function (t) {
        if (t && t.rec && t.rec.id) map[t.rec.id] = t.at || '';
      });
      return map;
    }
    var delMine = deletedIds(mine), delTheirs = deletedIds(theirs);

    for (var ci = 0; ci < COLLECTIONS.length; ci++) {
      var coll = COLLECTIONS[ci];
      if (coll === 'trash') continue;                 // корзину сливаем отдельно
      var a = mine[coll] || [], b = theirs[coll] || [];
      var byId = {}, order = [], stats = { added: 0, conflicts: 0, removed: 0 };

      function put(rec, fromMine) {
        if (!rec || typeof rec !== 'object') return;
        var id = rec.id;
        if (!id) { id = uid(); rec.id = id; }
        // запись, удалённая на другой стороне, не воскресает
        if (fromMine ? delTheirs[id] : delMine[id]) { stats.removed++; return; }
        if (!byId[id]) { byId[id] = rec; order.push(id); if (!fromMine) stats.added++; return; }
        var was = JSON.stringify(byId[id]), now = JSON.stringify(rec);
        if (was === now) return;                       // одинаковые — спорить не о чем
        stats.conflicts++;
        // побеждает та сторона, чей файл записан позже
        if (fromMine ? mineNewer : !mineNewer) byId[id] = rec;
      }
      for (var i = 0; i < a.length; i++) put(a[i], true);
      for (var j = 0; j < b.length; j++) put(b[j], false);

      out[coll] = order.map(function (id) { return byId[id]; });
      res.added += stats.added; res.conflicts += stats.conflicts; res.removed += stats.removed;
      if (stats.added || stats.conflicts || stats.removed) res.collections[coll] = stats;
    }

    // корзина: объединяем, чтобы удаления с обеих сторон помнились
    var trash = {}, tOrder = [];
    [(mine.trash || []), (theirs.trash || [])].forEach(function (list) {
      list.forEach(function (t) {
        if (!t || !t.id || trash[t.id]) return;
        trash[t.id] = t; tOrder.push(t.id);
      });
    });
    out.trash = tOrder.map(function (id) { return trash[id]; }).slice(-TRASH_MAX);

    // настройки берём у того, чей файл новее: это про один магазин, а не про
    // две разные базы, и мешать половинки настроек — хуже, чем взять целиком
    out.settings = merge(emptyState().settings,
      (mineNewer ? mine.settings : theirs.settings) || {});
    res.settingsFrom = mineNewer ? 'этот компьютер' : 'файл в папке';
    res.total = COLLECTIONS.reduce(function (n, c) { return n + (out[c] || []).length; }, 0);
    return { state: out, report: res };
  }

  // Примирить и сразу применить: возвращает отчёт для показа владельцу
  function reconcileWith(otherText, otherSaved) {
    var obj = typeof otherText === 'string' ? JSON.parse(otherText) : otherText;
    var data = obj.data || obj;
    var r = reconcile(state, data, { mineSaved: state.savedAt || '', theirsSaved: obj.saved || otherSaved || '' });
    state = r.state;
    save();
    return r.report;
  }

  function exportJSON() {
    return JSON.stringify({ exported: new Date().toISOString(), data: state }, null, 2);
  }
  function importJSON(text) {
    var obj = JSON.parse(text);
    var data = obj.data || obj;
    state = merge(emptyState(), data);
    save();
    return state;
  }

  // Постоянные расходы в месяц — база для точки безубыточности
  function fixedMonthly() {
    var s = state.settings;
    return (+s.fot || 0) + (+s.rent || 0) + (+s.utilities || 0) + (+s.taxes || 0) + (+s.other || 0);
  }

  return {
    KEY: KEY, DEFAULT_SETTINGS: DEFAULT_SETTINGS, COLLECTIONS: COLLECTIONS,
    reconcile: reconcile, reconcileWith: reconcileWith,
    get state() { return state; },
    get settings() { return state.settings; },
    load: load, save: save, add: add, addMany: addMany, update: update, remove: remove,
    restore: restore, undo: undo, emptyTrash: emptyTrash, logUndo: logUndo, COLL_RU: COLL_RU,
    clear: clear, setSetting: setSetting, exportJSON: exportJSON, importJSON: importJSON,
    fixedMonthly: fixedMonthly, uid: uid, onChange: onChange, replaceAll: replaceAll
  };
});
