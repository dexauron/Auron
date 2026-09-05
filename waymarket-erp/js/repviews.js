/* ============================================================================
   Отчёты и управленческие расчёты.

   Считаются по ручному учёту (контур 1): смены, итоги дня, расходы, табель.
   Из выгрузок 1С (контур 2) берётся ровно две вещи, и обе — только если файл
   загружен: себестоимость списаний и товарная детализация в «Кто зарабатывает».
   Если 1С нет — отчёты работают, просто без этих строк.

   Главное правило прибыли:
     [Выручка − Закуп] − [ФОТ + Аренда + Коммунальные + Налоги + Комиссия банка
      + Обед + ГСМ + Расходники + Списания + Прочее] = чистая прибыль.
   Выплаты из ящика затратой НЕ считаются: это способ оплаты, а не трата.
   ========================================================================== */
(function () {
  'use strict';
  var E = window.WM, S = window.WMStore, F = window.WMFin, R = window.WMReports,
    FC = window.WMForecast, ST = window.WMStaff;

  function U() { return window.WMUI; }
  function Q() { return window.WMQuick; }
  function D() { return U().data(); }
  function C() { return U().calc(); }
  function esc(s) { return U().esc(s); }
  function dateRu(d) { return U().dateRu(d); }
  function num(v) { return E.num(v); }
  function money(v) { return E.fmtMoney(v); }
  function today() { return E.today(); }
  function dds() { return S.state.dds || []; }

  /* --- Какой месяц смотрим ---------------------------------------------------- */
  function ym() { return E.txt(S.settings.reportMonth) || String(today()).slice(0, 7); }
  function inYm(r, m) { return String(r.date || '').slice(0, 7) === (m || ym()); }
  function monthRu(m) { return E.monthTitle ? E.monthTitle(m) : m; }
  function monthList() {
    var seen = {}, out = [];
    dds().forEach(function (r) { var k = String(r.date || '').slice(0, 7); if (k.length === 7) seen[k] = 1; });
    seen[String(today()).slice(0, 7)] = 1;
    for (var k in seen) out.push(k);
    return out.sort().reverse();
  }
  function monthPicker() {
    var cur = ym();
    return '<div class="quick"><label class="inline-label">Месяц:&nbsp;<select id="repMonth">' +
      monthList().map(function (m) {
        return '<option value="' + esc(m) + '"' + (m === cur ? ' selected' : '') + '>' +
          esc(monthRu(m)) + '</option>';
      }).join('') + '</select></label></div>';
  }

  function rowsOf(m) { return dds().filter(function (r) { return inYm(r, m || ym()); }); }

  /* Списания из 1С за месяц — по себестоимости. Нет файла — ноль, и в затратах
     останется то, что владелец записал руками. */
  function writeoff1c(m) {
    var d = D(), sum = 0;
    (d.writeoffs || []).forEach(function (r) {
      if (r.date && String(r.date).slice(0, 7) !== (m || ym())) return;
      sum += num(r.cost);
    });
    return E.safeRound(sum);
  }

  // ФОТ за месяц по табелю (оклад + часы + премии − удержания)
  function payrollOf(m) {
    var list = E.payrollSummary(
      (S.state.timesheet || []).filter(function (r) { return inYm(r, m); }),
      (S.state.payouts || []).filter(function (r) { return inYm(r, m); }),
      S.state.staff || [], S.settings);
    return E.payrollTotals(list).accrued;
  }

  // Сколько зарплаты фактически выдали за месяц — запасной источник ФОТ,
  // если табель не ведут
  function salaryPaidOf(m) {
    var sum = 0;
    (S.state.payouts || []).forEach(function (r) { if (inYm(r, m)) sum += num(r.amount); });
    return E.safeRound(sum);
  }

  function pnlOf(m) {
    m = m || ym();
    var rows = rowsOf(m);
    var t = E.totals(rows);
    var tax = F.taxAmount(S.settings, t.revenue, t.expense);
    return E.pnl({ rows: rows, payroll: payrollOf(m), writeoff1c: writeoff1c(m),
      salaryPaid: salaryPaidOf(m), taxAmount: tax.sum });
  }

  /* ==========================================================================
     ДАШБОРД
     ========================================================================== */
  function viewDash() {
    var u = U(), m = ym(), rows = rowsOf(m);
    var p = pnlOf(m);
    var t = E.totals(rows);
    var cash = E.cashOnHand(dds(), S.settings);
    var debt = E.supplierDebt(dds(), S.settings);
    var pace = R.monthPace(F.flatten(dds()), m, today());

    var h = u.pageHead('Дашборд', 'Как идут дела в ' + monthRu(m),
      '<button class="btn" data-act="print">🖨 Напечатать</button>');
    h += monthPicker();

    h += u.hero('Чистая прибыль за месяц', u.priv(p.net),
      'выручка ' + money(p.revenue) + ' · закуп ' + money(p.purchase) +
      ' · затраты ' + money(p.costTotal),
      p.net >= 0 ? 'c-green' : 'c-red');

    h += '<div class="stat-grid">' +
      u.stat('Наличные в ящиках', u.priv(cash), 'на сегодня') +
      u.stat('Безнал за месяц', u.priv(E.cashlessTotal(rows)), 'карта, СБП — ушли на счёт') +
      u.stat('Долг поставщикам', u.priv(debt.debt),
        debt.debt > num(S.settings.debtCrit) ? 'выше критичного порога' : 'общей суммой по магазину',
        debt.debt > num(S.settings.debtCrit) ? 'c-red'
          : debt.debt > num(S.settings.debtWarn) ? 'c-orange' : '') +
      u.stat('Валовая прибыль', u.priv(p.gross), 'наценка ' + u.pct(p.grossPct)) +
      u.stat('Смен закрыто', u.nf(t.shifts),
        t.badShifts ? t.badShifts + ' с расхождением' : 'все сошлись',
        t.badShifts ? 'c-orange' : 'c-green') +
      u.stat('В среднем за день', u.priv(t.avgDay), u.nf(t.dayCount) + ' дней с выручкой') +
      '</div>';

    if (pace && pace.forecast) {
      h += '<div class="banner blue"><span>📈</span><span>Такими темпами месяц закроется на ' +
        '<b>' + esc(money(pace.forecast)) + '</b> выручки: за ' + u.nf(pace.daysDone) +
        ' дн. сделано ' + esc(money(pace.done)) + '.</span></div>';
    }

    // Что мешает заработать
    var eaters = R.profitEaters({ dds: F.flatten(dds()), ym: m, writeoffSum: writeoff1c(m) });
    if (eaters && eaters.rows && eaters.rows.length) {
      h += u.card('Куда уходит прибыль', u.listOf(eaters.rows.slice(0, 6).map(function (x) {
        return u.listRow({ icon: '💸', title: esc(x.name), sub: esc(x.why),
          value: u.priv(x.sum), tap: !!x.go,
          attrs: x.go ? ' data-go="' + esc(x.go) + '"' : '' });
      }), 'Всё в порядке'), 'от валовой прибыли ' + money(eaters.gross));
    }

    h += u.card('Куда пойти', u.listOf([
      u.listRow({ icon: '🧮', title: 'Свести кассу за смену', tap: true, attrs: ' data-go="morning"' }),
      u.listRow({ icon: '🌙', title: 'Записать итоги дня', tap: true, attrs: ' data-go="evening"' }),
      u.listRow({ icon: '💰', title: 'Ведомость зарплаты', tap: true, attrs: ' data-go="payroll"' }),
      u.listRow({ icon: '📈', title: 'Прибыль подробно (P&L)', tap: true, attrs: ' data-go="pnl"' })
    ], ''));
    return h;
  }

  /* ==========================================================================
     ПРИБЫЛЬ (P&L)
     ========================================================================== */
  function viewPnl() {
    var u = U(), m = ym(), p = pnlOf(m);
    var h = u.pageHead('Прибыль (P&L)', 'Из чего сложилась прибыль за ' + monthRu(m),
      '<button class="btn" data-act="export-screen">⤓ В Excel</button> ' +
      '<button class="btn" data-act="print">🖨</button>');
    h += monthPicker();

    h += '<div class="stat-grid">' +
      u.stat('Выручка', u.priv(p.revenue), 'наличные + безнал') +
      u.stat('Закуп товара', u.priv(p.purchase),
        'за наличные ' + money(p.goodsCash) + ' + в долг ' + money(p.debtTaken)) +
      u.stat('Валовая прибыль', u.priv(p.gross), 'наценка ' + u.pct(p.grossPct),
        p.gross >= 0 ? 'c-green' : 'c-red') +
      u.stat('Чистая прибыль', u.priv(p.net), u.pct(p.netPct) + ' от выручки',
        p.net >= 0 ? 'c-green' : 'c-red') +
      '</div>';

    h += u.card('Расчёт по шагам', u.listOf([
      u.listRow({ icon: '＋', title: 'Выручка', sub: 'Z-отчёты за месяц', value: u.priv(p.revenue) }),
      u.listRow({ icon: '−', title: 'Закуп товара', sub: 'куплено за наличные и взято в долг',
        value: u.priv(p.purchase) }),
      u.listRow({ icon: '=', title: '<b>Валовая прибыль</b>', sub: 'сколько заработали на наценке',
        value: '<b>' + u.priv(p.gross) + '</b>' }),
      u.listRow({ icon: '−', title: 'Затраты магазина', sub: 'все статьи ниже',
        value: u.priv(p.costTotal) }),
      u.listRow({ icon: '=', title: '<b>Чистая прибыль</b>', sub: 'что осталось владельцу',
        value: '<b class="' + (p.net >= 0 ? 'c-green' : 'c-red') + '">' + u.priv(p.net) + '</b>' })
    ], ''), 'Погашение долгов поставщикам сюда не входит: это возврат денег, а не трата');

    h += u.card('Затраты по статьям', u.table('pnlT', [
      { title: 'Статья', fn: function (r) { return esc(r.name); } },
      { title: 'Откуда', fn: function (r) {
        var color = r.source === 'табель' ? 'blue' : r.source === '1С' ? 'green'
          : r.source === 'расчёт' ? 'gray' : 'gray';
        return u.badge(r.source, color); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.sum); } },
      { title: 'Доля выручки', cls: 'num', fn: function (r) { return u.pct(r.share); } }
    ], p.costs, { step: 20,
      total: [{ span: 2, html: 'Все затраты' },
        { cls: 'num', html: '<b>' + u.priv(p.costTotal) + '</b>' },
        { cls: 'num', html: u.pct(p.revenue ? E.safeRound(E.div(p.costTotal, p.revenue) * 100) : 0) }] }),
      'ФОТ берётся из табеля, если он ведётся; списания — из 1С, если файл загружен');

    /* Записи, которые тратой не являются. Молча выкидывать их нельзя:
       владелец должен видеть, что они есть и почему не в затратах. */
    if (p.excluded && p.excluded.length) {
      h += u.card('Не вошло в затраты — и правильно', u.table('pnlX', [
        { title: 'Что это', fn: function (r) { return esc(r.name); } },
        { title: 'Почему не затрата', fn: function (r) { return esc(r.why); } },
        { title: 'Записей', cls: 'num', fn: function (r) { return u.nf(r.count); } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.sum); } }
      ], p.excluded, { step: 10 }),
        'на ' + money(p.excludedTotal) + ' прибыль занижена НЕ была');
      h += '<div class="banner orange"><span>✏️</span><span>Эти записи лучше переделать: ' +
        'закуп — в «Итоги дня», погашение долга — туда же, инкассацию — кнопкой ' +
        '«Инкассация». Пока они лежат расходами, их видно в базе, но в прибыль ' +
        'они не идут.</span></div>';
    }

    h += '<div class="banner blue"><span>💵</span><span>Мимо прибыли за месяц прошли: ' +
      'выплаты из ящика <b>' + esc(money(p.payouts)) + '</b> (способ оплаты, а не трата), ' +
      'погашение долгов поставщикам <b>' + esc(money(p.debtPaid)) + '</b> (возврат чужих денег), ' +
      'инкассация <b>' + esc(money(p.moved)) + '</b> (деньги переложили, а не потратили) ' +
      'и забор владельца <b>' + esc(money(p.draw)) + '</b> (это уже из прибыли, а не до неё).' +
      '</span></div>';
    return h;
  }

  /* ==========================================================================
     ЗАКРЫТИЕ МЕСЯЦА
     Один экран, который отвечает на вопрос «можно ли верить цифрам за месяц».
     ========================================================================== */
  function viewMonthClose() {
    var u = U(), m = ym();
    var pay = E.payrollTotals(E.payrollSummary(
      (S.state.timesheet || []).filter(function (r) { return inYm(r, m); }),
      (S.state.payouts || []).filter(function (r) { return inYm(r, m); }),
      S.state.staff || [], S.settings, { dds: rowsOf(m) }));
    var mc = E.monthClose({ rows: dds(), ym: m, settings: S.settings,
      payrollRow: pay, cashcount: S.state.cashcount || [], pnl: pnlOf(m),
      salaryPaid: S.state.payouts || [],
      debtChecked: (S.settings.debtChecked || {})[m] });
    var p = mc.pnl;

    var h = u.pageHead('Закрытие месяца', monthRu(m) + ' — что должно сойтись',
      '<button class="btn" data-act="print">🖨 Напечатать</button> ' +
      '<button class="btn" data-act="export-screen">⤓ В Excel</button>');
    h += monthPicker();

    h += u.hero(mc.ready ? 'Месяц можно закрывать' : 'Месяц закрывать рано',
      u.nf(mc.done) + ' из ' + u.nf(mc.total),
      mc.ready ? 'важное сошлось' + (mc.softLeft ? ', ещё ' + mc.softLeft + ' на ваше усмотрение' : '')
        : 'осталось важного: ' + mc.hardLeft,
      mc.ready ? 'c-green' : 'c-orange');

    h += u.card('Что проверяем', u.listOf(mc.items.map(function (i) {
      return u.listRow({ icon: i.ok ? '✅' : (i.hard ? '⛔️' : '⚠️'),
        title: esc(i.name), sub: esc(i.said),
        value: i.go && !i.ok ? '<button class="btn btn-sm" data-go="' + esc(i.go) +
          '">Открыть</button>' : '',
        tap: false });
    }), ''), '⛔️ — без этого месяц считать нельзя, ⚠️ — стоит посмотреть');

    // Деньги на конец месяца: три места, где они лежат
    h += u.card('Где деньги на конец месяца', u.listOf([
      u.listRow({ icon: '💵', title: 'В ящиках', value: u.priv(mc.cash) }),
      u.listRow({ icon: '🔐', title: 'В сейфе', sub: 'увезено инкассацией',
        value: u.priv(mc.safe) }),
      u.listRow({ icon: '🤝', title: 'Должны поставщикам', sub: 'общей суммой по магазину',
        value: u.priv(mc.debt) })
    ], ''), 'Инкассация деньги не тратит — она их перекладывает');

    h += u.card('Прибыль за месяц', u.listOf([
      u.listRow({ icon: '＋', title: 'Выручка', value: u.priv(p.revenue) }),
      u.listRow({ icon: '−', title: 'Закуп товара', sub: 'наличными и в долг',
        value: u.priv(p.purchase) }),
      u.listRow({ icon: '=', title: '<b>Валовая прибыль</b>',
        value: '<b>' + u.priv(p.gross) + '</b>' }),
      u.listRow({ icon: '−', title: 'Затраты магазина', sub: 'ФОТ, аренда и остальное',
        value: u.priv(p.costTotal) }),
      u.listRow({ icon: '=', title: '<b>Чистая прибыль</b>',
        value: '<b class="' + (p.net >= 0 ? 'c-green' : 'c-red') + '">' + u.priv(p.net) + '</b>' })
    ], ''), '<button class="btn btn-sm" data-go="pnl">Подробно</button>');

    // Сверка выплат из ящика по дням — самое частое место, где теряются расходы
    var chk = mc.payouts;
    if (chk.rows.length) {
      h += u.card('Выплаты из ящика по дням', u.table('mcP', [
        { title: 'День', fn: function (r) { return esc(dateRu(r.date)); } },
        { title: 'Выдали из ящика', cls: 'num', fn: function (r) { return u.priv(r.payouts); } },
        { title: 'Расписано', cls: 'num', fn: function (r) {
          var parts = Object.keys(r.parts || {}).map(function (k) {
            return k + ' ' + money(r.parts[k]); }).join(', ');
          return u.priv(r.explained) +
            (parts ? '<br><small class="c-muted">' + esc(parts) + '</small>' : ''); } },
        { title: 'Не объяснено', cls: 'num', fn: function (r) {
          return r.left > 0.5 ? '<b class="c-orange">' + u.priv(r.left) + '</b>'
            : r.left < -0.5 ? '<b class="c-red">' + u.priv(r.left) + '</b>' : '—'; } }
      ], chk.rows.filter(function (r) { return Math.abs(r.left) > 0.5; }), { step: 31,
        empty: 'Все выплаты расписаны' }),
        'всего выдали ' + money(chk.payouts) + ', расписано ' + money(chk.explained) +
        ' — сюда входят товар за наличные, долги поставщикам, зарплата, расходы и инкассация');
    }

    h += u.card('Сверка долга с поставщиками', '<div class="card-pad">' +
      'Программа считает долг ' + money(mc.debt) + '. Позвоните поставщикам, ' +
      'узнайте их цифру и впишите — если сойдётся, месяц можно закрывать спокойно.' +
      '<br><br><button class="btn btn-primary" data-form="debtCheck">🤝 Вписать долг по сверке</button>' +
      '</div>');
    return h;
  }

  /* ==========================================================================
     КУДА УШЛИ ДЕНЬГИ
     ========================================================================== */
  function viewMoneyFlow() {
    var u = U(), m = ym();
    var flow = R.moneyFlow(F.flatten(dds()), m);
    var h = u.pageHead('Куда ушли деньги', 'Выручка по шагам за ' + monthRu(m),
      '<button class="btn" data-act="export-screen">⤓ В Excel</button>');
    h += monthPicker();

    if (!flow.steps.length) {
      return h + '<div class="card"><div class="empty">За ' + esc(monthRu(m)) +
        ' записей нет.</div></div>';
    }
    h += u.card('Дорожка денег', u.table('flowT', [
      { title: 'Шаг', fn: function (r) {
        return (r.kind === 'start' ? '<b>' : '') + esc(r.name) + (r.kind === 'start' ? '</b>' : ''); } },
      { title: 'Сумма', cls: 'num', fn: function (r) {
        return (r.kind === 'out' ? '−' : '') + u.priv(r.sum); } },
      { title: 'Доля', cls: 'num', fn: function (r) { return r.share ? u.pct(r.share) : '—'; } },
      { title: 'Осталось', cls: 'num', fn: function (r) {
        return '<span class="' + (r.left >= 0 ? '' : 'c-red') + '">' + u.priv(r.left) + '</span>'; } }
    ], flow.steps, { step: 30 }),
      'Каждая строка отнимает от выручки — внизу то, что осталось');
    if (flow.left !== undefined) {
      h += u.hero('Осталось после всех расходов', u.priv(flow.left), monthRu(m),
        flow.left >= 0 ? 'c-green' : 'c-red');
    }
    return h;
  }

  /* ==========================================================================
     СРЕДНИЙ ЧЕК
     ========================================================================== */
  function viewAvgCheck() {
    var u = U(), m = ym();
    var ac = R.avgCheck(F.flatten(rowsOf(m)));
    var h = u.pageHead('Средний чек', 'Сколько оставляет один покупатель, ' + monthRu(m));
    h += monthPicker();

    if (!ac.checks) {
      return h + '<div class="card"><div class="empty"><b>Нет числа чеков</b><br>' +
        'Средний чек считается из Z-отчёта: впишите «Чеков за смену» при сверке кассы — ' +
        'это одно поле, на деньги оно не влияет.</div>' +
        '<div class="card-pad"><button class="btn btn-primary" data-form="shiftClose">🧮 Свести кассу</button></div></div>';
    }
    h += '<div class="stat-grid">' +
      u.stat('Средний чек', u.priv(ac.avg), 'выручка ÷ число чеков') +
      u.stat('Чеков за месяц', u.nf(ac.checks), u.nf(ac.checksPerDay) + ' в день') +
      u.stat('Выручка', u.priv(ac.revenue), u.nf(ac.withChecks) + ' дней с чеками') +
      (ac.trend !== null && ac.trend !== undefined
        ? u.stat('Изменение', (ac.trend > 0 ? '+' : '') + u.pct(ac.trend), 'к началу месяца',
          ac.trend >= 0 ? 'c-green' : 'c-orange') : '') +
      '</div>';

    h += u.card('По дням', u.table('acT', [
      { title: 'День', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Чеков', cls: 'num', fn: function (r) { return u.nf(r.checks); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
      { title: 'Средний чек', cls: 'num', fn: function (r) { return u.priv(r.avg); } }
    ], ac.days.slice().reverse(), { step: 31, empty: 'Дней с чеками нет' }));
    return h;
  }

  /* ==========================================================================
     КТО ЗАРАБАТЫВАЕТ
     ========================================================================== */
  function viewEarners() {
    var u = U(), m = ym(), c = C(), d = D();
    var h = u.pageHead('Кто зарабатывает', 'Кассиры, смены и товарные группы');
    h += monthPicker();

    // 1. Кассиры — из ручного учёта, работает всегда
    var rating = E.cashierRating(rowsOf(m));
    h += u.card('Кассиры', u.table('erC', [
      { title: 'Кассир', fn: function (r) { return esc(r.cashier); } },
      { title: 'Смен', cls: 'num', fn: function (r) { return u.nf(r.shifts); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
      { title: 'В среднем за смену', cls: 'num', fn: function (r) { return u.priv(r.avgShift); } },
      { title: 'Расхождения', cls: 'num', fn: function (r) {
        return r.diffSum ? '<span class="' + u.cls(r.diffSum) + '">' + u.priv(r.diffSum) + '</span>' : '—'; } },
      { title: 'Смен без расхождений', cls: 'num', fn: function (r) { return u.pct(r.okPct); } }
    ], rating, { step: 20, empty: 'За месяц смен нет' }),
      'Считается из сверки кассы — 1С для этого не нужна');

    // 2. Смены (день/ночь)
    var byShift = F.byShift(rowsOf(m));
    h += u.card('День и ночь', u.table('erS', [
      { title: 'Смена', fn: function (r) { return esc(r.name); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.sum); } },
      { title: 'Доля', cls: 'num', fn: function (r) { return u.pct(r.share); } }
    ], byShift, { step: 10, empty: 'Смен нет' }));

    // 3. Группы товаров — только если есть выгрузка 1С
    if (c.byGroup && c.byGroup.length) {
      var gp = R.groupProfit(c.byGroup);
      h += u.card('Группы товаров (из 1С)', u.table('erG', [
        { title: 'Группа', fn: function (r) { return esc(r.name); } },
        { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
        { title: 'Валовая прибыль', cls: 'num', fn: function (r) { return u.priv(r.gross); } },
        { title: 'Доля выручки', cls: 'num', fn: function (r) { return u.pct(r.revShare); } },
        { title: 'Доля прибыли', cls: 'num', fn: function (r) { return u.pct(r.profitShare); } },
        { title: '', fn: function (r) {
          return r.gap < -5 ? u.badge('много продаём, мало зарабатываем', 'orange')
            : r.gap > 5 ? u.badge('кормилец', 'green') : ''; } }
      ], gp.rows.slice(0, 30), { step: 30 }),
        'наценка по магазину ' + u.pct(gp.margin));
    } else {
      h += '<div class="banner blue"><span>📦</span><span>Чтобы увидеть, какие группы товаров ' +
        'приносят прибыль, загрузите отчёт «Продажи» из 1С на экране «Данные и копии». ' +
        'На кассу и зарплату это не влияет.</span></div>';
    }
    return h;
  }

  /* ==========================================================================
     ОТЧЁТ СОБСТВЕННИКУ
     ========================================================================== */
  function viewOwner() {
    var u = U(), m = ym(), p = pnlOf(m), t = E.totals(rowsOf(m));
    var cash = E.cashOnHand(dds(), S.settings);
    var debt = E.supplierDebt(dds(), S.settings);
    var deb = E.debtorTotals(S.state.debtors || [], today());
    var pay = E.payrollTotals(E.payrollSummary(
      (S.state.timesheet || []).filter(function (r) { return inYm(r, m); }),
      (S.state.payouts || []).filter(function (r) { return inYm(r, m); }),
      S.state.staff || [], S.settings));

    var h = u.pageHead('Отчёт собственнику', 'Одна страница за ' + monthRu(m),
      '<button class="btn" data-act="print">🖨 Напечатать</button> ' +
      '<button class="btn" data-act="share-screen">↗ Отправить</button>');
    h += monthPicker();

    h += u.hero('Заработали за месяц', u.priv(p.net),
      p.net >= 0 ? 'после всех расходов' : 'магазин сработал в минус',
      p.net >= 0 ? 'c-green' : 'c-red');

    h += u.card('Деньги', u.listOf([
      u.listRow({ icon: '💵', title: 'Наличные в ящиках', sub: 'на сегодня', value: u.priv(cash) }),
      u.listRow({ icon: '💳', title: 'Безнал за месяц', sub: 'ушёл на счёт',
        value: u.priv(E.cashlessTotal(rowsOf(m))) }),
      u.listRow({ icon: '🤝', title: 'Долг поставщикам', sub: 'общей суммой по магазину',
        value: u.priv(debt.debt), tap: true, attrs: ' data-go="suppliers"' }),
      u.listRow({ icon: '📓', title: 'Должны покупатели', sub: 'тетрадка у кассы',
        value: u.priv(deb.open), tap: true, attrs: ' data-go="debtors"' }),
      u.listRow({ icon: '👛', title: 'Владелец взял себе', sub: 'заборы за месяц',
        value: u.priv(p.draw) })
    ], ''));

    h += u.card('Работа магазина', u.listOf([
      u.listRow({ icon: '🧾', title: 'Выручка', sub: u.nf(t.shifts) + ' смен', value: u.priv(p.revenue) }),
      u.listRow({ icon: '📦', title: 'Закуп товара', sub: 'наличными и в долг', value: u.priv(p.purchase) }),
      u.listRow({ icon: '📈', title: 'Валовая прибыль', sub: 'наценка ' + u.pct(p.grossPct),
        value: u.priv(p.gross) }),
      u.listRow({ icon: '👥', title: 'Зарплата начислена', sub: pay.people + ' чел., ' +
        u.nf(pay.shifts) + ' смен', value: u.priv(pay.accrued), tap: true, attrs: ' data-go="payroll"' }),
      u.listRow({ icon: '🧮', title: 'Затраты всего', sub: 'все статьи', value: u.priv(p.costTotal) }),
      u.listRow({ icon: '⚖️', title: 'Расхождения по кассе',
        sub: t.badShifts + ' из ' + t.shifts + ' смен',
        value: '<span class="' + u.cls(t.diff) + '">' + u.priv(t.diff) + '</span>' })
    ], ''));

    var probs = R.topProblems({ dds: F.flatten(dds()), ym: m });
    if (probs && probs.length) {
      h += u.card('На что посмотреть', u.listOf(probs.slice(0, 5).map(function (x) {
        return u.listRow({ icon: '⚠️', title: esc(x.what), sub: esc(x.why), value: u.priv(x.sum) });
      }), ''));
    }
    return h;
  }

  /* ==========================================================================
     БЕЗУБЫТОЧНОСТЬ
     ========================================================================== */
  function viewBep() {
    var u = U(), m = ym(), p = pnlOf(m);
    var fixed = p.costTotal || S.fixedMonthly();
    var margin = p.grossPct || num(S.settings.marginManual) || 25;
    var b = E.bep(fixed, margin, p.revenue);

    var h = u.pageHead('Безубыточность', 'Сколько надо продать, чтобы выйти в ноль');
    h += monthPicker();
    h += u.hero(b.profitable ? 'Порог пройден' : 'До нуля осталось',
      u.priv(b.profitable ? p.revenue - b.month : b.month - p.revenue),
      'порог ' + money(b.month) + ' в месяц при наценке ' + u.pct(b.margin),
      b.profitable ? 'c-green' : 'c-orange');

    h += '<div class="stat-grid">' +
      u.stat('Надо в месяц', u.priv(b.month), 'выручки') +
      u.stat('Надо в неделю', u.priv(b.week), '') +
      u.stat('Надо в день', u.priv(b.day), 'в среднем') +
      u.stat('Сделано', u.pct(b.done), 'от порога', b.done >= 100 ? 'c-green' : 'c-orange') +
      u.stat('Запас прочности', u.pct(b.safety),
        'насколько может упасть выручка', b.safety > 20 ? 'c-green' : 'c-orange') +
      u.stat('Порог берётся', u.nf(b.dayOfMonth) + '-го', 'при нынешнем темпе') +
      '</div>';

    h += u.card('Из чего порог', u.table('bepT', [
      { title: 'Статья', fn: function (r) { return esc(r.name); } },
      { title: 'В месяц', cls: 'num', fn: function (r) { return u.priv(r.sum); } },
      { title: 'Надо продать на', cls: 'num', fn: function (r) {
        return u.priv(margin > 0 ? E.safeRound(r.sum / (margin / 100)) : 0); } }
    ], p.costs.filter(function (r) { return r.sum > 0; }), { step: 20,
      empty: 'Затрат за месяц не записано' }),
      'Наценка ' + u.pct(margin) + ' — из фактической валовой прибыли за месяц');
    return h;
  }

  /* ==========================================================================
     ВЫХОД В НОЛЬ ПО ДНЯМ
     ========================================================================== */
  function viewBepDays() {
    var u = U(), m = ym(), p = pnlOf(m);
    var fixed = p.costTotal || S.fixedMonthly();
    var margin = p.grossPct || num(S.settings.marginManual) || 25;
    var bd = FC.bepDays(F.flatten(dds()), F.isIncome, fixed, margin, m);

    var h = u.pageHead('Выход в ноль по дням', 'Когда магазин отбил расходы в ' + monthRu(m));
    h += monthPicker();
    h += u.hero(bd.passed ? 'Вышли в ноль' : 'В ноль пока не вышли',
      bd.passed ? dateRu(bd.passed.date) : u.priv(bd.need - bd.acc),
      bd.passed ? 'дальше месяц работает на прибыль'
        : 'столько валовой прибыли ещё не хватает',
      bd.passed ? 'c-green' : 'c-orange');

    h += '<div class="stat-grid">' +
      u.stat('Надо отбить за месяц', u.priv(bd.need), 'все затраты') +
      u.stat('Каждый день надо', u.priv(bd.perDay), 'валовой прибыли') +
      u.stat('Накопили', u.priv(bd.acc), 'наценка ' + u.pct(bd.margin)) +
      '</div>';

    h += u.card('По дням', u.table('bdT', [
      { title: 'День', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return r.revenue ? u.priv(r.revenue) : '—'; } },
      { title: 'Валовая', cls: 'num', fn: function (r) { return u.priv(r.gross); } },
      { title: 'Накопили', cls: 'num', fn: function (r) { return u.priv(r.acc); } },
      { title: 'Надо было', cls: 'num', fn: function (r) { return u.priv(r.need); } },
      { title: 'Отставание', cls: 'num', fn: function (r) {
        return '<span class="' + u.cls(r.ahead) + '">' + (r.ahead > 0 ? '+' : '') +
          u.priv(r.ahead) + '</span>'; } }
    ], bd.rows, { step: 31 }), 'Зелёное — идём с опережением, красное — отстаём');
    return h;
  }

  /* ==========================================================================
     НАЛОГОВЫЙ КАЛЕНДАРЬ
     ========================================================================== */
  function viewTaxCal() {
    var u = U();
    var year = +String(today()).slice(0, 4);
    var yearRows = dds().filter(function (r) { return String(r.date || '').slice(0, 4) === String(year); });
    var t = E.totals(yearRows);
    var cal = FC.taxCalendar(S.settings, year, F.taxAmount, t.revenue, t.expense);
    var tax = F.taxAmount(S.settings, t.revenue, t.expense);

    var h = u.pageHead('Налоговый календарь', 'Что и когда платить в ' + year + ' году',
      '<button class="btn" data-act="print">🖨</button>');
    h += '<div class="stat-grid">' +
      u.stat('Система', esc(String(S.settings.taxMode || 'не выбрана')),
        'меняется в настройках') +
      u.stat('Выручка за год', u.priv(t.revenue), 'по кассе') +
      u.stat('Налог прикидочно', u.priv(tax.sum), tax.name) +
      '</div>';
    h += '<div class="banner blue"><span>ℹ️</span><span>Суммы здесь — прикидка по вашей выручке, ' +
      'а не расчёт налоговой. Точные цифры считает бухгалтер: программа только напоминает про даты.</span></div>';

    h += u.card('Даты', u.table('taxT', [
      { title: 'Когда', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Что платить', fn: function (r) { return esc(r.name); } },
      { title: 'Примечание', fn: function (r) { return esc(r.note || ''); } },
      { title: 'Сколько', cls: 'num', fn: function (r) { return r.sum ? u.priv(r.sum) : '—'; } },
      { title: '', fn: function (r) {
        return r.past ? u.badge('прошло', 'gray')
          : r.soon ? u.badge('скоро', 'orange') : u.badge('впереди', 'green'); } }
    ], cal, { step: 20, empty: 'Для вашей системы налогообложения дат не задано' }));
    return h;
  }

  /* ==========================================================================
     ГОТОВЫЙ ОТЧЁТ: всё для бухгалтера одним экраном
     ========================================================================== */
  function viewReady() {
    var u = U(), m = ym(), p = pnlOf(m), t = E.totals(rowsOf(m));
    var pay = E.payrollTotals(E.payrollSummary(
      (S.state.timesheet || []).filter(function (r) { return inYm(r, m); }),
      (S.state.payouts || []).filter(function (r) { return inYm(r, m); }),
      S.state.staff || [], S.settings));
    var debt = E.supplierDebt(dds(), S.settings);

    var h = u.pageHead('Готовый отчёт', 'Что отдать бухгалтеру за ' + monthRu(m),
      '<button class="btn btn-primary" data-act="print">🖨 Напечатать</button> ' +
      '<button class="btn" data-act="export-screen">⤓ В Excel</button> ' +
      '<button class="btn" data-act="share-screen">↗ Отправить</button>');
    h += monthPicker();

    var lines = [
      ['Выручка всего', p.revenue],
      ['  в том числе наличными', E.totals(rowsOf(m)).cashRevenue !== undefined
        ? E.totals(rowsOf(m)).cashRevenue : p.revenue - E.cashlessTotal(rowsOf(m))],
      ['  в том числе безналом', E.cashlessTotal(rowsOf(m))],
      ['Закуп товара', p.purchase],
      ['  оплачено наличными', p.goodsCash],
      ['  взято в долг', p.debtTaken],
      ['Погашено долгов поставщикам', p.debtPaid],
      ['Валовая прибыль', p.gross],
      ['Зарплата начислена (ФОТ)', pay.accrued],
      ['Зарплата выдана', pay.paid],
      ['Затраты магазина всего', p.costTotal],
      ['Чистая прибыль', p.net],
      ['Долг поставщикам на конец', debt.debt],
      ['Расхождения по кассе', t.diff],
      ['Владелец взял себе', p.draw]
    ];
    h += u.card('Сводка за месяц', u.table('rdyT', [
      { title: 'Показатель', fn: function (r) { return esc(r[0]); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r[1]); } }
    ], lines, { step: 30 }));

    h += u.card('Затраты по статьям', u.table('rdyC', [
      { title: 'Статья', fn: function (r) { return esc(r.name); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.sum); } }
    ], p.costs.filter(function (r) { return r.sum > 0; }), { step: 20, empty: 'Затрат нет' }));

    h += '<div class="banner blue"><span>📗</span><span>Полные журналы — в книге ' +
      '«Бухгалтерия.xlsx»: листы Касса_и_Смены, ДДС_Операции, План_Выплат, ' +
      'Табель_Зарплаты и Настройки. Их можно открыть в Excel и отправить как есть.</span></div>';
    return h;
  }

  /* ==========================================================================
     СБРОС И ОТКАТ БАЗЫ
     ========================================================================== */
  var BK = null;      // список копий из папки: заполняется по кнопке

  function viewReset() {
    var u = U();
    var counts = S.COLLECTIONS.map(function (c) {
      return { coll: c, n: (S.state[c] || []).length };
    }).filter(function (x) { return x.n; });
    var total = counts.reduce(function (a, x) { return a + x.n; }, 0);

    var h = u.pageHead('Сброс и откат базы', 'Если что-то пошло не так',
      '<button class="btn" data-go="data">🗂 Данные и копии</button>');

    h += '<div class="banner orange"><span>🛟</span><span>Перед любым сбросом программа сама ' +
      'сохраняет копию базы. Ничего не пропадёт безвозвратно: копии лежат в рабочей папке ' +
      'и скачиваются файлом .json.</span></div>';

    h += '<div class="stat-grid">' +
      u.stat('Записей в базе', u.nf(total), counts.length + ' журналов') +
      u.stat('В корзине', u.nf((S.state.trash || []).length), 'удалённое можно вернуть') +
      u.stat('Хранить копий', u.nf(S.settings.keepBackups), 'настраивается') +
      '</div>';

    h += u.card('Сделать копию сейчас', u.listOf([
      u.listRow({ icon: '💾', title: 'Скачать копию базы', sub: 'файл .json — положите на флешку',
        value: '<button class="btn btn-sm" data-act="reset-backup">Скачать</button>' }),
      u.listRow({ icon: '📗', title: 'Записать книгу заново', sub: 'пересобрать Бухгалтерию.xlsx из базы',
        value: '<button class="btn btn-sm" data-act="book-save">Записать</button>' })
    ], ''));

    h += u.card('Откатиться на копию', (BK
      ? u.table('bkT', [
        { title: 'Копия', fn: function (r) { return esc(r.name); } },
        { title: 'Когда', fn: function (r) { return esc(r.when || ''); } },
        { title: 'Записей', cls: 'num', fn: function (r) { return r.records ? u.nf(r.records) : '—'; } },
        { title: '', cls: 'center', fn: function (r) {
          return '<button class="btn btn-sm" data-act="reset-rollback" data-name="' +
            esc(r.name) + '">Откатиться</button>'; } }
      ], BK, { step: 20, empty: 'Копий в папке нет' })
      : '<div class="card-pad"><button class="btn" data-act="reset-copies">' +
        '📂 Показать копии из папки</button></div>') +
      '<div class="card-pad"><button class="btn" data-act="restore">📥 Загрузить копию файлом</button></div>',
      'Откат заменит нынешние записи содержимым копии');

    h += u.card('Очистить журналы', u.listOf(counts.map(function (x) {
      return u.listRow({ icon: '🗑', title: esc(x.coll), sub: u.nf(x.n) + ' записей',
        value: '<button class="btn btn-sm btn-danger" data-act="reset-coll" data-coll="' +
          esc(x.coll) + '">Очистить</button>' });
    }), 'База пуста'), 'Сначала скачается копия, потом журнал очистится');

    h += u.card('Начать с нуля', '<div class="card-pad">' +
      '<button class="btn btn-danger" data-act="reset-all">🧨 Очистить всю базу</button> ' +
      '<button class="btn" data-act="settings-reset">↺ Сбросить настройки</button>' +
      '</div>', 'Копия сохранится автоматически');
    return h;
  }

  /* ==========================================================================
     ФОРМЫ
     ========================================================================== */
  var FORMS = window.WM_EXTRA_FORMS = window.WM_EXTRA_FORMS || {};

  /* Сверка долга поставщикам. Цифру называют поставщики, программа её только
     запоминает и сравнивает — сам долг она не меняет: у долга один источник,
     это «Итоги дня». Иначе сверка стала бы вторым источником и они разошлись бы. */
  FORMS.debtCheck = {
    title: 'Долг по сверке с поставщиками', icon: '🤝',
    body: function (v) {
      var u = U(); v = v || {};
      var m = ym();
      var mine = E.supplierDebt(dds(), S.settings, m + '-31').debt;
      return u.fieldRow('За месяц', 'ym', 'text', m, { hint: 'меняется наверху экрана' }) +
        u.fieldRow('По программе', 'mine', 'text', money(mine), { hint: 'менять не нужно' }) +
        u.fieldRow('Назвали поставщики', 'sum', 'number', v.sum || '',
          { hint: 'общая сумма долга магазина на конец месяца' }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Сверка ничего не пересчитывает: она только показывает, сошлось или нет. ' +
      'Если расходится — ищите пропущенный день в «Итогах дня», а не правьте долг руками.',
    save: function (v) {
      var bad = Q().checkAmount(v.sum, { allowZero: true }); if (bad) return bad;
      var m = ym();
      var map = JSON.parse(JSON.stringify(S.settings.debtChecked || {}));
      map[m] = num(v.sum);
      S.setSetting('debtChecked', map);
      U().recompute();
      var mine = E.supplierDebt(dds(), S.settings, m + '-31').debt;
      var d = E.safeRound(num(v.sum) - mine);
      return { ok: Math.abs(d) < 0.5
        ? 'Сошлось: ' + money(mine) + '. Долг сверен.'
        : 'Расходится на ' + money(Math.abs(d)) + ': по программе ' + money(mine) +
          ', у поставщиков ' + money(v.sum) + '. Проверьте, все ли дни занесены в «Итоги дня».' };
    }
  };

  /* ==========================================================================
     ДЕЙСТВИЯ
     ========================================================================== */
  var A = window.WM_EXTRA_ACTIONS = window.WM_EXTRA_ACTIONS || {};

  // Скачать копию базы файлом
  function downloadBackup(tag) {
    var text = S.exportJSON();
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'база-' + (tag || today()) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  A['reset-backup'] = function () {
    downloadBackup();
    return 'Копия базы скачана. Положите файл на флешку или в облако.';
  };

  A['reset-copies'] = function () {
    var FS = window.WMFiles;
    if (!FS || !FS.listBackups) return 'Копии в папке доступны только когда папка подключена.';
    FS.listBackups().then(function (list) {
      BK = (list || []).map(function (b) {
        return { name: b.name, when: b.when || b.date || '', records: b.records || 0 };
      });
      U().render();
    }).catch(function () { BK = []; U().render(); });
    return 'Читаю копии из папки…';
  };

  A['reset-rollback'] = function (el) {
    var FS = window.WMFiles, name = el.dataset.name;
    if (!FS || !FS.readBackup) return 'Папка не подключена — загрузите копию файлом.';
    if (!confirm('Откатить базу на копию «' + name + '»? Нынешние записи заменятся. ' +
      'Сначала скачается копия того, что есть сейчас.')) return null;
    downloadBackup('перед-откатом-' + today());
    FS.readBackup(name).then(function (data) {
      if (!data) { U().toast('Копия не прочиталась.'); return; }
      S.replaceAll(typeof data === 'string' ? JSON.parse(data) : data);
      U().recompute(); U().render();
      U().toast('База откачена на копию «' + name + '».', 9000);
    }).catch(function (err) { U().toast('Не получилось: ' + err.message); });
    return null;
  };

  A['reset-coll'] = function (el) {
    var coll = el.dataset.coll, n = (S.state[coll] || []).length;
    if (!confirm('Очистить журнал «' + coll + '» — ' + n + ' записей? ' +
      'Сначала скачается копия всей базы.')) return null;
    downloadBackup('перед-очисткой-' + coll);
    S.state[coll] = [];
    S.save(); U().recompute();
    return 'Журнал «' + coll + '» очищен. Копия базы скачана.';
  };

  A['reset-all'] = function () {
    if (!confirm('Очистить ВСЮ базу? Настройки останутся. Сначала скачается копия.')) return null;
    if (!confirm('Точно? Все смены, итоги дня, табель и выплаты будут стёрты.')) return null;
    downloadBackup('перед-очисткой-всё');
    S.COLLECTIONS.forEach(function (c) { S.state[c] = []; });
    S.save(); U().recompute();
    return 'База очищена. Копия скачана — из неё можно вернуть всё обратно.';
  };

  // Обработчики, которых не хватало на экране «Данные и копии»
  A['book-save'] = function () {
    U().saveBook();
    return 'Записываю книгу «Бухгалтерия.xlsx»…';
  };
  A['book-read'] = function () {
    U().readBook();
    return 'Читаю правки из книги…';
  };
  A['wipe'] = function () { return A['reset-all'](); };

  // Переключение месяца на отчётах
  var prevChange = window.WM_EXTRA_CHANGE;
  window.WM_EXTRA_CHANGE = function (el) {
    if (el.id === 'repMonth') { S.setSetting('reportMonth', el.value); return true; }
    return prevChange ? prevChange(el) : false;
  };

  var VIEWS = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  VIEWS.push(
    { id: 'findash', icon: '📊', name: 'Дашборд', group: 'Отчёты', render: viewDash },
    { id: 'owner', icon: '🧑‍💼', name: 'Отчёт собственнику', group: 'Отчёты', render: viewOwner },
    { id: 'moneyflow', icon: '💸', name: 'Куда ушли деньги', group: 'Отчёты', render: viewMoneyFlow },
    { id: 'avgcheck', icon: '🧾', name: 'Средний чек', group: 'Отчёты', render: viewAvgCheck },
    { id: 'earners', icon: '🏅', name: 'Кто зарабатывает', group: 'Отчёты', render: viewEarners },
    { id: 'ready', icon: '📑', name: 'Готовый отчёт', group: 'Отчёты', render: viewReady },
    { id: 'pnl', icon: '📈', name: 'Прибыль (P&L)', group: 'Отчёты', render: viewPnl },
    { id: 'bep', icon: '⚖️', name: 'Безубыточность', group: 'Отчёты', render: viewBep },
    { id: 'bepdays', icon: '🗓', name: 'Выход в ноль по дням', group: 'Отчёты', render: viewBepDays },
    { id: 'taxcal', icon: '🏛', name: 'Налоговый календарь', group: 'Отчёты', render: viewTaxCal },
    { id: 'monthclose', icon: '🔒', name: 'Закрытие месяца', group: 'Отчёты', render: viewMonthClose },
    { id: 'reset', icon: '🛟', name: 'Сброс и откат базы', group: 'Ещё', render: viewReset }
  );
})();
