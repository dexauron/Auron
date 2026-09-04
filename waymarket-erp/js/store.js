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
    storeName: 'ВАЙ МАРКЕТ',
    fot: 280000,            // ФОТ в месяц, ₽
    rent: 110000,           // аренда в месяц, ₽
    utilities: 35000,       // коммуналка и свет, ₽
    taxes: 40000,           // налоги и фиксированные платежи, ₽
    other: 0,               // прочие постоянные расходы, ₽
    marginManual: '',       // маржинальность вручную, % (пусто = считать из продаж)
    rateDay: 200,           // ставка дневной смены, ₽/час
    rateNight: 220,         // ставка ночной смены, ₽/час
    openCash: 10000,        // разменный остаток в кассе на начало смены, ₽
    leadDays: 2,            // плечо доставки поставщика, дней
    safetyPct: 30,          // страховой запас, % от расхода за плечо
    fefoCrit: 2,            // «красная зона» срока годности, дней
    fefoWarn: 5,            // «жёлтая зона», дней
    discountCrit: 30,       // уценка в красной зоне, %
    discountWarn: 15,       // уценка в жёлтой зоне, %
    writeoffsToMonth: true, // приводить списания из 1С к месяцу в P&L
    autoSyncSeconds: 3,     // как часто проверять папку на изменения, сек

    // Финансовый учёт (как в вашей таблице): справочники и пороги сигналов
    finCategories: 'Закуп товара, ЗП, Аренда, Налоги, Коммуналка, Интернет, Оплата ТП, Реклама, Другое',
    finCashiers: '',
    finShifts: 'День 09:00–21:00, Ночь 21:00–09:00',
    finSuppliers: '',
    finMethods: 'Наличные, Карта, Перевод',
    finEmployees: '',
    finReasons: 'Просрочка, Бой и порча, Недостача, Дегустация, Своё потребление',
    openCashStart: 0,       // начальный остаток наличных
    openCardStart: 0,       // начальный остаток на карте
    openTransferStart: 0,   // начальный остаток на счёте
    debtWarn: 200000,       // долг поставщикам: внимание
    debtCrit: 500000,       // долг поставщикам: критично
    dueWarn: 7,             // за сколько дней предупреждать о платеже
    diffCrit: 1000,         // критичное расхождение кассы

    // Поставки из 1С: отсрочки, разбор оплат, долги покупателей
    termDaysDefault: 3,     // отсрочка по умолчанию, если у поставщика не задана
    debtorOldDays: 30,      // с какого возраста долг покупателя считается старым
    keepBackups: 30,        // сколько копий базы хранить в папке «копии»
    roundTolerance: 5,      // копеечная недоплата, которую можно списать округлением
    payWeekend: 'Платить как есть',   // что делать, если срок выпал на выходной
    autoConfirm: 'нет',     // подтверждать даты выплат автоматически

    // Магазин: реквизиты для шапки печатных отчётов
    legalName: '', inn: '', address: '', phone: '',
    workMode: 'Круглосуточно', openTime: '08:00', closeTime: '23:00',

    // Налоги
    taxMode: 'УСН 6% (доходы)',
    taxRate: 6,
    patentMonth: 0,
    vatMode: 'Без НДС',

    // Смены и касса
    dayStart: '09:00', nightStart: '21:00', shiftHours: 12,
    cashLimit: 0,           // предупреждать, если наличных в кассе больше
    diffCritPct: 0,         // либо если расхождение больше % от выручки

    // Зарплата
    rateHoliday: 0, bonusPercent: 0, advanceDay: 0, salaryDay: 0,

    // Товар и заказы
    coverDays: 7,           // на сколько дней держим запас
    markupDefault: 30,      // наценка по умолчанию, %
    priceRound: '1',        // до чего округлять розничную цену
    turnoverGood: 20,       // хорошая оборачиваемость, раз в год
    deadSoldPct: 20,        // неликвид: продали меньше этого % от остатка
    deadDays: 60,           // и завозили давнее этого числа дней

    // Потери
    writeoffNormPct: 1.5,   // норма списаний, % от выручки
    shrinkNormPct: 0.5,     // норма недостачи по инвентаризации, %

    // Цели месяца
    planRevenue: 0, planProfit: 0, marginTarget: 0,

    // Внешний вид и поведение
    theme: 'Авто', bigText: 'нет', privacyDefault: 'нет',
    startView: 'Сегодня', defaultPeriod: 'Месяц',
    bookAutoSave: 'да', bookAutoRead: 'да',

    // Доступ: пароль хранится не здесь, а на самом компьютере (localStorage)
    askPin: 'нет', lockMinutes: 0
  };

  var COLLECTIONS = ['shifts', 'invoices', 'payments', 'expenses', 'timesheet', 'payouts', 'expiry',
    'inventory', 'kvi', 'dds', 'plans',
    // поставки из 1С живут в базе постоянно: документы, оплаты, справочник фирм
    'docs', 'pays', 'supreg', 'debtors',
    // пересчёты кассы по купюрам и журнал действий владельца
    'cashcount', 'log',
    // корзина: всё удалённое лежит здесь, пока не почистят
    'trash'];

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
    dds: 'Касса и расходы', docs: 'Накладные', pays: 'Оплаты', supreg: 'Поставщики',
    plans: 'План выплат', payouts: 'Зарплата', timesheet: 'Табель',
    debtors: 'Долги покупателей', inventory: 'Списания', expiry: 'Сроки годности',
    cashcount: 'Пересчёт кассы', kvi: 'Товары-маркеры', invoices: 'Накладные (старые)',
    payments: 'Оплаты (старые)', shifts: 'Смены (старые)', expenses: 'Расходы (старые)'
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
    get state() { return state; },
    get settings() { return state.settings; },
    load: load, save: save, add: add, addMany: addMany, update: update, remove: remove,
    restore: restore, undo: undo, emptyTrash: emptyTrash, logUndo: logUndo, COLL_RU: COLL_RU,
    clear: clear, setSetting: setSetting, exportJSON: exportJSON, importJSON: importJSON,
    fixedMonthly: fixedMonthly, uid: uid, onChange: onChange, replaceAll: replaceAll
  };
});
