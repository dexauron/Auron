/* ============================================================================
   Экраны финансов «как в вашей таблице»: Пульт, Касса, Расходы, База операций,
   Выплаты поставщикам, Дашборд и Отчёт за месяц.
   Файл подключается ДО js/ui.js и складывает экраны и формы в общий список.
   Все помощники рисования берутся из window.WMUI в момент отрисовки.
   ========================================================================== */
(function () {
  'use strict';
  var E = window.WM, S = window.WMStore, F = window.WMFin, Q = window.WMQuick;

  function U() { return window.WMUI; }              // помощники интерфейса
  function ddsAll() { return S.state.dds || []; }
  function plansAll() { return S.state.plans || []; }
  function today() { return new Date().toISOString().slice(0, 10); }

  function opening() {
    var s = S.settings;
    return { cash: E.num(s.openCashStart), card: E.num(s.openCardStart), transfer: E.num(s.openTransferStart) };
  }
  function dict(name, fallback) {
    var v = S.settings[name];
    if (typeof v === 'string' && v.trim()) return v.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    return fallback;
  }
  function D() { return Q.dicts(S.state, S.settings); }
  function categories() { return D().categories; }
  function cashiers() { return D().cashiers; }
  function shiftNames() { return D().shifts; }
  function methods() { return D().methods; }
  function suppliers() { return D().suppliers; }

  // Новое слово, вписанное в форму, попадает в справочник — второй раз его
  // уже можно выбрать из списка.
  function learn(map) {
    var changed = false;
    Object.keys(map).forEach(function (dictName) {
      if (Q.learn(S.settings, dictName, map[dictName])) changed = true;
    });
    if (changed) S.save();
  }

  /* --- Формы ввода ---------------------------------------------------------- */
  window.WM_EXTRA_FORMS = {
    // Ввод кассы: Z-отчёт против фактических денег по трём способам оплаты
    cashShift: {
      title: 'Касса за смену', icon: '💵',
      body: function (v) {
        var u = U(); v = v || {};
        var pre = Q.defaults(S.state, S.settings, 'cashShift');
        return u.fieldRow('Дата', 'date', 'date', v.date || pre.date) +
          u.fieldRow('Смена', 'shift', 'list', v.shift || pre.shift, { options: shiftNames() }) +
          u.fieldRow('Кассир', 'cashier', 'list', v.cashier || pre.cashier, { options: cashiers(), placeholder: 'кто сдаёт' }) +
          u.fieldRow('Наличные: Z-отчёт', 'zCash', 'number', v.zCash || '') +
          u.fieldRow('Наличные: факт выручки', 'fCash', 'number', v.fCash || '') +
          u.fieldRow('Карта: Z-отчёт', 'zCard', 'number', v.zCard || 0) +
          u.fieldRow('Карта: факт', 'fCard', 'number', v.fCard || 0) +
          u.fieldRow('Перевод: Z-отчёт', 'zTrans', 'number', v.zTrans || 0) +
          u.fieldRow('Перевод: факт', 'fTrans', 'number', v.fTrans || 0) +
          u.fieldRow('Выдано из кассы за смену', 'payout', 'number', v.payout || 0) +
          u.fieldRow('Комментарий', 'note', 'text', v.note || '');
      },
      hint: '«Факт» — сколько денег пришло на самом деле, до выплат из кассы. ' +
        'Расхождение = факт − Z-отчёт по каждому способу.',
      save: function (v) {
        if (!v.zCash && !v.zCard && !v.zTrans && !v.fCash) return 'Заполните хотя бы наличные.';
        var fields = ['zCash', 'fCash', 'zCard', 'fCard', 'zTrans', 'fTrans', 'payout'];
        for (var fi = 0; fi < fields.length; fi++) {
          var badF = Q.checkAmount(v[fields[fi]], { allowEmpty: true, allowZero: true });
          if (badF) return 'Поле «' + fields[fi] + '»: ' + badF;
        }
        learn({ shifts: v.shift, cashiers: v.cashier });
        var base = { date: v.date, shift: v.shift, cashier: v.cashier, type: 'Приход',
          category: F.SALES, note: v.note, src: 'касса' };
        var group = S.uid();
        var pairs = [['Наличные', v.zCash, v.fCash], ['Карта', v.zCard, v.fCard], ['Перевод', v.zTrans, v.fTrans]];
        var added = 0, diffTotal = 0;
        pairs.forEach(function (p) {
          var z = E.num(p[1]), f = E.num(p[2]);
          if (!z && !f) return;
          var diff = E.safeRound(f - z);
          diffTotal += diff;
          S.add('dds', Object.assign({}, base, { method: p[0], amount: z, diff: diff, group: group }));
          added++;
        });
        if (E.num(v.payout) > 0) {
          S.add('dds', { date: v.date, shift: v.shift, cashier: v.cashier, type: 'Расход',
            category: 'Выплата из кассы', method: 'Наличные', amount: E.num(v.payout),
            diff: 0, note: v.note, src: 'касса', group: group });
          added++;
        }
        var total = E.num(v.zCash) + E.num(v.zCard) + E.num(v.zTrans);
        return { ok: 'Смена записана: выручка ' + E.fmtMoney(total) +
          (diffTotal ? ', расхождение ' + E.fmtMoney(diffTotal) : ', касса сходится') };
      }
    },
    // Расход: обычная трата или закуп товара в долг
    ddsExpense: {
      title: 'Расход', icon: '🧾',
      body: function (v) {
        var u = U(); v = v || {};
        var pre = Q.defaults(S.state, S.settings, 'ddsExpense');
        return u.fieldRow('Дата', 'date', 'date', v.date || pre.date) +
          u.fieldRow('Категория', 'category', 'list', v.category || pre.category, { options: categories(), placeholder: 'за что платим' }) +
          u.fieldRow('Способ оплаты', 'method', 'list', v.method || pre.method, { options: methods() }) +
          u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
          u.fieldRow('Это товар в долг', 'debt', 'select', v.debt || 'нет', { options: ['нет', 'да'] }) +
          u.fieldRow('Кто вносит', 'cashier', 'list', v.cashier || pre.cashier, { options: cashiers() }) +
          u.fieldRow('Комментарий', 'note', 'text', v.note || '', { placeholder: 'поставщик, за что' });
      },
      hint: '«Товар в долг» — деньги не платили, долг поставщику вырос.',
      save: function (v) {
        var bad = Q.checkAmount(v.amount); if (bad) return bad;
        learn({ categories: v.category, methods: v.method, cashiers: v.cashier });
        var debt = String(v.debt) === 'да';
        S.add('dds', { date: v.date, shift: '', cashier: v.cashier, type: debt ? 'Долг' : 'Расход',
          category: v.category, method: v.method, amount: E.num(v.amount), diff: 0,
          note: v.note, src: 'расход' });
        return { ok: (debt ? 'Взято в долг: ' : 'Расход записан: ') + v.category + ' — ' + E.fmtMoney(v.amount) };
      }
    },
    // Прочий приход, не связанный со сменой
    ddsIncome: {
      title: 'Приход денег', icon: '💰',
      body: function (v) {
        var u = U(); v = v || {};
        return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
          u.fieldRow('Категория', 'category', 'list', v.category || F.SALES, { options: categories() }) +
          u.fieldRow('Способ оплаты', 'method', 'list', v.method || 'Наличные', { options: methods() }) +
          u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
          u.fieldRow('Смена', 'shift', 'list', v.shift || '', { options: shiftNames() }) +
          u.fieldRow('Кассир', 'cashier', 'list', v.cashier || '', { options: cashiers() }) +
          u.fieldRow('Комментарий', 'note', 'text', v.note || '');
      },
      save: function (v) {
        var bad = Q.checkAmount(v.amount); if (bad) return bad;
        learn({ categories: v.category, methods: v.method, cashiers: v.cashier, shifts: v.shift });
        S.add('dds', { date: v.date, shift: v.shift, cashier: v.cashier, type: 'Приход',
          category: v.category || F.SALES, method: v.method, amount: E.num(v.amount), diff: 0,
          note: v.note, src: 'приход' });
        return { ok: 'Приход записан: ' + E.fmtMoney(v.amount) };
      }
    },
    // Плановая выплата поставщику
    payPlan: {
      title: 'Выплата поставщику', icon: '📅',
      body: function (v) {
        var u = U(); v = v || {};
        return u.fieldRow('Дата оплаты (план)', 'due', 'date', v.due || today()) +
          u.fieldRow('Поставщик', 'supplier', 'list', v.supplier || '', { options: suppliers(), placeholder: 'кому платим' }) +
          u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
          u.fieldRow('Накладная', 'doc', 'text', v.doc || '') +
          u.fieldRow('Способ оплаты', 'method', 'list', v.method || 'Наличные', { options: methods() }) +
          u.fieldRow('Статус', 'status', 'select', v.status || 'Запланировано', { options: ['Запланировано', 'Оплачено'] }) +
          u.fieldRow('Примечание', 'note', 'text', v.note || '');
      },
      hint: 'Когда оплатите — нажмите «Оплачено» в списке: запись сама попадёт в расходы.',
      save: function (v) {
        if (!v.supplier) return 'Укажите поставщика.';
        var badSum = Q.checkAmount(v.amount); if (badSum) return badSum;
        learn({ suppliers: v.supplier, methods: v.method });
        var paid = E.norm(v.status).indexOf('оплач') >= 0;
        var already = paid && (S.state.dds || []).some(function (r) {
          // расход по этой оплате уже мог быть записан раньше — не дублируем
          return E.norm(r.category).indexOf('оплата тп') >= 0 && r.date === v.due &&
            E.num(r.amount) === E.num(v.amount) && E.norm(r.note).indexOf(E.norm(v.supplier)) >= 0;
        });
        S.add('plans', { due: v.due, supplier: v.supplier, amount: E.num(v.amount), doc: v.doc,
          method: v.method, status: v.status, paidAt: paid ? v.due : '', note: v.note });
        if (paid && !already) markPaidRecord({ supplier: v.supplier, amount: E.num(v.amount), method: v.method, doc: v.doc }, v.due);
        return { ok: 'Выплата записана: ' + v.supplier + ' — ' + E.fmtMoney(v.amount) };
      }
    }
  };

  // Оплата поставщику попадает в расходы как «Оплата ТП» — так же, как в вашей таблице
  function markPaidRecord(p, date) {
    S.add('dds', { date: date, shift: '', cashier: '', type: 'Расход', category: F.DEBT_PAY,
      method: p.method || 'Наличные', amount: E.num(p.amount), diff: 0,
      note: p.supplier + (p.doc ? ' · ' + p.doc : ''), src: 'выплата' });
  }
  window.WM_MARK_PAID = function (id) {
    var p = plansAll().filter(function (x) { return x.id === id; })[0];
    if (!p) return null;
    S.update('plans', id, { status: 'Оплачено', paidAt: today() });
    markPaidRecord(p, today());
    return p;
  };

  /* --- Отбор записей по периоду --------------------------------------------- */
  function rowsIn(range) {
    return ddsAll().filter(function (r) { return r.date >= range.from && r.date <= range.to; });
  }
  // Если за выбранный период записей нет — показываем всё, честно предупредив.
  // Иначе владелец видит пустые экраны просто потому, что данные за прошлый год.
  function pick() {
    var u = U(), rows = rowsIn(u.periodRange());
    if (rows.length) return { rows: rows, whole: false, note: '' };
    var all = ddsAll();
    if (!all.length) return { rows: [], whole: false, note: '' };
    var dates = all.map(function (r) { return r.date; }).sort();
    return { rows: all, whole: true,
      note: 'За ' + u.periodName().toLowerCase() + ' записей нет — показаны все данные с ' +
        u.dateRu(dates[0]) + ' ' + dates[0].slice(0, 4) + ' по ' + u.dateRu(dates[dates.length - 1]) + ' ' + dates[dates.length - 1].slice(0, 4) + '.' };
  }
  function noteBanner(sel) {
    return sel.note ? '<div class="banner blue"><span>ℹ️</span><div>' + sel.note + '</div></div>' : '';
  }

  /* --- 1. Пульт -------------------------------------------------------------- */
  function viewPulse() {
    var u = U(), range = u.periodRange();
    var all = ddsAll();
    if (!all.length) {
      return u.pageHead('Пульт', 'Деньги, продажи и платежи') +
        '<div class="card"><div class="empty"><b>Записей пока нет</b><br>' +
        'Нажмите «Касса за смену» или «Расход» — и здесь появятся все показатели.<br>' +
        'Если у вас есть таблица Auron Finance — загрузите её на экране «Данные и файлы», всё перенесётся.</div></div>' +
        quick();
    }
    var sel = pick(), period = sel.rows, t = F.totals(period);
    var bal = F.balances(all, opening());
    var td = F.totals(all.filter(function (r) { return r.date === today(); }));
    var pt = F.planTotals(plansAll(), today());
    var tAll = F.totals(all);

    var h = u.pageHead('Пульт', 'Деньги, продажи и платежи — ' + (sel.whole ? 'все данные' : u.periodName().toLowerCase()));
    h += noteBanner(sel);
    h += '<div class="stat-grid">' +
      u.stat('Наличные', u.priv(bal.map['Наличные']), 'В кассе и сейфе') +
      u.stat('Карта', u.priv(bal.map['Карта']), 'Поступления минус траты') +
      u.stat('Перевод', u.priv(bal.map['Перевод']), 'Расчётный счёт') +
      u.stat('Всего денег', u.priv(bal.total), 'Остаток по всем способам', bal.total >= 0 ? 'c-green' : 'c-red') +
      '</div>';

    h += quick();

    h += u.card('Сегодня', u.listOf([
      u.listRow({ icon: '🧾', title: 'Записей за сегодня', value: u.nf(td.tx) }),
      u.listRow({ icon: '💰', title: 'Выручка', value: u.priv(td.income) }),
      u.listRow({ icon: '💸', title: 'Расход', value: u.priv(td.expense) }),
      u.listRow({ icon: '📈', title: 'Прибыль за день',
        value: '<span class="' + (td.profit >= 0 ? 'c-green' : 'c-red') + ' private">' + E.fmtMoney(td.profit) + '</span>' })
    ], ''));

    h += u.card('Как идёт магазин — ' + (sel.whole ? 'за всё время' : u.periodName().toLowerCase()), u.listOf([
      u.listRow({ icon: '💰', title: 'Выручка', sub: 'Все поступления', value: u.priv(t.income) }),
      u.listRow({ icon: '💸', title: 'Расход', sub: 'Закуп ' + E.fmtMoney(t.purchase), value: u.priv(t.expense) }),
      u.listRow({ icon: '📈', title: 'Прибыль', sub: 'Рентабельность ' + u.pct(t.profitability),
        value: '<span class="' + (t.profit >= 0 ? 'c-green' : 'c-red') + ' private">' + E.fmtMoney(t.profit) + '</span>' }),
      u.listRow({ icon: '📊', title: 'Маржа', sub: 'Выручка минус закуп товара', value: u.pct(t.margin) }),
      u.listRow({ icon: '📅', title: 'Средняя выручка в день', sub: 'Дней с данными: ' + t.days, value: u.priv(t.avgDay) }),
      u.listRow({ icon: '🕒', title: 'Смен закрыто', sub: 'Средняя выручка за смену ' + E.fmtMoney(t.avgShift), value: u.nf(t.shifts) }),
      u.listRow({ icon: '🤝', title: 'Взято в долг за период', sub: 'Товар без оплаты', value: u.priv(t.debtTaken) })
    ], ''));

    var debtColor = tAll.debtNow >= E.num(S.settings.debtCrit) ? 'c-red'
      : (tAll.debtNow >= E.num(S.settings.debtWarn) ? 'c-orange' : 'c-green');
    h += u.card('Выплаты поставщикам', u.listOf([
      u.listRow({ icon: '📅', title: 'К оплате сегодня', value: u.priv(pt.dueToday), tap: true, attrs: ' data-go="finpay"' }),
      u.listRow({ icon: '🔴', title: 'Просрочено', sub: pt.overdueCount + ' платежей',
        value: '<span class="c-red private">' + E.fmtMoney(pt.overdue) + '</span>', tap: true, attrs: ' data-go="finpay"' }),
      u.listRow({ icon: '🗓', title: 'Запланировано', sub: pt.plannedCount + ' платежей', value: u.priv(pt.planned), tap: true, attrs: ' data-go="finpay"' }),
      u.listRow({ icon: '💼', title: 'Общий долг поставщикам', sub: 'Взято ' + E.fmtMoney(tAll.debtTaken) + ' · погашено ' + E.fmtMoney(tAll.debtPaid),
        value: '<span class="' + debtColor + ' private">' + E.fmtMoney(tAll.debtNow) + '</span>' })
    ], ''));
    return h;
  }

  function quick() {
    return '<div class="quick">' +
      '<button class="btn btn-primary" data-form="cashShift">💵 Касса за смену</button>' +
      '<button class="btn" data-form="ddsExpense">🧾 Расход</button>' +
      '<button class="btn" data-form="ddsIncome">💰 Приход</button>' +
      '<button class="btn" data-form="payPlan">📅 Выплата поставщику</button></div>';
  }

  /* --- 2. Дашборд ------------------------------------------------------------ */
  function viewFinDash() {
    var u = U(), sel = pick(), rows = sel.rows;
    if (!rows.length) {
      return u.pageHead('Дашборд', 'Полная аналитика') +
        '<div class="card"><div class="empty">Записей пока нет. Начните с «Касса за смену» или загрузите свою таблицу.</div></div>';
    }
    var t = F.totals(rows), meth = F.byMethodIncome(rows), cats = F.byCategory(rows);
    var pt = F.planTotals(plansAll(), today());

    var h = u.pageHead('Дашборд', 'Полная аналитика — ' + (sel.whole ? 'все данные' : u.periodName().toLowerCase()));
    h += noteBanner(sel);

    h += '<div class="stat-grid">' +
      u.stat('Выручка всего', u.priv(t.income), u.nf(t.tx) + ' операций') +
      meth.map(function (m) { return u.stat(m.name, u.priv(m.sum), u.pct(m.share) + ' выручки'); }).join('') +
      '</div>';

    h += '<div class="stat-grid">' +
      u.stat('Расход всего', u.priv(t.expense), u.pct(E.div(t.expense, t.income) * 100) + ' от выручки') +
      u.stat('Закуп товара', u.priv(t.purchase), u.pct(E.div(t.purchase, t.expense) * 100) + ' расходов') +
      u.stat('Зарплата и аренда', u.priv(t.salaryRent), 'ЗП ' + E.fmtMoney(t.salary) + ' · аренда ' + E.fmtMoney(t.rent)) +
      u.stat('Прочее', u.priv(t.other), 'Налоги, связь, реклама и другое') +
      '</div>';

    h += '<div class="stat-grid">' +
      u.stat('Прибыль по кассе', u.priv(t.profit), 'Выручка минус расходы', t.profit >= 0 ? 'c-green' : 'c-red') +
      u.stat('Рентабельность', u.pct(t.profitability), 'Прибыль ÷ выручка') +
      u.stat('Маржа', u.pct(t.margin), 'Выручка минус закуп') +
      u.stat('Долг сейчас', u.priv(t.debtNow), 'Взято ' + E.fmtMoney(t.debtTaken) + ' · погашено ' + E.fmtMoney(t.debtPaid), 'c-orange') +
      '</div>';

    h += '<div class="stat-grid">' +
      u.stat('Смен закрыто', u.nf(t.shifts), 'Средняя выручка ' + E.fmtMoney(t.avgShift)) +
      u.stat('Средняя выручка в день', u.priv(t.avgDay), 'Дней с данными ' + t.days) +
      u.stat('Расхождение касс', u.priv(t.diffSum), t.diffCount + ' смен с расхождением',
        Math.abs(t.diffSum) >= E.num(S.settings.diffCrit) ? 'c-red' : 'c-green') +
      u.stat('Лучший и худший день', u.priv(t.maxDay), 'Минимум ' + E.fmtMoney(t.minDay)) +
      '</div>';

    h += '<div class="grid-2"><div class="chart-box"><canvas id="finChartDays"></canvas></div>' +
      '<div class="chart-box"><canvas id="finChartCats"></canvas></div></div>';

    h += u.card('Расходы по категориям', u.listOf(cats.map(function (c) {
      return u.listRow({ icon: '🧾', title: c.name, sub: c.count + ' записей · ' + u.pct(c.share) + ' расходов',
        value: u.priv(c.sum) });
    }), 'Расходов нет'));

    h += '<div class="grid-2">' +
      u.card('Выручка по сменам', u.listOf(F.byShift(rows).map(function (s) {
        return u.listRow({ icon: s.name === 'Ночная' ? '🌙' : (s.name === 'Утро' ? '🌅' : '🌆'),
          title: s.name, sub: u.pct(s.share) + ' выручки', value: u.priv(s.sum) });
      }), '')) +
      u.card('Выручка по дням недели', u.listOf(F.byWeekday(rows).map(function (d) {
        return u.listRow({ icon: '📅', title: d.name, sub: u.pct(d.share), value: u.priv(d.sum) });
      }), '')) + '</div>';

    h += u.card('Расхождения по кассирам', u.listOf(F.byCashier(rows).filter(function (c) { return c.name !== '—'; }).map(function (c) {
      return u.listRow({ icon: c.diff === 0 ? '🟢' : (c.diff < 0 ? '🔴' : '🟠'), title: c.name,
        sub: c.shiftCount + ' смен · выручка ' + E.fmtMoney(c.income) + ' · расхождений ' + c.diffCount,
        value: '<span class="' + u.cls(c.diff) + ' private">' + E.fmtMoney(c.diff) + '</span>' });
    }), 'Кассиры не указаны'));

    h += u.card('Эффективность', u.listOf([
      u.listRow({ icon: '📦', title: 'Эффективность закупа', sub: 'Во сколько раз выручка больше закупа', value: t.purchaseEff + '×' }),
      u.listRow({ icon: '💼', title: 'Нагрузка долга', sub: 'Долг ÷ выручка', value: u.pct(t.debtLoad) }),
      u.listRow({ icon: '🤝', title: 'Доля закупа в долг', sub: 'Сколько товара берём без оплаты', value: u.pct(t.debtShare) }),
      u.listRow({ icon: '📉', title: 'Средний расход в день', value: u.priv(t.expenseDay) }),
      u.listRow({ icon: '✅', title: 'Оплачено выплат', sub: pt.paidCount + ' из ' + pt.count + ' платежей', value: u.pct(pt.paidShare) }),
      u.listRow({ icon: '⏰', title: 'Просроченные выплаты', sub: pt.overdueCount + ' платежей',
        value: '<span class="c-red private">' + E.fmtMoney(pt.overdue) + '</span>' })
    ], ''));
    return h;
  }

  function drawFinCharts() {
    var u = U();
    if (typeof Chart === 'undefined') return;
    var rows = pick().rows;
    var t = F.totals(rows);
    var css = getComputedStyle(document.body);
    var blue = css.getPropertyValue('--blue').trim(), label = css.getPropertyValue('--label-2').trim();
    var cv = document.getElementById('finChartDays');
    if (cv) {
      var days = Object.keys(t.byDay).sort().slice(-30);
      if (window.__finChart1) window.__finChart1.destroy();
      window.__finChart1 = new Chart(cv.getContext('2d'), {
        type: 'bar',
        data: { labels: days.map(function (d) { return u.dateRu(d); }),
          datasets: [{ data: days.map(function (d) { return Math.round(t.byDay[d]); }), backgroundColor: blue, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, title: { display: true, text: 'Выручка по дням', color: label, align: 'start', font: { size: 14, weight: '600' } } },
          scales: { x: { grid: { display: false }, ticks: { color: label, maxTicksLimit: 10 } },
            y: { grid: { color: 'rgba(120,120,128,.14)' }, ticks: { color: label, callback: function (v) { return (v / 1000) + 'т'; } } } } }
      });
    }
    var cv2 = document.getElementById('finChartCats');
    if (cv2) {
      var cats = F.byCategory(rows).slice(0, 7);
      if (window.__finChart2) window.__finChart2.destroy();
      window.__finChart2 = new Chart(cv2.getContext('2d'), {
        type: 'doughnut',
        data: { labels: cats.map(function (c) { return c.name; }),
          datasets: [{ data: cats.map(function (c) { return Math.round(c.sum); }),
            backgroundColor: ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF3B30', '#30B0C7', '#5856D6'] }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: { legend: { position: 'bottom', labels: { color: label, font: { size: 11 }, boxWidth: 10 } },
            title: { display: true, text: 'Куда уходят деньги', color: label, align: 'start', font: { size: 14, weight: '600' } } } }
      });
    }
  }

  /* --- 3. База операций ------------------------------------------------------ */
  var filt = { type: '', category: '', method: '', cashier: '', q: '' };

  function viewFinBase() {
    var u = U(), sel = pick();
    var rows = sel.rows.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || '');
    });
    if (filt.type) rows = rows.filter(function (r) { return r.type === filt.type; });
    if (filt.category) rows = rows.filter(function (r) { return r.category === filt.category; });
    if (filt.method) rows = rows.filter(function (r) { return r.method === filt.method; });
    if (filt.cashier) rows = rows.filter(function (r) { return r.cashier === filt.cashier; });
    var q = E.norm(document.getElementById('search') ? document.getElementById('search').value : '');
    if (q) rows = rows.filter(function (r) {
      return E.norm(r.note).indexOf(q) >= 0 || E.norm(r.category).indexOf(q) >= 0 ||
        E.norm(r.cashier).indexOf(q) >= 0 || E.norm(r.supplier || '').indexOf(q) >= 0;
    });
    var t = F.totals(rows);

    var h = u.pageHead('База операций', 'Все записи о деньгах — ' + (sel.whole ? 'все данные' : u.periodName().toLowerCase())) +
      noteBanner(sel) + quick();

    h += '<div class="stat-grid">' +
      u.stat('Приход', u.priv(t.income), u.nf(rows.filter(F.isIncome).length) + ' записей', 'c-green') +
      u.stat('Расход', u.priv(t.expense), u.nf(rows.filter(F.isExpense).length) + ' записей', 'c-red') +
      u.stat('Взято в долг', u.priv(t.debtTaken), u.nf(rows.filter(F.isDebt).length) + ' записей', 'c-orange') +
      u.stat('Итого записей', u.nf(rows.length), 'Отобрано из ' + u.nf(ddsAll().length)) +
      '</div>';

    var sel = function (name, value, options, label) {
      return '<select class="fin-filter" data-filter="' + name + '" style="background:var(--fill);border:none;border-radius:9px;padding:8px 12px;font-size:14px">' +
        '<option value="">' + label + '</option>' +
        options.map(function (o) { return '<option value="' + u.esc(o) + '"' + (value === o ? ' selected' : '') + '>' + u.esc(o) + '</option>'; }).join('') +
        '</select>';
    };
    h += '<div class="quick">' +
      sel('type', filt.type, F.TYPES, 'Все операции') +
      sel('category', filt.category, uniq(ddsAll().map(function (r) { return r.category; })), 'Все категории') +
      sel('method', filt.method, F.METHODS, 'Любая оплата') +
      sel('cashier', filt.cashier, cashiers(), 'Все кассиры') +
      (filt.type || filt.category || filt.method || filt.cashier ? '<button class="btn btn-sm" data-act="fin-filter-clear">Сбросить</button>' : '') +
      '</div>';

    h += u.card('Записи', u.table('finBaseT', [
      { title: 'Дата', fn: function (r) { return u.esc(u.dateRu(r.date)); } },
      { title: 'Смена', fn: function (r) { return u.esc(r.shift || '—'); } },
      { title: 'Кассир', fn: function (r) { return u.esc(r.cashier || '—'); } },
      { title: 'Тип', fn: function (r) {
        return u.badge(r.type, F.isIncome(r) ? 'green' : (F.isDebt(r) ? 'orange' : 'red')); } },
      { title: 'Категория', fn: function (r) { return u.esc(r.category); } },
      { title: 'Оплата', fn: function (r) { return u.esc(r.method); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.amount); } },
      { title: 'Расхожд.', cls: 'num', fn: function (r) {
        return r.diff ? '<span class="' + u.cls(r.diff) + ' private">' + E.fmtMoney(r.diff) + '</span>' : '—'; } },
      { title: 'Комментарий', fn: function (r) { return u.esc(r.note || ''); } },
      { title: '', cls: 'center', fn: function (r) {
        var form = F.isIncome(r) ? 'ddsIncome' : 'ddsExpense';
        return '<button class="btn btn-sm" data-edit="dds:' + r.id + ':' + form + '" title="Исправить">✎</button> ' +
          '<button class="btn btn-sm btn-danger" data-del="dds:' + r.id + '">✕</button>'; } }
    ], rows, { step: 50, empty: 'Записей нет' }));
    return h;
  }
  function uniq(list) {
    var set = {};
    list.forEach(function (x) { if (x) set[x] = 1; });
    return Object.keys(set).sort();
  }

  /* --- 4. Выплаты поставщикам ------------------------------------------------ */
  // Подтверждённые накладные 1С встают в тот же план выплат, что и ручные записи:
  // владелец видит один список и один календарь, а не два.
  function docPlans() {
    var c = (U().calc() || {}).sup;
    if (!c) return [];
    return c.docs.filter(function (d) { return d.confirmed && d.left > 0; }).map(function (d) {
      return { id: 'doc:' + d.id, docId: d.id, due: d.due, supplier: d.firm, doc: d.doc,
        amount: d.left, method: '', source: '1c' };
    });
  }

  function viewFinPay() {
    var u = U(), t = today();
    var plans = plansAll().concat(docPlans())
      .sort(function (a, b) { return (a.due || '').localeCompare(b.due || ''); });
    var pt = F.planTotals(plans, t);
    var ym = (S.settings.payMonth || t.slice(0, 7));
    var cal = F.calendarMonth(plans, ym, t);
    var tAll = F.totals(ddsAll());

    var h = u.pageHead('Выплаты поставщикам', 'План платежей и календарь',
      '<button class="btn btn-primary" data-form="payPlan">＋ Выплата</button>');

    h += '<div class="stat-grid">' +
      u.stat('Просрочено', u.priv(pt.overdue), pt.overdueCount + ' платежей', pt.overdue ? 'c-red' : 'c-green') +
      u.stat('К оплате сегодня', u.priv(pt.dueToday), t) +
      u.stat('Запланировано', u.priv(pt.planned), pt.plannedCount + ' платежей') +
      u.stat('Общий долг', u.priv(tAll.debtNow), 'По базе операций', 'c-orange') +
      '</div>';

    // календарь месяца
    var head = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    var cells = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;padding:0 18px 18px">' +
      head.map(function (d) { return '<div style="font-size:12px;color:var(--label-2);text-align:center;padding:4px 0">' + d + '</div>'; }).join('');
    cal.weeks.forEach(function (w) {
      w.forEach(function (c) {
        if (!c) { cells += '<div></div>'; return; }
        var color = c.status === 'overdue' ? 'var(--red)' : (c.status === 'planned' ? 'var(--orange)' : 'var(--green)');
        cells += '<div style="border-radius:10px;padding:7px 8px;min-height:56px;background:' +
          (c.sum ? 'color-mix(in srgb, ' + color + ' 12%, transparent)' : 'var(--fill-2)') +
          (c.isToday ? ';outline:2px solid var(--blue)' : '') + '">' +
          '<div style="font-size:12px;color:var(--label-2)">' + c.day + '</div>' +
          (c.sum ? '<div style="font-size:13px;font-weight:650;color:' + color + '" class="private">' + E.fmtMoney(c.sum) + '</div>' : '') +
          '</div>';
      });
    });
    cells += '</div>';
    h += u.card('Календарь · ' + cal.title, cells,
      '<span class="card-note">🔴 просрочено · 🟠 ждёт оплаты · 🟢 оплачено</span>');

    h += u.card('Список выплат', u.table('planT', [
      { title: 'Дата плана', fn: function (r) {
        var st = F.planStatus(r, t);
        return '<span class="' + (st === 'overdue' ? 'c-red' : '') + '">' + u.esc(u.dateRu(r.due)) + '</span>'; } },
      { title: 'Поставщик', fn: function (r) { return u.esc(r.supplier); } },
      { title: 'Накладная', fn: function (r) {
        return u.esc(r.doc || '—') + (r.source === '1c' ? ' ' + u.badge('из 1С', 'blue') : ''); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.amount); } },
      { title: 'Оплата', fn: function (r) { return u.esc(r.method || '—'); } },
      { title: 'Статус', cls: 'center', fn: function (r) {
        var st = F.planStatus(r, t);
        return u.badge(st === 'paid' ? 'Оплачено' : (st === 'overdue' ? 'Просрочено' : 'Запланировано'),
          st === 'paid' ? 'green' : (st === 'overdue' ? 'red' : 'orange')); } },
      { title: 'Оплачено', fn: function (r) { return r.paidAt ? u.esc(u.dateRu(r.paidAt)) : '—'; } },
      { title: '', cls: 'center', fn: function (r) {
        var st = F.planStatus(r, t);
        if (r.source === '1c') {
          return '<button class="btn btn-sm btn-primary" data-act="sup-doc-paid" data-id="' + r.docId + '">Оплатил</button> ' +
            '<button class="btn btn-sm" data-act="sup-doc-edit" data-id="' + r.docId + '" title="Исправить">✎</button>';
        }
        return (st === 'paid' ? '' : '<button class="btn btn-sm btn-primary" data-act="fin-pay" data-id="' + r.id + '">Оплатил</button> ') +
          '<button class="btn btn-sm" data-edit="plans:' + r.id + ':payPlan" title="Исправить">✎</button> ' +
          '<button class="btn btn-sm btn-danger" data-del="plans:' + r.id + '">✕</button>'; } }
    ], plans, { step: 40, empty: 'Выплат пока нет. Нажмите «＋ Выплата».' }));
    return h;
  }

  /* --- 5. Отчёт за месяц ------------------------------------------------------ */
  function viewFinReport() {
    var u = U();
    var all = ddsAll();
    if (!all.length) {
      return u.pageHead('Отчёт за месяц', 'Сравнение с прошлым месяцем') +
        '<div class="card"><div class="empty">Нет записей для отчёта.</div></div>';
    }
    var months = uniq(all.map(function (r) { return String(r.date).slice(0, 7); })).sort().reverse();
    var ym = S.settings.reportMonth && months.indexOf(S.settings.reportMonth) >= 0 ? S.settings.reportMonth : months[0];
    var rep = F.monthReport(all, ym);

    var h = u.pageHead('Отчёт за месяц', rep.title + ' · сравнение с ' + rep.prevTitle,
      '<select id="repMonth" style="background:var(--fill);border:none;border-radius:9px;padding:9px 12px;font-size:14px">' +
      months.map(function (m) { return '<option value="' + m + '"' + (m === ym ? ' selected' : '') + '>' + F.monthName(m) + '</option>'; }).join('') +
      '</select>');

    h += '<div class="stat-grid">' +
      u.stat('Выручка', u.priv(rep.cur.income), delta(rep.finance[0])) +
      u.stat('Расходы', u.priv(rep.cur.expense), delta(rep.finance[1])) +
      u.stat('Чистая прибыль', u.priv(rep.cur.profit), delta(rep.finance[6]), rep.cur.profit >= 0 ? 'c-green' : 'c-red') +
      u.stat('Рентабельность', u.pct(rep.cur.profitability), 'В прошлом месяце ' + u.pct(rep.prev.profitability)) +
      '</div>';

    function tableOf(id, title, rowsArr, isMoney) {
      return u.card(title, u.table(id, [
        { title: 'Показатель', fn: function (r) { return u.esc(r.name); } },
        { title: rep.title, cls: 'num', fn: function (r) { return isMoney === false ? u.nf(r.cur, 0) : u.priv(r.cur); } },
        { title: 'Доля', cls: 'num', fn: function (r) { return r.share == null ? '—' : u.pct(r.share); } },
        { title: rep.prevTitle, cls: 'num', fn: function (r) { return isMoney === false ? u.nf(r.prev, 0) : u.priv(r.prev); } },
        { title: 'Разница', cls: 'num', fn: function (r) {
          return '<span class="' + u.cls(r.delta) + ' private">' + (r.delta > 0 ? '+' : '') +
            (isMoney === false ? u.nf(r.delta, 0) : E.fmtMoney(r.delta)) + '</span>'; } },
        { title: '%', cls: 'num', fn: function (r) {
          return r.deltaPct == null ? '—' : '<span class="' + u.cls(r.deltaPct) + '">' + (r.deltaPct > 0 ? '+' : '') + u.pct(r.deltaPct) + '</span>'; } }
      ], rowsArr, { step: 30 }));
    }

    h += tableOf('repFin', '1. Финансовая сводка', rep.finance);
    h += tableOf('repMeth', '2. Выручка по способам оплаты', rep.methods);
    h += tableOf('repCat', '3. Расходы по категориям', rep.categories);
    h += tableOf('repStat', '4. Операционная статистика', rep.stats, false);
    return h;
  }
  function delta(line) {
    if (!line || line.deltaPct == null) return 'нет данных за прошлый месяц';
    return (line.delta >= 0 ? '▲ ' : '▼ ') + E.fmtMoney(Math.abs(line.delta)) + ' (' + U().pct(Math.abs(line.deltaPct)) + ')';
  }

  /* --- 6. Ежедневный отчёт ----------------------------------------------------- */
  function viewFinDay() {
    var u = U(), all = ddsAll();
    if (!all.length) {
      return u.pageHead('День', 'Что происходило за день') +
        '<div class="card"><div class="empty">Нет записей.</div></div>';
    }
    var days = uniq(all.map(function (r) { return r.date; })).sort().reverse();
    var date = S.settings.dayReportDate && days.indexOf(S.settings.dayReportDate) >= 0 ? S.settings.dayReportDate : days[0];
    var d = F.dayReport(all, date, opening());

    var h = u.pageHead('Отчёт за день', u.dateRu(date) + ' · ' + new Date(date).toLocaleDateString('ru-RU', { weekday: 'long' }),
      '<select id="dayDate" style="background:var(--fill);border:none;border-radius:9px;padding:9px 12px;font-size:14px">' +
      days.slice(0, 400).map(function (m) { return '<option value="' + m + '"' + (m === date ? ' selected' : '') + '>' + u.dateRu(m) + ' ' + m.slice(0, 4) + '</option>'; }).join('') +
      '</select>');

    h += '<div class="stat-grid">' +
      u.stat('Выручка за день', u.priv(d.totals.income), d.totals.tx + ' операций') +
      u.stat('Расходы за день', u.priv(d.totals.expense), 'Закуп ' + E.fmtMoney(d.totals.purchase)) +
      u.stat('Денежный поток', u.priv(d.flow), 'Приход минус расход', d.flow >= 0 ? 'c-green' : 'c-red') +
      u.stat('Взято в долг', u.priv(d.totals.debtTaken), 'Товар без оплаты') +
      '</div>';

    h += u.card('Остатки денег на конец дня', u.listOf(
      d.balances.list.map(function (b) {
        return u.listRow({ icon: b.name === 'Наличные' ? '💵' : (b.name === 'Карта' ? '💳' : '🏦'),
          title: b.name, value: '<span class="' + (b.sum >= 0 ? '' : 'c-red') + ' private">' + E.fmtMoney(b.sum) + '</span>' });
      }).concat([
        u.listRow({ icon: '💰', title: 'Всего денег', value: '<b class="private">' + E.fmtMoney(d.balances.total) + '</b>' }),
        u.listRow({ icon: '💼', title: 'Общий долг поставщикам', sub: 'Накоплено на эту дату',
          value: '<span class="c-orange private">' + E.fmtMoney(d.debtNow) + '</span>' })
      ]), ''));

    h += '<div class="grid-2">' +
      u.card('Приход по сменам', u.listOf(d.byShift.map(function (s) {
        return u.listRow({ icon: '🕒', title: s.name, sub: u.pct(s.share), value: u.priv(s.sum) });
      }), 'Смен не было')) +
      u.card('Приход по способу оплаты', u.listOf(d.byMethod.map(function (m) {
        return u.listRow({ icon: m.name === 'Наличные' ? '💵' : (m.name === 'Карта' ? '💳' : '🏦'),
          title: m.name, sub: u.pct(m.share), value: u.priv(m.sum) });
      }), '')) + '</div>';

    if (d.byCategory.length) {
      h += u.card('Расходы за день', u.listOf(d.byCategory.map(function (c) {
        return u.listRow({ icon: '🧾', title: c.name, sub: c.count + ' записей', value: u.priv(c.sum) });
      }), ''));
    }

    h += u.card('Все операции дня', u.table('dayT', [
      { title: 'Смена', fn: function (r) { return u.esc(r.shift || '—'); } },
      { title: 'Кассир', fn: function (r) { return u.esc(r.cashier || '—'); } },
      { title: 'Тип', fn: function (r) { return u.badge(r.type, F.isIncome(r) ? 'green' : (F.isDebt(r) ? 'orange' : 'red')); } },
      { title: 'Категория', fn: function (r) { return u.esc(r.category); } },
      { title: 'Оплата', fn: function (r) { return u.esc(r.method); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.amount); } },
      { title: 'Комментарий', fn: function (r) { return u.esc(r.note || ''); } }
    ], d.rows, { step: 40 }));
    return h;
  }

  /* --- Регистрация экранов ------------------------------------------------------ */
  window.WM_EXTRA_VIEWS = [
    { id: 'finpulse', icon: '📊', name: 'Пульт', group: 'Деньги', render: viewPulse, after: 'today' },
    { id: 'finbase', icon: '🧮', name: 'База операций', group: 'Деньги', render: viewFinBase },
    { id: 'finpay', icon: '📅', name: 'Выплаты', group: 'Деньги', render: viewFinPay },
    { id: 'findash', icon: '📈', name: 'Дашборд', group: 'Отчёты', render: viewFinDash, onDraw: drawFinCharts },
    { id: 'finreport', icon: '📄', name: 'Отчёт за месяц', group: 'Отчёты', render: viewFinReport },
    { id: 'finday', icon: '🗓', name: 'Отчёт за день', group: 'Отчёты', render: viewFinDay }
  ];

  // Обработчики, специфичные для этих экранов
  window.WM_EXTRA_ACTIONS = {
    'fin-pay': function (el) {
      var p = window.WM_MARK_PAID(el.dataset.id);
      return p ? 'Оплачено: ' + p.supplier + ' — ' + E.fmtMoney(p.amount) + '. Запись добавлена в расходы.' : null;
    },
    'fin-filter-clear': function () { filt = { type: '', category: '', method: '', cashier: '', q: '' }; return null; }
  };
  window.WM_EXTRA_CHANGE = function (el) {
    if (el.classList && el.classList.contains('fin-filter')) { filt[el.dataset.filter] = el.value; return true; }
    if (el.id === 'repMonth') { S.setSetting('reportMonth', el.value); return true; }
    if (el.id === 'dayDate') { S.setSetting('dayReportDate', el.value); return true; }
    return false;
  };

  // Перенос данных из вашей книги Auron Finance
  window.WM_IMPORT_FINANCE = function (wb, sheetOf) {
    var res = { dds: 0, plans: 0, settings: false };
    var base = sheetOf(wb, 'БАЗА_ДДС');
    if (base) { var r = F.parseDdsBase(base); S.addMany('dds', r.rows, true); res.dds = r.rows.length; }
    var pl = sheetOf(wb, 'Запись_Выплат');
    if (pl) { var p = F.parsePayPlan(pl); S.addMany('plans', p.rows, true); res.plans = p.rows.length; }
    var st = sheetOf(wb, 'Настройки');
    if (st) {
      var s = F.parseFinSettings(st);
      if (s.store) S.setSetting('storeName', s.store);
      S.setSetting('openCashStart', s.opening.cash);
      S.setSetting('openCardStart', s.opening.card);
      S.setSetting('openTransferStart', s.opening.transfer);
      S.setSetting('debtWarn', s.thresholds.debtWarn);
      S.setSetting('debtCrit', s.thresholds.debtCrit);
      S.setSetting('diffCrit', s.thresholds.diffCrit);
      S.setSetting('dueWarn', s.thresholds.dueWarn);
      if (s.dict.categories.length) S.setSetting('finCategories', s.dict.categories.join(', '));
      if (s.dict.cashiers.length) S.setSetting('finCashiers', s.dict.cashiers.join(', '));
      if (s.dict.shifts.length) S.setSetting('finShifts', s.dict.shifts.join(', '));
      if (s.dict.suppliers.length) S.setSetting('finSuppliers', s.dict.suppliers.join(', '));
      res.settings = true;
    }
    return res;
  };
})();
