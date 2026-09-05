/* ============================================================================
   Ядро: числа, даты и кассовая математика.
   Никаких выгрузок 1С — программа считает только то, что вписали руками.

   ГЛАВНОЕ ПРАВИЛО, ради которого всё написано:
   в денежном ящике лежат ТОЛЬКО наличные. Карта и СБП в ящик не попадают —
   они уходят на расчётный счёт и наличный остаток не увеличивают.

       расчётный остаток = размен + Z-наличные − выплаты из ящика
       расхождение       = факт в ящике − расчётный остаток

   Расхождение со знаком минус — недостача кассира, с плюсом — излишек.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* --- Числа ---------------------------------------------------------------- */
  function txt(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return txt(v).toLowerCase().replace(/ё/g, 'е'); }

  /* Число из ячейки или поля.
     В русской записи разделитель тысяч — пробел, а запятая десятичная:
     «2,500» это 2,5. Но файл, пересохранённый в английской раскладке,
     приходит как «1,234.56» — там запятая уже разделяет тысячи. Различаем по
     тому, какой знак стоит правее: он и есть десятичный. */
  function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v)
      .replace(/[   \s]/g, '')
      .replace(/₽|руб\.?|rub|р\.$/gi, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else {
      s = s.replace(/,/g, '.');
    }
    var m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return 0;
    var n = parseFloat(m[0]);
    return isFinite(n) ? n : 0;
  }

  /* Номер строки для разобранных выгрузок 1С. Он живёт только в памяти —
     нужен, чтобы при повторной загрузке файла узнать ту же строку. */
  var UID_N = 0;
  function uid() {
    UID_N++;
    return 'r' + Date.now().toString(36) + UID_N.toString(36);
  }

  // Округление до копеек без «0.30000000000000004»
  function safeRound(v) {
    var n = num(v);
    if (!isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }
  function div(a, b) { b = num(b); return b ? num(a) / b : 0; }

  /* --- Как показываем ------------------------------------------------------- */
  function fmtNum(v, d) {
    var n = num(v);
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('ru-RU', {
      minimumFractionDigits: d == null ? 0 : d,
      maximumFractionDigits: d == null ? 0 : d
    });
  }
  function fmtMoney(v) { return fmtNum(Math.round(num(v))) + ' ₽'; }
  function fmtPct(v, d) { return fmtNum(v, d == null ? 1 : d).replace('.', ',') + '%'; }
  function plural(n, one, few, many) {
    n = Math.abs(Math.round(num(n)));
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  /* --- Даты ------------------------------------------------------------------ */
  function today() { return new Date().toISOString().slice(0, 10); }
  function addDays(date, days) {
    var d = new Date(txt(date) || today());
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + num(days));
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    var x = new Date(txt(a)), y = new Date(txt(b));
    if (isNaN(x.getTime()) || isNaN(y.getTime())) return 0;
    return Math.round((y - x) / 86400000);
  }
  function ymOf(date) { return txt(date).slice(0, 7); }
  var MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
    'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var MONTHS_IM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
    'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  function monthName(ym) { return (MONTHS_OF[+txt(ym).slice(5, 7) - 1] || '') + ' ' + txt(ym).slice(0, 4); }
  function monthTitle(ym) { return (MONTHS_IM[+txt(ym).slice(5, 7) - 1] || '') + ' ' + txt(ym).slice(0, 4); }
  function prevMonth(ym) {
    var y = +txt(ym).slice(0, 4), m = +txt(ym).slice(5, 7) - 1;
    if (m < 1) { m = 12; y--; }
    return y + '-' + (m < 10 ? '0' : '') + m;
  }
  function daysInMonth(ym) {
    return new Date(+txt(ym).slice(0, 4), +txt(ym).slice(5, 7), 0).getDate();
  }
  // Дата из ячейки Excel: и число «45900», и текст «05.09.2026», и «2026-09-05»
  function excelDate(v) {
    if (v instanceof Date && !isNaN(v.getTime())) {
      return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }
    if (typeof v === 'number' && v > 20000 && v < 90000) {
      var ms = Math.round((v - 25569) * 86400000);
      return new Date(ms).toISOString().slice(0, 10);
    }
    var s = txt(v);
    var ru = s.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})/);
    if (ru) return ru[3] + '-' + ru[2] + '-' + ru[1];
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];
    return '';
  }

  /* ==========================================================================
     КАССОВАЯ МАТЕМАТИКА
     ========================================================================== */

  var TILLS = ['Касса 1', 'Касса 2'];
  var SHIFTS = ['День', 'Ночь'];
  // Как называются записи в общей базе движения денег
  var T_SHIFT = 'Смена', T_DAY = 'День', T_IN = 'Приход', T_OUT = 'Расход',
    T_DRAW = 'Забор', T_MOVE = 'Перемещение';

  function isShift(r) { return txt(r && r.type) === T_SHIFT; }
  function isDay(r) { return txt(r && r.type) === T_DAY; }
  function isIncome(r) { return txt(r && r.type) === T_IN; }
  function isExpense(r) { return txt(r && r.type) === T_OUT; }
  function isDraw(r) { return txt(r && r.type) === T_DRAW; }
  function isMove(r) { return txt(r && r.type) === T_MOVE; }
  function isCash(method) { return norm(method) === 'наличные' || !txt(method); }

  /* ==========================================================================
     ДВЕ ОСИ, НА КОТОРЫХ ДЕРЖИТСЯ ВЕСЬ УЧЁТ

     Ось 1 — ЧТО ЭТО ЗА ДЕНЬГИ. Три разные вещи, которые нельзя мешать:
       • трата           — аренда, ЗП, ГСМ: уменьшает прибыль;
       • перемещение     — инкассация в сейф или банк, забор владельца:
                           деньги не потрачены, они лежат в другом месте,
                           прибыль НЕ уменьшается;
       • товар и долги   — закуп и погашение долга поставщику: закуп входит
                           в прибыль через себестоимость, а погашение долга
                           не расход вовсе — это возврат чужих денег.

     Ось 2 — ОТКУДА ФИЗИЧЕСКИ УШЛИ ДЕНЬГИ:
       • из ящика (fromTill) — эти деньги УЖЕ посчитаны в «выплатах из ящика»
                           при сверке смены, второй раз кассу уменьшать нельзя;
       • из сейфа        — уменьшает сейф, ящик не трогает;
       • со счёта/картой — наличные не трогает вовсе.

     Каждая формула ниже читает ровно одну ось и не лезет в чужую. Именно
     смешение этих осей и давало двойной счёт.
     ====================================================================== */

  // Статьи, которые НЕ являются тратой магазина: их место в других формулах
  var NOT_A_COST = [
    { key: 'purchase', name: 'Закуп товара', why: 'уже входит в себестоимость',
      cats: ['закуп', 'товар за наличные', 'закупка'] },
    { key: 'debt', name: 'Погашение долга поставщику', why: 'возврат денег, а не трата',
      cats: ['оплата тп', 'погашение долга', 'долг поставщик', 'оплата поставщик'] },
    { key: 'move', name: 'Перемещение денег', why: 'деньги не потрачены, а переложены',
      cats: ['инкассация', 'в сейф', 'из сейфа', 'в банк', 'перемещение', 'выплата из кассы'] }
  ];
  /* Статья не является тратой? Вернём, какая именно и почему. Нужно, чтобы
     старые записи с такими статьями не резали прибыль молча. */
  function notACost(category) {
    var c = norm(category);
    if (!c) return null;
    for (var i = 0; i < NOT_A_COST.length; i++) {
      for (var j = 0; j < NOT_A_COST[i].cats.length; j++) {
        if (c.indexOf(NOT_A_COST[i].cats[j]) >= 0) return NOT_A_COST[i];
      }
    }
    return null;
  }

  /* Уменьшает ли эта наличная запись остаток в ящике.
     Ключевое правило: расход, оплаченный ИЗ ЯЩИКА, кассу второй раз не
     уменьшает — он уже сидит в «выплатах из ящика» той смены. Расход из
     сейфа ящик тоже не трогает. Уменьшает ящик только то, что взяли из него
     помимо смены. */
  // Откуда взяли деньги: 'ящик' | 'сейф' | 'счёт' | '' (не сказано)
  function moneyFrom(r) {
    var src = norm(r && (r.source || r.from));
    if (r && r.fromTill === true) return 'ящик';
    if (src.indexOf('ящик') >= 0 || src.indexOf('касс') >= 0) return 'ящик';
    if (src.indexOf('сейф') >= 0) return 'сейф';
    if (src.indexOf('счёт') >= 0 || src.indexOf('счет') >= 0 || src.indexOf('банк') >= 0) return 'счёт';
    return '';
  }
  function hitsTill(r) {
    if (!isCash(r.method)) return false;         // карта, СБП, перевод — не ящик
    var w = moneyFrom(r);
    // из ящика — уже в выплатах смены; из сейфа или со счёта — ящик не трогают
    return w === '';
  }
  // Место, откуда берут деньги, по умолчанию — ящик: так безопаснее,
  // потому что ошибка «не вычли» видна сразу, а «вычли дважды» — нет.
  var MONEY_SOURCES = ['Из ящика', 'Из сейфа', 'Со счёта'];

  /* Сверка одной смены. Единственное место, где считается расхождение.
     Безнал (карта, СБП, QR) в расчётный остаток НЕ входит: этих денег в
     ящике не было — они ушли на расчётный счёт. */
  function shiftCalc(s) {
    s = s || {};
    var open = safeRound(s.openCash), zCash = safeRound(s.zCash);
    var zCashless = safeRound(s.zCashless), payouts = safeRound(s.payouts);
    var fact = safeRound(s.factCash);
    var expected = safeRound(open + zCash - payouts);
    var diff = safeRound(fact - expected);
    return {
      openCash: open, zCash: zCash, zCashless: zCashless, payouts: payouts,
      factCash: fact, expected: expected, diff: diff,
      revenue: safeRound(zCash + zCashless),
      short: diff < 0 ? safeRound(-diff) : 0,
      over: diff > 0 ? safeRound(diff) : 0,
      ok: Math.abs(diff) < 0.5,
      status: Math.abs(diff) < 0.5 ? 'сходится' : (diff < 0 ? 'недостача' : 'излишек')
    };
  }

  // Смены по порядку: сначала по дате, потом по кассе, потом день/ночь
  function shiftsOf(rows, filter) {
    var out = (rows || []).filter(function (r) {
      return isShift(r) && (!filter || filter(r));
    });
    return out.sort(function (a, b) {
      return txt(a.date).localeCompare(txt(b.date)) ||
        txt(a.till).localeCompare(txt(b.till)) ||
        SHIFTS.indexOf(txt(a.shift)) - SHIFTS.indexOf(txt(b.shift));
    });
  }

  /* Сколько наличных в ящиках прямо сейчас.
     Раз «факт = расчётный + расхождение», накопленное движение по кассе — это
     Σ(Z-наличные − выплаты + расхождение). Расхождение обязано входить:
     в ящике лежит факт, а не то, что должно было быть.
     Карта и СБП тут не участвуют — они не в ящике. */
  function cashOnHand(rows, settings, upto) {
    settings = settings || {};
    var cash = safeRound(settings.openCashStart);
    (rows || []).forEach(function (r) {
      if (upto && txt(r.date) > upto) return;
      if (isShift(r)) {
        var c = shiftCalc(r);
        cash += c.zCash - c.payouts + c.diff;
      } else if (isIncome(r) && isCash(r.method)) {
        cash += safeRound(r.amount);
      } else if (isMove(r)) {
        // Инкассация: из ящика в сейф или банк — и обратно, если разменивали
        if (norm(r.from) === 'касса') cash -= safeRound(r.amount);
        if (norm(r.to) === 'касса') cash += safeRound(r.amount);
      } else if ((isExpense(r) || isDraw(r)) && hitsTill(r)) {
        // hitsTill отсекает то, что уже ушло через «выплаты из ящика» смены
        cash -= safeRound(r.amount);
      }
    });
    return safeRound(cash);
  }

  /* Сколько денег в сейфе. Сейф пополняется инкассацией из кассы и тратится
     на расходы, помеченные «из сейфа». В прибыли сейф не участвует вовсе:
     переложить деньги — не значит их потратить. */
  function safeOnHand(rows, settings, upto) {
    settings = settings || {};
    var safe = safeRound(settings.openSafeStart);
    (rows || []).forEach(function (r) {
      if (upto && txt(r.date) > upto) return;
      if (isMove(r)) {
        if (norm(r.to) === 'сейф') safe += safeRound(r.amount);
        if (norm(r.from) === 'сейф') safe -= safeRound(r.amount);
      } else if ((isExpense(r) || isDraw(r)) && isCash(r.method) && moneyFrom(r) === 'сейф') {
        safe -= safeRound(r.amount);
      }
    });
    return safeRound(safe);
  }

  /* Сверка «выплаты из ящика ↔ расшифровка». За день из ящика выдали столько-то
     (сумма payouts по сменам), а расшифровано расходами «из ящика» — столько.
     Разница показывает, что деньги брали, а на что — не записали. */
  function tillPayoutCheck(rows, ym) {
    var byDay = {};
    function day(d) {
      if (!byDay[d]) byDay[d] = { date: d, payouts: 0, explained: 0 };
      return byDay[d];
    }
    (rows || []).forEach(function (r) {
      var d = txt(r.date); if (!d) return;
      if (ym && ymOf(d) !== ym) return;
      if (isShift(r)) day(d).payouts += shiftCalc(r).payouts;
      else if ((isExpense(r) || isDraw(r)) && isCash(r.method) && moneyFrom(r) === 'ящик') {
        day(d).explained += safeRound(r.amount);
      }
    });
    var rows2 = [], totalPayouts = 0, totalExplained = 0;
    Object.keys(byDay).sort().forEach(function (d) {
      var x = byDay[d];
      x.payouts = safeRound(x.payouts); x.explained = safeRound(x.explained);
      x.left = safeRound(x.payouts - x.explained);
      totalPayouts += x.payouts; totalExplained += x.explained;
      if (x.payouts || x.explained) rows2.push(x);
    });
    return { rows: rows2, payouts: safeRound(totalPayouts),
      explained: safeRound(totalExplained),
      left: safeRound(totalPayouts - totalExplained),
      // расшифровали больше, чем вообще выдали, — где-то лишняя запись
      over: totalExplained > totalPayouts + 0.5 };
  }

  /* Безналичная выручка: карта, СБП, QR. В кассу не попадает — идёт на счёт.
     Показываем отдельно, чтобы не путать с наличными. */
  function cashlessTotal(rows, from, to) {
    var sum = 0;
    (rows || []).forEach(function (r) {
      if (from && txt(r.date) < from) return;
      if (to && txt(r.date) > to) return;
      if (isShift(r)) sum += safeRound(r.zCashless);
      else if (isIncome(r) && !isCash(r.method)) sum += safeRound(r.amount);
    });
    return safeRound(sum);
  }

  /* Долг поставщикам (кредиторка). Считается ТОЛЬКО из вечерних итогов дня:
     взяли товар в долг — долг вырос, отдали деньги — уменьшился. Второго
     источника у этой цифры нет специально: две дороги к одному числу всегда
     кончаются двойным счётом. */
  function supplierDebt(rows, settings, upto) {
    settings = settings || {};
    var debt = safeRound(settings.openDebtStart);
    var taken = 0, paid = 0;
    (rows || []).forEach(function (r) {
      if (!isDay(r)) return;
      if (upto && txt(r.date) > upto) return;
      taken += safeRound(r.debtTaken);
      paid += safeRound(r.debtPaid);
    });
    return { debt: safeRound(debt + taken - paid), taken: safeRound(taken),
      paid: safeRound(paid), opening: safeRound(settings.openDebtStart) };
  }

  /* Антирейтинг кассиров: у кого чаще и на сколько не сходится касса.
     Считаем ещё и «на 1000 ₽ выручки» — иначе кассир с большой выручкой и
     парой ошибок выглядит хуже того, у кого выручка маленькая, а недостачи
     те же. */
  function cashierRating(rows, from, to) {
    var map = {};
    shiftsOf(rows, function (r) {
      if (from && txt(r.date) < from) return false;
      if (to && txt(r.date) > to) return false;
      return true;
    }).forEach(function (r) {
      var who = txt(r.cashier) || 'Без имени';
      if (!map[who]) map[who] = { name: who, shifts: 0, short: 0, over: 0,
        diff: 0, revenue: 0, badShifts: 0, worst: 0, worstDate: '' };
      var c = shiftCalc(r), m = map[who];
      m.shifts++; m.short += c.short; m.over += c.over; m.diff += c.diff;
      m.revenue += c.revenue;
      if (!c.ok) m.badShifts++;
      if (c.short > m.worst) { m.worst = c.short; m.worstDate = txt(r.date); }
    });
    var out = [];
    for (var k in map) {
      var m = map[k];
      m.short = safeRound(m.short); m.over = safeRound(m.over);
      m.diff = safeRound(m.diff); m.revenue = safeRound(m.revenue);
      m.per1000 = safeRound(div(m.short, m.revenue) * 1000);
      m.badPct = safeRound(div(m.badShifts, m.shifts) * 100);
      out.push(m);
    }
    // сверху тот, у кого недостач больше
    return out.sort(function (a, b) { return b.short - a.short || b.badShifts - a.badShifts; });
  }

  /* Размен новой смены обязан совпадать с фактом предыдущей по той же кассе.
     Не совпал — значит деньги вынули, и это надо записать, иначе учёт
     незаметно разъедется. Возвращаем список таких разрывов. */
  function cashGaps(rows) {
    var last = {}, out = [];
    shiftsOf(rows).forEach(function (r) {
      var till = txt(r.till) || TILLS[0];
      var prev = last[till];
      var c = shiftCalc(r);
      if (prev) {
        var gap = safeRound(safeRound(r.openCash) - prev.fact);
        if (Math.abs(gap) >= 1) {
          out.push({ id: r.id, date: txt(r.date), till: till, shift: txt(r.shift),
            prevDate: prev.date, prevFact: prev.fact, open: safeRound(r.openCash),
            gap: gap });
        }
      }
      last[till] = { fact: c.factCash, date: txt(r.date) };
    });
    return out;
  }

  // Остаток в каждой кассе на конец последней смены
  function tillState(rows, settings) {
    var last = {};
    shiftsOf(rows).forEach(function (r) {
      last[txt(r.till) || TILLS[0]] = { fact: shiftCalc(r).factCash,
        date: txt(r.date), shift: txt(r.shift), cashier: txt(r.cashier) };
    });
    var tills = txt(settings && settings.tills)
      ? txt(settings.tills).split(',').map(function (x) { return x.trim(); }).filter(Boolean)
      : TILLS.slice();
    return tills.map(function (t) {
      return { till: t, fact: last[t] ? last[t].fact : 0,
        date: last[t] ? last[t].date : '', shift: last[t] ? last[t].shift : '',
        cashier: last[t] ? last[t].cashier : '', closed: !!last[t] };
    });
  }

  /* Итоги за период: выручка, расходы, товар, долги. Одна функция на все
     экраны, чтобы цифры нигде не разошлись. */
  function totals(rows, settings) {
    var t = { zCash: 0, zCashless: 0, revenue: 0, payouts: 0, short: 0, over: 0,
      diff: 0, shifts: 0, badShifts: 0, expense: 0, income: 0, draw: 0,
      goodsCash: 0, debtTaken: 0, debtPaid: 0, moved: 0, collected: 0,
      notCost: 0, explained: 0, days: {}, byCategory: {} };
    (rows || []).forEach(function (r) {
      if (isShift(r)) {
        var c = shiftCalc(r);
        t.zCash += c.zCash; t.zCashless += c.zCashless; t.payouts += c.payouts;
        t.short += c.short; t.over += c.over; t.diff += c.diff;
        t.shifts++; if (!c.ok) t.badShifts++;
        if (r.date) t.days[r.date] = true;
      } else if (isDay(r)) {
        t.goodsCash += safeRound(r.goodsCash);
        t.debtTaken += safeRound(r.debtTaken);
        t.debtPaid += safeRound(r.debtPaid);
        if (r.date) t.days[r.date] = true;
      } else if (isIncome(r)) {
        t.income += safeRound(r.amount);
      } else if (isExpense(r)) {
        var cat = txt(r.category) || 'Без статьи';
        t.byCategory[cat] = safeRound((t.byCategory[cat] || 0) + safeRound(r.amount));
        // Закуп, погашение долга и инкассация расходом магазина не являются
        if (notACost(r.category)) t.notCost += safeRound(r.amount);
        else t.expense += safeRound(r.amount);
        if (isCash(r.method) && moneyFrom(r) === 'ящик') t.explained += safeRound(r.amount);
      } else if (isDraw(r)) {
        t.draw += safeRound(r.amount);
      } else if (isMove(r)) {
        t.moved += safeRound(r.amount);
        if (norm(r.to) === 'сейф' || norm(r.to) === 'банк') t.collected += safeRound(r.amount);
      }
    });
    t.revenue = safeRound(t.zCash + t.zCashless);
    ['zCash', 'zCashless', 'payouts', 'short', 'over', 'diff', 'expense',
      'income', 'draw', 'goodsCash', 'debtTaken', 'debtPaid', 'moved', 'collected',
      'notCost', 'explained'].forEach(function (k) { t[k] = safeRound(t[k]); });
    t.dayCount = Object.keys(t.days).length;
    t.avgDay = safeRound(div(t.revenue, t.dayCount));
    t.avgShift = safeRound(div(t.revenue, t.shifts));
    t.cashlessShare = safeRound(div(t.zCashless, t.revenue) * 100);
    /* Сколько денег ушло из ящика: это и есть выплаты по сменам. Складывать
       их с расходами нельзя — расходы чаще всего и есть расшифровка этих
       выплат, и сумма получилась бы вдвое больше настоящей. Отдельно считаем
       то, что взяли помимо ящика. */
    t.spentFromTill = t.payouts;
    t.spentElsewhere = safeRound(t.expense - t.explained > 0 ? t.expense - t.explained : 0);
    t.spent = safeRound(t.payouts + t.spentElsewhere);
    return t;
  }

  /* --- План выплат ----------------------------------------------------------- */
  var PLAN_STATUS = ['Запланирована', 'Оплачена', 'Отменена'];
  function planStatus(p, t) {
    t = t || today();
    var st = txt(p && p.status) || PLAN_STATUS[0];
    if (st === 'Оплачена') return { key: 'paid', name: 'Оплачена', color: 'green' };
    if (st === 'Отменена') return { key: 'off', name: 'Отменена', color: 'gray' };
    var due = txt(p && p.due);
    if (!due) return { key: 'nodate', name: 'Без даты', color: 'gray' };
    if (due < t) return { key: 'late', name: 'Просрочена', color: 'red' };
    if (due === t) return { key: 'today', name: 'Сегодня', color: 'orange' };
    if (daysBetween(t, due) <= 3) return { key: 'soon', name: 'Скоро', color: 'orange' };
    return { key: 'plan', name: 'Запланирована', color: 'blue' };
  }
  function planTotals(plans, t) {
    t = t || today();
    var r = { overdue: 0, overdueCount: 0, dueToday: 0, week: 0, planned: 0,
      plannedCount: 0, paid: 0 };
    (plans || []).forEach(function (p) {
      var st = planStatus(p, t), a = safeRound(p.amount);
      if (st.key === 'paid') { r.paid += a; return; }
      if (st.key === 'off') return;
      r.planned += a; r.plannedCount++;
      if (st.key === 'late') { r.overdue += a; r.overdueCount++; }
      if (st.key === 'today') r.dueToday += a;
      if (p.due && p.due >= t && daysBetween(t, p.due) <= 7) r.week += a;
    });
    for (var k in r) r[k] = safeRound(r[k]);
    return r;
  }

  /* --- Долги покупателей («тетрадка у кассы») -------------------------------- */
  function debtorTotals(rows, t) {
    t = t || today();
    var open = 0, closed = 0, old = 0, list = {};
    (rows || []).forEach(function (d) {
      var left = safeRound(safeRound(d.sum) - safeRound(d.paid));
      if (left <= 0) { closed += safeRound(d.sum); return; }
      open += left;
      if (daysBetween(d.date, t) > 30) old += left;
      var who = txt(d.name) || 'Без имени';
      list[who] = safeRound((list[who] || 0) + left);
    });
    var people = Object.keys(list).map(function (k) { return { name: k, left: list[k] }; })
      .sort(function (a, b) { return b.left - a.left; });
    return { open: safeRound(open), closed: safeRound(closed), old: safeRound(old), people: people };
  }

  /* ==========================================================================
     ЧИСТАЯ ПРИБЫЛЬ (P&L)

         валовая прибыль = выручка − закуп товара
         чистая прибыль  = валовая − (ФОТ + аренда + коммунальные + налоги +
                           комиссия банка + обед + ГСМ + расходники + списания)

     Два правила, без которых цифра врёт:
     1. ЗАКУП — это товар, ПОСТУПИВШИЙ за период: куплено за наличные плюс
        взято в долг. Погашение старых долгов сюда не идёт: тот товар уже
        посчитали, когда его привезли. Иначе он посчитается дважды.
     2. ВЫПЛАТЫ ИЗ ЯЩИКА в P&L не входят вообще. Это способ, которым платили,
        а не отдельная трата: аренда, оплаченная из ящика, уже стоит в своей
        статье. Выплаты нужны только для сверки кассы.
     ========================================================================== */
  var COST_KINDS = [
    { key: 'fot', name: 'Зарплата (ФОТ)', cats: ['зп', 'зарплата', 'фот', 'аванс', 'премия'] },
    { key: 'rent', name: 'Аренда', cats: ['аренда'] },
    { key: 'utilities', name: 'Коммунальные', cats: ['коммуналка', 'коммунальные', 'свет', 'электричество', 'вода', 'интернет'] },
    { key: 'taxes', name: 'Налоги', cats: ['налоги', 'налог', 'взносы', 'патент'] },
    { key: 'bank', name: 'Комиссия банка', cats: ['комиссия банка', 'эквайринг', 'банк'] },
    { key: 'lunch', name: 'Обед', cats: ['обед', 'обеды', 'питание'] },
    { key: 'fuel', name: 'ГСМ', cats: ['гсм', 'бензин', 'топливо', 'солярка'] },
    { key: 'supplies', name: 'Расходники', cats: ['расходники', 'хозрасходы', 'хозтовары', 'пакеты', 'канцтовары'] },
    { key: 'writeoff', name: 'Списания', cats: ['списание', 'списания', 'просрочка', 'бой', 'порча'] },
    { key: 'other', name: 'Прочие расходы', cats: [] }
  ];
  function costKindOf(category) {
    var c = norm(category);
    for (var i = 0; i < COST_KINDS.length; i++) {
      var k = COST_KINDS[i];
      for (var j = 0; j < k.cats.length; j++) {
        if (c === k.cats[j] || c.indexOf(k.cats[j]) === 0) return k.key;
      }
    }
    return 'other';
  }

  /* opts: { rows, payroll, writeoff1c, taxAmount }
       payroll    — начислено по табелю за период (если табель ведётся);
       writeoff1c — себестоимость списаний из отчёта 1С (если он загружен);
       taxAmount  — расчётный налог, если статьи «Налоги» в расходах нет. */
  function pnl(opts) {
    opts = opts || {};
    var rows = opts.rows || [];
    var t = totals(rows);
    var revenue = t.revenue;
    // товар, поступивший за период: куплен за наличные плюс взят в долг
    var purchase = safeRound(t.goodsCash + t.debtTaken);
    var gross = safeRound(revenue - purchase);

    var byKind = {}, sources = {}, excluded = {};
    COST_KINDS.forEach(function (k) { byKind[k.key] = 0; });
    rows.forEach(function (r) {
      if (!isExpense(r)) return;
      /* Записи, которые тратой не являются, в затраты не идут ни при каких
         условиях: закуп уже сидит в себестоимости, погашение долга — возврат
         чужих денег, инкассация — перекладывание своих. Раньше они падали в
         «прочие расходы» и молча срезали прибыль. */
      var not = notACost(r.category);
      if (not) {
        if (!excluded[not.key]) excluded[not.key] = { key: not.key, name: not.name,
          why: not.why, sum: 0, count: 0 };
        excluded[not.key].sum = safeRound(excluded[not.key].sum + safeRound(r.amount));
        excluded[not.key].count++;
        return;
      }
      byKind[costKindOf(r.category)] += safeRound(r.amount);
    });
    Object.keys(byKind).forEach(function (k) { byKind[k] = safeRound(byKind[k]); sources[k] = 'записи'; });

    // ФОТ: если ведётся табель — берём начисленное по нему, иначе статью «ЗП».
    // Складывать нельзя: одни и те же деньги попадут в затраты дважды.
    if (num(opts.payroll) > 0) { byKind.fot = safeRound(opts.payroll); sources.fot = 'табель'; }
    // Списания: если загружен отчёт 1С — берём себестоимость оттуда
    if (num(opts.writeoff1c) > 0) { byKind.writeoff = safeRound(opts.writeoff1c); sources.writeoff = '1С'; }
    // Налог: если своей записи нет, показываем расчётный
    if (!byKind.taxes && num(opts.taxAmount) > 0) {
      byKind.taxes = safeRound(opts.taxAmount); sources.taxes = 'расчёт';
    }

    var costs = COST_KINDS.map(function (k) {
      return { key: k.key, name: k.name, sum: byKind[k.key],
        source: sources[k.key] || 'записи',
        share: revenue ? safeRound(div(byKind[k.key], revenue) * 100) : 0 };
    });
    var costTotal = safeRound(costs.reduce(function (a, c) { return a + c.sum; }, 0));
    var net = safeRound(gross - costTotal);
    var exList = [];
    for (var ek in excluded) exList.push(excluded[ek]);

    return {
      revenue: revenue, purchase: purchase, gross: gross,
      grossPct: revenue ? safeRound(div(gross, revenue) * 100) : 0,
      costs: costs, costTotal: costTotal, net: net,
      netPct: revenue ? safeRound(div(net, revenue) * 100) : 0,
      draw: t.draw,
      // выплаты из ящика показываем отдельно и подписываем, что это не затрата
      payouts: t.payouts,
      debtPaid: t.debtPaid, debtTaken: t.debtTaken, goodsCash: t.goodsCash,
      // перемещения денег: инкассация в сейф и банк — прибыль не трогают
      moved: t.moved,
      // записи, которые тратой не являются и в затраты не вошли
      excluded: exList,
      excludedTotal: safeRound(exList.reduce(function (a, x) { return a + x.sum; }, 0))
    };
  }

  /* ==========================================================================
     ЗАКРЫТИЕ МЕСЯЦА

     Список того, что должно сойтись, прежде чем считать месяц закрытым.
     Каждый пункт — это конкретная дыра, через которую в отчёт попадает
     неправда. Пункт либо сходится, либо говорит, где именно смотреть.
     ====================================================================== */
  function monthClose(opts) {
    opts = opts || {};
    var all = opts.rows || [], ym = opts.ym || '';
    var rows = ym ? all.filter(function (r) { return ymOf(r.date) === ym; }) : all;
    var settings = opts.settings || {};
    var t = totals(rows);
    var items = [];

    function item(key, name, ok, said, go, hard) {
      items.push({ key: key, name: name, ok: !!ok, said: said, go: go || '',
        hard: hard !== false });
    }

    // 1. Все ли смены закрыты: дни месяца без единой смены
    var daysIn = ym ? new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate() : 0;
    var withShift = {};
    rows.forEach(function (r) { if (isShift(r)) withShift[txt(r.date)] = true; });
    var lastDay = ym === ymOf(today()) ? +today().slice(8, 10) : daysIn;
    var gaps = [];
    for (var d = 1; d <= lastDay; d++) {
      var date = ym + '-' + ('0' + d).slice(-2);
      if (!withShift[date]) gaps.push(date);
    }
    item('shifts', 'Смены закрыты за каждый день', gaps.length === 0,
      gaps.length ? 'нет смен за ' + gaps.length + ' дн.: ' +
        gaps.slice(0, 5).map(dateRuShort).join(', ') + (gaps.length > 5 ? '…' : '')
        : 'закрыто смен: ' + t.shifts, 'morning');

    // 2. Расхождения по кассе разобраны
    var crit = num(settings.diffCrit) || 1000;
    var bad = rows.filter(function (r) {
      return isShift(r) && Math.abs(shiftCalc(r).diff) >= crit;
    });
    item('diff', 'Крупные расхождения разобраны', bad.length === 0,
      bad.length ? bad.length + ' смен с расхождением от ' + fmtMoney(crit) +
        ', всего ' + fmtMoney(t.diff)
        : 'расхождение за месяц ' + fmtMoney(t.diff), 'cashiers', false);

    // 3. Выплаты из ящика расшифрованы
    var chk = tillPayoutCheck(rows, ym);
    item('payouts', 'Выплаты из ящика расшифрованы',
      Math.abs(chk.left) < 0.5 && !chk.over,
      chk.over ? 'расшифровано больше, чем выдавали, на ' + fmtMoney(-chk.left) +
        ' — где-то лишняя запись'
        : chk.left > 0 ? 'не расписано ' + fmtMoney(chk.left) + ' из ' + fmtMoney(chk.payouts)
        : 'всё сошлось: ' + fmtMoney(chk.payouts), 'ledger', false);

    // 4. Зарплата начислена и выдана
    var pay = opts.payrollRow || { accrued: 0, paid: 0, left: 0, people: 0 };
    item('payroll', 'Зарплата начислена и выдана',
      pay.accrued > 0 && Math.abs(pay.left) < 0.5,
      !pay.accrued ? 'табель за месяц пуст — ФОТ считаться не с чего'
        : pay.left > 0 ? 'не выдано ' + fmtMoney(pay.left) + ' по ' + pay.people + ' чел.'
        : 'начислено и выдано ' + fmtMoney(pay.accrued), 'payroll');

    // 5. Долг поставщикам сверен с реальностью
    var debt = supplierDebt(all, settings, ym ? ym + '-31' : '');
    item('debt', 'Долг поставщикам сверен', num(opts.debtChecked) > 0 ?
      Math.abs(num(opts.debtChecked) - debt.debt) < 0.5 : false,
      num(opts.debtChecked) > 0
        ? (Math.abs(num(opts.debtChecked) - debt.debt) < 0.5
          ? 'сходится: ' + fmtMoney(debt.debt)
          : 'по программе ' + fmtMoney(debt.debt) + ', вы вписали ' +
            fmtMoney(opts.debtChecked) + ' — разница ' +
            fmtMoney(Math.abs(debt.debt - num(opts.debtChecked))))
        : 'по программе ' + fmtMoney(debt.debt) + ' — сверьте с поставщиками',
      'suppliers', false);

    // 6. Наличные сходятся с последним пересчётом ящика
    var cash = cashOnHand(all, settings, ym ? ym + '-31' : '');
    var counts = (opts.cashcount || []).filter(function (c) {
      return !ym || ymOf(c.date) === ym;
    }).sort(function (a, b) { return txt(b.date).localeCompare(txt(a.date)); });
    var lastCount = counts[0];
    item('cash', 'Наличные сверены с пересчётом',
      !!lastCount && Math.abs(num(lastCount.sum) - cash) < 0.5,
      !lastCount ? 'в этом месяце ящик не пересчитывали'
        : Math.abs(num(lastCount.sum) - cash) < 0.5
        ? 'сходится: ' + fmtMoney(cash)
        : 'по программе ' + fmtMoney(cash) + ', насчитали ' + fmtMoney(lastCount.sum),
      'ledger', false);

    // 7. Записи, которые тратой не являются, но попали в расходы
    var p = opts.pnl || pnl({ rows: rows });
    item('clean', 'В расходах нет закупа и инкассации',
      !p.excluded || !p.excluded.length,
      p.excluded && p.excluded.length
        ? p.excluded.map(function (x) { return x.name + ' ' + fmtMoney(x.sum); }).join(', ') +
          ' — в затраты не вошли, но записи лучше поправить'
        : 'чисто', 'ledger', false);

    var hardLeft = items.filter(function (i) { return !i.ok && i.hard; }).length;
    var softLeft = items.filter(function (i) { return !i.ok && !i.hard; }).length;
    return { items: items, ym: ym, ready: hardLeft === 0,
      hardLeft: hardLeft, softLeft: softLeft,
      done: items.filter(function (i) { return i.ok; }).length, total: items.length,
      pnl: p, cash: cash, safe: safeOnHand(all, settings, ym ? ym + '-31' : ''),
      debt: debt.debt, payouts: chk };
  }

  function dateRuShort(iso) {
    var m = txt(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '.' + m[2] : txt(iso);
  }

  /* Точка безубыточности: сколько надо продать, чтобы выйти в ноль */
  function breakEven(fixedMonth, marginPct) {
    var m = num(marginPct) / 100;
    if (m <= 0) return { revenue: 0, ok: false };
    return { revenue: safeRound(div(num(fixedMonth), m)), ok: true, margin: num(marginPct) };
  }

  /* Какого числа месяца магазин отбил постоянные расходы */
  function breakEvenDay(rows, fixedMonth, marginPct, ym) {
    var need = breakEven(fixedMonth, marginPct);
    if (!need.ok) return { ok: false };
    var byDay = {};
    rows.forEach(function (r) {
      if (ym && ymOf(r.date) !== ym) return;
      if (isShift(r)) byDay[r.date] = (byDay[r.date] || 0) + shiftCalc(r).revenue;
    });
    var days = Object.keys(byDay).sort(), run = 0, hit = '';
    var rowsOut = days.map(function (d) {
      run += byDay[d];
      if (!hit && run >= need.revenue) hit = d;
      return { date: d, day: safeRound(byDay[d]), run: safeRound(run),
        left: safeRound(Math.max(0, need.revenue - run)) };
    });
    return { ok: true, need: need.revenue, rows: rowsOut, day: hit,
      dayNum: hit ? +hit.slice(8, 10) : 0, total: safeRound(run) };
  }

  /* --- Пересчёт купюр -------------------------------------------------------- */
  var NOMINALS = [5000, 2000, 1000, 500, 200, 100, 50, 10, 5, 2, 1];
  function countCash(counts) {
    var sum = 0, pieces = 0;
    NOMINALS.forEach(function (n) {
      var c = Math.max(0, Math.round(num(counts && counts['n' + n])));
      sum += n * c; pieces += c;
    });
    return { sum: safeRound(sum), pieces: pieces };
  }


  /* ==========================================================================
     КОНТУР 2: РАЗБОР ВЫГРУЗОК 1С
     Живёт отдельно от ручного учёта. Эти функции только читают файлы и
     считают товарную аналитику; в базу оперативных записей они не пишут
     ничего — данные держатся в памяти браузера, пока открыта программа.
     ========================================================================== */
  var HEADER_SCAN_ROWS = 22;

  // Склеиваем текст шапки по каждой колонке: колонка 8 в «Остатках» —
  // это «Группа товара» + «Номенклатура.Входит в группу».
  function columnTitles(matrix, headerEnd) {
    var titles = [];
    for (var r = 0; r <= headerEnd && r < matrix.length; r++) {
      var row = matrix[r] || [];
      for (var c = 0; c < row.length; c++) {
        var t = txt(row[c]);
        if (!t) continue;
        titles[c] = (titles[c] ? titles[c] + ' ' : '') + t;
      }
    }
    for (var i = 0; i < titles.length; i++) titles[i] = norm(titles[i] || '');
    return titles;
  }

  // Ищем колонку по ключевым словам (все слова из группы должны встретиться)
  function findCol(titles, variants, opts) {
    opts = opts || {};
    for (var v = 0; v < variants.length; v++) {
      var words = variants[v];
      for (var c = 0; c < titles.length; c++) {
        if (opts.skip && opts.skip.indexOf(c) >= 0) continue;
        var t = titles[c] || '';
        if (!t) continue;
        var ok = true;
        for (var w = 0; w < words.length; w++) {
          if (t.indexOf(words[w]) < 0) { ok = false; break; }
        }
        if (opts.not) {
          for (var n2 = 0; n2 < opts.not.length; n2++) {
            if (t.indexOf(opts.not[n2]) >= 0) { ok = false; break; }
          }
        }
        if (ok) return c;
      }
    }
    return -1;
  }

  // Ячейка с числом (дата «12.02.2026» числом не считается — в ней две точки)
  function isNumericCell(v) {
    if (typeof v === 'number') return isFinite(v);
    if (typeof v !== 'string') return false;
    var t = v.replace(/[   ]/g, '').trim();
    return t !== '' && /^-?\d+(?:[.,]\d+)?$/.test(t);
  }

  // Конец шапки = последняя строка с «заголовочными» словами ДО начала данных.
  // Важно: в отчётах «Причины списания/возврата» слово «Склад» стоит и в данных
  // («Основной склад»), поэтому шапка обязана обрываться на первой строке данных,
  // иначе первые полтора десятка позиций просто теряются.
  function findHeaderEnd(matrix, keywords) {
    var last = -1;
    var limit = Math.min(matrix.length, HEADER_SCAN_ROWS);
    for (var r = 0; r < limit; r++) {
      var row = matrix[r] || [];
      var joined = norm(row.map(txt).join(' '));
      var nums = 0;
      for (var c = 0; c < row.length; c++) if (isNumericCell(row[c])) nums++;
      var hasKeyword = false;
      for (var k = 0; k < keywords.length; k++) {
        if (joined && joined.indexOf(keywords[k]) >= 0) { hasKeyword = true; break; }
      }
      if (last >= 0 && (nums >= 2 || (nums >= 1 && !hasKeyword))) break; // пошли данные
      if (hasKeyword) last = r;
    }
    return last;
  }

  // Строки-итоги и служебные строки, которые нельзя считать товаром.
  // Именно из-за них прошлые сводки задваивали выручку.
  var STOP_NAMES = ['итого', 'всего', 'общий итог', 'итого:', 'итог'];
  function isTotalRow(name) {
    var n = norm(name);
    if (!n) return true;
    for (var i = 0; i < STOP_NAMES.length; i++) if (n === STOP_NAMES[i] || n.indexOf(STOP_NAMES[i] + ' ') === 0) return true;
    return false;
  }

  /* --- 3. Определение вида файла ----------------------------------------- */

  function sheetSignature(matrix) {
    var lines = [];
    for (var r = 0; r < Math.min(matrix.length, HEADER_SCAN_ROWS); r++) {
      lines.push((matrix[r] || []).map(txt).join(' '));
    }
    return norm(lines.join(' | '));
  }

  // Вид файла определяем по содержимому (имя файла — только подсказка),
  // чтобы переименованная выгрузка всё равно попала в нужный модуль.
  function detectKind(fileName, matrix, sheetNames) {
    var sig = sheetSignature(matrix);
    var fn = norm(fileName || '');
    var sn = norm((sheetNames || []).join(' '));

    // Книга финансового учёта: листы БАЗА_ДДС / Ввод_Касса / Запись_Выплат
    if (sn.indexOf('база_ддс') >= 0 || sn.indexOf('ввод_касса') >= 0 ||
        (sn.indexOf('пульт') >= 0 && sn.indexOf('настройки') >= 0)) return 'finance_book';
    // Ручная книга владельца: листы ДДС / ОПЛАТА / ПЛАТЕЖКА / ОТЧЁТ
    if (sn.indexOf('ддс') >= 0 || sn.indexOf('платежка') >= 0 || sn.indexOf('кассовая книга') >= 0) return 'owner_book';
    if (sn.indexOf('журнал_смен') >= 0 || sn.indexOf('журнал смен') >= 0 ||
        sn.indexOf('накладные_и_выплаты') >= 0) return 'journal_shifts';
    if (sn.indexOf('табель_смен') >= 0 || sn.indexOf('выплаты_и_авансы') >= 0) return 'journal_staff';

    // Отчёт «Неликвидные товары»: что лежит без движения
    if (sig.indexOf('неликвидные товары') >= 0 ||
        (sig.indexOf('процент продаж от остатка') >= 0 && sig.indexOf('конечный остаток') >= 0)) return 'deadstock';
    // Регистр «Общие доходы и расходы»: обороты по статьям и контрагентам.
    // Проверяем раньше накладных — в нём накладные встречаются как регистраторы
    if (sig.indexOf('общиедоходыирасходы') >= 0 || sig.indexOf('общие доходы и расходы') >= 0 ||
        (sig.indexOf('статья доходов') >= 0 && sig.indexOf('статья расходов') >= 0)) return 'incexp1c';
    if (sig.indexOf('текущие цены поставщиков') >= 0) return 'prices';
    if (sig.indexOf('контактная информация') >= 0 && sig.indexOf('контрагент') >= 0) return 'contacts';
    // Кассовые ордера проверяем раньше накладных: в ордерах накладная стоит
    // в колонке «Документ основание», иначе отчёт по кассе примут за поставки
    if (sig.indexOf('расходный кассовый ордер') >= 0) return 'cashout';
    if (sig.indexOf('приходный кассовый ордер') >= 0) return 'cashin';
    if (sig.indexOf('приходная накладная') >= 0) return 'invoices1c';
    if (sig.indexOf('прайс-лист') >= 0 || sig.indexOf('закупочный тип цен') >= 0) return 'pricelist';
    if (sig.indexOf('сумма продажи') >= 0 && sig.indexOf('номенклатура') >= 0) return 'sales';
    if (sig.indexOf('остатки номенклатуры') >= 0 ||
        (sig.indexOf('приходная сумма') >= 0 && sig.indexOf('розничная цена') >= 0)) return 'stock';
    if (sig.indexOf('штрих код') >= 0 && sig.indexOf('номенклатура') >= 0) return 'barcodes';
    if (sig.indexOf('единицы измерения') >= 0 && sig.indexOf('коэффициент') >= 0) return 'units';
    if (sig.indexOf('причина списания') >= 0 || sig.indexOf('причины списания') >= 0) return 'writeoffs1c';
    if (sig.indexOf('причина возврата') >= 0 || sig.indexOf('причины возврата') >= 0) return 'returns';
    if (sig.indexOf('списан') >= 0 || sig.indexOf('брак') >= 0 || fn.indexOf('списан') >= 0 || fn.indexOf('брак') >= 0) return 'writeoffs';
    if (fn.indexOf('возврат') >= 0) return 'returns';

    // Подсказки по имени файла — если внутри непривычная шапка
    if (fn.indexOf('продаж') >= 0) return 'sales';
    if (fn.indexOf('остатк') >= 0) return 'stock';
    if (fn.indexOf('цены') >= 0 && fn.indexOf('поставщик') >= 0) return 'prices';
    if (fn.indexOf('контакт') >= 0) return 'contacts';
    if (fn.indexOf('прайс') >= 0) return 'pricelist';
    if (fn.indexOf('штрихкод') >= 0 || fn.indexOf('штрих код') >= 0) return 'barcodes';
    if (fn.indexOf('единиц') >= 0) return 'units';
    if (fn.indexOf('неликвид') >= 0) return 'deadstock';
    if (fn.indexOf('доходы и расходы') >= 0) return 'incexp1c';
    return 'unknown';
  }

  /* --- 4. Разбор конкретных отчётов -------------------------------------- */

  // «Период: 01.08.2026 - 31.08.2026» из шапки отчёта
  function parsePeriod(matrix) {
    var sig = sheetSignature(matrix);
    var m = sig.match(/(\d{2}\.\d{2}\.\d{4})\s*[-–—]\s*(\d{2}\.\d{2}\.\d{4})/);
    if (!m) return null;
    return { from: m[1], to: m[2], days: daysBetween(m[1], m[2]) };
  }

  function ruDateToISO(d) {
    var m = txt(d).match(/(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
  }
  function parseSales(matrix) {
    var he = findHeaderEnd(matrix, ['номенклатура', 'сумма продажи', 'себестоимость']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['номенклатура']]),
      qty: findCol(t, [['количество']], { not: ['ед.отч'] }),
      buyPrice: findCol(t, [['усредненная цена закупки'], ['цена закупки']]),
      cogs: findCol(t, [['себестоимость продажи']], { not: ['%'] }),
      inSum: findCol(t, [['приходная сумма продажи']]),
      sellPrice: findCol(t, [['усредненная цена продажи']]),
      revenue: findCol(t, [['сумма продажи']], { not: ['приходная'] }),
      vat: findCol(t, [['сумма ндс']]),
      discount: findCol(t, [['сумма скидки']]),
      profit: findCol(t, [['прибыль']], { not: ['рентабельность', '%'] }),
      markup: findCol(t, [['процент наценки']], { not: ['доп'] }),
      abc: findCol(t, [['класс abc'], ['abc']]),
      xyz: findCol(t, [['класс xyz'], ['xyz']])
    };
    if (col.name < 0 || col.revenue < 0) return { rows: [], period: parsePeriod(matrix), cols: col };

    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (isTotalRow(name) && name) continue;
      var revenue = num(row[col.revenue]);
      var cogs = col.cogs >= 0 ? num(row[col.cogs]) : (col.inSum >= 0 ? num(row[col.inSum]) : 0);
      if (revenue === 0 && cogs === 0) continue;
      // Позиция без имени в 1С (переименована или помечена на удаление) — суммы у неё
      // настоящие, поэтому строку сохраняем, иначе итог дашборда не сойдётся с отчётом
      if (!name) name = 'Без наименования';
      rows.push({
        name: name,
        key: norm(name),
        qty: col.qty >= 0 ? num(row[col.qty]) : 0,
        buyPrice: col.buyPrice >= 0 ? num(row[col.buyPrice]) : 0,
        sellPrice: col.sellPrice >= 0 ? num(row[col.sellPrice]) : 0,
        revenue: revenue,
        cogs: cogs,
        profit: safeRound(revenue - cogs),
        discount: col.discount >= 0 ? num(row[col.discount]) : 0,
        abcSrc: col.abc >= 0 ? txt(row[col.abc]) : '',
        xyzSrc: col.xyz >= 0 ? txt(row[col.xyz]) : ''
      });
    }
    return { rows: rows, period: parsePeriod(matrix), cols: col };
  }

  // Остатки_Номенклатуры.xls
  function parseStock(matrix) {
    var he = findHeaderEnd(matrix, ['номенклатура', 'штрих', 'приходная', 'розничная', 'базовая единица', 'группа товара']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['номенклатура']], { not: ['артикул', 'код', 'штрих', 'группа', 'единица'] }),
      article: findCol(t, [['артикул']]),
      code: findCol(t, [['код товара'], ['номенклатура.код']]),
      barcode: findCol(t, [['штрих']]),
      group: findCol(t, [['группа товара'], ['входит в группу']]),
      unit: findCol(t, [['базовая единица'], ['единица']]),
      qty: findCol(t, [['количество']], { not: ['ед.отч'] }),
      buyPrice: findCol(t, [['приходная цена']]),
      buySum: findCol(t, [['приходная сумма']]),
      markup: findCol(t, [['процент наценки']]),
      retailPrice: findCol(t, [['розничная цена']]),
      retailSum: findCol(t, [['розничная сумма']])
    };
    if (col.name < 0) col.name = 0;

    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (isTotalRow(name) && name) continue;
      var barcode = col.barcode >= 0 ? txt(row[col.barcode]) : '';
      var group = col.group >= 0 ? txt(row[col.group]) : '';
      var unit = col.unit >= 0 ? txt(row[col.unit]) : '';
      var buyPrice0 = col.buyPrice >= 0 ? num(row[col.buyPrice]) : 0;
      var retailPrice0 = col.retailPrice >= 0 ? num(row[col.retailPrice]) : 0;
      // Строка склада («Основной склад») несёт итоги: у неё нет ни реквизитов, ни цен
      if (!barcode && !group && !unit && !buyPrice0 && !retailPrice0) continue;
      if (!name) name = 'Без наименования';
      rows.push({
        name: name,
        key: norm(name),
        article: col.article >= 0 ? txt(row[col.article]) : '',
        code: col.code >= 0 ? txt(row[col.code]).replace(/\.0$/, '') : '',
        barcode: barcode.replace(/\.0$/, ''),
        group: group || 'Без группы',
        unit: unit,
        qty: col.qty >= 0 ? num(row[col.qty]) : 0,
        buyPrice: buyPrice0,
        buySum: col.buySum >= 0 ? num(row[col.buySum]) : 0,
        retailPrice: retailPrice0,
        retailSum: col.retailSum >= 0 ? num(row[col.retailSum]) : 0
      });
    }
    return { rows: rows, cols: col };
  }

  // Цены_Поставщиков.xls («Текущие цены поставщиков»)
  function parsePrices(matrix) {
    var he = findHeaderEnd(matrix, ['номенклатура', 'контрагент', 'цена', 'штрихкод', 'группа']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['номенклатура']], { not: ['артикул', 'код', 'штрих', 'группа', 'единица'] }),
      supplier: findCol(t, [['контрагент']]),
      price: findCol(t, [['цена']], { not: ['тип цен'] }),
      barcode: findCol(t, [['штрих']]),
      unit: findCol(t, [['единица']]),
      group: findCol(t, [['группа'], ['входит в группу']]),
      date: findCol(t, [['период']]),
      article: findCol(t, [['артикул']]),
      code: findCol(t, [['номенклатура.код'], ['код']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (!name || isTotalRow(name)) continue;
      var price = num(row[col.price]);
      if (price <= 0) continue;
      rows.push({
        name: name,
        key: norm(name),
        supplier: col.supplier >= 0 ? txt(row[col.supplier]) : '',
        price: price,
        barcode: col.barcode >= 0 ? txt(row[col.barcode]).replace(/\.0$/, '') : '',
        unit: col.unit >= 0 ? txt(row[col.unit]) : '',
        group: col.group >= 0 ? txt(row[col.group]) : '',
        date: col.date >= 0 ? txt(row[col.date]) : '',
        article: col.article >= 0 ? txt(row[col.article]) : ''
      });
    }
    return { rows: rows, cols: col };
  }

  // Контакты_Поставщиков.xls — справочник контрагентов с телефонами
  function parseContacts(matrix) {
    var he = findHeaderEnd(matrix, ['контрагент', 'контактная информация', 'телефон']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['контрагент']], { not: ['контактная'] }),
      phone: findCol(t, [['контактная информация'], ['телефон']])
    };
    if (col.name < 0) col.name = 0;
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (!name || isTotalRow(name)) continue;
      var phone = col.phone >= 0 ? txt(row[col.phone]).replace(/\.0$/, '') : '';
      rows.push({ name: name, key: norm(name), phone: phone });
    }
    return { rows: rows, cols: col };
  }

  // Прайслист.xls — товары сгруппированы: строка группы, под ней товары
  function parsePricelist(matrix) {
    var he = findHeaderEnd(matrix, ['номенклатура', 'штрих-код', 'закупочный тип цен', 'розничный тип цен']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['номенклатура']]),
      barcode: findCol(t, [['штрих']]),
      code: findCol(t, [['код']], { not: ['штрих'] }),
      buy: findCol(t, [['закупочный тип цен'], ['закупочн']]),
      retail: findCol(t, [['розничный тип цен'], ['розничн']])
    };
    if (col.name < 0) col.name = 0;
    var rows = [], group = 'Без группы';
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (!name || isTotalRow(name)) continue;
      var buy = col.buy >= 0 ? num(row[col.buy]) : 0;
      var retail = col.retail >= 0 ? num(row[col.retail]) : 0;
      var barcode = col.barcode >= 0 ? txt(row[col.barcode]).replace(/\.0$/, '') : '';
      if (buy === 0 && retail === 0 && !barcode) { group = name; continue; } // строка-группа
      rows.push({
        name: name, key: norm(name), group: group, barcode: barcode,
        code: col.code >= 0 ? txt(row[col.code]).replace(/\.0$/, '') : '',
        buy: buy, retail: retail
      });
    }
    return { rows: rows, cols: col };
  }

  function parseBarcodes(matrix) {
    var he = findHeaderEnd(matrix, ['штрих код', 'штрихкод', 'номенклатура', 'единица']);
    var t = columnTitles(matrix, he);
    var col = {
      barcode: findCol(t, [['штрих']]),
      unit: findCol(t, [['единица']]),
      name: findCol(t, [['номенклатура']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var bc = col.barcode >= 0 ? txt(row[col.barcode]).replace(/\.0$/, '') : '';
      var nm = col.name >= 0 ? txt(row[col.name]) : '';
      if (!bc || !nm) continue;
      rows.push({ barcode: bc, name: nm, key: norm(nm), unit: col.unit >= 0 ? txt(row[col.unit]) : '' });
    }
    return { rows: rows, cols: col };
  }

  function parseUnits(matrix) {
    var he = findHeaderEnd(matrix, ['единицы измерения', 'коэффициент', 'количество в упаковке']);
    var t = columnTitles(matrix, he);
    var col = {
      unit: findCol(t, [['единицы измерения']]),
      code: findCol(t, [['номенклатура.код'], ['код']]),
      inPack: findCol(t, [['количество в упаковке']]),
      coef: findCol(t, [['коэффициент']], { not: ['цены'] })
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var code = col.code >= 0 ? txt(row[col.code]).replace(/\.0$/, '') : '';
      if (!code) continue;
      rows.push({
        code: code,
        unit: col.unit >= 0 ? txt(row[col.unit]) : '',
        inPack: col.inPack >= 0 ? num(row[col.inPack]) : 0,
        coef: col.coef >= 0 ? num(row[col.coef]) : 1
      });
    }
    return { rows: rows, cols: col };
  }

  // Списания_Брак.xlsx — свободная форма: дата / товар / кол-во / сумма / причина
  function parseWriteoffs(matrix) {
    var he = findHeaderEnd(matrix, ['дата', 'товар', 'номенклатура', 'сумма', 'причина', 'количество']);
    var t = columnTitles(matrix, he);
    var col = {
      date: findCol(t, [['дата']]),
      name: findCol(t, [['товар'], ['номенклатура']]),
      qty: findCol(t, [['количество'], ['кол-во']]),
      sum: findCol(t, [['сумма']]),
      reason: findCol(t, [['причина'], ['основание'], ['примечание']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = col.name >= 0 ? txt(row[col.name]) : '';
      if (!name || isTotalRow(name)) continue;
      rows.push({
        id: uid(),
        date: excelDate(col.date >= 0 ? row[col.date] : ''),
        name: name,
        qty: col.qty >= 0 ? num(row[col.qty]) : 0,
        sum: col.sum >= 0 ? num(row[col.sum]) : 0,
        reason: col.reason >= 0 ? txt(row[col.reason]) : ''
      });
    }
    return { rows: rows, cols: col };
  }

  // Отчёт 1С «Причины списания»: номенклатура / склад / партия / причина / суммы.
  // Себестоимость берём из «Приходной суммы» — это деньги, которые магазин потерял.
  function parseWriteoffs1C(matrix) {
    var he = findHeaderEnd(matrix, ['номенклатура', 'причина списания', 'партия', 'склад', 'приходная сумма']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['номенклатура']]),
      warehouse: findCol(t, [['склад']]),
      batch: findCol(t, [['партия']]),
      reason: findCol(t, [['причина списания'], ['причина']]),
      qty: findCol(t, [['количество']], { not: ['записей'] }),
      cost: findCol(t, [['приходная сумма в регламентной'], ['приходная сумма'], ['себестоимость']]),
      retail: findCol(t, [['розничная сумма']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (name && isTotalRow(name)) continue;
      var wh = col.warehouse >= 0 ? txt(row[col.warehouse]) : '';
      var batch = col.batch >= 0 ? txt(row[col.batch]) : '';
      if (!wh && !batch) continue;
      rows.push({
        id: uid(),
        name: name || 'Без наименования',
        key: norm(name),
        warehouse: wh,
        batch: batch,
        reason: (col.reason >= 0 ? txt(row[col.reason]) : '') || 'Без причины',
        qty: col.qty >= 0 ? num(row[col.qty]) : 0,
        cost: col.cost >= 0 ? num(row[col.cost]) : 0,
        retail: col.retail >= 0 ? num(row[col.retail]) : 0
      });
    }
    return { rows: rows, period: parsePeriod(matrix), cols: col };
  }

  /* Синхронизация списаний с файлом 1С (Upsert).

     Файл — это правда за свой период. Поэтому:
       • строки того же периода, что и в файле, заменяются тем, что в файле:
         совпавшие обновляются (сумма и количество берутся новые, номер строки
         остаётся прежним), новые добавляются, а те, которых в файле больше
         нет, из аналитики стираются;
       • строки других периодов не трогаются — иначе загрузка августа стёрла бы
         июль, и в отчёте о прибыли пропали бы уже посчитанные списания.
     Ключ строки — товар + партия + склад + причина: именно так одну и ту же
     позицию печатает 1С в каждой выгрузке.
     ------------------------------------------------------------------------ */
  function periodKey(p) {
    return p && p.from ? txt(p.from) + '..' + txt(p.to) : 'без периода';
  }
  function writeoffKey(r) {
    return [norm(r.name), norm(r.batch), norm(r.warehouse), norm(r.reason)].join('|');
  }
  function syncWriteoffs(existing, incoming, period) {
    var pk = periodKey(period);
    var from = period && period.from ? ruDateToISO(period.from) : '';
    var to = period && period.to ? ruDateToISO(period.to) : '';
    var old = {}, kept = [], i;

    for (i = 0; i < (existing || []).length; i++) {
      var e = existing[i];
      if (txt(e.periodKey) === pk) old[writeoffKey(e)] = e;   // тот же период — под замену
      else kept.push(e);                                      // чужой период — не трогаем
    }

    var rows = [], stats = { updated: 0, added: 0, removed: 0, kept: kept.length };
    for (i = 0; i < (incoming || []).length; i++) {
      var n = incoming[i], k = writeoffKey(n);
      var prev = old[k];
      var row = {
        id: prev ? prev.id : n.id,
        name: n.name, key: n.key, warehouse: n.warehouse, batch: n.batch,
        reason: n.reason, qty: n.qty, cost: n.cost, retail: n.retail,
        periodKey: pk, from: from, to: to,
        // дата нужна отчётам по месяцам: берём конец периода выгрузки
        date: to || from || ''
      };
      if (prev) { stats.updated++; delete old[k]; } else { stats.added++; }
      rows.push(row);
    }
    for (var k2 in old) stats.removed++;      // были в базе, в файле их больше нет

    return { rows: kept.concat(rows), stats: stats };
  }

  // Отчёт 1С «Причины возврата»: причина / склад / договор / номенклатура / суммы
  function parseReturns(matrix) {
    var he = findHeaderEnd(matrix, ['причина возврата', 'номенклатура', 'договор', 'склад', 'приходная сумма']);
    var t = columnTitles(matrix, he);
    var col = {
      reason: findCol(t, [['причина возврата'], ['причина']]),
      warehouse: findCol(t, [['склад']]),
      contract: findCol(t, [['договор']]),
      name: findCol(t, [['номенклатура']]),
      qty: findCol(t, [['количество']], { not: ['записей'] }),
      cost: findCol(t, [['приходная сумма в регламентной'], ['приходная сумма'], ['себестоимость']]),
      retail: findCol(t, [['розничная сумма']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = col.name >= 0 ? txt(row[col.name]) : '';
      var first = txt(row[0]);
      if (first && isTotalRow(first)) continue;
      if (!name) continue;
      rows.push({
        id: uid(),
        name: name,
        key: norm(name),
        reason: (col.reason >= 0 ? txt(row[col.reason]) : '') || 'Без причины',
        warehouse: col.warehouse >= 0 ? txt(row[col.warehouse]) : '',
        contract: col.contract >= 0 ? txt(row[col.contract]) : '',
        qty: col.qty >= 0 ? num(row[col.qty]) : 0,
        cost: col.cost >= 0 ? num(row[col.cost]) : 0,
        retail: col.retail >= 0 ? num(row[col.retail]) : 0
      });
    }
    return { rows: rows, period: parsePeriod(matrix), cols: col };
  }

  // Свод «по причине»: сколько денег ушло и какая доля от общей суммы
  function byReason(rows) {
    var map = {}, total = 0, i;
    for (i = 0; i < rows.length; i++) {
      var k = rows[i].reason || 'Без причины';
      if (!map[k]) map[k] = { reason: k, qty: 0, cost: 0, retail: 0, docs: 0 };
      map[k].qty += num(rows[i].qty); map[k].cost += num(rows[i].cost);
      map[k].retail += num(rows[i].retail); map[k].docs++;
      total += num(rows[i].cost);
    }
    var out = [];
    for (var k2 in map) {
      var m = map[k2];
      m.qty = safeRound(m.qty); m.cost = safeRound(m.cost); m.retail = safeRound(m.retail);
      m.share = safeRound(div(m.cost, total) * 100);
      out.push(m);
    }
    return out.sort(function (a, b) { return b.cost - a.cost; });
  }

  // Топ позиций по сумме потерь (списания или возвраты)
  function topByCost(rows, limit) {
    var map = {};
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].key || norm(rows[i].name);
      if (!map[k]) map[k] = { name: rows[i].name, qty: 0, cost: 0, retail: 0, docs: 0, reasons: {} };
      map[k].qty += num(rows[i].qty); map[k].cost += num(rows[i].cost);
      map[k].retail += num(rows[i].retail); map[k].docs++;
      map[k].reasons[rows[i].reason] = true;
    }
    var out = [];
    for (var k2 in map) {
      var m = map[k2];
      m.qty = safeRound(m.qty); m.cost = safeRound(m.cost); m.retail = safeRound(m.retail);
      m.reason = Object.keys(m.reasons).join(', ');
      delete m.reasons;
      out.push(m);
    }
    out.sort(function (a, b) { return b.cost - a.cost; });
    return limit ? out.slice(0, limit) : out;
  }

  // Приведение суммы за произвольный период к месяцу (30 дней) — для P&L
  function perMonth(sum, days) {
    var d = num(days);
    return d > 0 ? safeRound(num(sum) / d * 30) : safeRound(sum);
  }

  // Дата из имени документа 1С: «Приходная накладная ПФ000… от 01.08.2026 10:21:25»
  function docDate(name) {
    var m = txt(name).match(/от\s+(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
  }

  // Отчёт 1С «Приходная накладная» — реальные поставки за период
  function parseIncomingInvoices(matrix) {
    var he = findHeaderEnd(matrix, ['приходная накладная', 'контрагент', 'сумма документа', 'склад', 'договор']);
    var t = columnTitles(matrix, he);
    var col = {
      doc: findCol(t, [['приходная накладная']]),
      // «Дата документа» — когда товар пришёл в магазин.
      // «Входящая дата документа» — дата на бумаге поставщика, она другая:
      // поставщик выписал накладную 30 июля, а привёз 1 августа.
      date: findCol(t, [['дата документа']], { not: ['входящ'] }),
      incomingDate: findCol(t, [['входящая дата документа']]),
      incomingNo: findCol(t, [['входящий номер документа']]),
      supplier: findCol(t, [['контрагент']]),
      contract: findCol(t, [['договор']], { not: ['спецификация'] }),
      warehouse: findCol(t, [['склад']]),
      storeman: findCol(t, [['кладовщик']]),
      author: findCol(t, [['автор']], { not: ['не используется'] }),
      payDate: findCol(t, [['дата оплаты']]),
      sum: findCol(t, [['сумма документа прих']]),
      retail: findCol(t, [['сумма документа розница']]),
      comment: findCol(t, [['комментарий']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var doc = txt(row[col.doc]);
      if (!doc || isTotalRow(doc)) continue;
      // Дата прихода — дата самого документа 1С (она стоит в его названии
      // «…от 01.08.2026»). По ней считаются день, месяц и отсрочка платежа.
      // Раньше бралась входящая дата поставщика — из-за этого приход
      // попадал в другой день, а то и в прошлый месяц.
      var date = docDate(doc) || (col.date >= 0 ? excelDate(row[col.date]) : '');
      var incoming = col.incomingDate >= 0 ? excelDate(row[col.incomingDate]) : '';
      if (!date) date = incoming;
      rows.push({
        id: uid(),
        doc: doc,
        key: norm(doc),
        date: date,
        incomingDate: incoming,
        incomingNo: col.incomingNo >= 0 ? txt(row[col.incomingNo]) : '',
        supplier: (col.supplier >= 0 ? txt(row[col.supplier]) : '') || 'Без контрагента',
        contract: col.contract >= 0 ? txt(row[col.contract]) : '',
        warehouse: col.warehouse >= 0 ? txt(row[col.warehouse]) : '',
        storeman: col.storeman >= 0 ? txt(row[col.storeman]) : '',
        author: col.author >= 0 ? txt(row[col.author]) : '',
        payDate: col.payDate >= 0 ? excelDate(row[col.payDate]) : '',
        sum: col.sum >= 0 ? num(row[col.sum]) : 0,
        retail: col.retail >= 0 ? num(row[col.retail]) : 0,
        comment: col.comment >= 0 ? txt(row[col.comment]) : ''
      });
    }
    return { rows: rows, period: parsePeriod(matrix), cols: col };
  }

  // Отчёт 1С «Расходный/Приходный кассовый ордер» — движение наличных
  function parseCashOrders(matrix, direction) {
    var he = findHeaderEnd(matrix, ['кассовый ордер', 'вид операции', 'статья ддс', 'контрагент', 'касса']);
    var t = columnTitles(matrix, he);
    var col = {
      doc: findCol(t, [['кассовый ордер']]),
      operation: findCol(t, [['вид операции']]),
      article: findCol(t, [['статья ддс'], ['статья доходов и расходов']]),
      basis: findCol(t, [['документ основание'], ['основание']]),
      supplier: findCol(t, [['контрагент']]),
      cashbox: findCol(t, [['касса']], { not: ['счет', 'кассир'] }),
      cashier: findCol(t, [['кассир']]),
      employee: findCol(t, [['сотрудник']], { not: ['не используется'] }),
      shiftNo: findCol(t, [['номер смены']]),
      zReport: findCol(t, [['учет z-отчетов'], ['учет z']]),
      comment: findCol(t, [['комментарий']]),
      sum: findCol(t, [['сумма']], { not: ['ндс', 'планиру', 'валют', 'кратность'] })
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var doc = txt(row[col.doc]);
      if (!doc || isTotalRow(doc)) continue;
      var basis = col.basis >= 0 ? txt(row[col.basis]) : '';
      rows.push({
        id: uid(),
        doc: doc,
        date: docDate(doc),
        direction: direction || 'out',
        operation: col.operation >= 0 ? txt(row[col.operation]) : '',
        article: (col.article >= 0 ? txt(row[col.article]) : '') || 'Без статьи',
        basis: basis,
        basisKey: norm(basis),
        supplier: (col.supplier >= 0 ? txt(row[col.supplier]) : '') || '',
        cashbox: col.cashbox >= 0 ? txt(row[col.cashbox]) : '',
        cashier: col.cashier >= 0 ? txt(row[col.cashier]) : '',
        employee: col.employee >= 0 ? txt(row[col.employee]) : '',
        shiftNo: col.shiftNo >= 0 ? txt(row[col.shiftNo]).replace(/\.0$/, '') : '',
        zReport: col.zReport >= 0 ? txt(row[col.zReport]) : '',
        comment: col.comment >= 0 ? txt(row[col.comment]) : '',
        sum: col.sum >= 0 ? num(row[col.sum]) : 0
      });
    }
    return { rows: rows, period: parsePeriod(matrix), cols: col };
  }

  // Отчёт 1С «Неликвидные товары»: приход, продажи и остаток в штуках,
  // плюс дата последнего поступления — по ней видно, сколько товар лежит.
  function parseDeadStock(matrix) {
    var he = findHeaderEnd(matrix, ['неликвидные товары', 'номенклатура', 'конечный остаток', 'продажи', 'склад']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['номенклатура'], ['склад']], { not: ['артикул', 'код', 'штрих'] }),
      inSum: findCol(t, [['общий приход']]),
      income: findCol(t, [['поступление']], { not: ['дата'] }),
      lastIn: findCol(t, [['дата последнего поступ']]),
      left: findCol(t, [['конечный остаток']]),
      sold: findCol(t, [['продажи']], { not: ['процент', 'тип'] }),
      pctIn: findCol(t, [['процент продаж от поступ'], ['процент продаж от прих']]),
      pctLeft: findCol(t, [['процент продаж от остатка']])
    };
    if (col.name < 0) col.name = 0;
    var rows = [], i;
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (!name || isTotalRow(name)) continue;
      if (norm(name).indexOf('склад') >= 0 && norm(name).length < 20) continue;   // строка склада
      var left = col.left >= 0 ? num(row[col.left]) : 0;
      var sold = col.sold >= 0 ? num(row[col.sold]) : 0;
      var lastIn = col.lastIn >= 0 ? excelDate(row[col.lastIn]) : '';
      rows.push({
        name: name, key: norm(name),
        inSum: col.inSum >= 0 ? num(row[col.inSum]) : 0,
        income: col.income >= 0 ? num(row[col.income]) : 0,
        lastIn: lastIn,
        left: left, sold: sold,
        pctIn: col.pctIn >= 0 ? num(row[col.pctIn]) : 0,
        pctLeft: col.pctLeft >= 0 ? num(row[col.pctLeft]) : 0
      });
    }
    return { rows: rows, period: parsePeriod(matrix), cols: col };
  }

  // Замороженные деньги: что лежит на полке и не продаётся.
  // Цену берём из «Остатков номенклатуры», давность — по последнему приходу.
  function deadStockList(rows, stockIdx, settings, todayStr) {
    settings = settings || {};
    var maxPct = num(settings.deadSoldPct) || 20;      // продали меньше этого % от остатка
    var days = num(settings.deadDays) || 60;           // и завозили давно
    var today = todayStr || new Date().toISOString().slice(0, 10);
    var out = [], total = 0, noSale = 0;
    for (var i = 0; i < (rows || []).length; i++) {
      var r = rows[i];
      var left = safeRound(r.left);
      if (left <= 0) continue;                          // на полке ничего нет — не о чем говорить
      var age = r.lastIn ? Math.round((new Date(today) - new Date(r.lastIn)) / 86400000) : null;
      var slow = r.sold <= 0 || (r.pctLeft > 0 && r.pctLeft < maxPct);
      var old = age !== null && age >= days;
      if (!slow && !old) continue;
      var st = stockIdx ? stockIdx[r.key] : null;
      var price = st ? num(st.buyPrice) : 0;
      var money = safeRound(left * price);
      total += money;
      if (r.sold <= 0) noSale++;
      out.push({
        name: r.name, key: r.key, left: left, sold: safeRound(r.sold),
        lastIn: r.lastIn, age: age, price: price, money: money,
        group: st ? st.group : '',
        pctLeft: r.pctLeft,
        reason: r.sold <= 0 ? 'нет продаж' : (old ? 'лежит ' + age + ' дн.' : 'продаётся медленно')
      });
    }
    out.sort(function (a, b) { return b.money - a.money || b.left - a.left; });
    return { list: out, total: safeRound(total), count: out.length, noSale: noSale };
  }

  // Регистр 1С «Общие доходы и расходы»: иерархия «вид операции → статья →
  // контрагент → документ». Уровень определяем по суммам: сумма родителя
  // равна сумме его строк, поэтому разбираем стеком.
  // Документ 1С узнаём по номеру вида «ПФ0000040007665» — так надёжнее,
  // чем список названий: документы бывают самые разные.
  var DOC_RE = /(ПФ|АА|ЦБ)\d{6,}|№\s*\d+\s+от\s+\d{2}\.\d{2}\.\d{4}/i;

  function parseIncomeExpense(matrix) {
    var he = findHeaderEnd(matrix, ['вид операции', 'приход', 'расход', 'статья доходов',
      'статья расходов', 'регистратор', 'количество записей']);
    var t = columnTitles(matrix, he);
    var col = {
      name: 0,
      income: findCol(t, [['приход']], { not: ['статья', 'вид', 'количество'] }),
      expense: findCol(t, [['расход']], { not: ['статья', 'вид', 'количество'] }),
      count: findCol(t, [['количество записей']])
    };
    if (col.income < 0) col.income = 5;
    if (col.expense < 0) col.expense = 7;

    var stack = [], rows = [], totals = null;
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      var inc = num(row[col.income]), exp = num(row[col.expense]);
      var sum = inc + exp;
      if (!name && !sum) continue;
      if (isTotalRow(name)) continue;
      // первая строка без имени — общий итог отчёта
      if (totals === null && !name && !stack.length) { totals = { income: inc, expense: exp }; continue; }

      // уровень определяем по суммам: сумма родителя равна сумме его строк
      while (stack.length && stack[stack.length - 1].rest + 0.01 < sum) stack.pop();
      if (stack.length) stack[stack.length - 1].rest = safeRound(stack[stack.length - 1].rest - sum);

      if (DOC_RE.test(name)) {
        rows.push({
          operation: stack[0] ? stack[0].name : '',
          article: stack[1] ? stack[1].name : '',
          party: stack[2] ? stack[2].name : '',
          // самый глубокий заполненный уровень — обычно это контрагент или статья
          group: (stack[2] && stack[2].name) || (stack[1] && stack[1].name) || '',
          doc: name, date: docDate(name),
          income: safeRound(inc), expense: safeRound(exp),
          count: col.count >= 0 ? num(row[col.count]) : 1
        });
      } else {
        stack.push({ name: name, rest: sum });
      }
    }
    if (!totals) {
      totals = { income: 0, expense: 0 };
      rows.forEach(function (x) { totals.income += x.income; totals.expense += x.expense; });
    }
    totals.income = safeRound(totals.income); totals.expense = safeRound(totals.expense);
    return { rows: rows, totals: totals, period: parsePeriod(matrix), cols: col };
  }

  // Свод: по видам операций, по статьям и по контрагентам
  function incomeExpenseSummary(rows) {
    function group(field) {
      var map = {};
      (rows || []).forEach(function (r) {
        var k = r[field] || '—';
        if (!map[k]) map[k] = { name: k, income: 0, expense: 0, count: 0 };
        map[k].income += r.income; map[k].expense += r.expense; map[k].count++;
      });
      var out = [];
      for (var k in map) {
        map[k].income = safeRound(map[k].income); map[k].expense = safeRound(map[k].expense);
        map[k].net = safeRound(map[k].income - map[k].expense);
        out.push(map[k]);
      }
      return out.sort(function (a, b) { return (b.income + b.expense) - (a.income + a.expense); });
    }
    return { byOperation: group('operation'), byArticle: group('article'),
      byParty: group('party'), byGroup: group('group') };
  }

  // Сопоставление накладных и оплат: сколько заплатили сразу, сколько ушло
  // на погашение старых долгов и сколько магазин должен поставщикам сейчас.
  function matchPayments(invoices, orders) {
    var paidByDoc = {}, i;
    var oldDebtPaid = 0, matchedPaid = 0, orphan = [];
    var invKeys = {};
    for (i = 0; i < invoices.length; i++) invKeys[invoices[i].key] = true;

    for (i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (!o.basisKey) continue;
      if (invKeys[o.basisKey]) {
        paidByDoc[o.basisKey] = (paidByDoc[o.basisKey] || 0) + num(o.sum);
        matchedPaid += num(o.sum);
      } else {
        // оплата по накладной вне периода выгрузки = погашение старого долга
        oldDebtPaid += num(o.sum);
        orphan.push(o);
      }
    }

    var docs = [], totalSum = 0, totalLeft = 0, overpaid = 0;
    for (i = 0; i < invoices.length; i++) {
      var inv = invoices[i];
      var paid = safeRound(paidByDoc[inv.key] || 0);
      var left = Math.max(0, safeRound(num(inv.sum) - paid));
      // переплата по документу не уменьшает долг по другим накладным — считаем отдельно
      overpaid += Math.max(0, safeRound(paid - num(inv.sum)));
      totalSum += num(inv.sum); totalLeft += left;
      docs.push({
        doc: inv.doc, date: inv.date, supplier: inv.supplier, sum: safeRound(inv.sum),
        retail: safeRound(inv.retail), paid: paid, left: left,
        status: left === 0 ? 'paid' : (paid > 0 ? 'part' : 'debt'),
        statusText: left === 0 ? 'Оплачено 100%' : (paid > 0 ? 'Частичный долг' : 'В долг 100%')
      });
    }
    docs.sort(function (a, b) { return b.left - a.left || (b.date || '').localeCompare(a.date || ''); });

    return {
      docs: docs,
      totalSum: safeRound(totalSum),
      totalPaid: safeRound(matchedPaid),
      totalLeft: safeRound(totalLeft),
      overpaid: safeRound(overpaid),
      oldDebtPaid: safeRound(oldDebtPaid),
      orphan: orphan
    };
  }

  // Свод по поставщикам: поставки, оплаты, текущий долг
  function supplierBalance(invoices, orders) {
    var map = {}, i, k;
    function slot(name) {
      var key = norm(name) || '—';
      if (!map[key]) map[key] = { supplier: name || '—', docs: 0, sum: 0, paid: 0, paidNow: 0, paidDebt: 0 };
      return map[key];
    }
    for (i = 0; i < invoices.length; i++) {
      var m = slot(invoices[i].supplier);
      m.docs++; m.sum += num(invoices[i].sum);
    }
    for (i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (!o.supplier) continue;
      var m2 = slot(o.supplier);
      m2.paid += num(o.sum);
      if (norm(o.article).indexOf('сразу') >= 0) m2.paidNow += num(o.sum);
      else if (norm(o.article).indexOf('долг') >= 0) m2.paidDebt += num(o.sum);
    }
    var out = [];
    for (k in map) {
      var v = map[k];
      v.sum = safeRound(v.sum); v.paid = safeRound(v.paid);
      v.paidNow = safeRound(v.paidNow); v.paidDebt = safeRound(v.paidDebt);
      v.debt = safeRound(v.sum - v.paid);
      out.push(v);
    }
    return out.sort(function (a, b) { return b.debt - a.debt; });
  }

  // Свод выплат наличными по статьям и кассам
  function cashSummary(orders) {
    var byArticle = {}, byCashbox = {}, byOperation = {}, total = 0, shifts = {};
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i], s = num(o.sum);
      total += s;
      byArticle[o.article] = safeRound((byArticle[o.article] || 0) + s);
      if (o.cashbox) byCashbox[o.cashbox] = safeRound((byCashbox[o.cashbox] || 0) + s);
      if (o.operation) byOperation[o.operation] = safeRound((byOperation[o.operation] || 0) + s);
      if (o.shiftNo) shifts[o.shiftNo] = safeRound((shifts[o.shiftNo] || 0) + s);
    }
    function toList(obj) {
      var out = [];
      for (var k in obj) out.push({ name: k, sum: obj[k], share: safeRound(div(obj[k], total) * 100) });
      return out.sort(function (a, b) { return b.sum - a.sum; });
    }
    return {
      total: safeRound(total), byArticle: toList(byArticle),
      byCashbox: toList(byCashbox), byOperation: toList(byOperation), byShift: shifts
    };
  }

  // Дата из ячейки: «2026-08-18», «18.08.2026», Date, серийный номер Excel
  function pad2(x) { return String(x).length < 2 ? '0' + x : String(x); }

  /* --- 5. Журналы из Excel (смены, накладные, табель, выплаты) ------------ */

  function rowsByHeader(matrix) {
    // Первая непустая строка — заголовки, дальше данные (наши журналы простые)
    var start = 0;
    while (start < matrix.length && !(matrix[start] || []).some(function (c) { return txt(c); })) start++;
    var head = (matrix[start] || []).map(norm);
    var out = [];
    for (var r = start + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var first = txt(row[0]);
      if (!first || isTotalRow(first)) continue;
      var obj = {};
      for (var c = 0; c < head.length; c++) if (head[c]) obj[head[c]] = row[c];
      obj.__row = row;
      out.push(obj);
    }
    return { head: head, rows: out };
  }

  function pick(obj, variants) {
    for (var v = 0; v < variants.length; v++) {
      for (var k in obj) {
        if (k === '__row') continue;
        if (k.indexOf(variants[v]) >= 0) return obj[k];
      }
    }
    return '';
  }

  /* --- 5б. Ручная книга владельца (ДДС, ОПЛАТА, ПЛАТЕЖКА, ОТЧЁТ) ---------- */

  // Лист «ДДС»: одна строка = одна смена. Ведётся вручную каждый день.
  /* --- 6. Расчёты: продажи, склад, цены ---------------------------------- */

  function salesTotals(sales) {
    var revenue = 0, cogs = 0, qty = 0, discount = 0;
    for (var i = 0; i < sales.length; i++) {
      revenue += sales[i].revenue; cogs += sales[i].cogs;
      qty += sales[i].qty; discount += sales[i].discount;
    }
    revenue = safeRound(revenue); cogs = safeRound(cogs);
    var gross = safeRound(revenue - cogs);
    return {
      revenue: revenue, cogs: cogs, gross: gross, qty: safeRound(qty), discount: safeRound(discount),
      margin: safeRound(div(gross, revenue) * 100),   // маржинальность = ВП / выручка
      markup: safeRound(div(gross, cogs) * 100),      // наценка = ВП / себестоимость
      positions: sales.length
    };
  }

  // ABC по выручке (A — первые 80% оборота, B — до 95%, C — остальное)
  function abcClassify(sales) {
    var sorted = sales.slice().sort(function (a, b) { return b.revenue - a.revenue; });
    var total = 0, i;
    for (i = 0; i < sorted.length; i++) total += sorted[i].revenue;
    var acc = 0;
    for (i = 0; i < sorted.length; i++) {
      acc += sorted[i].revenue;
      var share = div(acc, total);
      sorted[i].abc = share <= 0.8 ? 'A' : (share <= 0.95 ? 'B' : 'C');
      sorted[i].share = safeRound(div(sorted[i].revenue, total) * 100);   // доля позиции в обороте
      sorted[i].shareCum = safeRound(share * 100);                        // накопленная доля
    }
    return sorted;
  }

  function stockTotals(stock) {
    var buySum = 0, retailSum = 0, qty = 0, zero = 0;
    for (var i = 0; i < stock.length; i++) {
      buySum += stock[i].buySum; retailSum += stock[i].retailSum; qty += stock[i].qty;
      if (stock[i].qty <= 0) zero++;
    }
    return {
      buySum: safeRound(buySum), retailSum: safeRound(retailSum),
      qty: safeRound(qty), sku: stock.length, zeroSku: zero
    };
  }

  // Индекс «товар → группа» для разреза продаж по категориям
  function groupIndex(stock, prices) {
    var idx = {};
    var i;
    for (i = 0; i < stock.length; i++) if (stock[i].group) idx[stock[i].key] = stock[i].group;
    for (i = 0; i < prices.length; i++) if (!idx[prices[i].key] && prices[i].group) idx[prices[i].key] = prices[i].group;
    return idx;
  }

  function salesByGroup(sales, idx) {
    var map = {};
    for (var i = 0; i < sales.length; i++) {
      var g = idx[sales[i].key] || 'Без группы';
      if (!map[g]) map[g] = { group: g, qty: 0, revenue: 0, cogs: 0, items: 0 };
      map[g].qty += sales[i].qty; map[g].revenue += sales[i].revenue;
      map[g].cogs += sales[i].cogs; map[g].items++;
    }
    var out = [];
    for (var k in map) {
      var m = map[k];
      m.qty = safeRound(m.qty); m.revenue = safeRound(m.revenue); m.cogs = safeRound(m.cogs);
      m.gross = safeRound(m.revenue - m.cogs);
      m.margin = safeRound(div(m.gross, m.revenue) * 100);
      out.push(m);
    }
    return out.sort(function (a, b) { return b.revenue - a.revenue; });
  }

  // Лучшая цена по каждому товару среди всех поставщиков
  function bestPriceIndex(prices) {
    var best = {};
    for (var i = 0; i < prices.length; i++) {
      var p = prices[i];
      if (!best[p.key] || p.price < best[p.key].price) best[p.key] = p;
    }
    return best;
  }

  // Матрица сравнения: по товару — все предложения, экономия к минимуму
  function priceComparison(prices, contactsIdx, limitItems) {
    var byItem = {};
    for (var i = 0; i < prices.length; i++) {
      var p = prices[i];
      if (!byItem[p.key]) byItem[p.key] = { name: p.name, key: p.key, group: p.group, barcode: p.barcode, offers: [] };
      byItem[p.key].offers.push(p);
    }
    var out = [];
    for (var k in byItem) {
      var it = byItem[k];
      it.offers.sort(function (a, b) { return a.price - b.price; });
      it.min = it.offers[0].price;
      it.max = it.offers[it.offers.length - 1].price;
      it.spread = safeRound(it.max - it.min);
      it.bestSupplier = it.offers[0].supplier;
      it.bestPhone = contactsIdx ? (contactsIdx[norm(it.offers[0].supplier)] || '') : '';
      it.suppliers = it.offers.length;
      out.push(it);
    }
    out.sort(function (a, b) { return b.spread - a.spread; });
    return limitItems ? out.slice(0, limitItems) : out;
  }

  function contactsIndex(contacts) {
    var idx = {};
    for (var i = 0; i < contacts.length; i++) if (contacts[i].phone) idx[contacts[i].key] = contacts[i].phone;
    return idx;
  }

  /* --- 7. Расчёты: касса, накладные, зарплата ---------------------------- */

  // Расчетный остаток = остаток утро + Z-отчет нал - выплаты из кассы
  /* --- Зарплата: табель и ведомость ФОТ ----------------------------------
     Смена в табеле — это часы днём и часы ночью. Ночные дороже: ставка
     берётся своя. Порядок, откуда берём ставку: сначала то, что вписали
     в саму смену, потом карточка сотрудника, потом настройки магазина.
     Оклад к часам не прибавляется — это другая схема оплаты, и складывать
     их значит заплатить дважды за одну работу.
     ---------------------------------------------------------------------- */

  function rateOf(t, person, settings, night) {
    if (num(t && t.rate)) return num(t.rate);                    // вписали в смену
    if (person) {
      if (night && num(person.rateNight)) return num(person.rateNight);
      if (num(person.rate)) return num(person.rate);
    }
    return num(settings && (night ? settings.rateNight : settings.rateDay));
  }

  function timesheetCalc(t, person, settings) {
    t = t || {};
    var hd = num(t.hoursDay), hn = num(t.hoursNight);
    if (!hd && !hn && num(t.hours)) hd = num(t.hours);           // записи старого образца
    var rd = rateOf(t, person, settings, false);
    var rn = rateOf(t, person, settings, true);
    var pay = safeRound(hd * rd + hn * rn);
    var bonus = safeRound(num(t.bonus));
    var fine = safeRound(num(t.fine) || num(t.penalty));
    return {
      hoursDay: hd, hoursNight: hn, hours: safeRound(hd + hn),
      rateDay: rd, rateNight: rn, pay: pay, bonus: bonus, fine: fine,
      total: safeRound(pay + bonus - fine)
    };
  }

  /* Недостачи и излишки кассира за период. Нужны ведомости ФОТ: недостачу
     принято удерживать из зарплаты. Сама по себе эта сумма зарплату НЕ
     трогает — она лишь показывает, сколько можно удержать. Удержание
     становится настоящим только когда владелец впишет его в табель:
     иначе одна и та же недостача уменьшила бы и кассу, и ФОТ автоматически,
     а сотрудник об этом бы не знал. */
  function cashierShortages(rows) {
    var map = {}, order = [];
    (rows || []).forEach(function (r) {
      if (!isShift(r)) return;
      var c = shiftCalc(r);
      if (c.ok) return;
      var name = txt(r.cashier) || '—', k = norm(name);
      if (!map[k]) { map[k] = { cashier: name, short: 0, over: 0, shifts: 0 }; order.push(k); }
      map[k].short += c.short; map[k].over += c.over; map[k].shifts++;
    });
    return order.map(function (k) {
      var m = map[k];
      m.short = safeRound(m.short); m.over = safeRound(m.over);
      m.net = safeRound(m.short - m.over);          // чистая недостача за период
      return m;
    }).sort(function (a, b) { return b.net - a.net; });
  }

  // Ведомость ФОТ: начислено по табелю (или оклад) − выданное = остаток к выдаче
  function payrollSummary(timesheet, payouts, staff, settings, opts) {
    opts = opts || {};
    var map = {}, order = [], i, k;
    function idx(name) {
      var key = norm(name) || '—';
      if (!map[key]) {
        var p = personOf(staff, name);
        map[key] = { employee: txt(name) || '—', position: p ? txt(p.position) : '',
          salary: p ? num(p.salary) : 0, normShifts: p ? num(p.normShifts) : 0,
          fired: p ? txt(p.fired) : '',
          shifts: 0, hoursDay: 0, hoursNight: 0, hours: 0,
          pay: 0, bonus: 0, fine: 0, accrued: 0, advance: 0, paid: 0 };
        order.push(key);
      }
      return map[key];
    }
    function personOf(list, name) {
      var key = norm(name);
      var found = null;
      (list || []).forEach(function (p) { if (norm(p.name) === key) found = p; });
      return found;
    }

    (staff || []).forEach(function (p) { if (!txt(p.fired)) idx(p.name); });

    // Сколько у человека недостач по кассе за тот же период — справочно
    var shortByName = {};
    cashierShortages(opts.dds || []).forEach(function (c) { shortByName[norm(c.cashier)] = c; });

    for (i = 0; i < (timesheet || []).length; i++) {
      var t = timesheet[i];
      var m = idx(t.employee);
      var c = timesheetCalc(t, personOf(staff, t.employee), settings);
      m.shifts++;
      m.hoursDay += c.hoursDay; m.hoursNight += c.hoursNight; m.hours += c.hours;
      m.pay += c.pay; m.bonus += c.bonus; m.fine += c.fine;
    }
    for (i = 0; i < (payouts || []).length; i++) {
      var p2 = payouts[i], mm = idx(p2.employee);
      var sum = safeRound(num(p2.amount));
      mm.paid += sum;
      if (txt(p2.kind).toLowerCase().indexOf('аванс') >= 0) mm.advance += sum;
    }

    var out = [];
    for (k = 0; k < order.length; k++) {
      var r = map[order[k]];
      ['hoursDay', 'hoursNight', 'hours', 'pay', 'bonus', 'fine', 'paid', 'advance']
        .forEach(function (f) { r[f] = safeRound(r[f]); });
      /* Оклад заменяет часы: у кого оклад, тому часы идут только в табель.
         Но оклад не начисляется тому, кто в этом месяце не выходил ни разу,
         а если норма смен задана и человек её не добрал — оклад считается
         пропорционально отработанному. Иначе месяц отпуска стоил бы как
         полный рабочий. */
      var base;
      if (r.salary > 0) {
        var norma = num(r.normShifts);
        if (!r.shifts) base = 0;
        else if (norma > 0 && r.shifts < norma) base = safeRound(r.salary / norma * r.shifts);
        else base = r.salary;
      } else {
        base = r.pay;
      }
      r.base = safeRound(base);
      r.scheme = r.salary > 0 ? 'оклад' : 'по часам';
      r.accrued = safeRound(base + r.bonus - r.fine);
      r.left = safeRound(r.accrued - r.paid);
      /* Недостачи по кассе — отдельно от начисления. Показываем, сколько
         недостач числится и сколько из них уже удержано в табеле, чтобы
         одну недостачу не удержать дважды. */
      var sh = shortByName[order[k]];
      r.shortage = sh ? sh.net : 0;
      r.withheld = r.fine;
      r.canWithhold = safeRound(Math.max(0, r.shortage - r.fine));
      out.push(r);
    }
    if (!opts.keepEmpty) out = out.filter(function (r) { return r.shifts || r.accrued || r.paid; });
    return out.sort(function (a, b) { return b.accrued - a.accrued; });
  }

  // Итог ведомости одной строкой
  function payrollTotals(list) {
    var t = { people: 0, shifts: 0, hours: 0, accrued: 0, paid: 0, advance: 0,
      left: 0, bonus: 0, fine: 0, shortage: 0, canWithhold: 0 };
    (list || []).forEach(function (r) {
      t.people++; t.shifts += r.shifts; t.hours += r.hours;
      t.accrued += r.accrued; t.paid += r.paid; t.advance += r.advance;
      t.bonus += r.bonus; t.fine += r.fine;
      t.shortage += num(r.shortage); t.canWithhold += num(r.canWithhold);
    });
    t.left = safeRound(t.accrued - t.paid);
    ['hours', 'accrued', 'paid', 'advance', 'bonus', 'fine', 'shortage',
      'canWithhold'].forEach(function (f) { t[f] = safeRound(t[f]); });
    return t;
  }

  // Кто работает сейчас: уволенные в формы не предлагаются
  function activeStaff(staff, on) {
    var d = on || today();
    return (staff || []).filter(function (p) {
      if (txt(p.fired) && txt(p.fired) <= d) return false;
      if (txt(p.hired) && txt(p.hired) > d) return false;
      return true;
    });
  }

  /* --- 7б. Ручной учёт: поставки и оплаты поставщикам --------------------- */
  // Владелец записывает накладную (что привезли) и оплату (что отдал).
  // Долг поставщику = сумма поставок − сумма оплат.

  /* --- 8. Точка безубыточности, P&L, ROP, FEFO --------------------------- */

  // BEP = постоянные расходы / маржинальность
  function bep(fixedMonth, marginPct, revenueMonth) {
    var m = num(marginPct) / 100;
    var bepMonth = m > 0 ? safeRound(num(fixedMonth) / m) : 0;
    var bepDay = safeRound(bepMonth / 30);
    var bepWeek = safeRound(bepDay * 7);
    var rev = num(revenueMonth);
    var doneP = bepMonth > 0 ? safeRound(div(rev, bepMonth) * 100) : 0;
    var safety = rev > 0 ? safeRound(div(rev - bepMonth, rev) * 100) : 0;
    var avgDay = safeRound(rev / 30);
    var bepDayOfMonth = avgDay > 0 ? Math.ceil(bepMonth / avgDay) : 0;
    return {
      fixedMonth: safeRound(fixedMonth), margin: safeRound(marginPct),
      month: bepMonth, week: bepWeek, day: bepDay,
      revenue: rev, done: doneP, safety: safety,
      dayOfMonth: bepDayOfMonth, avgDay: avgDay,
      profitable: rev >= bepMonth
    };
  }

  // P&L: выручка - COGS = ВП; ВП - OPEX = чистая прибыль
  function priceFor(buy, markupPct, step) {
    var raw = num(buy) * (1 + num(markupPct) / 100);
    var st = num(step) || 1;
    if (!raw) return 0;
    return safeRound(Math.ceil(raw / st) * st);
  }

  function ropList(sales, stock, days, settings, bestPrices) {
    var stockIdx = {}, i;
    for (i = 0; i < stock.length; i++) stockIdx[stock[i].key] = stock[i];
    var lead = num(settings.leadDays) || 2;
    var safetyPct = num(settings.safetyPct) || 30;
    var cover = num(settings.coverDays) || 0;      // на сколько дней держим запас
    var d = num(days) || 30;
    var out = [];
    for (i = 0; i < sales.length; i++) {
      var s = sales[i];
      var st = stockIdx[s.key];
      var demand = safeRound(div(s.qty, d));
      if (demand <= 0) continue;
      var safety = safeRound(demand * lead * safetyPct / 100);
      var rop = safeRound(demand * lead + safety);
      var have = st ? st.qty : 0;
      if (have > rop) continue;
      // заказываем столько, чтобы хватило и на плечо поставки, и на нужное покрытие
      var order = Math.ceil(Math.max(rop + demand * lead, demand * (lead + cover)) - have);
      if (order <= 0) continue;
      var bp = bestPrices ? bestPrices[s.key] : null;
      out.push({
        name: s.name, key: s.key,
        group: st ? st.group : '',
        stock: safeRound(have), demand: demand, lead: lead, rop: rop,
        order: order,
        price: bp ? bp.price : (st ? st.buyPrice : s.buyPrice),
        supplier: bp ? bp.supplier : '',
        sum: safeRound(order * (bp ? bp.price : (st ? st.buyPrice : s.buyPrice))),
        critical: have <= 0
      });
    }
    return out.sort(function (a, b) { return b.sum - a.sum; });
  }

  // FEFO-светофор по сроку годности
  function fefoStatus(bestBefore, settings, today) {
    var crit = num(settings.fefoCrit) || 2;      // дней
    var warn = num(settings.fefoWarn) || 5;
    var d0 = today ? new Date(today) : new Date();
    var d1 = new Date(bestBefore);
    if (isNaN(d1)) return { days: null, level: 'none', discount: 0, action: 'Дата не указана' };
    var days = Math.floor((d1 - new Date(d0.toISOString().slice(0, 10))) / 86400000);
    if (days < 0) return { days: days, level: 'expired', discount: 100, action: 'Просрочено — снять с полки и списать' };
    if (days <= crit) return { days: days, level: 'crit', discount: num(settings.discountCrit) || 30, action: 'Уценка и выкладка в прикассовую зону' };
    if (days <= warn) return { days: days, level: 'warn', discount: num(settings.discountWarn) || 15, action: 'Ротация: первая линия полки' };
    return { days: days, level: 'ok', discount: 0, action: 'Обычная реализация' };
  }

  /* --- 9. Умный поиск ----------------------------------------------------- */

  function search(query, data, scope, limit) {
    var q = norm(query);
    if (!q) return [];
    var lim = limit || 200;
    var out = [], i, r;
    function add(type, name, cols) {
      out.push({ type: type, name: name, cols: cols });
    }
    if ((scope === 'all' || scope === 'sales') && data.sales) {
      for (i = 0; i < data.sales.length && out.length < lim; i++) {
        r = data.sales[i];
        if (r.key.indexOf(q) >= 0) add('Продажи 1С', r.name, [fmtNum(r.qty, 2), fmtMoney(r.revenue), fmtMoney(r.profit)]);
      }
    }
    if ((scope === 'all' || scope === 'stock') && data.stock) {
      for (i = 0; i < data.stock.length && out.length < lim; i++) {
        r = data.stock[i];
        if (r.key.indexOf(q) >= 0 || (r.barcode && r.barcode.indexOf(q) >= 0) || (r.code && r.code.indexOf(q) >= 0) || norm(r.article).indexOf(q) >= 0)
          add('Остатки склада', r.name, [r.barcode || '—', fmtNum(r.qty, 2) + ' ' + r.unit, fmtMoney(r.retailPrice)]);
      }
    }
    if ((scope === 'all' || scope === 'prices') && data.prices) {
      for (i = 0; i < data.prices.length && out.length < lim; i++) {
        r = data.prices[i];
        if (r.key.indexOf(q) >= 0 || norm(r.supplier).indexOf(q) >= 0 || (r.barcode && r.barcode.indexOf(q) >= 0))
          add('Цены поставщиков', r.name, [r.supplier, fmtMoney(r.price), r.date || '—']);
      }
    }
    if ((scope === 'all' || scope === 'contacts') && data.contacts) {
      for (i = 0; i < data.contacts.length && out.length < lim; i++) {
        r = data.contacts[i];
        if (r.key.indexOf(q) >= 0 || (r.phone && r.phone.indexOf(q.replace(/\D/g, '')) >= 0 && q.replace(/\D/g, '')))
          add('Контакты', r.name, [r.phone || '—', '', '']);
      }
    }
    return out;
  }

  return {
    txt: txt, norm: norm, num: num, safeRound: safeRound, div: div,
    fmtNum: fmtNum, fmtMoney: fmtMoney, fmtPct: fmtPct, plural: plural,
    today: today, addDays: addDays, daysBetween: daysBetween, excelDate: excelDate,
    ymOf: ymOf, monthName: monthName, monthTitle: monthTitle, prevMonth: prevMonth,
    daysInMonth: daysInMonth,

    TILLS: TILLS, SHIFTS: SHIFTS, PLAN_STATUS: PLAN_STATUS, NOMINALS: NOMINALS,
    T_SHIFT: T_SHIFT, T_DAY: T_DAY, T_IN: T_IN, T_OUT: T_OUT, T_DRAW: T_DRAW,
    T_MOVE: T_MOVE, isMove: isMove, hitsTill: hitsTill, moneyFrom: moneyFrom, notACost: notACost,
    NOT_A_COST: NOT_A_COST, MONEY_SOURCES: MONEY_SOURCES,
    safeOnHand: safeOnHand, tillPayoutCheck: tillPayoutCheck,
    isShift: isShift, isDay: isDay, isIncome: isIncome, isExpense: isExpense,
    isDraw: isDraw, isCash: isCash,

    shiftCalc: shiftCalc, shiftsOf: shiftsOf, cashOnHand: cashOnHand,
    cashlessTotal: cashlessTotal, supplierDebt: supplierDebt,
    cashierRating: cashierRating, cashGaps: cashGaps, tillState: tillState,
    totals: totals, planStatus: planStatus, planTotals: planTotals,
    debtorTotals: debtorTotals, countCash: countCash,
    COST_KINDS: COST_KINDS, costKindOf: costKindOf, pnl: pnl,
    breakEven: breakEven, breakEvenDay: breakEvenDay,

    /* --- Контур 2: 1С --------------------------------------------------- */
    detectKind: detectKind, parsePeriod: parsePeriod, columnTitles: columnTitles,
    findCol: findCol, findHeaderEnd: findHeaderEnd, isTotalRow: isTotalRow,
    parseSales: parseSales, parseStock: parseStock, parsePrices: parsePrices,
    parseContacts: parseContacts, parsePricelist: parsePricelist,
    parseBarcodes: parseBarcodes, parseUnits: parseUnits,
    parseWriteoffs: parseWriteoffs, parseWriteoffs1C: parseWriteoffs1C,
    syncWriteoffs: syncWriteoffs, writeoffKey: writeoffKey, periodKey: periodKey,
    parseReturns: parseReturns, parseIncomingInvoices: parseIncomingInvoices,
    parseCashOrders: parseCashOrders, parseDeadStock: parseDeadStock,
    parseIncomeExpense: parseIncomeExpense, incomeExpenseSummary: incomeExpenseSummary,
    byReason: byReason, topByCost: topByCost, perMonth: perMonth,
    deadStockList: deadStockList, matchPayments: matchPayments,
    supplierBalance: supplierBalance, cashSummary: cashSummary,
    salesTotals: salesTotals, abcClassify: abcClassify, stockTotals: stockTotals,
    groupIndex: groupIndex, salesByGroup: salesByGroup,
    bestPriceIndex: bestPriceIndex, priceComparison: priceComparison,
    contactsIndex: contactsIndex, priceFor: priceFor, ropList: ropList,
    fefoStatus: fefoStatus, search: search, bep: bep,
    timesheetCalc: timesheetCalc, payrollSummary: payrollSummary,
    payrollTotals: payrollTotals, activeStaff: activeStaff, rateOf: rateOf,
    cashierShortages: cashierShortages, monthClose: monthClose
  };
});
