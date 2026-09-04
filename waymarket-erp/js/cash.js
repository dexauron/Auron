/* ============================================================================
   Касса, сейф, точки и кассиры.

   46 — инкассация как операция: сколько вынули, кому сдали, что осталось;
   47 — несколько касс и точек с раздельными остатками;
   48 — сейф отдельно от кассы: деньги ушли из ящика, но остались в магазине;
   49 — лимит выдачи из кассы за смену с предупреждением;
   50 — кто из кассиров чаще ошибается: рейтинг по расхождениям;
   66 — сверка кассы с эквайрингом по выписке банка;
   68 — «мой карман» и деньги магазина считаются отдельно.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMCash = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/ё/g, 'е'); }
  function round(v) { return Math.round(v * 100) / 100; }
  function today() { return new Date().toISOString().slice(0, 10); }

  /* --- 47/48. Где лежат деньги ----------------------------------------------
     Место хранения — обычное поле записи: «Касса», «Сейф», «Точка на рынке».
     Пустое место = главная касса, чтобы прежние записи не сломались.
     ---------------------------------------------------------------------- */
  var MAIN = 'Касса';
  var SAFE = 'Сейф';
  var POCKET = 'Мой карман';

  function placeOf(rec, settings) {
    var p = String((rec && rec.place) || '').trim();
    if (p) return p;
    return (settings && settings.mainCashName) || MAIN;
  }

  function places(state, settings) {
    var set = {}, out = [];
    [(settings && settings.mainCashName) || MAIN, SAFE].forEach(function (n) { set[norm(n)] = n; });
    splitList(settings && settings.cashPlaces).forEach(function (n) { set[norm(n)] = n; });
    (state.dds || []).forEach(function (r) {
      var p = String(r.place || '').trim();
      if (p) set[norm(p)] = p;
    });
    Object.keys(set).forEach(function (k) { out.push(set[k]); });
    return out;
  }
  function splitList(v) {
    if (typeof v !== 'string' || !v.trim()) return [];
    return v.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* --- Остатки по местам и способам оплаты ----------------------------------
     Наличные лежат в конкретном месте, безнал — на счёте. Перемещение между
     местами (инкассация, «в сейф») деньги магазина не меняет: одна запись
     уходит из ящика, другая приходит в сейф.
     ---------------------------------------------------------------------- */
  var MOVE = 'Перемещение денег';

  function isMove(rec) { return norm(rec && rec.category) === norm(MOVE); }
  function isIncomeRec(rec) { return norm(rec && rec.type) === 'приход'; }
  function isOutRec(rec) {
    var t = norm(rec && rec.type);
    return t === 'расход' || t === 'забор';
  }

  function byPlace(state, settings, upto) {
    var map = {}, list = places(state, settings);
    list.forEach(function (p) { map[norm(p)] = { place: p, cash: 0, card: 0, sbp: 0, transfer: 0, total: 0 }; });
    function cell(p) {
      var k = norm(p);
      if (!map[k]) map[k] = { place: p, cash: 0, card: 0, sbp: 0, transfer: 0, total: 0 };
      return map[k];
    }
    // начальные остатки — на главной кассе
    var main = cell((settings && settings.mainCashName) || MAIN);
    main.cash += num(settings && settings.openCashStart);
    main.card += num(settings && settings.openCardStart);
    main.sbp += num(settings && settings.openSbpStart);
    main.transfer += num(settings && settings.openTransferStart);

    (state.dds || []).forEach(function (r) {
      if (upto && r.date > upto) return;
      var c = cell(placeOf(r, settings));
      var m = norm(r.method);
      var field = m === 'сбп' ? 'sbp'
        : (m.indexOf('карт') >= 0 || m.indexOf('эквайр') >= 0) ? 'card'
        : m.indexOf('перевод') >= 0 ? 'transfer' : 'cash';
      var v = num(r.amount);
      if (isIncomeRec(r)) c[field] += v;
      else if (isOutRec(r)) c[field] -= v;
      // забор владельца — это переезд денег из кассы в его карман,
      // а не исчезновение: из магазина ушло, у владельца прибавилось
      if (norm(r.type) === 'забор') cell(POCKET)[field] += v;
    });
    var out = [];
    Object.keys(map).forEach(function (k) {
      var c = map[k];
      c.cash = round(c.cash); c.card = round(c.card);
      c.sbp = round(c.sbp); c.transfer = round(c.transfer);
      c.total = round(c.cash + c.card + c.sbp + c.transfer);
      out.push(c);
    });
    return out.sort(function (a, b) { return b.total - a.total; });
  }

  // Деньги магазина отдельно от кармана владельца (68)
  function ownerSplit(state, settings) {
    var shop = 0, pocket = 0;
    byPlace(state, settings).forEach(function (c) {
      if (norm(c.place) === norm(POCKET)) pocket += c.total; else shop += c.total;
    });
    var drawn = 0;
    (state.dds || []).forEach(function (r) {
      if (norm(r.type) === 'забор') drawn += num(r.amount);
    });
    return { shop: round(shop), pocket: round(pocket), drawn: round(drawn) };
  }

  /* --- 46. Инкассация -------------------------------------------------------- */
  // Две записи: из места «откуда» ушло, в место «куда» пришло
  function moveRecords(v, settings) {
    var sum = num(v.amount);
    if (sum <= 0) return null;
    var from = v.from || ((settings && settings.mainCashName) || MAIN);
    var to = v.to || SAFE;
    var base = { date: v.date || today(), shift: '', cashier: v.cashier || '',
      category: MOVE, method: v.method || 'Наличные', diff: 0,
      note: (v.note || '') + (v.who ? ' · сдали: ' + v.who : ''), src: 'перемещение' };
    return [
      Object.assign({}, base, { type: 'Расход', amount: sum, place: from, moveTo: to }),
      Object.assign({}, base, { type: 'Приход', amount: sum, place: to, moveFrom: from })
    ];
  }

  /* --- 49. Лимит выдачи из кассы за смену ------------------------------------ */
  function payoutWatch(state, settings, date) {
    var limit = num(settings && settings.payoutLimit);
    var d = date || today();
    var out = 0;
    (state.dds || []).forEach(function (r) {
      if (r.date !== d || !isOutRec(r) || isMove(r)) return;
      if (norm(r.method).indexOf('нал') < 0 && norm(r.method) !== '') return;
      out += num(r.amount);
    });
    out = round(out);
    return { limit: limit, spent: out, left: round(limit - out),
      over: limit > 0 && out > limit, near: limit > 0 && out > limit * 0.8 && out <= limit };
  }

  /* --- 50. Рейтинг кассиров по расхождениям ---------------------------------- */
  function cashierScore(state, settings) {
    var map = {};
    (state.dds || []).forEach(function (r) {
      var name = String(r.cashier || '').trim();
      if (!name) return;
      var k = norm(name);
      if (!map[k]) map[k] = { name: name, shifts: {}, revenue: 0, diff: 0, short: 0, over: 0, cases: 0 };
      var m = map[k];
      if (isIncomeRec(r)) m.revenue += num(r.amount);
      var d = num(r.diff);
      if (d) { m.diff += d; m.cases++; if (d < 0) m.short += -d; else m.over += d; }
      if (r.date) m.shifts[r.date + '|' + (r.shift || '')] = 1;
    });
    // пересчёты кассы по купюрам — тоже показатель точности
    (state.cashcount || []).forEach(function (c) {
      var name = String(c.cashier || '').trim();
      if (!name) return;
      var k = norm(name);
      if (!map[k]) map[k] = { name: name, shifts: {}, revenue: 0, diff: 0, short: 0, over: 0, cases: 0 };
      var d = num(c.diff);
      if (d) { map[k].diff += d; map[k].cases++; if (d < 0) map[k].short += -d; else map[k].over += d; }
    });
    var out = [];
    Object.keys(map).forEach(function (k) {
      var m = map[k];
      m.shiftCount = Object.keys(m.shifts).length;
      delete m.shifts;
      m.revenue = round(m.revenue); m.diff = round(m.diff);
      m.short = round(m.short); m.over = round(m.over);
      // «цена ошибки»: сколько недостачи на тысячу рублей выручки
      m.perThousand = m.revenue ? round(m.short / m.revenue * 1000) : 0;
      m.perShift = m.shiftCount ? round(m.short / m.shiftCount) : 0;
      out.push(m);
    });
    return out.sort(function (a, b) { return b.short - a.short || b.cases - a.cases; });
  }

  /* --- 66. Сверка кассы с эквайрингом ----------------------------------------
     Банк присылает выписку: дата и сумма зачисления. Сравниваем с тем, что
     пробито по карте, и показываем разницу по дням.
     ---------------------------------------------------------------------- */
  function acquiringCheck(state, bankRows, settings) {
    var byDay = {}, kinds = {};
    (state.dds || []).forEach(function (r) {
      var m = norm(r.method);
      var card = m.indexOf('карт') >= 0 || m.indexOf('эквайр') >= 0, sbp = m === 'сбп';
      if (!isIncomeRec(r) || (!card && !sbp)) return;
      byDay[r.date] = (byDay[r.date] || 0) + num(r.amount);
      if (!kinds[r.date]) kinds[r.date] = { card: 0, sbp: 0 };
      kinds[r.date][card ? 'card' : 'sbp'] += num(r.amount);
    });
    var bank = {};
    (bankRows || []).forEach(function (b) {
      if (!b || !b.date) return;
      bank[b.date] = (bank[b.date] || 0) + num(b.amount);
    });
    var days = {};
    Object.keys(byDay).forEach(function (d) { days[d] = 1; });
    Object.keys(bank).forEach(function (d) { days[d] = 1; });
    var fee = num(settings && settings.acquiringFee);   // комиссия банка, %
    var out = Object.keys(days).sort().map(function (d) {
      var shop = round(byDay[d] || 0), got = round(bank[d] || 0);
      var expect = round(shop * (1 - fee / 100));
      var diff = round(got - expect);
      var k = kinds[d] || { card: 0, sbp: 0 };
      return { date: d, shop: shop, bank: got, expect: expect, diff: diff,
        card: round(k.card), sbp: round(k.sbp),
        // комиссия банка — это расход магазина, а не «просто разница»
        commission: round(shop - expect),
        ok: Math.abs(diff) < 1, missing: got === 0 && shop > 0 };
    });
    return {
      rows: out,
      shopTotal: round(out.reduce(function (a, r) { return a + r.shop; }, 0)),
      bankTotal: round(out.reduce(function (a, r) { return a + r.bank; }, 0)),
      diffTotal: round(out.reduce(function (a, r) { return a + r.diff; }, 0)),
      badDays: out.filter(function (r) { return !r.ok; }).length,
      commissionTotal: round(out.reduce(function (a, r) { return a + r.commission; }, 0)),
      // сколько ещё «в пути»: пробили, а банк не зачислил
      transitTotal: round(out.reduce(function (a, r) {
        return a + (r.bank === 0 && r.shop > 0 ? r.expect : 0); }, 0)),
      fee: fee
    };
  }

  return {
    MAIN: MAIN, SAFE: SAFE, POCKET: POCKET, MOVE: MOVE,
    placeOf: placeOf, places: places, byPlace: byPlace, ownerSplit: ownerSplit,
    moveRecords: moveRecords, payoutWatch: payoutWatch,
    cashierScore: cashierScore, acquiringCheck: acquiringCheck,
    isMove: isMove
  };
});
