/* ============================================================================
   Экраны отчётов для владельца:
   Куда ушли деньги · Средний чек · Что было год назад · Прогноз до конца
   месяца · Праздники и выходные · Главные проблемы · Группы товаров ·
   Рейтинг по прибыли · Что съедает прибыль.
   Файл подключается ДО js/ui.js и дополняет общий список экранов.
   ========================================================================== */
(function () {
  'use strict';
  var E = window.WM, S = window.WMStore, F = window.WMFin, R = window.WMReports;

  function U() { return window.WMUI; }
  function DET() { return window.WMDetail; }
  function FLT() { return window.WMFilter; }
  function esc(s) { return U().esc(s); }
  function dateRu(d) { return U().dateRu(d); }
  function num(v) { return E.num(v); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function dds() { return S.state.dds || []; }

  function uniq(list) {
    var seen = {}, out = [];
    list.forEach(function (v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }
  // Месяцы, за которые есть записи, — новые сверху
  function months() {
    return uniq(dds().map(function (r) { return String(r.date).slice(0, 7); })).sort().reverse();
  }
  // Выбранный месяц: он же общий для всех отчётов этого файла
  function pickedYm() {
    var ms = months();
    if (!ms.length) return '';
    var saved = S.settings.reportMonth;
    return saved && ms.indexOf(saved) >= 0 ? saved : ms[0];
  }
  function monthSelect() {
    var ms = months(), ym = pickedYm();
    if (!ms.length) return '';
    return '<select id="repMonth" style="background:var(--fill);border:none;border-radius:9px;' +
      'padding:9px 12px;font-size:14px">' + ms.map(function (m) {
        return '<option value="' + m + '"' + (m === ym ? ' selected' : '') + '>' +
          esc(F.monthTitle(m)) + '</option>';
      }).join('') + '</select>';
  }
  function noData(title, sub) {
    return U().pageHead(title, sub) + '<div class="card"><div class="empty">' +
      'Записей пока нет. Закройте первую смену на экране «Касса за смену» — ' +
      'и отчёт соберётся сам.</div></div>';
  }

  /* --- 101. Куда ушли деньги за месяц ------------------------------------------
     Водопад: сверху вся выручка, каждая полоса откусывает свой кусок,
     внизу — что осталось. Одна картинка вместо десяти цифр.
     ---------------------------------------------------------------------- */
  function viewFlow() {
    var u = U(), ym = pickedYm();
    if (!ym) return noData('Куда ушли деньги', 'Вся выручка месяца по кусочкам');
    var fl = R.moneyFlow(dds(), ym);
    var h = u.pageHead('Куда ушли деньги', F.monthTitle(ym) + ' — от выручки до остатка',
      monthSelect() + ' <button class="btn" data-act="print">🖨 Печать</button>');

    if (!fl.income) {
      return h + '<div class="card"><div class="empty">В этом месяце выручки нет. ' +
        'Выберите другой месяц наверху.</div></div>';
    }

    h += '<div class="stat-grid">' +
      u.stat('Выручка', u.priv(fl.income), 'всё, что пришло за месяц') +
      u.stat('Потрачено', u.priv(fl.expense), 'все расходы месяца', 'c-red') +
      (fl.draw ? u.stat('Забрал владелец', u.priv(fl.draw), 'из оборота в карман', 'c-orange') : '') +
      u.stat('Осталось', u.priv(fl.left), fl.left >= 0 ? 'это и есть прибыль' : 'потратили больше, чем заработали',
        fl.left >= 0 ? 'c-green' : 'c-red') +
      '</div>';

    // Полосы рисуем обычной разметкой, без графиков: так и печатается, и
    // открывается на любом компьютере без интернета.
    var bars = fl.steps.map(function (st) {
      var w = fl.income ? Math.max(0.6, Math.abs(st.kind === 'start' || st.kind === 'end' ? st.left : st.sum) / fl.income * 100) : 0;
      var cls = st.kind === 'start' ? 'flow-in' : st.kind === 'end'
        ? (st.left >= 0 ? 'flow-left' : 'flow-minus') : (st.kind === 'draw' ? 'flow-draw' : 'flow-out');
      var right = st.kind === 'start' || st.kind === 'end'
        ? '<b class="private">' + E.fmtMoney(st.left) + '</b>'
        : '<span class="private">−' + E.fmtMoney(st.sum) + '</span>' +
          '<small class="c-muted"> · осталось ' + E.fmtMoney(st.left) + '</small>';
      return '<div class="flow-row" data-sum="' + (st.kind === 'start' || st.kind === 'end' ? st.left : st.sum) +
        '" data-left="' + st.left + '"><div class="flow-name">' + esc(st.name) +
        (st.share ? ' <small class="c-muted">' + u.pct(st.share) + '</small>' : '') + '</div>' +
        '<div class="flow-track"><div class="flow-bar ' + cls + '" style="width:' + w.toFixed(1) + '%"></div></div>' +
        '<div class="flow-sum">' + right + '</div></div>';
    }).join('');
    h += u.card('От выручки до остатка', '<div class="card-pad flow">' + bars + '</div>');

    h += '<div class="banner"><span>💡</span><span>Читается сверху вниз: первая полоса — вся выручка ' +
      'месяца, каждая следующая отнимает свою часть. Проценты — доля от выручки. ' +
      'Мелкие траты меньше 2% собраны в одну строку, чтобы картинка была читаемой.</span></div>';
    return h;
  }

  /* --- 104. Средний чек ---------------------------------------------------------
     Число чеков берётся из Z-отчёта: его вписывает кассир при закрытии смены.
     В выгрузках 1С чеков нет — там только итоги по товарам.
     ---------------------------------------------------------------------- */
  function viewAvgCheck() {
    var u = U();
    var rows = dds().filter(function (r) { return u.inPeriod(r.date); });
    if (!rows.length) rows = dds();
    if (!rows.length) return noData('Средний чек', 'Сколько в среднем оставляет один покупатель');
    var a = R.avgCheck(rows);

    var h = u.pageHead('Средний чек', 'Сколько в среднем оставляет один покупатель — ' +
      u.periodName().toLowerCase(), '<button class="btn" data-act="print">🖨 Печать</button>');

    if (!a.checks) {
      return h + '<div class="card"><div class="empty"><b>Пока не из чего считать</b><br>' +
        'Средний чек = выручка ÷ количество чеков. Числа чеков в базе нет.<br>' +
        'При закрытии смены заполните поле «Чеков по Z-отчёту» — оно прямо на ' +
        'Z-отчёте кассы. В выгрузках 1С этого числа нет, само оно не появится.' +
        '</div><div class="card-pad"><button class="btn btn-primary" data-form="cashShift">' +
        '💵 Закрыть смену с числом чеков</button></div></div>';
    }

    h += '<div class="stat-grid">' +
      u.stat('Средний чек', u.priv(a.avg), 'за ' + a.withChecks + ' ' +
        u.plural(a.withChecks, 'день', 'дня', 'дней') + ' с числом чеков') +
      u.stat('Чеков всего', u.nf(a.checks), 'в среднем ' + u.nf(a.checksPerDay) + ' в день') +
      u.stat('Выручка этих дней', u.priv(a.revenue), 'из неё и считаем') +
      (a.trend ? u.stat('Куда идёт', (a.trend.change >= 0 ? '+' : '') + u.pct(a.trend.pct),
        'было ' + E.fmtMoney(a.trend.was) + ' → стало ' + E.fmtMoney(a.trend.now),
        a.trend.change >= 0 ? 'c-green' : 'c-red') : '') +
      '</div>';

    if (a.withChecks < a.totalDays) {
      h += '<div class="banner orange"><span>⚠️</span><span>Число чеков заполнено только за <b>' +
        a.withChecks + '</b> ' + u.plural(a.withChecks, 'день', 'дня', 'дней') + ' из ' + a.totalDays +
        '. Остальные дни в расчёт не вошли — иначе средний чек был бы завышен.</span></div>';
    }

    h += u.card('По дням', u.table('avgT', [
      { title: 'Дата', fn: function (r) { return DET().link('day', r.date, dateRu(r.date)); } },
      { title: 'День', fn: function (r) { return esc(R.dayKind(r.date)); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
      { title: 'Чеков', cls: 'num', fn: function (r) { return r.checks ? u.nf(r.checks) : '—'; } },
      { title: 'Средний чек', cls: 'num', fn: function (r) {
        if (!r.checks) return '<span class="c-muted">не заполнено</span>';
        var mark = a.avg && r.avg > a.avg * 1.15 ? 'c-green' : (a.avg && r.avg < a.avg * 0.85 ? 'c-orange' : '');
        return '<span class="' + mark + ' private">' + E.fmtMoney(r.avg) + '</span>'; } }
    ], a.days.slice().reverse(), { step: 40 }));

    h += '<div class="banner"><span>💡</span><span>Средний чек растёт двумя способами: ' +
      'человек берёт больше позиций или берёт дороже. Выкладка у кассы и сопутствующий товар ' +
      'работают на первое, ассортимент — на второе.</span></div>';
    return h;
  }

  /* --- 107. Что было год назад --------------------------------------------------
     У продуктового сравнивать с прошлым месяцем бессмысленно: январь и
     декабрь несравнимы. Сравниваем с тем же месяцем прошлого года.
     ---------------------------------------------------------------------- */
  function viewYearAgo() {
    var u = U(), ym = pickedYm();
    if (!ym) return noData('Что было год назад', 'Тот же месяц прошлого года');
    var y = R.yearAgo(dds(), ym);
    var h = u.pageHead('Что было год назад', F.monthTitle(ym) + ' против ' + F.monthName(y.prevYm),
      monthSelect() + ' <button class="btn" data-act="print">🖨 Печать</button>');

    if (!y.has) {
      return h + '<div class="banner blue"><span>🗓</span><span>За ' + esc(F.monthTitle(y.prevYm)) +
        ' записей нет — сравнивать не с чем. Это нормально: сравнение год к году ' +
        'заработает, когда программа проживёт с вами год. Пока пользуйтесь экраном ' +
        '«Сравнение периодов».</span></div>' +
        '<div class="card-pad"><button class="btn" data-go="compare">📐 Сравнение периодов</button></div>';
    }

    var line = y.lines[0], pr = y.lines[3];
    h += '<div class="stat-grid">' +
      u.stat('Выручка сейчас', u.priv(line.cur), 'год назад ' + E.fmtMoney(line.prev)) +
      u.stat('Изменение', (line.change >= 0 ? '+' : '') + u.pct(line.pct == null ? 0 : line.pct),
        (line.change >= 0 ? '+' : '') + E.fmtMoney(line.change) + ' к прошлому году',
        line.change >= 0 ? 'c-green' : 'c-red') +
      u.stat('Прибыль сейчас', u.priv(pr.cur), 'год назад ' + E.fmtMoney(pr.prev),
        pr.change >= 0 ? 'c-green' : 'c-red') +
      '</div>';

    h += u.card('Строка за строкой', u.table('yaT', [
      { title: 'Показатель', fn: function (r) { return esc(r.name); } },
      { title: F.monthTitle(ym), cls: 'num', fn: function (r) {
        return r.money ? u.priv(r.cur) : u.nf(r.cur); } },
      { title: F.monthTitle(y.prevYm), cls: 'num', fn: function (r) {
        return r.money ? u.priv(r.prev) : u.nf(r.prev); } },
      { title: 'Разница', cls: 'num', fn: function (r) {
        return '<span class="' + u.cls(r.change) + (r.money ? ' private' : '') + '">' +
          (r.change > 0 ? '+' : '') + (r.money ? E.fmtMoney(r.change) : u.nf(r.change)) + '</span>'; } },
      { title: '%', cls: 'num', fn: function (r) {
        return r.pct == null ? '—' : '<span class="' + u.cls(r.pct) + '">' +
          (r.pct > 0 ? '+' : '') + u.pct(r.pct) + '</span>'; } }
    ], y.lines, { step: 20 }));

    h += '<div class="banner"><span>💡</span><span>Сравнение год к году убирает сезон: ' +
      'август всегда тише декабря, и это не повод для тревоги. А вот август хуже ' +
      'прошлого августа — уже разговор.</span></div>';
    return h;
  }

  /* --- 108. Прогноз выручки до конца месяца -------------------------------------
     По медиане дня, а не по среднему: один праздник с двойной выручкой не
     должен обещать такой же весь месяц.
     ---------------------------------------------------------------------- */
  function viewPace() {
    var u = U(), ym = pickedYm();
    if (!ym) return noData('Прогноз до конца месяца', 'Сколько будет, если пойдёт как идёт');
    var p = R.monthPace(dds(), ym, today());
    var h = u.pageHead('Прогноз до конца месяца',
      F.monthTitle(ym) + ' — сколько будет, если пойдёт как идёт',
      monthSelect() + ' <button class="btn" data-act="print">🖨 Печать</button>');

    if (!p.daysWithData) {
      return h + '<div class="card"><div class="empty">За этот месяц выручки нет. ' +
        'Выберите другой месяц наверху.</div></div>';
    }

    var goal = num(S.settings.planRevenue);
    h += '<div class="stat-grid">' +
      u.stat('Уже заработано', u.priv(p.done), 'за ' + p.daysWithData + ' ' +
        u.plural(p.daysWithData, 'день', 'дня', 'дней')) +
      u.stat('Обычный день', u.priv(p.median), 'середина всех дней месяца') +
      u.stat('Будет к концу месяца', u.priv(p.forecast),
        p.left ? 'осталось ' + p.left + ' ' + u.plural(p.left, 'день', 'дня', 'дней') : 'месяц закончился') +
      (goal ? u.stat('Цель на месяц', u.priv(goal),
        p.forecast >= goal ? 'выйдем с запасом ' + E.fmtMoney(p.forecast - goal)
          : 'не хватит ' + E.fmtMoney(goal - p.forecast),
        p.forecast >= goal ? 'c-green' : 'c-orange') : '') +
      '</div>';

    h += u.card('Три варианта, как может сложиться', u.listOf([
      u.listRow({ icon: '🙂', title: 'Если пойдёт как обычно',
        sub: 'по медиане ' + E.fmtMoney(p.median) + ' в день', value: u.priv(p.forecast) }),
      u.listRow({ icon: '😐', title: 'Если по среднему',
        sub: 'среднее выше медианы, если были удачные дни: ' + E.fmtMoney(p.average) + ' в день',
        value: u.priv(p.forecastAvg) }),
      u.listRow({ icon: '😟', title: 'Если каждый день будет как худший',
        sub: 'нижняя граница', value: '<span class="c-orange private">' + E.fmtMoney(p.low) + '</span>' }),
      u.listRow({ icon: '🤩', title: 'Если каждый день будет как лучший',
        sub: 'верхняя граница', value: '<span class="c-green private">' + E.fmtMoney(p.high) + '</span>' })
    ], ''));

    if (goal && p.left && p.forecast < goal) {
      var need = E.safeRound((goal - p.done) / p.left);
      h += '<div class="banner orange"><span>🎯</span><span>Чтобы выйти на цель, оставшиеся <b>' +
        p.left + '</b> ' + u.plural(p.left, 'день', 'дня', 'дней') + ' нужно делать по <b class="private">' +
        E.fmtMoney(need) + '</b> — это на ' + u.pct(E.safeRound((need / (p.median || 1) - 1) * 100)) +
        ' больше обычного дня.</span></div>';
    }
    h += '<div class="banner"><span>💡</span><span>Прогноз считается по медиане, а не по среднему: ' +
      'одна удачная суббота не должна обещать такую же выручку каждый день. ' +
      'Цель на месяц задаётся в настройках, раздел «Цели месяца».</span></div>';
    return h;
  }

  /* --- 109. Праздники, выходные и дни зарплаты ----------------------------------
     Погоду офлайн взять неоткуда, и врать не будем. А календарь программа
     знает сама — и он на выручку влияет не меньше.
     ---------------------------------------------------------------------- */
  function viewCalendarEffect() {
    var u = U();
    var rows = dds();
    if (!rows.length) return noData('Праздники и выходные', 'Как календарь двигает выручку');
    var c = R.calendarEffect(rows);
    var h = u.pageHead('Праздники и выходные', 'Как календарь двигает выручку',
      '<button class="btn" data-act="print">🖨 Печать</button>');

    if (c.days < 7) {
      return h + '<div class="card"><div class="empty">Пока мало дней с записями (' + c.days +
        '). Разбор по дням недели и праздникам станет честным примерно после месяца работы.</div></div>';
    }

    h += '<div class="stat-grid">' +
      u.stat('Обычный день', u.priv(c.base), 'медиана всех дней с выручкой') +
      u.stat('Дней в разборе', u.nf(c.days), 'чем больше, тем точнее') +
      '</div>';

    h += u.card('Что даёт какой день', u.table('calT', [
      { title: 'Какой день', fn: function (r) { return esc(r.kind); } },
      { title: 'Дней', cls: 'num', fn: function (r) { return u.nf(r.days); } },
      { title: 'Обычная выручка', cls: 'num', fn: function (r) { return u.priv(r.med); } },
      { title: 'Против обычного дня', cls: 'num', fn: function (r) {
        if (!r.vs) return '<span class="c-muted">как обычно</span>';
        return '<span class="' + u.cls(r.vs) + '">' + (r.vs > 0 ? '+' : '') + u.pct(r.vs) + '</span>'; } },
      { title: 'Всего за все такие дни', cls: 'num', fn: function (r) { return u.priv(r.sum); } }
    ], c.rows, { step: 20 }));

    h += '<div class="banner blue"><span>🌦</span><span>Погоду программа не знает: она работает ' +
      'без интернета, и брать прогноз ей неоткуда. Если хотите видеть влияние дождя — ' +
      'пишите погоду в комментарий к смене, и её будет видно в отчёте за день. ' +
      'Праздники и дни зарплаты программа считает сама по календарю.</span></div>';
    return h;
  }

  /* --- 110. Три главные проблемы месяца -----------------------------------------
     Не список всего подряд, а то, что стоит денег: с суммой в рублях и
     кнопкой, куда идти разбираться.
     ---------------------------------------------------------------------- */
  function viewProblems() {
    var u = U(), ym = pickedYm();
    if (!ym) return noData('Главные проблемы месяца', 'За что браться первым');
    var C = u.calc(), D = u.data();
    var pt = F.planTotals(S.state.plans || [], today());
    var prevYm = F.prevMonth(ym);
    var prevT = F.totals(dds().filter(function (r) { return String(r.date).slice(0, 7) === prevYm; }));
    var deadMoney = C.dead ? num(C.dead.total) : 0;

    var p = R.topProblems({
      dds: dds(), ym: ym,
      writeoffSum: C.writeoffSum, returnSum: C.returnSum,
      overdue: pt.overdue, overdueCount: pt.overdueCount,
      deadMoney: deadMoney,
      marginPrev: prevT.income ? prevT.margin : null
    });

    var h = u.pageHead('Главные проблемы месяца', F.monthTitle(ym) + ' — за что браться первым',
      monthSelect() + ' <button class="btn" data-act="print">🖨 Печать</button>');

    if (!p.all.length) {
      return h + '<div class="card"><div class="empty">👍 <b>Ничего крупного не нашлось</b><br>' +
        'Недостач нет, списаний нет, платежи в срок. Так тоже бывает.</div></div>';
    }

    h += '<div class="stat-grid">' +
      u.stat('Всего потерь найдено', u.priv(p.total), 'по ' + p.all.length + ' ' +
        u.plural(p.all.length, 'причине', 'причинам', 'причинам'), 'c-red') +
      u.stat('Три главные', u.priv(p.top.reduce(function (a, x) { return a + x.sum; }, 0)),
        'на них приходится основное') +
      '</div>';

    var medals = ['🥇', '🥈', '🥉'];
    h += u.card('С чего начать', u.listOf(p.top.map(function (x, i) {
      return u.listRow({ icon: medals[i] || '•', title: esc(x.what),
        sub: esc(x.why) + ' · <b>' + esc(x.fix) + '</b>',
        value: '<span class="c-red private">' + E.fmtMoney(x.sum) + '</span>' +
          '<small><button class="btn btn-sm" data-go="' + esc(x.go) + '">Разобраться</button></small>' });
    }), ''));

    if (p.all.length > 3) {
      h += u.card('Остальное', u.table('probT', [
        { title: 'Что', fn: function (r) { return esc(r.what); } },
        { title: 'Почему', fn: function (r) { return esc(r.why); } },
        { title: 'Стоит', cls: 'num', fn: function (r) { return u.priv(r.sum); } },
        { title: '', cls: 'center', fn: function (r) {
          return '<button class="btn btn-sm" data-go="' + esc(r.go) + '">Открыть</button>'; } }
      ], p.all.slice(3), { step: 20 }));
    }

    h += '<div class="banner"><span>💡</span><span>Проблемы отсортированы по деньгам, а не по ' +
      'громкости. Недостача в 500 ₽ бывает обиднее, но списаний на 40 000 ₽ дороже — ' +
      'браться выгоднее за них.</span></div>';
    return h;
  }

  /* --- 111. Группы товаров: доля в прибыли ---------------------------------------
     Группа может давать четверть выручки и почти ничего не приносить —
     тогда место на полке под неё занято зря.
     ---------------------------------------------------------------------- */
  function viewGroupProfit() {
    var u = U(), C = u.calc();
    var g = R.groupProfit(C.byGroup || []);
    var h = u.pageHead('Группы товаров', 'Кто даёт выручку, а кто — прибыль',
      '<button class="btn" data-act="print">🖨 Печать</button>');
    if (!g.rows.length) {
      return h + '<div class="card"><div class="empty">Нужны отчёты 1С «Продажи» и ' +
        '«Остатки номенклатуры» — из них берутся группы. Загрузите их на экране ' +
        '«Импорт из 1С».</div></div>';
    }

    h += '<div class="stat-grid">' +
      u.stat('Выручка по группам', u.priv(g.revenue), g.rows.length + ' ' +
        u.plural(g.rows.length, 'группа', 'группы', 'групп')) +
      u.stat('Валовая прибыль', u.priv(g.gross), 'выручка минус закуп', 'c-green') +
      u.stat('Общая маржа', u.pct(g.margin), 'сколько остаётся с рубля') +
      '</div>';

    var traps = g.rows.filter(function (r) { return r.gap < -3 && r.revShare >= 3; });
    if (traps.length) {
      h += '<div class="banner orange"><span>⚠️</span><span>Продаём много, зарабатываем мало: <b>' +
        traps.map(function (r) { return esc(r.group); }).join(', ') + '</b>. ' +
        'Доля в выручке заметно больше доли в прибыли — проверьте наценку по этим группам.</span></div>';
    }

    h += u.card('Группы по прибыли', u.table('grpT', [
      { title: 'Группа', fn: function (r) { return esc(r.group); } },
      { title: 'Позиций', cls: 'num', fn: function (r) { return u.nf(r.items); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
      { title: 'Доля выручки', cls: 'num', fn: function (r) { return u.pct(r.revShare); } },
      { title: 'Прибыль', cls: 'num', fn: function (r) { return u.priv(r.gross); } },
      { title: 'Доля прибыли', cls: 'num', fn: function (r) {
        return '<b>' + u.pct(r.profitShare) + '</b>'; } },
      { title: 'Маржа', cls: 'num', fn: function (r) {
        var m = num(r.margin);
        return '<span class="' + (m >= 25 ? 'c-green' : m >= 15 ? '' : 'c-orange') + '">' +
          u.pct(m) + '</span>'; } },
      { title: '', cls: 'center', fn: function (r) {
        return r.gap < -3 ? u.badge('мало зарабатывает', 'orange')
          : (r.gap > 3 ? u.badge('кормит магазин', 'green') : ''); } }
    ], g.rows, { step: 30 }));

    h += '<div class="banner"><span>💡</span><span>Сравнивайте две доли: если группа даёт 20% ' +
      'выручки и 8% прибыли — она занимает полку, а кормит магазин кто-то другой. ' +
      'Полка не резиновая, и это повод пересмотреть наценку или ассортимент.</span></div>';
    return h;
  }

  /* --- 112. Рейтинг товаров по прибыли ------------------------------------------
     Дорогой товар с маленькой наценкой стоит в топе выручки, а денег с него
     нет. Считаем прибыль в рублях и показываем таких отдельно.
     ---------------------------------------------------------------------- */
  function viewItemProfit() {
    var u = U(), D = u.data();
    var h = u.pageHead('Рейтинг по прибыли', 'Не кто больше продаётся, а кто больше приносит',
      '<button class="btn" data-act="print">🖨 Печать</button>');
    if (!D.sales.length) {
      return h + '<div class="card"><div class="empty">Нужен отчёт 1С «Продажи». ' +
        'Загрузите его на экране «Импорт из 1С».</div></div>';
    }
    var p = R.itemProfit(D.sales, 20);

    h += '<div class="stat-grid">' +
      u.stat('Прибыль по товарам', u.priv(p.total), u.nf(p.count) + ' позиций', 'c-green') +
      u.stat('Топ-20 приносит', u.priv(p.byProfit.slice(0, 20).reduce(function (a, r) { return a + r.profit; }, 0)),
        p.total ? u.pct(E.safeRound(p.byProfit.slice(0, 20).reduce(function (a, r) { return a + r.profit; }, 0) / p.total * 100)) + ' всей прибыли' : '') +
      u.stat('«Обманщиков»', u.nf(p.fakes.length), 'в топе выручки, но не в топе прибыли',
        p.fakes.length ? 'c-orange' : 'c-green') +
      '</div>';

    if (p.fakes.length) {
      h += u.card('Продаются хорошо, а зарабатывают плохо', u.table('fakeT', [
        { title: 'Товар', fn: function (r) { return DET().link('product', E.norm(r.name), r.name); } },
        { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
        { title: 'Прибыль', cls: 'num', fn: function (r) { return u.priv(r.profit); } },
        { title: 'Маржа', cls: 'num', fn: function (r) {
          return '<span class="c-orange">' + u.pct(r.margin) + '</span>'; } },
        { title: 'Место по прибыли', cls: 'num', fn: function (r) { return u.nf(r.profitPlace); } }
      ], p.fakes, { step: 20 }),
        'В выручке они в двадцатке, а по прибыли — далеко за сороковым местом');
    }

    var defs = [{ key: 'm', name: 'Маржа', options: [
      { v: 'hi', name: 'Больше 25%', test: function (r) { return r.margin >= 25; } },
      { v: 'mid', name: '10–25%', test: function (r) { return r.margin >= 10 && r.margin < 25; } },
      { v: 'lo', name: 'Меньше 10%', test: function (r) { return r.margin < 10; } }
    ] }];
    var list = FLT().apply('itemprof', p.byProfit, defs, function (r) { return r.name; });
    h += FLT().bar('itemprof', defs, p.byProfit, { search: 'название товара' });

    h += u.card('Кто приносит деньги', FLT().note(list.length, p.byProfit.length) + u.table('ipT', [
      { title: '#', cls: 'num', fn: function (r, i) { return u.nf(i + 1); } },
      { title: 'Товар', fn: function (r) { return DET().link('product', E.norm(r.name), r.name); } },
      { title: 'Продано', cls: 'num', fn: function (r) { return u.nf(r.qty, 2); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
      { title: 'Закуп', cls: 'num', fn: function (r) { return u.priv(r.cogs); } },
      { title: 'Прибыль', cls: 'num', fn: function (r) {
        return '<b class="' + (r.profit >= 0 ? 'c-green' : 'c-red') + ' private">' +
          E.fmtMoney(r.profit) + '</b>'; } },
      { title: 'Маржа', cls: 'num', fn: function (r) { return u.pct(r.margin); } }
    ], list, { step: 40 }));

    h += '<div class="banner"><span>💡</span><span>Обычный рейтинг «по выручке» обманывает: ' +
      'сигареты и молоко всегда наверху, а зарабатывает магазин на другом. ' +
      'Здесь список отсортирован по рублям прибыли — по тем деньгам, которые остаются вам.</span></div>';
    return h;
  }

  /* --- 113. Что съедает прибыль --------------------------------------------------
     Валовая прибыль сверху, дальше по строке на каждую причину, снизу —
     что реально осталось.
     ---------------------------------------------------------------------- */
  function viewEaters() {
    var u = U(), ym = pickedYm();
    if (!ym) return noData('Что съедает прибыль', 'От валовой прибыли до чистой');
    var C = u.calc();
    var p = R.profitEaters({ dds: dds(), ym: ym, writeoffSum: C.writeoffSum });
    var h = u.pageHead('Что съедает прибыль', F.monthTitle(ym) + ' — от валовой прибыли до чистой',
      monthSelect() + ' <button class="btn" data-act="print">🖨 Печать</button>');

    if (!p.income) {
      return h + '<div class="card"><div class="empty">За этот месяц записей нет. ' +
        'Выберите другой месяц наверху.</div></div>';
    }

    h += '<div class="stat-grid">' +
      u.stat('Валовая прибыль', u.priv(p.gross), 'выручка ' + E.fmtMoney(p.income) +
        ' минус закуп ' + E.fmtMoney(p.purchase)) +
      u.stat('Съедено', u.priv(p.eaten), 'всё, что ушло сверх закупа', 'c-red') +
      u.stat('Осталось вам', u.priv(p.left), p.left >= 0 ? 'чистая прибыль месяца' : 'месяц в минусе',
        p.left >= 0 ? 'c-green' : 'c-red') +
      '</div>';

    h += u.card('Кто сколько откусил', u.table('eatT', [
      { title: 'Причина', fn: function (r) { return esc(r.name); } },
      { title: 'Почему', fn: function (r) { return '<span class="c-muted">' + esc(r.why) + '</span>'; } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.sum); } },
      { title: 'Доля валовой прибыли', cls: 'num', fn: function (r) {
        return '<span class="' + (r.share >= 25 ? 'c-red' : r.share >= 10 ? 'c-orange' : '') + '">' +
          u.pct(r.share) + '</span>'; } },
      { title: '', cls: 'center', fn: function (r) {
        return '<button class="btn btn-sm" data-go="' + esc(r.go) + '">Открыть</button>'; } }
    ], p.eaters, { step: 30, empty: 'Расходов за месяц нет',
      total: [{ html: 'Съедено всего', span: 2 }, { html: E.fmtMoney(p.eaten), cls: 'num' },
        { html: p.gross ? u.pct(E.safeRound(p.eaten / p.gross * 100)) : '—', cls: 'num' }, { html: '' }] }));

    h += '<div class="banner"><span>💡</span><span>Валовая прибыль — это ещё не ваши деньги: ' +
      'из неё платится зарплата, аренда, налоги, и в неё же попадают списания и недостачи. ' +
      'Чистая прибыль внизу — вот что действительно остаётся.</span></div>';
    return h;
  }

  /* --- 117. Свои показатели ------------------------------------------------------
     Экран, где владелец заводит свою цифру: имя, формула словами, единица.
     ---------------------------------------------------------------------- */
  function kpiCtx() {
    var u = U();
    var rows = dds().filter(function (r) { return u.inPeriod(r.date); });
    if (!rows.length) rows = dds();
    var t = F.totals(rows);
    return {
      dds: rows, bank: S.state.bank || [], settings: S.settings,
      opening: { cash: num(S.settings.openCashStart), card: num(S.settings.openCardStart),
        sbp: num(S.settings.openSbpStart), transfer: num(S.settings.openTransferStart) },
      writeoffSum: u.calc().writeoffSum || 0,
      tax: F.taxAmount(S.settings, t.income, t.expense).sum
    };
  }
  function viewKpi() {
    var u = U();
    var vals = R.kpiValues(kpiCtx());
    var list = S.state.kpis || [];
    var h = u.pageHead('Свои показатели', 'Задайте формулу — цифра встанет на «Сегодня»',
      '<button class="btn btn-primary" data-form="kpiCard">＋ Новый показатель</button>');

    h += u.card('Ваши показатели', u.table('kpiT', [
      { title: 'Название', fn: function (r) { return esc(r.name); } },
      { title: 'Формула', fn: function (r) { return '<code>' + esc(r.formula) + '</code>'; } },
      { title: 'Сейчас', cls: 'num', fn: function (r) {
        var res = R.kpiEval(r.formula, vals);
        if (res.error) return '<span class="c-orange">' + esc(res.error.slice(0, 45)) + '</span>';
        return r.unit === '%' ? u.pct(res.value)
          : r.unit === 'штук' ? u.nf(res.value) : u.priv(res.value); } },
      { title: 'Хочу, чтобы было', fn: function (r) {
        return r.good && r.good !== 'просто показывать'
          ? esc(r.good) + ' ' + u.nf(num(r.target)) : '<span class="c-muted">просто показывать</span>'; } },
      { title: '', cls: 'center', fn: function (r) {
        return '<button class="btn btn-sm" data-edit="kpis:' + r.id + ':kpiCard">✎</button> ' +
          '<button class="btn btn-sm btn-danger" data-del="kpis:' + r.id + '">✕</button>'; } }
    ], list, { step: 20, empty: 'Пока ни одного. Нажмите «Новый показатель».' }));

    var words = R.KPI_WORDS.map(function (w) {
      var v = vals[w];
      return '<tr><td><code>' + esc(w) + '</code></td><td class="num private">' +
        E.fmtMoney(v) + '</td></tr>';
    }).join('');
    h += u.card('Какие слова можно писать в формуле',
      '<div class="table-wrap"><table class="data"><thead><tr><th>Слово</th>' +
      '<th class="num">Сейчас, за ' + esc(u.periodName().toLowerCase()) + '</th></tr></thead>' +
      '<tbody>' + words + '</tbody></table></div>',
      'Плюс, минус, умножить, разделить и скобки — как на калькуляторе');

    h += '<div class="banner"><span>💡</span><span>Примеры: <code>выручка - закуп - зп - аренда</code> — ' +
      'сколько остаётся после главного; <code>(выручка - закуп) / выручка * 100</code> — маржа; ' +
      '<code>выручка / дней</code> — сколько в среднем в день; <code>списания / выручка * 100</code> — ' +
      'какую долю выручки съедает порча.</span></div>';
    return h;
  }

  /* --- 105. Отчёт собственнику на одну страницу ----------------------------------
     Всё главное за месяц одним листом: деньги, продажи, долги, потери,
     люди и три проблемы. Чтобы распечатать и положить в папку.
     ---------------------------------------------------------------------- */
  function viewOwnerPage() {
    var u = U(), ym = pickedYm();
    if (!ym) return noData('Отчёт собственнику', 'Всё главное за месяц на одну страницу');
    var C = u.calc();
    var all = dds();
    var per = all.filter(function (r) { return String(r.date).slice(0, 7) === ym; });
    var t = F.totals(per), tAll = F.totals(all);
    var prevYm = F.prevMonth(ym);
    var prev = F.totals(all.filter(function (r) { return String(r.date).slice(0, 7) === prevYm; }));
    var bal = F.balances(all, { cash: num(S.settings.openCashStart), card: num(S.settings.openCardStart),
      sbp: num(S.settings.openSbpStart), transfer: num(S.settings.openTransferStart) });
    var tr = F.inTransit(all, S.state.bank || [], S.settings);
    var pt = F.planTotals(S.state.plans || [], today());
    var ac = R.avgCheck(per);
    var pace = R.monthPace(all, ym, today());
    var tax = F.taxAmount(S.settings, t.income, t.expense);
    var probs = R.topProblems({ dds: all, ym: ym, writeoffSum: C.writeoffSum,
      returnSum: C.returnSum, overdue: pt.overdue, overdueCount: pt.overdueCount,
      deadMoney: C.dead ? num(C.dead.total) : 0,
      marginPrev: prev.income ? prev.margin : null });

    var h = u.pageHead('Отчёт собственнику', F.monthTitle(ym) + ' — всё главное на одну страницу',
      monthSelect() + ' <button class="btn btn-primary" data-act="print">🖨 Печать</button>');

    function dlt(now, was) {
      if (!was) return 'в прошлом месяце данных нет';
      var d = E.safeRound(now - was), p = E.safeRound(d / Math.abs(was) * 100);
      return (d >= 0 ? '+' : '') + E.fmtMoney(d) + ' (' + (p >= 0 ? '+' : '') + u.pct(p) + ') к ' + F.monthName(prevYm);
    }

    h += '<div class="stat-grid">' +
      u.stat('Выручка', u.priv(t.income), dlt(t.income, prev.income)) +
      u.stat('Расход', u.priv(t.expense), dlt(t.expense, prev.expense)) +
      u.stat('Прибыль', u.priv(t.profit), dlt(t.profit, prev.profit),
        t.profit >= 0 ? 'c-green' : 'c-red') +
      u.stat('Маржа', u.pct(t.margin), 'в прошлом месяце ' + u.pct(prev.margin)) +
      '</div>';

    h += '<div class="grid-2">' +
      u.card('Деньги на сегодня', u.listOf([
        u.listRow({ icon: '💵', title: 'Наличные', value: u.priv(bal.map['Наличные']) }),
        u.listRow({ icon: '💳', title: 'Карта и СБП',
          value: u.priv(E.safeRound((bal.map['Карта'] || 0) + (bal.map['СБП'] || 0))) }),
        u.listRow({ icon: '🏦', title: 'На счёте', value: u.priv(bal.map['Перевод']) }),
        u.listRow({ icon: '🚚', title: 'В пути от банка', sub: 'пробили, банк ещё не зачислил',
          value: '<span class="c-orange private">' + E.fmtMoney(tr.sum) + '</span>' }),
        u.listRow({ icon: '✅', title: 'Доступно сейчас', sub: 'всё минус деньги в пути',
          value: '<b class="private">' + E.fmtMoney(E.safeRound(bal.total - tr.sum)) + '</b>' })
      ], ''), '') +
      u.card('Долги и платежи', u.listOf([
        u.listRow({ icon: '💼', title: 'Должны поставщикам',
          value: '<span class="' + (tAll.debtNow > 0 ? 'c-red' : 'c-green') + ' private">' +
            E.fmtMoney(tAll.debtNow) + '</span>' }),
        u.listRow({ icon: '🔴', title: 'Просрочено', sub: pt.overdueCount + ' платежей',
          value: '<span class="c-red private">' + E.fmtMoney(pt.overdue) + '</span>' }),
        u.listRow({ icon: '📅', title: 'Запланировано к выплате', value: u.priv(pt.planned) }),
        u.listRow({ icon: '⚖️', title: 'Налог за месяц', sub: tax.name, value: u.priv(tax.sum) })
      ], ''), '') +
      '</div>';

    h += '<div class="grid-2">' +
      u.card('Как торгуем', u.listOf([
        u.listRow({ icon: '📅', title: 'В среднем в день', sub: t.days + ' дней с записями',
          value: u.priv(t.avgDay) }),
        u.listRow({ icon: '🕒', title: 'В среднем за смену', sub: t.shifts + ' смен',
          value: u.priv(t.avgShift) }),
        u.listRow({ icon: '🧾', title: 'Средний чек',
          sub: ac.checks ? u.nf(ac.checks) + ' чеков' : 'число чеков не заполнено',
          value: ac.avg ? u.priv(ac.avg) : '—' }),
        u.listRow({ icon: '🔮', title: 'Будет к концу месяца',
          sub: pace.left ? 'осталось ' + pace.left + ' дней' : 'месяц закончился',
          value: u.priv(pace.forecast) })
      ], ''), '') +
      u.card('Что теряем', u.listOf([
        u.listRow({ icon: '🗑', title: 'Списано товара', sub: 'по данным 1С',
          value: u.priv(C.writeoffSum || 0) }),
        u.listRow({ icon: '⚠️', title: 'Недостачи в кассе',
          value: '<span class="c-red private">' + E.fmtMoney(Math.abs(t.diffSum < 0 ? t.diffSum : 0)) + '</span>' }),
        u.listRow({ icon: '🧊', title: 'Денег стоит в неликвиде',
          value: u.priv(C.dead ? num(C.dead.total) : 0) }),
        u.listRow({ icon: '👛', title: 'Забрал владелец', value: u.priv(t.draw) })
      ], ''), '') +
      '</div>';

    if (probs.top.length) {
      h += u.card('Три главные проблемы месяца', u.listOf(probs.top.map(function (x, i) {
        return u.listRow({ icon: ['🥇', '🥈', '🥉'][i] || '•', title: esc(x.what),
          sub: esc(x.why) + ' · ' + esc(x.fix),
          value: '<span class="c-red private">' + E.fmtMoney(x.sum) + '</span>' });
      }), ''), '<button class="btn btn-sm" data-go="problems">Подробнее</button>');
    }

    h += '<div class="banner"><span>🖨</span><span>Эта страница сделана, чтобы её распечатать: ' +
      'нажмите «Печать» — суммы печатаются как есть, даже если включён режим «спрятать суммы».</span></div>';
    return h;
  }

  /* --- 115. Готовые отчёты по кнопке ---------------------------------------------
     Бумаги, которые время от времени нужны: товарный отчёт ТОРГ-29,
     ведомость зарплаты, акт сверки с поставщиком, кассовая книга.
     ---------------------------------------------------------------------- */
  function torg29(ym) {
    // ТОРГ-29 «Товарный отчёт»: остаток на начало, приход, расход, остаток
    // на конец. Приход берём из накладных, расход — из продаж и списаний.
    var u = U(), C = u.calc(), D = u.data();
    var docs = (S.state.docs || []).filter(function (d) { return String(d.date).slice(0, 7) === ym; });
    var come = docs.reduce(function (a, d) { return a + num(d.sum); }, 0);
    var sold = C.sales ? num(C.sales.cogs) : 0;         // по себестоимости
    var lost = num(C.writeoffSum);
    var endStock = C.stock ? num(C.stock.buySum) : 0;
    return {
      ym: ym, docs: docs.length, come: E.safeRound(come), sold: E.safeRound(sold),
      lost: E.safeRound(lost), end: E.safeRound(endStock),
      // остаток на начало восстанавливаем обратным счётом: конец + расход − приход
      begin: E.safeRound(endStock + sold + lost - come),
      hasStock: !!(D.stock && D.stock.length), hasSales: !!(D.sales && D.sales.length)
    };
  }
  function viewReadyReports() {
    var u = U(), ym = pickedYm() || today().slice(0, 7);
    var t29 = torg29(ym);
    var h = u.pageHead('Готовые отчёты', 'Бумаги, которые иногда нужны — по кнопке',
      monthSelect() + ' <button class="btn" data-act="print">🖨 Печать</button>');

    h += u.card('Куда идти за каждой бумагой', u.listOf([
      u.listRow({ icon: '🧾', title: 'Ведомость зарплаты',
        sub: 'кому сколько начислено и выдано, с подписями', tap: true, attrs: ' data-go="payroll"' }),
      u.listRow({ icon: '⚖️', title: 'Акт сверки с поставщиком',
        sub: 'долг на начало, приход, оплаты, долг на конец', tap: true, attrs: ' data-go="reconcile"' }),
      u.listRow({ icon: '📓', title: 'Кассовая книга',
        sub: 'приход и расход наличных по дням', tap: true, attrs: ' data-go="finbase"' }),
      u.listRow({ icon: '📋', title: 'Отчёт собственнику',
        sub: 'всё главное за месяц на одну страницу', tap: true, attrs: ' data-go="ownerpage"' }),
      u.listRow({ icon: '🏧', title: 'Сверка с эквайрингом',
        sub: 'что пробили против того, что зачислил банк', tap: true, attrs: ' data-go="acquiring"' })
    ], ''), 'Любую из них можно скачать в Excel кнопкой ⤓ наверху');

    h += u.card('ТОРГ-29 — товарный отчёт за ' + esc(F.monthTitle(ym)), u.table('t29', [
      { title: 'Строка', fn: function (r) { return esc(r.name); } },
      { title: 'Сумма, ₽', cls: 'num', fn: function (r) { return u.priv(r.sum); } },
      { title: 'Откуда цифра', fn: function (r) { return '<span class="c-muted">' + esc(r.src) + '</span>'; } }
    ], [
      { name: 'Остаток на начало месяца', sum: t29.begin, src: 'посчитан обратным счётом' },
      { name: 'Приход товара за месяц', sum: t29.come, src: t29.docs + ' накладных из 1С' },
      { name: 'Итого с остатком', sum: E.safeRound(t29.begin + t29.come), src: 'начало + приход' },
      { name: 'Продано (по себестоимости)', sum: t29.sold, src: 'отчёт 1С «Продажи»' },
      { name: 'Списано и испорчено', sum: t29.lost, src: 'отчёт 1С «Причины списания»' },
      { name: 'Итого расход', sum: E.safeRound(t29.sold + t29.lost), src: 'продано + списано' },
      { name: 'Остаток на конец месяца', sum: t29.end, src: 'отчёт 1С «Остатки номенклатуры»' }
    ], { step: 10 }));

    if (!t29.hasStock || !t29.hasSales) {
      h += '<div class="banner orange"><span>⚠️</span><span>Для честного ТОРГ-29 нужны оба отчёта 1С: ' +
        '<b>«Остатки номенклатуры»</b>' + (t29.hasStock ? ' ✓' : ' — не загружен') +
        ' и <b>«Продажи»</b>' + (t29.hasSales ? ' ✓' : ' — не загружен') +
        '. Без них строки будут неполными.</span></div>';
    }
    h += '<div class="banner"><span>💡</span><span>Остаток на начало программа считает обратным счётом: ' +
      'остаток на конец плюс всё, что ушло, минус всё, что пришло. Если 1С даёт остаток на начало ' +
      'прямо — сверьтесь с ним: расхождение означает, что какой-то приход или списание не попали в учёт.</span></div>';
    return h;
  }

  /* --- Формы --------------------------------------------------------------------- */
  var FORMS = window.WM_EXTRA_FORMS = window.WM_EXTRA_FORMS || {};
  FORMS.kpiCard = {
    title: 'Свой показатель', icon: '🎯',
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Название', 'name', 'text', v.name || '',
        { placeholder: 'например: остаётся после главного' }) +
        u.fieldRow('Формула', 'formula', 'text', v.formula || '',
          { placeholder: 'выручка - закуп - зп - аренда' }) +
        u.fieldRow('В чём измеряем', 'unit', 'select', v.unit || 'рублях',
          { options: ['рублях', '%', 'штук'] }) +
        u.fieldRow('Хочу, чтобы было', 'good', 'select', v.good || 'просто показывать',
          { options: ['просто показывать', 'больше', 'меньше'] }) +
        u.fieldRow('Порог', 'target', 'number', v.target || 0,
          { hint: 'если задан — цифра будет зелёной или оранжевой' });
    },
    hint: 'Слова, которые понимает программа: ' + (R ? R.KPI_WORDS.join(', ') : '') +
      '. Плюс, минус, умножить, разделить и скобки — как на калькуляторе.',
    save: function (v) {
      if (!String(v.name || '').trim()) return 'Дайте показателю название.';
      var res = R.kpiEval(v.formula, R.kpiValues(kpiCtx()));
      if (res.error) return res.error;
      S.add('kpis', { name: String(v.name).trim(), formula: String(v.formula).trim(),
        unit: v.unit === 'рублях' ? '₽' : v.unit, good: v.good, target: E.num(v.target) });
      return { ok: 'Показатель «' + v.name + '» добавлен: сейчас ' + E.fmtMoney(res.value) +
        '. Он появился на экране «Сегодня».' };
    }
  };

  /* --- Регистрация экранов ------------------------------------------------------- */
  var VIEWS = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  VIEWS.push(
    { id: 'flow', icon: '🌊', name: 'Куда ушли деньги', group: 'Отчёты', render: viewFlow, after: 'finreport' },
    { id: 'problems', icon: '🚨', name: 'Главные проблемы месяца', group: 'Отчёты', render: viewProblems, after: 'flow' },
    { id: 'eaters', icon: '🍽', name: 'Что съедает прибыль', group: 'Отчёты', render: viewEaters, after: 'problems' },
    { id: 'pace', icon: '📈', name: 'Прогноз до конца месяца', group: 'Отчёты', render: viewPace, after: 'eaters' },
    { id: 'yearago', icon: '🕰', name: 'Что было год назад', group: 'Отчёты', render: viewYearAgo, after: 'pace' },
    { id: 'avgcheck', icon: '🧾', name: 'Средний чек', group: 'Отчёты', render: viewAvgCheck, after: 'yearago' },
    { id: 'calend', icon: '🎄', name: 'Праздники и выходные', group: 'Отчёты', render: viewCalendarEffect, after: 'avgcheck' },
    { id: 'groupprofit', icon: '📦', name: 'Группы товаров', group: 'Товары', render: viewGroupProfit, after: 'abc' },
    { id: 'itemprofit', icon: '🏆', name: 'Рейтинг по прибыли', group: 'Товары', render: viewItemProfit, after: 'groupprofit' },
    { id: 'ownerpage', icon: '📋', name: 'Отчёт собственнику', group: 'Отчёты', render: viewOwnerPage, after: 'finreport' },
    { id: 'ready', icon: '🖨', name: 'Готовые отчёты', group: 'Отчёты', render: viewReadyReports, after: 'calend' },
    { id: 'kpi', icon: '🎯', name: 'Свои показатели', group: 'Отчёты', render: viewKpi, after: 'ready' }
  );
})();
