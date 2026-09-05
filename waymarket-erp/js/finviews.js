/* ============================================================================
   Экраны кассового учёта.

   Порядок дня в магазине 24/7:
     утром  — закрыли смену, сверили ящик  → экран «Утро: сверка кассы»;
     вечером — записали товар и долги      → экран «Вечер: итоги дня»;
     когда нужно — план выплат, расходы, долги покупателей.

   Два правила, на которых держится вся арифметика:
   1. В ящике только наличные. Карта и СБП туда не попадают.
   2. У каждой цифры один источник. Кассу двигают смены и явные расходы;
      долг поставщикам — только вечерние итоги. Двух дорог к одному числу
      нет специально: они всегда кончаются двойным счётом.
   ========================================================================== */
(function () {
  'use strict';
  var E = window.WM, S = window.WMStore, Q = window.WMQuick;

  function U() { return window.WMUI; }
  function FLT() { return window.WMFilter; }
  function esc(s) { return U().esc(s); }
  function dateRu(d) { return U().dateRu(d); }
  function num(v) { return E.num(v); }
  function money(v) { return E.fmtMoney(v); }
  function today() { return E.today(); }
  function dds() { return S.state.dds || []; }
  function refresh() { U().recompute(); }

  function dict(name, fallback) {
    var v = S.settings[name];
    if (typeof v === 'string' && v.trim()) {
      return v.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    }
    return fallback || [];
  }
  function tills() { return dict('tills', E.TILLS); }
  function shiftNames() { return dict('shiftNames', E.SHIFTS); }
  function cashiers() { return Q.dicts(S.state, S.settings).cashiers; }
  function categories() { return Q.dicts(S.state, S.settings).categories; }
  function methods() { return Q.dicts(S.state, S.settings).methods; }
  function suppliers() { return Q.dicts(S.state, S.settings).suppliers; }
  function learn(map) {
    var changed = false;
    Object.keys(map).forEach(function (d) {
      if (Q.learn(S.settings, d, map[d], S.state)) changed = true;
    });
    if (changed) S.save();
  }
  function period() {
    return dds().filter(function (r) { return U().inPeriod(r.date); });
  }
  // Если за выбранный период записей нет — считаем по всему, но говорим об этом
  function pick() {
    var p = period();
    if (p.length) return { rows: p, whole: false };
    return { rows: dds(), whole: true };
  }
  function wholeNote(sel) {
    if (!sel.whole || !dds().length) return '';
    return '<div class="banner blue"><span>ℹ️</span><span>За ' +
      esc(U().periodName().toLowerCase()) + ' записей нет — показаны все данные.</span></div>';
  }

  // Факт последней закрытой смены по этой кассе: подставляем как размен
  function lastFact(till) {
    var list = E.shiftsOf(dds(), function (r) { return E.txt(r.till) === E.txt(till); },
      S.settings);
    if (!list.length) return null;
    var prev = list[list.length - 1];
    return { fact: E.shiftCalc(prev).factCash, date: E.txt(prev.date), shift: E.txt(prev.shift) };
  }

  /* ==========================================================================
     ФОРМЫ
     ========================================================================== */
  var FORMS = window.WM_EXTRA_FORMS = window.WM_EXTRA_FORMS || {};

  /* --- Утро: сверка кассы ----------------------------------------------------
     Единственное место, где считается расхождение. Безнал сюда не входит:
     этих денег в ящике не было. */
  FORMS.shiftClose = {
    title: 'Сверка кассы за смену', icon: '🧮',
    body: function (v) {
      var u = U(); v = v || {};
      var till = v.till || tills()[0];
      var prev = lastFact(till);
      var openHint = prev
        ? 'прошлая смена (' + dateRu(prev.date) + ') закрылась с ' + money(prev.fact)
        : 'первая смена по этой кассе';
      return u.fieldRow('Дата смены', 'date', 'date', v.date || today()) +
        u.fieldRow('Касса', 'till', 'select', till, { options: tills() }) +
        u.fieldRow('Смена', 'shift', 'select', v.shift || shiftNames()[0], { options: shiftNames() }) +
        u.fieldRow('Кассир', 'cashier', 'list', v.cashier || '',
          { options: cashiers(), placeholder: 'кто сдаёт смену' }) +
        u.fieldRow('Размен на начало', 'openCash', 'number',
          v.openCash != null ? v.openCash : (prev ? prev.fact : 0), { hint: openHint }) +
        u.fieldRow('Z-отчёт: наличные', 'zCash', 'number', v.zCash || '',
          { hint: 'выручка, которая легла в ящик' }) +
        u.fieldRow('Z-отчёт: безнал', 'zCashless', 'number', v.zCashless || '',
          { hint: 'карта, СБП, QR — в ящик не попадают, идут на счёт' }) +
        u.fieldRow('Выплаты из ящика', 'payouts', 'number', v.payouts || 0,
          { hint: 'что брали из кассы за смену: поставщикам, на хознужды' }) +
        u.fieldRow('Факт в ящике', 'factCash', 'number', v.factCash || '',
          { hint: 'сколько денег пересчитали руками' }) +
        u.fieldRow('Чеков за смену', 'checks', 'number', v.checks || '',
          { hint: 'из Z-отчёта — нужно только для среднего чека, на кассу не влияет' }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Расчётный остаток = размен + Z-наличные − выплаты. ' +
      'Расхождение = факт − расчётный. Безнал в этой формуле не участвует: ' +
      'карта и СБП в ящик не попадают.',
    save: function (v) {
      var bad = Q.checkAmount(v.zCash, { allowZero: true });
      if (bad) return 'Z-отчёт наличные: ' + bad;
      if (!E.txt(v.factCash) && v.factCash !== 0) return 'Впишите, сколько денег пересчитали в ящике.';
      if (!E.txt(v.cashier)) return 'Укажите кассира — иначе непонятно, с кем разбирать расхождение.';
      var fields = ['openCash', 'zCash', 'zCashless', 'payouts', 'factCash'];
      for (var i = 0; i < fields.length; i++) {
        var b = Q.checkAmount(v[fields[i]], { allowEmpty: true, allowZero: true });
        if (b) return 'Поле «' + fields[i] + '»: ' + b;
      }
      learn({ cashiers: v.cashier });
      var rec = { type: E.T_SHIFT, date: v.date, till: v.till, shift: v.shift,
        cashier: v.cashier, openCash: num(v.openCash), zCash: num(v.zCash),
        zCashless: num(v.zCashless), payouts: num(v.payouts),
        factCash: num(v.factCash), checks: num(v.checks), note: v.note };
      var c = E.shiftCalc(rec);
      rec.diff = c.diff;
      S.add('dds', rec);
      S.save(); refresh();

      var msg = 'Смена записана. Расчётный остаток ' + money(c.expected) + ', в ящике ' +
        money(c.factCash) + ' — ';
      msg += c.ok ? 'касса сходится.'
        : (c.diff < 0 ? 'НЕДОСТАЧА ' + money(c.short) + '.' : 'излишек ' + money(c.over) + '.');
      // размен новой смены должен равняться факту предыдущей — иначе деньги
      // вынули, и это надо записать, иначе учёт разъедется
      var prev = lastFact(v.till);
      msg += ' Безнал ' + money(c.zCashless) + ' ушёл на счёт, в кассу не считается.';
      return { ok: msg };
    }
  };

  /* --- Вечер: итоги дня ------------------------------------------------------
     Кассу эта форма НЕ двигает: деньги за товар уже ушли через «выплаты из
     ящика» в сверке смены. Здесь — товарные обороты и долг поставщикам. */
  FORMS.dayTotals = {
    title: 'Итоги дня', icon: '🌙',
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Товар за наличные', 'goodsCash', 'number', v.goodsCash || 0,
          { hint: 'сколько товара взяли и сразу заплатили' }) +
        u.fieldRow('Погашение долгов ТП', 'debtPaid', 'number', v.debtPaid || 0,
          { hint: 'сколько отдали поставщикам по старым долгам' }) +
        u.fieldRow('Взят новый товар в долг', 'debtTaken', 'number', v.debtTaken || 0,
          { hint: 'привезли, деньги не платили — долг вырос' }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Эта форма про товар и долги, а не про кассу: деньги за товар уже ушли ' +
      'из ящика и посчитаны в «Выплатах» при сверке смены. Если вычесть их ещё раз, ' +
      'одни и те же деньги уйдут дважды.',
    save: function (v) {
      var f = ['goodsCash', 'debtPaid', 'debtTaken'];
      for (var i = 0; i < f.length; i++) {
        var b = Q.checkAmount(v[f[i]], { allowEmpty: true, allowZero: true });
        if (b) return 'Поле «' + f[i] + '»: ' + b;
      }
      if (!num(v.goodsCash) && !num(v.debtPaid) && !num(v.debtTaken)) {
        return 'Все три поля пустые — записывать нечего.';
      }
      var same = dds().filter(function (r) { return E.isDay(r) && r.date === v.date; })[0];
      if (same) return 'Итоги за ' + dateRu(v.date) + ' уже записаны. ' +
        'Поправьте ту запись на экране «База операций», чтобы не задвоить.';
      S.add('dds', { type: E.T_DAY, date: v.date, goodsCash: num(v.goodsCash),
        debtPaid: num(v.debtPaid), debtTaken: num(v.debtTaken), note: v.note });
      S.save(); refresh();
      var d = E.supplierDebt(dds(), S.settings);
      return { ok: 'Итоги дня записаны. Долг поставщикам теперь ' + money(d.debt) + '.' };
    }
  };

  /* --- Расход и приход денег -------------------------------------------------- */
  /* --- Расход ----------------------------------------------------------------
     Две вещи, из-за которых расход раньше врал:
       1) наличные вычитались из ящика второй раз, если эти же деньги уже
          прошли выплатой при сверке смены;
       2) статьи «Закуп товара» и «Оплата ТП» резали прибыль, хотя закуп
          считается из итогов дня, а погашение долга — вообще не трата.
     Теперь форма спрашивает, ОТКУДА взяли деньги, и не принимает статьи,
     которые тратой не являются. */
  FORMS.moneyOut = {
    title: 'Расход', icon: '🧾',
    body: function (v) {
      var u = U(); v = v || {};
      var cash = E.norm(v.method || 'Наличные') === 'наличные';
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Статья', 'category', 'list', v.category || '',
          { options: categories(), placeholder: 'за что платим',
            hint: 'закуп товара и долги поставщикам сюда не пишут — им место в «Итогах дня»' }) +
        u.fieldRow('Чем платим', 'method', 'select', v.method || 'Наличные', { options: methods() }) +
        u.fieldRow('Откуда деньги', 'source', 'select',
          v.source || (cash ? 'Из ящика' : 'Со счёта'),
          { options: E.MONEY_SOURCES,
            hint: 'из ящика — эти деньги уже посчитаны в «выплатах» при сверке смены, ' +
              'второй раз их не вычтут' }) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Расход уменьшает прибыль. Остаток наличных он уменьшает, только если ' +
      'деньги взяли не из ящика: то, что вынули из ящика, уже сидит в «выплатах» смены.',
    save: function (v) {
      var bad = Q.checkAmount(v.amount); if (bad) return bad;
      if (!E.txt(v.category)) return 'Укажите статью — иначе непонятно, за что ушли деньги.';
      // Ловим статью, которая тратой не является: иначе прибыль занизится
      var not = E.notACost(v.category);
      if (not) {
        if (not.key === 'purchase') {
          return 'Закуп товара расходом не записывают: впишите сумму в «Итоги дня» → ' +
            '«Товар за наличные». Иначе один и тот же товар уменьшит прибыль дважды.';
        }
        if (not.key === 'debt') {
          return 'Погашение долга поставщику — не расход, а возврат денег. ' +
            'Впишите сумму в «Итоги дня» → «Погашение долгов ТП».';
        }
        return 'Перемещение денег расходом не записывают — прибыль от этого не меняется. ' +
          'Для инкассации есть своя кнопка «Инкассация».';
      }
      learn({ categories: v.category, methods: v.method });
      var rec = { type: E.T_OUT, date: v.date, category: v.category,
        method: v.method, source: v.source, amount: num(v.amount), note: v.note };
      var ed = U().editing();
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('dds', rec);
      S.save(); refresh();
      var where = E.moneyFrom(rec);
      return { ok: 'Расход записан: ' + v.category + ' — ' + money(v.amount) +
        (where === 'ящик' ? '. Кассу не трогаем: эти деньги уже в «выплатах» смены.'
          : where === 'сейф' ? '. Сейф уменьшился.' : '.') };
    }
  };

  /* --- Инкассация: перемещение денег, а не трата ------------------------------
     Увезли выручку в сейф или в банк — деньги не потрачены, они лежат в другом
     месте. Касса уменьшается, прибыль НЕ меняется. Раньше это можно было
     записать только расходом, и месяц закрывался с ложным убытком. */
  FORMS.moveCash = {
    title: 'Инкассация', icon: '🚛',
    body: function (v) {
      var u = U(); v = v || {};
      var cash = E.cashOnHand(dds(), S.settings);
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Откуда', 'from', 'select', v.from || 'Касса',
          { options: ['Касса', 'Сейф'], hint: 'в кассе сейчас ' + money(cash) }) +
        u.fieldRow('Куда', 'to', 'select', v.to || S.settings.collectTo || 'Сейф',
          { options: ['Сейф', 'Банк', 'Касса'] }) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        u.fieldRow('Кто повёз', 'who', 'list', v.who || '',
          { options: cashiers(), placeholder: 'необязательно' }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Деньги переложили, а не потратили: прибыль от инкассации не меняется ' +
      'ни на рубль. Уменьшается только наличный остаток там, откуда увезли.',
    save: function (v) {
      var bad = Q.checkAmount(v.amount); if (bad) return bad;
      if (E.norm(v.from) === E.norm(v.to)) return 'Откуда и куда — одно и то же место.';
      var cash = E.cashOnHand(dds(), S.settings);
      if (E.norm(v.from) === 'касса' && num(v.amount) > cash + 0.5) {
        return 'В кассе сейчас ' + money(cash) + ' — увезти ' + money(v.amount) +
          ' не получится. Проверьте сумму или сначала закройте смену.';
      }
      var rec = { type: E.T_MOVE, date: v.date, from: v.from, to: v.to,
        amount: num(v.amount), cashier: v.who, note: v.note };
      var ed = U().editing();
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('dds', rec);
      S.save(); refresh();
      return { ok: 'Инкассация записана: ' + money(v.amount) + ' из «' + v.from +
        '» в «' + v.to + '». В кассе осталось ' + money(E.cashOnHand(dds(), S.settings)) +
        '. Прибыль не изменилась — деньги не потрачены.' };
    }
  };

  FORMS.moneyIn = {
    title: 'Приход денег', icon: '💰',
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Откуда', 'category', 'list', v.category || 'Прочий приход',
          { options: categories().concat(['Прочий приход', 'Вернули долг', 'Внёс владелец']) }) +
        u.fieldRow('Чем', 'method', 'select', v.method || 'Наличные', { options: methods() }) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Выручку сюда писать не нужно — она приходит из сверки смены.',
    save: function (v) {
      var bad = Q.checkAmount(v.amount); if (bad) return bad;
      learn({ categories: v.category, methods: v.method });
      S.add('dds', { type: E.T_IN, date: v.date, category: v.category || 'Прочий приход',
        method: v.method, amount: num(v.amount), note: v.note });
      S.save(); refresh();
      return { ok: 'Приход записан: ' + money(v.amount) };
    }
  };

  FORMS.moneyDraw = {
    title: 'Забрал владелец', icon: '👛',
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Чем', 'method', 'select', v.method || 'Наличные', { options: methods() }) +
        u.fieldRow('Откуда деньги', 'source', 'select', v.source || 'Из ящика',
          { options: E.MONEY_SOURCES,
            hint: 'из ящика — уже посчитано в «выплатах» смены, второй раз не вычтем' }) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Деньги ушли из оборота, но это не расход магазина: прибыль они не уменьшают.',
    save: function (v) {
      var bad = Q.checkAmount(v.amount); if (bad) return bad;
      S.add('dds', { type: E.T_DRAW, date: v.date, category: 'Забор владельца',
        method: v.method, source: v.source, amount: num(v.amount), note: v.note });
      S.save(); refresh();
      return { ok: 'Записано: из оборота ушло ' + money(v.amount) };
    }
  };

  /* --- План выплат ------------------------------------------------------------ */
  FORMS.payPlan = {
    title: 'Выплата поставщику', icon: '📅',
    editsInPlace: true,
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Дата выплаты', 'due', 'date', v.due || today()) +
        u.fieldRow('Кому', 'supplier', 'list', v.supplier || '',
          { options: suppliers(), placeholder: 'поставщик или ТП' }) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        u.fieldRow('Чем платим', 'method', 'select', v.method || 'Наличные', { options: methods() }) +
        u.fieldRow('Статус', 'status', 'select', v.status || E.PLAN_STATUS[0],
          { options: E.PLAN_STATUS }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Это календарь: кому и когда платить. Долг поставщикам отметка «Оплачена» ' +
      'сама не уменьшает — сумму погашения впишите в «Итоги дня», иначе она посчитается дважды.',
    save: function (v) {
      var bad = Q.checkAmount(v.amount); if (bad) return bad;
      if (!E.txt(v.supplier)) return 'Укажите, кому платим.';
      learn({ suppliers: v.supplier, methods: v.method });
      var rec = { due: v.due, supplier: v.supplier, amount: num(v.amount),
        method: v.method, status: v.status, note: v.note,
        paidAt: v.status === 'Оплачена' ? (v.paidAt || today()) : '' };
      var edit = U().editing && U().editing();
      if (edit && edit.coll === 'plans') {
        var old = (S.state.plans || []).filter(function (p) { return p.id === edit.id; })[0];
        if (old) { Object.keys(rec).forEach(function (k) { old[k] = rec[k]; }); S.save(); refresh();
          return { ok: 'Выплата обновлена.' }; }
      }
      S.add('plans', rec);
      S.save(); refresh();
      return { ok: 'В плане: ' + v.supplier + ' — ' + money(v.amount) + ' на ' + dateRu(v.due) };
    }
  };

  /* --- Долг покупателя --------------------------------------------------------- */
  FORMS.debtor = {
    title: 'Долг покупателя', icon: '📓',
    editsInPlace: true,
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Кто', 'name', 'text', v.name || '', { placeholder: 'имя из тетрадки' }) +
        u.fieldRow('Телефон', 'phone', 'text', v.phone || '') +
        u.fieldRow('Сумма долга', 'sum', 'number', v.sum || '') +
        u.fieldRow('Уже погашено', 'paid', 'number', v.paid || 0) +
        u.fieldRow('Кто записал', 'cashier', 'list', v.cashier || '', { options: cashiers() }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Пока долг не погашен, выручкой он не считается.',
    save: function (v) {
      var bad = Q.checkAmount(v.sum); if (bad) return bad;
      if (!E.txt(v.name)) return 'Впишите, кто должен.';
      learn({ cashiers: v.cashier });
      var rec = { date: v.date, name: v.name, phone: v.phone, sum: num(v.sum),
        paid: num(v.paid), cashier: v.cashier, note: v.note };
      var edit = U().editing && U().editing();
      if (edit && edit.coll === 'debtors') {
        var old = (S.state.debtors || []).filter(function (d) { return d.id === edit.id; })[0];
        if (old) { Object.keys(rec).forEach(function (k) { old[k] = rec[k]; }); S.save(); refresh();
          return { ok: 'Долг обновлён.' }; }
      }
      S.add('debtors', rec);
      S.save(); refresh();
      return { ok: 'Записано: ' + v.name + ' должен ' + money(num(v.sum) - num(v.paid)) };
    }
  };

  /* --- Пересчёт кассы по купюрам ----------------------------------------------- */
  FORMS.cashCount = {
    title: 'Пересчитать кассу', icon: '🧾',
    body: function (v) {
      var u = U(); v = v || {};
      var h = u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Касса', 'till', 'select', v.till || tills()[0], { options: tills() }) +
        u.fieldRow('Кассир', 'cashier', 'list', v.cashier || '', { options: cashiers() });
      E.NOMINALS.forEach(function (n) {
        h += u.fieldRow(E.fmtNum(n) + ' ₽ — сколько штук', 'n' + n, 'number', v['n' + n] || 0);
      });
      return h;
    },
    hint: 'Не надо складывать в уме: впишите количество купюр, программа посчитает сама ' +
      'и сравнит с тем, сколько должно быть в этой кассе.',
    save: function (v) {
      var c = E.countCash(v);
      if (!c.sum) return 'Ни одной купюры не вписано.';
      var st = E.tillState(dds(), S.settings).filter(function (t) { return t.till === v.till; })[0];
      var expected = st ? st.fact : 0;
      var diff = E.safeRound(c.sum - expected);
      S.add('cashcount', { date: v.date, till: v.till, cashier: v.cashier,
        sum: c.sum, expected: expected, diff: diff,
        note: c.pieces + ' купюр' });
      S.save(); refresh();
      return { ok: 'Насчитали ' + money(c.sum) + ' (' + c.pieces + ' купюр). ' +
        (Math.abs(diff) < 1 ? 'Сходится с кассой.'
          : (diff < 0 ? 'Не хватает ' + money(-diff) + '.' : 'Больше на ' + money(diff) + '.')) };
    }
  };

  /* ==========================================================================
     ЭКРАНЫ
     ========================================================================== */

  function quickBar() {
    return '<div class="quick">' +
      '<button class="btn btn-primary" data-form="shiftClose">🧮 Сверка кассы</button>' +
      '<button class="btn" data-form="dayTotals">🌙 Итоги дня</button>' +
      '<button class="btn" data-form="moneyOut">🧾 Расход</button>' +
      '<button class="btn" data-form="moveCash">🚛 Инкассация</button>' +
      '<button class="btn" data-form="payPlan">📅 Выплата</button></div>';
  }

  /* --- Пульт ------------------------------------------------------------------ */
  function viewPulse() {
    var u = U();
    var all = dds();
    var h = u.pageHead('Пульт', 'Деньги в кассе, долги и кто недосдаёт');

    if (!all.length) {
      return h + '<div class="card"><div class="empty"><b>Записей пока нет</b><br>' +
        'Начните со «Сверки кассы» — закройте первую смену.<br>' +
        'Начальный остаток наличных и долг поставщикам впишите в «Настройках», ' +
        'раздел «Начальные остатки».</div></div>' + quickBar();
    }

    var cash = E.cashOnHand(all, S.settings);
    var debt = E.supplierDebt(all, S.settings);
    var sel = pick(), t = E.totals(sel.rows);
    var pt = E.planTotals(S.state.plans || [], today());
    var deb = E.debtorTotals(S.state.debtors || [], today());
    var rating = E.cashierRating(sel.rows);
    var gaps = E.cashGaps(all, S.settings);
    var debtColor = debt.debt >= num(S.settings.debtCrit) ? 'c-red'
      : (debt.debt >= num(S.settings.debtWarn) ? 'c-orange' : 'c-green');

    var safe = E.safeOnHand(all, S.settings);
    h += '<div class="stat-grid">' +
      u.stat('Наличные в кассе', u.priv(cash), 'в ящиках прямо сейчас',
        cash < 0 ? 'c-red' : (num(S.settings.cashLimit) && cash > num(S.settings.cashLimit)
          ? 'c-orange' : '')) +
      u.stat('В сейфе', u.priv(safe), 'увезено инкассацией') +
      u.stat('Долг поставщикам', u.priv(debt.debt),
        'взято ' + money(debt.taken) + ' · отдано ' + money(debt.paid), debtColor) +
      u.stat('Безнал за период', u.priv(t.zCashless),
        'ушёл на счёт, в кассе его нет') +
      u.stat('Недостачи за период', u.priv(t.short),
        t.badShifts ? t.badShifts + ' смен из ' + t.shifts + ' не сошлись' : 'все смены сошлись',
        t.short ? 'c-red' : 'c-green') +
      '</div>';

    // В ящике скопилось больше, чем вы считаете безопасным
    if (num(S.settings.cashLimit) && cash > num(S.settings.cashLimit)) {
      h += '<div class="banner orange"><span>🚛</span><span>В ящике ' +
        esc(money(cash)) + ' — больше вашего порога ' + esc(money(S.settings.cashLimit)) +
        '. Пора увезти в сейф: это перемещение, прибыль оно не меняет. ' +
        '<button class="btn btn-sm" data-form="moveCash">Записать инкассацию</button></span></div>';
    }

    /* Из ящика выдали больше, чем расписали по статьям: деньги брали, а на
       что — не записали. Без этой сверки расходы месяца выходят неполными. */
    var chk = E.tillPayoutCheck(sel.rows);
    if (chk.left > 0.5) {
      h += '<div class="banner orange"><span>🧾</span><span>Из ящика за период выдали ' +
        esc(money(chk.payouts)) + ', а расписано по статьям только ' +
        esc(money(chk.explained)) + '. Не хватает объяснения на <b>' +
        esc(money(chk.left)) + '</b> — эти деньги нигде не учтены как расход, ' +
        'и прибыль за месяц выглядит выше настоящей.</span></div>';
    } else if (chk.over) {
      h += '<div class="banner red"><span>⚠️</span><span>Расходов «из ящика» записано на ' +
        esc(money(-chk.left)) + ' больше, чем вообще выдавали из ящика. ' +
        'Где-то лишняя запись — посмотрите «Базу операций».</span></div>';
    }

    h += wholeNote(sel);
    h += quickBar();

    // Кассы: где сколько лежит по последней закрытой смене
    var st = E.tillState(all, S.settings);
    h += u.card('Кассы', u.listOf(st.map(function (x) {
      return u.listRow({ icon: '💵', title: esc(x.till),
        sub: x.closed ? 'последняя смена ' + dateRu(x.date) + ' · ' + esc(x.shift) +
          (x.cashier ? ' · ' + esc(x.cashier) : '') : 'смен ещё не было',
        value: u.priv(x.fact) });
    }), ''), 'По факту последней закрытой смены');

    if (gaps.length) {
      var g = gaps[gaps.length - 1];
      h += '<div class="banner orange"><span>⚠️</span><span>Размен не сходится с прошлой сменой: ' +
        esc(g.till) + ' закрылась ' + dateRu(g.prevDate) + ' с <b>' + money(g.prevFact) +
        '</b>, а ' + dateRu(g.date) + ' смену открыли с <b>' + money(g.open) + '</b>. ' +
        'Разница ' + money(Math.abs(g.gap)) + ' — если деньги убрали в сейф или забрал владелец, ' +
        'запишите это расходом, иначе учёт разъедется.' +
        (gaps.length > 1 ? ' Всего таких случаев: ' + gaps.length + '.' : '') + '</span></div>';
    }

    h += '<div class="grid-2">' +
      u.card('Выплаты поставщикам', u.listOf([
        u.listRow({ icon: '🔴', title: 'Просрочено', sub: pt.overdueCount + ' платежей',
          value: '<span class="c-red private">' + money(pt.overdue) + '</span>',
          tap: true, attrs: ' data-go="finpay"' }),
        u.listRow({ icon: '📅', title: 'Сегодня', value: u.priv(pt.dueToday),
          tap: true, attrs: ' data-go="finpay"' }),
        u.listRow({ icon: '🗓', title: 'На неделе', value: u.priv(pt.week),
          tap: true, attrs: ' data-go="finpay"' })
      ], ''), '') +
      u.card('Долги покупателей', u.listOf([
        u.listRow({ icon: '📓', title: 'Всего не отдали', value: u.priv(deb.open),
          tap: true, attrs: ' data-go="debtors"' }),
        u.listRow({ icon: '⏳', title: 'Старше 30 дней',
          value: '<span class="' + (deb.old ? 'c-orange' : '') + ' private">' + money(deb.old) + '</span>',
          tap: true, attrs: ' data-go="debtors"' }),
        u.listRow({ icon: '👥', title: 'Должников', value: u.nf(deb.people.length) })
      ], ''), '') +
      '</div>';

    // Антирейтинг: сверху тот, у кого недостач больше
    var bad = rating.filter(function (r) { return r.short > 0; });
    h += u.card('Кто недосдаёт', bad.length ? u.table('pulseRate', [
      { title: 'Кассир', fn: function (r) { return esc(r.name); } },
      { title: 'Смен', cls: 'num', fn: function (r) { return u.nf(r.shifts); } },
      { title: 'Недостачи', cls: 'num', fn: function (r) {
        return '<b class="c-red private">' + money(r.short) + '</b>'; } },
      { title: 'На 1000 ₽ выручки', cls: 'num', fn: function (r) { return u.priv(r.per1000); } },
      { title: 'Смен с расхождением', cls: 'num', fn: function (r) {
        return u.nf(r.badShifts) + ' <span class="c-muted">' + u.pct(r.badPct) + '</span>'; } }
    ], bad.slice(0, 5), { step: 5 })
      : '<div class="empty">👍 Недостач нет — все смены сошлись.</div>',
      '<button class="btn btn-sm" data-go="cashiers">Все кассиры</button>');

    h += u.card('Как идёт магазин — ' + (sel.whole ? 'за всё время' : u.periodName().toLowerCase()),
      u.listOf([
        u.listRow({ icon: '💰', title: 'Выручка', sub: 'наличные ' + money(t.zCash) +
          ' · безнал ' + money(t.zCashless), value: u.priv(t.revenue) }),
        u.listRow({ icon: '🧾', title: 'Выплаты из ящика', sub: 'что брали из кассы за смены',
          value: u.priv(t.payouts) }),
        u.listRow({ icon: '💸', title: 'Прочие расходы', sub: 'записаны отдельно',
          value: u.priv(t.expense) }),
        u.listRow({ icon: '📦', title: 'Товар за наличные', value: u.priv(t.goodsCash) }),
        u.listRow({ icon: '🕒', title: 'Смен закрыто',
          sub: t.shifts ? 'в среднем ' + money(t.avgShift) + ' за смену' : '',
          value: u.nf(t.shifts) }),
        u.listRow({ icon: '📅', title: 'Средняя выручка в день',
          sub: 'дней с записями: ' + t.dayCount, value: u.priv(t.avgDay) })
      ], ''));
    return h;
  }

  /* --- Утро: сверка кассы ------------------------------------------------------ */
  function viewMorning() {
    var u = U();
    var all = dds();
    var shifts = E.shiftsOf(all, null, S.settings).slice().reverse();
    var sel = pick();
    var t = E.totals(sel.rows);

    var h = u.pageHead('Утро: сверка кассы',
      'Закрыли смену — сверили ящик. Безнал в ящик не попадает',
      '<button class="btn btn-primary" data-form="shiftClose">＋ Закрыть смену</button>');

    h += '<div class="banner blue"><span>🧮</span><span>' +
      '<b>Расчётный остаток</b> = размен + Z-наличные − выплаты из ящика.<br>' +
      '<b>Расхождение</b> = факт в ящике − расчётный остаток. ' +
      'Минус — недостача кассира, плюс — излишек. ' +
      'Карта и СБП сюда не входят: этих денег в ящике не было.</span></div>';

    h += '<div class="stat-grid">' +
      u.stat('Смен за период', u.nf(t.shifts),
        t.badShifts ? t.badShifts + ' с расхождением' : 'все сошлись',
        t.badShifts ? 'c-orange' : 'c-green') +
      u.stat('Недостачи', u.priv(t.short), 'не хватило в ящике', t.short ? 'c-red' : 'c-green') +
      u.stat('Излишки', u.priv(t.over), 'оказалось больше расчётного') +
      u.stat('Выплаты из ящика', u.priv(t.payouts), 'брали за смены') +
      '</div>';
    h += wholeNote(sel);

    var defs = [
      { key: 'res', name: 'Как сошлась', options: [
        { v: 'short', name: 'Недостача', test: function (r) { return E.shiftCalc(r).diff < -0.5; } },
        { v: 'over', name: 'Излишек', test: function (r) { return E.shiftCalc(r).diff > 0.5; } },
        { v: 'ok', name: 'Сошлась', test: function (r) { return E.shiftCalc(r).ok; } }
      ] },
      { key: 'till', name: 'Касса', auto: function (r) { return r.till; }, limit: 6 },
      { key: 'shift', name: 'Смена', auto: function (r) { return r.shift; }, limit: 6 },
      { key: 'cashier', name: 'Кассир', auto: function (r) { return r.cashier; }, limit: 12 }
    ];
    var list = FLT().apply('morning', shifts, defs, function (r) {
      return (r.cashier || '') + ' ' + (r.note || '') + ' ' + (r.date || '');
    });
    h += FLT().bar('morning', defs, shifts, { search: 'кассир, дата, комментарий' });

    h += u.card('Закрытые смены', FLT().note(list.length, shifts.length) + u.table('shiftsT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Касса', fn: function (r) { return esc(r.till || '—'); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift || '—'); } },
      { title: 'Кассир', fn: function (r) { return esc(r.cashier || '—'); } },
      { title: 'Размен', cls: 'num', fn: function (r) { return u.priv(r.openCash); } },
      { title: 'Z наличные', cls: 'num', fn: function (r) { return u.priv(r.zCash); } },
      { title: 'Z безнал', cls: 'num', fn: function (r) { return u.priv(r.zCashless); } },
      { title: 'Выплаты', cls: 'num', fn: function (r) { return u.priv(r.payouts); } },
      { title: 'Должно быть', cls: 'num', fn: function (r) { return u.priv(E.shiftCalc(r).expected); } },
      { title: 'Факт', cls: 'num', fn: function (r) { return u.priv(r.factCash); } },
      { title: 'Расхождение', cls: 'num', fn: function (r) {
        var c = E.shiftCalc(r);
        if (c.ok) return '<span class="c-green">сходится</span>';
        return '<b class="' + (c.diff < 0 ? 'c-red' : 'c-orange') + ' private">' +
          (c.diff > 0 ? '+' : '') + money(c.diff) + '</b>'; } },
      { title: '', cls: 'center', fn: function (r) {
        return u.rowMenu('dds', r.id, { form: 'shiftClose' }); } }
    ], list, { step: 40, empty: FLT().active('morning') ? 'Под фильтр ничего не подошло'
      : 'Смен пока нет. Нажмите «Закрыть смену».',
      total: [{ html: 'Итого', span: 5, label: 'Итого' },
        { html: money(t.zCash), cls: 'num', label: 'Z наличные' },
        { html: money(t.zCashless), cls: 'num', label: 'Z безнал' },
        { html: money(t.payouts), cls: 'num', label: 'Выплаты' },
        { html: '', cls: 'num' }, { html: '', cls: 'num' },
        { html: '<span class="' + u.cls(t.diff) + '">' + money(t.diff) + '</span>', cls: 'num', label: 'Расхождение' },
        { html: '' }] }));

    h += '<div class="quick"><button class="btn" data-form="cashCount">🧾 Пересчитать по купюрам</button> ' +
      '<button class="btn" data-go="cashiers">🧑‍💼 Кассиры и расхождения</button></div>';
    return h;
  }

  /* --- Вечер: итоги дня --------------------------------------------------------- */
  function viewEvening() {
    var u = U();
    var days = dds().filter(E.isDay).slice().sort(function (a, b) {
      return E.txt(b.date).localeCompare(E.txt(a.date));
    });
    var sel = pick(), t = E.totals(sel.rows);
    var debt = E.supplierDebt(dds(), S.settings);

    var h = u.pageHead('Вечер: итоги дня', 'Товар и долги поставщикам за день',
      '<button class="btn btn-primary" data-form="dayTotals">＋ Записать итоги дня</button>');

    h += '<div class="banner blue"><span>🌙</span><span>Эта форма про <b>товар и долги</b>, ' +
      'а не про кассу. Деньги за товар уже ушли из ящика и посчитаны в «Выплатах» при сверке ' +
      'смены — если вычесть их ещё раз, одни и те же деньги уйдут дважды.</span></div>';

    h += '<div class="stat-grid">' +
      u.stat('Долг поставщикам', u.priv(debt.debt), 'на сегодня',
        debt.debt >= num(S.settings.debtCrit) ? 'c-red' : '') +
      u.stat('Взято в долг за период', u.priv(t.debtTaken), 'привезли без оплаты') +
      u.stat('Погашено за период', u.priv(t.debtPaid), 'отдали поставщикам', 'c-green') +
      u.stat('Товар за наличные', u.priv(t.goodsCash), 'взяли и сразу заплатили') +
      '</div>';
    h += wholeNote(sel);

    if (debt.opening) {
      h += '<div class="banner"><span>ℹ️</span><span>Долг считается от начального: ' +
        '<b>' + money(debt.opening) + '</b> из «Настроек» плюс взятое в долг минус погашенное. ' +
        'Если начальная цифра не та — поправьте в настройках, раздел «Начальные остатки».</span></div>';
    }

    h += u.card('Итоги по дням', u.table('daysT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Товар за наличные', cls: 'num', fn: function (r) { return u.priv(r.goodsCash); } },
      { title: 'Погашено долга', cls: 'num', fn: function (r) { return u.priv(r.debtPaid); } },
      { title: 'Взято в долг', cls: 'num', fn: function (r) { return u.priv(r.debtTaken); } },
      { title: 'Долг вырос на', cls: 'num', fn: function (r) {
        var d = E.safeRound(num(r.debtTaken) - num(r.debtPaid));
        return '<span class="' + (d > 0 ? 'c-red' : 'c-green') + ' private">' +
          (d > 0 ? '+' : '') + money(d) + '</span>'; } },
      { title: 'Комментарий', fn: function (r) { return esc(r.note || '—'); } },
      { title: '', cls: 'center', fn: function (r) {
        return u.rowMenu('dds', r.id, { form: 'dayTotals' }); } }
    ], days, { step: 40, empty: 'Итогов дня пока нет.',
      total: [{ html: 'Итого', label: 'Итого' },
        { html: money(t.goodsCash), cls: 'num', label: 'Товар за наличные' },
        { html: money(t.debtPaid), cls: 'num', label: 'Погашено' },
        { html: money(t.debtTaken), cls: 'num', label: 'Взято в долг' },
        { html: '', cls: 'num' }, { html: '' }, { html: '' }] }));
    return h;
  }

  /* --- План выплат -------------------------------------------------------------- */
  function viewPlans() {
    var u = U();
    var plans = (S.state.plans || []).slice().sort(function (a, b) {
      return E.txt(a.due).localeCompare(E.txt(b.due));
    });
    var t = E.planTotals(plans, today());

    var h = u.pageHead('План выплат', 'Кому и когда платить',
      '<button class="btn btn-primary" data-form="payPlan">＋ Запланировать выплату</button>');

    h += '<div class="stat-grid">' +
      u.stat('Просрочено', u.priv(t.overdue), t.overdueCount + ' платежей',
        t.overdue ? 'c-red' : 'c-green') +
      u.stat('Сегодня', u.priv(t.dueToday), 'платить сегодня') +
      u.stat('На неделе', u.priv(t.week), 'ближайшие 7 дней') +
      u.stat('Всего запланировано', u.priv(t.planned), t.plannedCount + ' платежей') +
      '</div>';

    h += '<div class="banner"><span>💡</span><span>Отметка «Оплачена» закрывает пункт плана, ' +
      'но долг поставщикам сама не уменьшает: сумму погашения впишите в «Итоги дня». ' +
      'Так у долга остаётся один источник и он не считается дважды.</span></div>';

    var defs = [{ key: 'st', name: 'Состояние', options: [
      { v: 'late', name: 'Просрочено', test: function (p) { return E.planStatus(p).key === 'late'; } },
      { v: 'today', name: 'Сегодня', test: function (p) { return E.planStatus(p).key === 'today'; } },
      { v: 'plan', name: 'Впереди', test: function (p) {
        var k = E.planStatus(p).key; return k === 'plan' || k === 'soon'; } },
      { v: 'paid', name: 'Оплачено', test: function (p) { return E.planStatus(p).key === 'paid'; } }
    ] }, { key: 'who', name: 'Кому', auto: function (p) { return p.supplier; }, limit: 14 }];
    var list = FLT().apply('plans', plans, defs, function (p) { return p.supplier + ' ' + (p.note || ''); });
    h += FLT().bar('plans', defs, plans, { search: 'поставщик или комментарий' });

    h += u.card('Календарь платежей', FLT().note(list.length, plans.length) + u.table('plansT', [
      { title: 'Когда', fn: function (p) { return esc(dateRu(p.due)); } },
      { title: 'Кому', fn: function (p) { return esc(p.supplier || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (p) { return u.priv(p.amount); } },
      { title: 'Чем', fn: function (p) { return esc(p.method || '—'); } },
      { title: 'Состояние', fn: function (p) {
        var st = E.planStatus(p, today());
        return u.badge(st.name, st.color); } },
      { title: 'Комментарий', fn: function (p) { return esc(p.note || '—'); } },
      { title: '', cls: 'center', fn: function (p) {
        var st = E.planStatus(p, today());
        return (st.key === 'paid' ? ''
          : '<button class="btn btn-sm btn-primary" data-act="plan-paid" data-id="' + p.id + '">Оплатил</button> ') +
          u.rowMenu('plans', p.id, { form: 'payPlan' }); } }
    ], list, { step: 40, empty: 'Плановых выплат нет.' }));
    return h;
  }

  /* --- Кассиры и расхождения ------------------------------------------------------ */
  function viewCashiers() {
    var u = U();
    var sel = pick();
    var rating = E.cashierRating(sel.rows);
    var t = E.totals(sel.rows);
    var crit = num(S.settings.diffCrit) || 1000;

    var h = u.pageHead('Кассиры и расхождения',
      'У кого касса не сходится — ' + (sel.whole ? 'за всё время' : u.periodName().toLowerCase()),
      '<button class="btn" data-act="print">🖨 Печать</button>');

    h += '<div class="stat-grid">' +
      u.stat('Недостачи', u.priv(t.short), 'всего не хватило', t.short ? 'c-red' : 'c-green') +
      u.stat('Излишки', u.priv(t.over), 'всего оказалось лишним') +
      u.stat('Смен с расхождением', u.nf(t.badShifts), 'из ' + t.shifts,
        t.badShifts ? 'c-orange' : 'c-green') +
      u.stat('Кассиров', u.nf(rating.length), 'работали за период') +
      '</div>';
    h += wholeNote(sel);

    h += u.card('Антирейтинг', u.table('rateT', [
      { title: 'Кассир', fn: function (r) { return esc(r.name); } },
      { title: 'Смен', cls: 'num', fn: function (r) { return u.nf(r.shifts); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
      { title: 'Недостачи', cls: 'num', fn: function (r) {
        return r.short ? '<b class="c-red private">' + money(r.short) + '</b>' : '—'; } },
      { title: 'Излишки', cls: 'num', fn: function (r) {
        return r.over ? '<span class="c-orange private">' + money(r.over) + '</span>' : '—'; } },
      { title: 'На 1000 ₽ выручки', cls: 'num', fn: function (r) { return u.priv(r.per1000); } },
      { title: 'Смен с расхождением', cls: 'num', fn: function (r) {
        return u.nf(r.badShifts) + ' <span class="c-muted">' + u.pct(r.badPct) + '</span>'; } },
      { title: 'Худший случай', cls: 'num', fn: function (r) {
        return r.worst ? '<span class="private">' + money(r.worst) + '</span>' +
          '<small class="c-muted"> ' + esc(dateRu(r.worstDate)) + '</small>' : '—'; } }
    ], rating, { step: 30, empty: 'Смен за период нет.' }));

    var bigOnes = E.shiftsOf(sel.rows, null, S.settings).filter(function (r) {
      return Math.abs(E.shiftCalc(r).diff) >= crit;
    }).sort(function (a, b) { return E.shiftCalc(a).diff - E.shiftCalc(b).diff; });
    if (bigOnes.length) {
      h += u.card('Крупные расхождения — от ' + money(crit), u.table('bigT', [
        { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
        { title: 'Касса', fn: function (r) { return esc(r.till || '—'); } },
        { title: 'Смена', fn: function (r) { return esc(r.shift || '—'); } },
        { title: 'Кассир', fn: function (r) { return esc(r.cashier || '—'); } },
        { title: 'Должно быть', cls: 'num', fn: function (r) { return u.priv(E.shiftCalc(r).expected); } },
        { title: 'Факт', cls: 'num', fn: function (r) { return u.priv(r.factCash); } },
        { title: 'Расхождение', cls: 'num', fn: function (r) {
          var c = E.shiftCalc(r);
          return '<b class="' + (c.diff < 0 ? 'c-red' : 'c-orange') + ' private">' +
            (c.diff > 0 ? '+' : '') + money(c.diff) + '</b>'; } },
        { title: 'Комментарий', fn: function (r) { return esc(r.note || '—'); } }
      ], bigOnes, { step: 30 }),
        'Порог задаётся в настройках, раздел «Пороги»');
    }

    h += '<div class="banner"><span>💡</span><span>Сравнивайте не сумму недостач, а ' +
      '<b>недостачу на 1000 ₽ выручки</b>: кассир с большой выручкой и парой ошибок ' +
      'аккуратнее того, у кого выручка маленькая, а недостачи те же.</span></div>';
    return h;
  }

  /* --- База операций -------------------------------------------------------------- */
  function viewLedger() {
    var u = U();
    var sel = pick(), rows = sel.rows.slice().sort(function (a, b) {
      return E.txt(b.date).localeCompare(E.txt(a.date));
    });
    var t = E.totals(rows);

    var h = u.pageHead('База операций', 'Все записи о деньгах — ' +
      (sel.whole ? 'за всё время' : u.periodName().toLowerCase()),
      '<button class="btn" data-act="export-screen">⤓ В Excel</button>');

    h += '<div class="stat-grid">' +
      u.stat('Записей', u.nf(rows.length), 'смены, дни, приходы и расходы') +
      u.stat('Выручка', u.priv(t.revenue), 'наличные ' + money(t.zCash) + ' · безнал ' + money(t.zCashless)) +
      u.stat('Потрачено', u.priv(t.spent), 'выплаты из ящика плюс расходы') +
      u.stat('Забрал владелец', u.priv(t.draw), 'из оборота') +
      '</div>';
    h += wholeNote(sel);

    var defs = [
      { key: 'type', name: 'Что это', auto: function (r) { return r.type; }, limit: 6 },
      { key: 'cat', name: 'Статья', auto: function (r) { return r.category; }, limit: 14 },
      { key: 'method', name: 'Чем', auto: function (r) { return r.method; }, limit: 6 },
      { key: 'cashier', name: 'Кассир', auto: function (r) { return r.cashier; }, limit: 12 }
    ];
    var list = FLT().apply('ledger', rows, defs, function (r) {
      return [r.category, r.note, r.cashier, r.till, r.shift].filter(Boolean).join(' ');
    });
    h += FLT().bar('ledger', defs, rows, { search: 'статья, кассир, комментарий' });

    function sumOf(r) {
      if (E.isShift(r)) return E.shiftCalc(r).revenue;
      if (E.isDay(r)) return E.safeRound(num(r.goodsCash) + num(r.debtPaid));
      return num(r.amount);
    }
    function whatOf(r) {
      if (E.isShift(r)) return 'Смена: ' + esc(r.till || '') + ' ' + esc(r.shift || '') +
        (r.cashier ? ' · ' + esc(r.cashier) : '');
      if (E.isDay(r)) return 'Итоги дня';
      return esc(r.category || '—');
    }
    h += u.card('Записи', FLT().note(list.length, rows.length) + u.table('ledgerT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Что это', fn: function (r) { return u.badge(r.type || '—',
        E.isShift(r) ? 'blue' : E.isDay(r) ? 'gray' : E.isIncome(r) ? 'green'
          : E.isDraw(r) ? 'orange' : 'red'); } },
      { title: 'Подробности', fn: whatOf },
      { title: 'Чем', fn: function (r) { return esc(r.method || (E.isShift(r) ? 'нал + безнал' : '—')); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(sumOf(r)); } },
      { title: 'Расхождение', cls: 'num', fn: function (r) {
        if (!E.isShift(r)) return '—';
        var c = E.shiftCalc(r);
        return c.ok ? '<span class="c-green">сходится</span>'
          : '<span class="' + (c.diff < 0 ? 'c-red' : 'c-orange') + ' private">' + money(c.diff) + '</span>'; } },
      { title: 'Комментарий', fn: function (r) { return esc(r.note || '—'); } },
      { title: '', cls: 'center', fn: function (r) {
        var form = E.isShift(r) ? 'shiftClose' : E.isDay(r) ? 'dayTotals'
          : E.isIncome(r) ? 'moneyIn' : E.isDraw(r) ? 'moneyDraw' : 'moneyOut';
        return u.rowMenu('dds', r.id, { form: form }); } }
    ], list, { step: 50, empty: FLT().active('ledger') ? 'Под фильтр ничего не подошло' : 'Записей нет.' }));

    h += '<div class="quick">' +
      '<button class="btn" data-form="moneyIn">💰 Приход</button> ' +
      '<button class="btn" data-form="moneyOut">🧾 Расход</button> ' +
      '<button class="btn" data-form="moneyDraw">👛 Забрал владелец</button></div>';
    return h;
  }

  /* --- Долги покупателей ---------------------------------------------------------- */
  function viewDebtors() {
    var u = U();
    var rows = (S.state.debtors || []).slice().sort(function (a, b) {
      return E.txt(b.date).localeCompare(E.txt(a.date));
    });
    var t = E.debtorTotals(rows, today());
    var oldDays = num(S.settings.debtorOldDays) || 30;

    var h = u.pageHead('Долги покупателей', 'Бывшая тетрадка у кассы',
      '<button class="btn btn-primary" data-form="debtor">＋ Записать долг</button>');

    h += '<div class="stat-grid">' +
      u.stat('Не отдали', u.priv(t.open), t.people.length + ' человек', t.open ? 'c-orange' : 'c-green') +
      u.stat('Старше ' + oldDays + ' дней', u.priv(t.old), 'пора напомнить', t.old ? 'c-red' : 'c-green') +
      u.stat('Погашено', u.priv(t.closed), 'вернули полностью', 'c-green') +
      '</div>';

    var defs = [{ key: 'st', name: 'Состояние', options: [
      { v: 'open', name: 'Не отдал', test: function (d) { return num(d.sum) - num(d.paid) > 0; } },
      { v: 'old', name: 'Старше ' + oldDays + ' дней', test: function (d) {
        return num(d.sum) - num(d.paid) > 0 && E.daysBetween(d.date, today()) > oldDays; } },
      { v: 'closed', name: 'Вернул', test: function (d) { return num(d.sum) - num(d.paid) <= 0; } }
    ] }];
    var list = FLT().apply('debtors', rows, defs, function (d) { return d.name + ' ' + (d.phone || ''); });
    h += FLT().bar('debtors', defs, rows, { search: 'имя или телефон' });

    h += u.card('Кто должен', FLT().note(list.length, rows.length) + u.table('debtT', [
      { title: 'Кто', fn: function (d) { return esc(d.name); } },
      { title: 'Телефон', fn: function (d) {
        return d.phone ? '<a href="tel:' + esc(d.phone) + '">' + esc(d.phone) + '</a>' : '—'; } },
      { title: 'Когда', fn: function (d) { return esc(dateRu(d.date)); } },
      { title: 'Дней', cls: 'num', fn: function (d) {
        var n = E.daysBetween(d.date, today());
        return '<span class="' + (n > oldDays ? 'c-red' : '') + '">' + u.nf(n) + '</span>'; } },
      { title: 'Взял', cls: 'num', fn: function (d) { return u.priv(d.sum); } },
      { title: 'Вернул', cls: 'num', fn: function (d) { return u.priv(d.paid); } },
      { title: 'Осталось', cls: 'num', fn: function (d) {
        var left = E.safeRound(num(d.sum) - num(d.paid));
        return left > 0 ? '<b class="c-red private">' + money(left) + '</b>'
          : '<span class="c-green">вернул</span>'; } },
      { title: 'Кассир', fn: function (d) { return esc(d.cashier || '—'); } },
      { title: '', cls: 'center', fn: function (d) { return u.rowMenu('debtors', d.id, { form: 'debtor' }); } }
    ], list, { step: 40, empty: 'Долгов нет.' }));

    h += '<div class="banner"><span>💡</span><span>Пока долг не погашен, он не выручка. ' +
      'Когда человек вернёт деньги — впишите сумму в «Уже погашено», а сами деньги ' +
      'придут в кассу через сверку смены (или запишите «Приход денег»).</span></div>';
    return h;
  }

  /* --- Отчёт за месяц -------------------------------------------------------------- */
  function viewReport() {
    var u = U();
    var all = dds();
    if (!all.length) {
      return u.pageHead('Отчёт за месяц', 'Что было и как это выглядит рядом с прошлым месяцем') +
        '<div class="card"><div class="empty">Записей пока нет.</div></div>';
    }
    var months = {};
    all.forEach(function (r) { if (r.date) months[E.ymOf(r.date)] = 1; });
    var list = Object.keys(months).sort().reverse();
    var ym = S.settings.reportMonth && list.indexOf(S.settings.reportMonth) >= 0
      ? S.settings.reportMonth : list[0];
    var prevYm = E.prevMonth(ym);
    function of(m) { return all.filter(function (r) { return E.ymOf(r.date) === m; }); }
    var a = E.totals(of(ym)), b = E.totals(of(prevYm));

    var h = u.pageHead('Отчёт за месяц', E.monthTitle(ym) + ' — против ' + E.monthName(prevYm),
      '<select id="repMonth" style="background:var(--fill);border:none;border-radius:9px;padding:9px 12px;font-size:14px">' +
      list.map(function (m) {
        return '<option value="' + m + '"' + (m === ym ? ' selected' : '') + '>' +
          esc(E.monthTitle(m)) + '</option>';
      }).join('') + '</select> <button class="btn" data-act="print">🖨 Печать</button>');

    function line(name, x, y, isMoney) {
      return { name: name, cur: x, prev: y, delta: E.safeRound(x - y),
        pct: y ? E.safeRound((x - y) / Math.abs(y) * 100) : null, money: isMoney !== false };
    }
    var lines = [
      line('Выручка', a.revenue, b.revenue),
      line('в т.ч. наличными', a.zCash, b.zCash),
      line('в т.ч. безналом', a.zCashless, b.zCashless),
      line('Доля безнала, %', a.cashlessShare, b.cashlessShare, false),
      line('Выплаты из ящика', a.payouts, b.payouts),
      line('Прочие расходы', a.expense, b.expense),
      line('Товар за наличные', a.goodsCash, b.goodsCash),
      line('Взято в долг', a.debtTaken, b.debtTaken),
      line('Погашено долга', a.debtPaid, b.debtPaid),
      line('Недостачи', a.short, b.short),
      line('Излишки', a.over, b.over),
      line('Забрал владелец', a.draw, b.draw),
      line('Смен закрыто', a.shifts, b.shifts, false),
      line('Средняя выручка за смену', a.avgShift, b.avgShift)
    ];

    h += '<div class="stat-grid">' +
      u.stat('Выручка', u.priv(a.revenue), 'в прошлом месяце ' + money(b.revenue)) +
      u.stat('Потрачено', u.priv(a.spent), 'выплаты плюс расходы') +
      u.stat('Недостачи', u.priv(a.short), a.badShifts + ' смен не сошлись',
        a.short ? 'c-red' : 'c-green') +
      u.stat('Доля безнала', u.pct(a.cashlessShare), 'в прошлом месяце ' + u.pct(b.cashlessShare)) +
      '</div>';

    h += u.card('Строка за строкой', u.table('repT', [
      { title: 'Показатель', fn: function (r) { return esc(r.name); } },
      { title: E.monthTitle(ym), cls: 'num', fn: function (r) {
        return r.money ? u.priv(r.cur) : u.nf(r.cur, r.name.indexOf('%') > 0 ? 1 : 0); } },
      { title: E.monthTitle(prevYm), cls: 'num', fn: function (r) {
        return r.money ? u.priv(r.prev) : u.nf(r.prev, r.name.indexOf('%') > 0 ? 1 : 0); } },
      { title: 'Разница', cls: 'num', fn: function (r) {
        return '<span class="' + u.cls(r.delta) + (r.money ? ' private' : '') + '">' +
          (r.delta > 0 ? '+' : '') + (r.money ? money(r.delta) : u.nf(r.delta, 1)) + '</span>'; } },
      { title: '%', cls: 'num', fn: function (r) {
        return r.pct == null ? '—' : '<span class="' + u.cls(r.pct) + '">' +
          (r.pct > 0 ? '+' : '') + u.pct(r.pct) + '</span>'; } }
    ], lines, { step: 30 }));

    var cats = Object.keys(a.byCategory).map(function (k) {
      return { name: k, sum: a.byCategory[k], prev: b.byCategory[k] || 0 };
    }).sort(function (x, y) { return y.sum - x.sum; });
    if (cats.length) {
      h += u.card('Расходы по статьям', u.table('catT', [
        { title: 'Статья', fn: function (r) { return esc(r.name); } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.sum); } },
        { title: 'Доля', cls: 'num', fn: function (r) {
          return u.pct(E.div(r.sum, a.expense) * 100); } },
        { title: 'В прошлом месяце', cls: 'num', fn: function (r) { return u.priv(r.prev); } }
      ], cats, { step: 20 }));
    }
    return h;
  }

  /* ==========================================================================
     ДЕЙСТВИЯ
     ========================================================================== */
  var A = window.WM_EXTRA_ACTIONS = window.WM_EXTRA_ACTIONS || {};

  /* Отметить выплату оплаченной. Долг сама не уменьшает — предлагает вписать
     сумму в итоги дня, чтобы у кредиторки остался один источник. */
  A['plan-paid'] = function (el) {
    var p = (S.state.plans || []).filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!p) return 'Выплата не найдена.';
    p.status = 'Оплачена';
    p.paidAt = today();
    S.save(); refresh(); U().render();
    var day = dds().filter(function (r) { return E.isDay(r) && r.date === today(); })[0];
    if (day) {
      return 'Отмечено: ' + p.supplier + ' — ' + money(p.amount) + '. ' +
        'Не забудьте добавить эту сумму в «Погашение долгов ТП» за сегодня: ' +
        'сейчас там ' + money(day.debtPaid) + '.';
    }
    U().openForm('dayTotals', { date: today(), debtPaid: num(p.amount) });
    return 'Отмечено: ' + p.supplier + ' — ' + money(p.amount) + '. ' +
      'Вписал сумму в итоги дня — проверьте и сохраните.';
  };

  window.WM_EXTRA_CHANGE = function (el) {
    if (el.id === 'repMonth') { S.setSetting('reportMonth', el.value); return true; }
    return false;
  };

  /* ==========================================================================
     РЕГИСТРАЦИЯ ЭКРАНОВ
     ========================================================================== */
  var VIEWS = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  VIEWS.push(
    { id: 'pulse', icon: '📊', name: 'Пульт', group: 'Каждый день', render: viewPulse },
    { id: 'morning', icon: '🧮', name: 'Утро: сверка кассы', group: 'Каждый день', render: viewMorning },
    { id: 'evening', icon: '🌙', name: 'Вечер: итоги дня', group: 'Каждый день', render: viewEvening },
    { id: 'finpay', icon: '📅', name: 'План выплат', group: 'Каждый день', render: viewPlans },
    { id: 'ledger', icon: '🧮', name: 'База операций', group: 'Деньги', render: viewLedger },
    { id: 'cashiers', icon: '🧑‍💼', name: 'Кассиры и расхождения', group: 'Деньги', render: viewCashiers },
    { id: 'debtors', icon: '📓', name: 'Долги покупателей', group: 'Деньги', render: viewDebtors },
    { id: 'finreport', icon: '📄', name: 'Отчёт за месяц', group: 'Деньги', render: viewReport }
  );
})();
