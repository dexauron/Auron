/* ============================================================================
   Мост: записи Auron → полный учёт.

   ЗАЧЕМ. Половины продукта считают одно и то же, но своими руками: Auron
   пишет в свои листы («БАЗА», «СЧЕТА»), полный учёт — в свои коллекции
   (`dds`, `accounts`). Пока они не знают друг о друге, владелец записывает
   расход в одном месте, а во втором его нет — и обе цифры врут.

   КАК. Мост односторонний: Auron → полный учёт. Записи Auron приходят сюда
   ЗЕРКАЛОМ (поле `src:'auron'`), правится оригинал — в Auron. Обратно
   ничего не уходит: две программы, пишущие в одну запись, рано или поздно
   затрут друг друга, и разобраться, чья версия верная, будет нечем.

   ПОЧЕМУ ТОЛЬКО «БАЗА», А НЕ «СМЕНЫ». В Auron смена сама раскладывается
   строками в «БАЗУ» (у них проставлен Z_Ref смены — по нему смена и
   отменяется). Если зеркалить ещё и лист «СМЕНЫ», выручка посчитается
   дважды. Правило полного учёта — у каждой суммы ровно один источник.

   ЗАКРЫТЫЙ МЕСЯЦ НЕ ТРОГАЕМ. Если владелец запер период, зеркало в нём
   остаётся как было: иначе закрытые цифры менялись бы сами собой.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuronBridge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var AURON_KEY = 'auron_db_v1';   // тот же ключ, что пишет android/build-www.js
  var SRC = 'auron';

  /* Даты в копии Auron помечены как {__d:'…ISO…'} — иначе при чтении они
     превращаются в строки, и выручка съезжает на день. Возвращаем тип. */
  function parseDb(raw) {
    return JSON.parse(raw, function (k, v) {
      if (v && typeof v === 'object' && typeof v.__d === 'string') return new Date(v.__d);
      return v;
    });
  }

  function ymd(v) {
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      var m = String(v.getMonth() + 1), d = String(v.getDate());
      return v.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (d.length < 2 ? '0' + d : d);
    }
    var s = String(v == null ? '' : v).trim();
    var m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m1) return m1[0];
    var m2 = s.match(/^(\d{2})[.](\d{2})[.](\d{4})/);   // 05.09.2026
    if (m2) return m2[3] + '-' + m2[2] + '-' + m2[1];
    return '';
  }

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }
  function txt(v) { return v == null ? '' : String(v).trim(); }

  /* Лист = массив строк, первая строка — заголовки. Возвращаем записи,
     где к колонке обращаются по имени: порядок колонок в Auron менялся
     уже дважды, и привязка к номеру каждый раз это ломала. */
  function rows(db, sheetName) {
    var sh = db && db[sheetName];
    if (!sh || !sh.length) return [];
    var head = sh[0].map(txt);
    var out = [];
    for (var i = 1; i < sh.length; i++) {
      var r = sh[i];
      if (!r || !r.length) continue;
      var o = {};
      for (var c = 0; c < head.length; c++) o[head[c]] = r[c];
      var empty = true;
      for (var k in o) if (txt(o[k])) { empty = false; break; }
      if (!empty) out.push(o);
    }
    return out;
  }

  /* --- Счета -------------------------------------------------------------- */
  function accounts(db) {
    return rows(db, 'СЧЕТА')
      .filter(function (r) { return txt(r['Название']); })
      .map(function (r) {
        return {
          id: 'auron:acc:' + txt(r['ID']),
          name: txt(r['Название']),
          kind: /карт|безнал|счёт|счет|банк/i.test(txt(r['Название'])) ? 'bank' : 'cash',
          opening: num(r['Нач_Баланс']),
          note: 'из Auron',
          src: SRC
        };
      });
  }

  /* --- Операции ----------------------------------------------------------- */
  /* Перевод в Auron лежит ДВУМЯ строками (расход с одного счёта и приход на
     другой) с общим Z_Ref. В полном учёте перевод — одна запись. Если пару
     не нашли, строку пропускаем: половина перевода в отчёте выглядит как
     настоящий расход, которого не было. */
  /* Наличные или нет — полный учёт решает по полю `method` (пусто = наличные),
     а Auron по счёту. Поэтому переводим счёт в способ оплаты: без этого
     безнал попадал бы в остаток денежного ящика и касса не сходилась бы. */
  function methodOf(accName, kinds) {
    return kinds[txt(accName).toLowerCase()] === 'bank' ? 'Безнал' : 'Наличные';
  }

  function operations(db, kinds, смены) {
    kinds = kinds || {};
    смены = смены || {};
    var src = rows(db, 'БАЗА');
    var out = [];
    var moves = {};

    src.forEach(function (r) {
      var date = ymd(r['Дата']);
      var amount = Math.abs(num(r['Сумма']));
      if (!date || !amount) return;
      var type = txt(r['Тип']);
      var cat = txt(r['Категория']);
      var uuid = txt(r['UUID']) || txt(r['ID']);
      if (!uuid) return;
      // строка принадлежит смене — она приедет вместе со сменой, не отдельно
      if (смены[txt(r['Z_Ref'])]) return;

      if (cat === 'Перевод') {
        var key = txt(r['Z_Ref']) || uuid.replace(/_(in|out)$/, '');
        var m = moves[key] || (moves[key] = { key: key, date: date, amount: amount });
        if (type === 'Расход') m.account = txt(r['Счёт']);
        else m.toAccount = txt(r['Счёт']);
        m.note = txt(r['Комментарий']) || m.note;
        return;
      }

      out.push({
        id: 'auron:' + uuid,
        type: type === 'Доход' ? 'Приход' : 'Расход',
        date: date,
        category: cat,
        account: txt(r['Счёт']),
        method: methodOf(r['Счёт'], kinds),
        amount: amount,
        note: txt(r['Комментарий']),
        src: SRC
      });
    });

    Object.keys(moves).forEach(function (k) {
      var m = moves[k];
      if (!m.account || !m.toAccount) return;    // половина перевода — не запись
      out.push({
        id: 'auron:move:' + k,
        type: 'Перемещение',
        date: m.date,
        account: m.account,
        toAccount: m.toAccount,
        method: methodOf(m.account, kinds),
        amount: m.amount,
        note: m.note || '',
        src: SRC
      });
    });

    return out;
  }

  /* --- Смены -------------------------------------------------------------- */
  /* Смена в Auron лежит в двух местах: в листе «СМЕНЫ» — сама сверка, а в
     «БАЗЕ» — её разложение строками (у всех проставлен Z_Ref смены). Сюда
     переносим ИМЕННО СМЕНУ, а её строки из «БАЗЫ» пропускаем: иначе выручка
     посчитается дважды. Ради этого экран «Утро: сверка кассы» и существует —
     без смен он оставался бы пустым, а это главное, ради чего полный учёт.

     ⚠️ РАСХОЖДЕНИЕ МОЖЕТ ОТЛИЧАТЬСЯ ОТ AURON, и это не ошибка переноса.
     Auron считает расхождение как «забрал + оплатил поставщикам + оставил −
     выручка» и НЕ вычитает выплаты с кассы, хотя кассир их из ящика вынул.
     Полный учёт вычитает: из ящика ушло — значит ушло. На смене с выплатами
     Auron покажет недостачу ровно на их сумму, которой на самом деле нет. */
  function shiftIds(db) {
    var ids = {};
    rows(db, 'СМЕНЫ').forEach(function (r) { var id = txt(r['ID']); if (id) ids[id] = true; });
    return ids;
  }

  function parseJson(v) {
    if (v && typeof v === 'object') return v;
    try { return JSON.parse(String(v || 'null')); } catch (e) { return null; }
  }

  function shifts(db, kinds) {
    return rows(db, 'СМЕНЫ').map(function (r) {
      var date = ymd(r['Дата']);
      if (!date) return null;
      var данные = parseJson(r['Rows_JSON']);
      var выплаты = parseJson(r['Wyplatas_JSON']) || [];
      var zCash = 0, zCashless = 0, supp = 0, kept = '', received = '', безналСчёт = '';

      if (данные && !Array.isArray(данные)) {          // сверка по Z-отчёту
        zCash = num(данные.cashRev);
        (данные.cardRevs || []).forEach(function (c) {
          zCashless += num(c.amount);
          if (!безналСчёт) безналСчёт = txt(c.account);
        });
        supp = num(данные.cashSupp);
        kept = данные.cashLeft == null ? '' : num(данные.cashLeft);
        received = данные.cashCollect == null ? '' : num(данные.cashCollect);
      } else if (Array.isArray(данные)) {              // старая сетка счетов
        данные.forEach(function (row) {
          var сумма = num(row.zAmount);
          if (kinds[txt(row.account).toLowerCase()] === 'bank') {
            zCashless += сумма;
            if (!безналСчёт) безналСчёт = txt(row.account);
          } else zCash += сумма;
        });
      }

      var список = выплаты.filter(function (w) { return num(w.amount); })
        .map(function (w) { return { name: txt(w.desc) || txt(w.category) || 'Выплата', sum: num(w.amount) }; });
      var суммаВыплат = 0;
      список.forEach(function (x) { суммаВыплат += x.sum; });

      if (!zCash && !zCashless && !суммаВыплат && !supp) return null;

      return {
        id: 'auron:shift:' + txt(r['ID']),
        type: 'Смена',
        date: date,
        till: 'Касса 1',
        shift: txt(r['Смена']) || '1',
        cashier: txt(r['Кассир']),
        openCash: 0,
        zCash: zCash, zCashless: zCashless,
        cashlessAccount: безналСчёт,
        /* Поставщикам из кассы — такая же выплата из ящика, как и остальные:
           отдельного поля под неё здесь нет, и городить его ради переноса
           значило бы завести вторую правду о том же числе. */
        payouts: суммаВыплат + supp,
        payoutList: supp
          ? список.concat([{ name: 'Оплачено поставщикам наличными', sum: supp }])
          : список,
        kept: kept, received: received,
        note: 'Смена записана в Auron',
        src: SRC
      };
    }).filter(Boolean);
  }

  /* --- Сотрудники --------------------------------------------------------- */
  function staff(db) {
    var seen = {}, out = [];
    rows(db, 'ТАБЕЛЬ').forEach(function (r) {
      var name = txt(r['Сотрудник']);
      if (!name || seen[name]) return;
      seen[name] = true;
      out.push({ id: 'auron:staff:' + name, name: name, rate: num(r['Ставка']), src: SRC });
    });
    return out;
  }

  /* --- Слияние ------------------------------------------------------------ */
  /* Свои записи владельца не трогаем вообще: сливаем только те, у которых
     стоит наша метка. Записи зеркала в запертом периоде оставляем как есть —
     иначе закрытый месяц менялся бы сам. */
  function mergeInto(list, fresh, closedTo) {
    var own = [], keptMirror = [];
    (list || []).forEach(function (r) {
      if (!r || r.src !== SRC) own.push(r);
      else if (closedTo && r.date && r.date <= closedTo) keptMirror.push(r);
    });
    var kept = {};
    keptMirror.forEach(function (r) { kept[r.id] = true; });
    var add = fresh.filter(function (r) {
      if (kept[r.id]) return false;
      if (closedTo && r.date && r.date <= closedTo) return false;
      return true;
    });
    return own.concat(keptMirror, add);
  }

  function readRaw(store) {
    try {
      var raw = (store || window.localStorage).getItem(AURON_KEY);
      return raw ? parseDb(raw) : null;
    } catch (e) { return null; }
  }

  function available(store) { return !!readRaw(store); }

  /* Главная точка входа: зовётся один раз при запуске.
     Возвращает, что перенесено, — это показывается владельцу. */
  function sync(S, store) {
    return syncFrom(S, readRaw(store));
  }

  /* Тот же перенос, но данные уже на руках. Внутри Auron Finance на сервере
     они приходят из таблицы владельца, а не из памяти браузера: памяти там
     может не быть вовсе. */
  function syncFrom(S, db) {
    if (!db) return null;

    var st = S.state;
    var closed = '';
    try { closed = S.closedTo ? S.closedTo() : ''; } catch (e) {}

    var acc = accounts(db);
    var kinds = {};
    acc.forEach(function (a) { kinds[txt(a.name).toLowerCase()] = a.kind; });
    var сменыId = shiftIds(db);
    var ops = operations(db, kinds, сменыId), ppl = staff(db);
    var см = shifts(db, kinds);

    /* Счёт из Auron не должен задваивать одноимённый счёт владельца:
       деньги разъедутся по двум «Наличным», и остаток перестанет сходиться. */
    var ownNames = {};
    (st.accounts || []).forEach(function (a) {
      if (a && a.src !== SRC) ownNames[txt(a.name).toLowerCase()] = true;
    });
    acc = acc.filter(function (a) { return !ownNames[txt(a.name).toLowerCase()]; });

    st.accounts = mergeInto(st.accounts, acc, '');
    st.dds = mergeInto(st.dds, ops.concat(см), closed);
    st.staff = mergeInto(st.staff, ppl, '');

    try { S.save(); } catch (e) {}

    return { accounts: acc.length, operations: ops.length + см.length,
      shifts: см.length, staff: ppl.length };
  }

  /* Назад в Auron. Полный учёт открывается в том же окне, поэтому обычно
     работает история браузера; прямой адрес — на случай, когда программу
     открыли ссылкой и возвращаться некуда. */
  function back() {
    try {
      if (window.history.length > 1) { window.history.back(); return; }
    } catch (e) {}
    window.location.href = '../index.html';
  }

  return {
    available: available, sync: sync, syncFrom: syncFrom, back: back,
    // наружу для проверок
    _rows: rows, _accounts: accounts, _operations: operations, _staff: staff,
    _shifts: shifts, _shiftIds: shiftIds,
    _mergeInto: mergeInto, _ymd: ymd, KEY: AURON_KEY, SRC: SRC
  };
});
