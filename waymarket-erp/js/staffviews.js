/* ============================================================================
   КОНТУР 1: люди и зарплата. Табель смен, график, ведомость ФОТ, личные листы.

   Всё считается из своих журналов и живёт в «Бухгалтерия.xlsx». Выгрузки 1С
   сюда не попадают: зарплату магазин ведёт сам, и никакой файл её не
   перезапишет.

   Одно правило, чтобы деньги не задвоились: начисление берётся ТОЛЬКО из
   табеля (или из оклада), а выданное — ТОЛЬКО из журнала выплат. Если ту же
   зарплату записать ещё и расходом по статье «ЗП», в отчёте о прибыли она
   встанет дважды — программа об этом предупреждает.
   ========================================================================== */
(function () {
  'use strict';
  var E = window.WM, S = window.WMStore, Q = window.WMQuick, ST = window.WMStaff;

  function U() { return window.WMUI; }
  function FLT() { return window.WMFilter; }
  function esc(s) { return U().esc(s); }
  function dateRu(d) { return U().dateRu(d); }
  function num(v) { return E.num(v); }
  function money(v) { return E.fmtMoney(v); }
  function today() { return E.today(); }
  function refresh() { U().recompute(); }

  function staff() { return S.state.staff || []; }
  function timesheet() { return S.state.timesheet || []; }
  function payouts() { return S.state.payouts || []; }
  function dds() { return S.state.dds || []; }

  function employees() { return Q.dicts(S.state, S.settings).employees; }
  function shiftNames() {
    var raw = E.txt(S.settings.finShifts || S.settings.shiftNames);
    var list = raw ? raw.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : [];
    return list.length ? list : ['День', 'Ночь'];
  }
  function personOf(name) { return ST.personOf(staff(), name); }

  function learn(map) {
    var changed = false;
    for (var k in map) if (Q.learn(S.settings, k, map[k], S.state)) changed = true;
    if (changed) S.save();
  }

  // Месяц, с которым сейчас работаем. Один на все зарплатные экраны.
  function ym() {
    return E.txt(S.settings.payrollMonth) || String(today()).slice(0, 7);
  }
  function inYm(r, m) { return String(r.date || '').slice(0, 7) === (m || ym()); }
  function monthRu(m) {
    var names = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
      'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    var mm = +String(m).slice(5, 7);
    return (names[mm - 1] || '') + ' ' + String(m).slice(0, 4);
  }
  function monthOptions() {
    var seen = {}, out = [];
    timesheet().concat(payouts()).concat(dds()).forEach(function (r) {
      var k = String(r.date || '').slice(0, 7);
      if (k.length === 7) seen[k] = 1;
    });
    seen[String(today()).slice(0, 7)] = 1;
    for (var k in seen) out.push(k);
    return out.sort().reverse();
  }
  function monthPicker() {
    var list = monthOptions(), cur = ym();
    return '<div class="quick"><label class="inline-label">Месяц:&nbsp;' +
      '<select id="payMonth">' + list.map(function (m) {
        return '<option value="' + esc(m) + '"' + (m === cur ? ' selected' : '') + '>' +
          esc(monthRu(m)) + '</option>';
      }).join('') + '</select></label></div>';
  }

  // Ведомость за выбранный месяц
  function board(m) {
    m = m || ym();
    return E.payrollSummary(
      timesheet().filter(function (r) { return inYm(r, m); }),
      payouts().filter(function (r) { return inYm(r, m); }),
      staff(), S.settings, { keepEmpty: true });
  }

  /* Зарплата не должна попасть в затраты дважды: и табелем, и статьёй «ЗП» */
  function doubleWarn(m) {
    var byArticle = 0;
    dds().forEach(function (r) {
      if (!E.isExpense(r) || !inYm(r, m)) return;
      if (E.costKindOf(r.category) === 'fot') byArticle += num(r.amount);
    });
    if (!byArticle) return '';
    return '<div class="banner orange"><span>⚠️</span><span>За этот месяц зарплата записана ' +
      'ещё и расходом по статье «ЗП» на <b>' + money(byArticle) + '</b>. ' +
      'В отчёте о прибыли считается что-то одно: пока ведётся табель, берётся он. ' +
      'Чтобы не путаться, эти расходы лучше убрать на экране «База операций».</span></div>';
  }

  /* ==========================================================================
     ФОРМЫ
     ========================================================================== */
  var FORMS = window.WM_EXTRA_FORMS = window.WM_EXTRA_FORMS || {};

  /* --- Карточка сотрудника ---------------------------------------------------- */
  FORMS.staffCard = {
    title: 'Сотрудник', icon: '👤',
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Имя', 'name', 'text', v.name || '', { placeholder: 'как зовёте в магазине' }) +
        u.fieldRow('Должность', 'position', 'list', v.position || '',
          { options: ['Кассир', 'Продавец', 'Администратор', 'Уборщица', 'Грузчик', 'Бухгалтер'] }) +
        u.fieldRow('Как считаем зарплату', 'scheme', 'select', v.scheme || 'Ставка за час',
          { options: ST.SCHEMES, hint: 'оклад и часы вместе не складываются' }) +
        u.fieldRow('Ставка за час, день', 'rate', 'number',
          v.rate != null && v.rate !== '' ? v.rate : num(S.settings.rateDay),
          { hint: 'пусто — возьмётся из настроек' }) +
        u.fieldRow('Ставка за час, ночь', 'rateNight', 'number',
          v.rateNight != null && v.rateNight !== '' ? v.rateNight : num(S.settings.rateNight)) +
        u.fieldRow('Оклад за месяц', 'salary', 'number', v.salary || 0,
          { hint: 'если стоит оклад — часы идут только в табель, деньги считаются от оклада' }) +
        u.fieldRow('Процент с выручки', 'percent', 'number', v.percent || 0) +
        u.fieldRow('Норма смен в месяц', 'normShifts', 'number', v.normShifts || 15) +
        u.fieldRow('Телефон', 'phone', 'tel', v.phone || '') +
        u.fieldRow('Принят', 'hired', 'date', v.hired || '') +
        u.fieldRow('Уволен', 'fired', 'date', v.fired || '', { hint: 'пусто — работает' }) +
        u.fieldRow('Заметка', 'note', 'text', v.note || '');
    },
    hint: 'Ставка из карточки главнее настроек магазина, а ставка, вписанная прямо ' +
      'в смену табеля, — главнее карточки.',
    save: function (v) {
      if (!E.txt(v.name)) return 'Впишите имя — иначе непонятно, кому платить.';
      var f = ['rate', 'rateNight', 'salary', 'percent'];
      for (var i = 0; i < f.length; i++) {
        var b = Q.checkAmount(v[f[i]], { allowEmpty: true, allowZero: true });
        if (b) return 'Поле «' + f[i] + '»: ' + b;
      }
      var ed = U().editing();
      var same = staff().filter(function (p) {
        return E.norm(p.name) === E.norm(v.name) && (!ed || p.id !== ed.id);
      })[0];
      if (same) return 'Сотрудник «' + same.name + '» уже заведён. Откройте его карточку.';
      var rec = { name: E.txt(v.name), position: E.txt(v.position), scheme: E.txt(v.scheme),
        rate: num(v.rate), rateNight: num(v.rateNight), salary: num(v.salary),
        percent: num(v.percent), normShifts: num(v.normShifts), phone: E.txt(v.phone),
        hired: E.txt(v.hired), fired: E.txt(v.fired), note: E.txt(v.note) };
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('staff', rec);
      S.save(); refresh();
      return { ok: rec.name + ' — карточка сохранена.' };
    }
  };

  /* --- Смена в табеле --------------------------------------------------------
     Часы днём и ночью — раздельно: ночью ставка выше. */
  FORMS.timesheetRow = {
    title: 'Смена в табеле', icon: '🗒',
    body: function (v) {
      var u = U(); v = v || {};
      var p = personOf(v.employee);
      var hint = p
        ? (num(p.salary) ? 'у ' + p.name + ' оклад ' + money(p.salary) + ' — часы идут в табель, деньги от оклада'
          : 'ставка из карточки: ' + money(num(p.rate) || num(S.settings.rateDay)) + '/час')
        : 'ставка из настроек: ' + money(num(S.settings.rateDay)) + '/час днём, ' +
          money(num(S.settings.rateNight)) + '/час ночью';
      var hours = num(S.settings.shiftHours) || 12;
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Сотрудник', 'employee', 'list', v.employee || '',
          { options: employees(), placeholder: 'кто работал', hint: hint }) +
        u.fieldRow('Смена', 'shift', 'select', v.shift || shiftNames()[0], { options: shiftNames() }) +
        u.fieldRow('Часы днём', 'hoursDay', 'number',
          v.hoursDay != null ? v.hoursDay : (E.txt(v.shift).toLowerCase().indexOf('ноч') >= 0 ? 0 : hours)) +
        u.fieldRow('Часы ночью', 'hoursNight', 'number',
          v.hoursNight != null ? v.hoursNight : 0,
          { hint: 'ночные часы считаются по своей ставке' }) +
        u.fieldRow('Ставка за час', 'rate', 'number', v.rate || '',
          { hint: 'пусто — возьмётся из карточки или настроек' }) +
        u.fieldRow('Премия', 'bonus', 'number', v.bonus || 0, { hint: 'за план, за смену без расхождений' }) +
        u.fieldRow('Удержание', 'fine', 'number', v.fine || 0, { hint: 'штраф, недостача, брак' }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Начислено = часы днём × дневную ставку + часы ночью × ночную + премия − удержание. ' +
      'Эта запись зарплату только начисляет — выданные деньги записываются отдельно.',
    save: function (v) {
      if (!E.txt(v.employee)) return 'Укажите, кто работал.';
      var f = ['hoursDay', 'hoursNight', 'rate', 'bonus', 'fine'];
      for (var i = 0; i < f.length; i++) {
        var b = Q.checkAmount(v[f[i]], { allowEmpty: true, allowZero: true });
        if (b) return 'Поле «' + f[i] + '»: ' + b;
      }
      if (num(v.hoursDay) + num(v.hoursNight) > 24) return 'В сутках 24 часа — проверьте часы.';
      if (!num(v.hoursDay) && !num(v.hoursNight) && !num(v.bonus) && !num(v.fine)) {
        return 'Смена пустая: ни часов, ни премии, ни удержания.';
      }
      var ed = U().editing();
      var dup = timesheet().filter(function (r) {
        return r.date === v.date && E.norm(r.employee) === E.norm(v.employee) &&
          E.norm(r.shift) === E.norm(v.shift) && (!ed || r.id !== ed.id);
      })[0];
      if (dup) return 'Эта смена уже в табеле: ' + dateRu(v.date) + ', ' + v.employee +
        ', ' + v.shift + '. Поправьте ту запись, чтобы часы не задвоились.';
      learn({ employees: v.employee, shifts: v.shift });
      var rec = { date: v.date, employee: E.txt(v.employee), shift: E.txt(v.shift),
        hoursDay: num(v.hoursDay), hoursNight: num(v.hoursNight), rate: num(v.rate),
        bonus: num(v.bonus), fine: num(v.fine), note: E.txt(v.note) };
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('timesheet', rec);
      S.save(); refresh();
      var c = E.timesheetCalc(rec, personOf(rec.employee), S.settings);
      return { ok: 'Смена записана: ' + rec.employee + ', ' + U().nf(c.hours) +
        ' ч, начислено ' + money(c.total) + '.' };
    }
  };

  /* --- Выдача денег ----------------------------------------------------------- */
  FORMS.payoutRow = {
    title: 'Выдача зарплаты', icon: '💵',
    body: function (v) {
      var u = U(); v = v || {};
      var row = board().filter(function (r) { return E.norm(r.employee) === E.norm(v.employee); })[0];
      var hint = row ? 'начислено ' + money(row.accrued) + ', уже выдано ' + money(row.paid) +
        ', остаток ' + money(row.left) : 'сначала занесите смены в табель';
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Сотрудник', 'employee', 'list', v.employee || '',
          { options: employees(), hint: hint }) +
        u.fieldRow('Вид выплаты', 'kind', 'select', v.kind || 'Аванс',
          { options: ['Аванс', 'Окончательный расчёт', 'Премия', 'Отпускные', 'Прочее'] }) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        u.fieldRow('Чем выдали', 'method', 'select', v.method || 'Наличные',
          { options: ['Наличные', 'Карта', 'СБП', 'Перевод'] }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Эта запись только фиксирует, что деньги отданы. Кассу она не двигает: ' +
      'если наличные брали из ящика, они уже посчитаны в «Выплатах из ящика» при сверке смены.',
    save: function (v) {
      var bad = Q.checkAmount(v.amount); if (bad) return bad;
      if (!E.txt(v.employee)) return 'Укажите, кому выдали.';
      learn({ employees: v.employee });
      var ed = U().editing();
      var rec = { date: v.date, employee: E.txt(v.employee), kind: E.txt(v.kind),
        amount: num(v.amount), method: E.txt(v.method), note: E.txt(v.note) };
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('payouts', rec);
      S.save(); refresh();
      var row = board(String(rec.date).slice(0, 7))
        .filter(function (r) { return E.norm(r.employee) === E.norm(rec.employee); })[0];
      return { ok: 'Записано: ' + rec.employee + ' — ' + money(rec.amount) +
        (row ? '. Остаток к выдаче ' + money(row.left) + '.' : '.') };
    }
  };

  /* ==========================================================================
     ЭКРАНЫ
     ========================================================================== */

  /* --- Табель смен ------------------------------------------------------------ */
  function viewTimesheet() {
    var u = U(), m = ym();
    var rows = timesheet().filter(function (r) { return inYm(r, m); });
    var tot = { hoursDay: 0, hoursNight: 0, sum: 0, bonus: 0, fine: 0 };
    rows.forEach(function (r) {
      var c = E.timesheetCalc(r, personOf(r.employee), S.settings);
      tot.hoursDay += c.hoursDay; tot.hoursNight += c.hoursNight;
      tot.sum += c.total; tot.bonus += c.bonus; tot.fine += c.fine;
    });

    var h = u.pageHead('Табель смен', 'Кто сколько отработал за ' + monthRu(m),
      '<button class="btn btn-primary" data-form="timesheetRow">＋ Смена</button>');
    h += monthPicker();
    h += '<div class="stat-grid">' +
      u.stat('Смен в табеле', u.nf(rows.length), monthRu(m)) +
      u.stat('Часов днём', u.nf(E.safeRound(tot.hoursDay)), 'по дневной ставке') +
      u.stat('Часов ночью', u.nf(E.safeRound(tot.hoursNight)), 'ночь дороже') +
      u.stat('Начислено за месяц', u.priv(tot.sum),
        'премии ' + money(tot.bonus) + ', удержания ' + money(tot.fine)) +
      '</div>';
    h += doubleWarn(m);

    var defs = [
      { key: 'who', name: 'Сотрудник', auto: function (r) { return r.employee; }, limit: 12 },
      { key: 'sh', name: 'Смена', auto: function (r) { return r.shift; }, limit: 6 },
      { key: 'mark', name: 'Отметки', options: [
        { v: 'bonus', name: 'С премией', test: function (r) { return num(r.bonus) > 0; } },
        { v: 'fine', name: 'С удержанием', test: function (r) { return num(r.fine) > 0; } },
        { v: 'night', name: 'Ночные', test: function (r) { return num(r.hoursNight) > 0; } }
      ] }
    ];
    var list = FLT().apply('timesheet', rows, defs, function (r) {
      return E.txt(r.employee) + ' ' + E.txt(r.note);
    }).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    h += FLT().bar('timesheet', defs, rows, { search: 'имя или комментарий' });

    h += u.card('Смены', FLT().note(list.length, rows.length) + u.table('tsT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Сотрудник', fn: function (r) { return esc(r.employee); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift || '—'); } },
      { title: 'День, ч', cls: 'num', fn: function (r) { return u.nf(num(r.hoursDay)); } },
      { title: 'Ночь, ч', cls: 'num', fn: function (r) { return u.nf(num(r.hoursNight)); } },
      { title: 'Ставка', cls: 'num', fn: function (r) {
        var c = E.timesheetCalc(r, personOf(r.employee), S.settings);
        return u.priv(c.rateDay) + (c.hoursNight ? ' / ' + u.priv(c.rateNight) : ''); } },
      { title: 'Премия', cls: 'num', fn: function (r) { return num(r.bonus) ? u.priv(r.bonus) : '—'; } },
      { title: 'Удержание', cls: 'num', fn: function (r) {
        return num(r.fine) ? '<span class="c-red">' + u.priv(r.fine) + '</span>' : '—'; } },
      { title: 'Начислено', cls: 'num', fn: function (r) {
        return u.priv(E.timesheetCalc(r, personOf(r.employee), S.settings).total); } },
      { title: '', cls: 'center', fn: function (r) {
        return u.rowMenu('timesheet', r.id, { form: 'timesheetRow' }); } }
    ], list, { step: 40, empty: 'За ' + monthRu(m) + ' смен не записано' }));
    return h;
  }

  /* --- График смен: календарь месяца ------------------------------------------ */
  function viewSchedule() {
    var u = U(), m = ym();
    var sch = ST.schedule([], timesheet(), m, staff());
    var h = u.pageHead('График смен', 'Кто выходил в ' + monthRu(m),
      '<button class="btn btn-primary" data-form="timesheetRow">＋ Смена</button>');
    h += monthPicker();
    h += '<div class="stat-grid">' +
      u.stat('Дней в месяце', u.nf(sch.daysIn), monthRu(m)) +
      u.stat('Дней без смен', u.nf(sch.gaps), sch.gaps ? 'проверьте табель' : 'пропусков нет',
        sch.gaps ? 'c-orange' : 'c-green') +
      u.stat('Людей в графике', u.nf(sch.people.length), 'по табелю и карточкам') +
      '</div>';

    var cells = '';
    var first = new Date(m + '-01').getDay();
    var pad = (first + 6) % 7;                    // неделя начинается с понедельника
    for (var i = 0; i < pad; i++) cells += '<div class="cal-cell empty"></div>';
    sch.days.forEach(function (d) {
      var who = d.people.map(function (p) {
        return '<span class="cal-who">' + esc(p.who || '?') +
          (p.hours ? ' <b>' + u.nf(p.hours) + 'ч</b>' : '') + '</span>';
      }).join('');
      cells += '<div class="cal-cell' + (d.weekend ? ' weekend' : '') +
        (d.empty ? ' gap' : '') + (d.date === today() ? ' today' : '') + '">' +
        '<div class="cal-day">' + d.day + '</div>' + (who || '<span class="cal-none">—</span>') +
        '</div>';
    });
    var dows = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
      .map(function (x) { return '<div class="cal-dow">' + x + '</div>'; }).join('');
    h += u.card('Календарь', '<div class="cal-grid">' + dows + cells + '</div>',
      'Пустой день — смену в табель не записали. Зарплата по нему не начислится.');

    // Кто сколько смен закрыл
    var per = {};
    timesheet().filter(function (r) { return inYm(r, m); }).forEach(function (r) {
      var k = E.txt(r.employee) || '—';
      if (!per[k]) per[k] = { employee: k, shifts: 0, hours: 0, night: 0 };
      var c = E.timesheetCalc(r, personOf(k), S.settings);
      per[k].shifts++; per[k].hours += c.hours; per[k].night += c.hoursNight;
    });
    var pl = Object.keys(per).map(function (k) { return per[k]; })
      .sort(function (a, b) { return b.shifts - a.shifts; });
    h += u.card('Смены по людям', u.table('schT', [
      { title: 'Сотрудник', fn: function (r) { return esc(r.employee); } },
      { title: 'Смен', cls: 'num', fn: function (r) { return u.nf(r.shifts); } },
      { title: 'Часов', cls: 'num', fn: function (r) { return u.nf(E.safeRound(r.hours)); } },
      { title: 'Из них ночью', cls: 'num', fn: function (r) { return u.nf(E.safeRound(r.night)); } },
      { title: 'Норма', cls: 'num', fn: function (r) {
        var p = personOf(r.employee);
        var norma = p ? num(p.normShifts) : 0;
        if (!norma) return '—';
        return '<span class="' + (r.shifts >= norma ? 'c-green' : 'c-orange') + '">' +
          r.shifts + ' из ' + norma + '</span>'; } }
    ], pl, { step: 30, empty: 'В этом месяце смен нет' }));
    return h;
  }

  /* --- Ведомость зарплаты ------------------------------------------------------ */
  function viewPayroll() {
    var u = U(), m = ym();
    var rows = board(m).filter(function (r) { return r.shifts || r.accrued || r.paid; });
    var tot = E.payrollTotals(rows);
    var parts = ST.payParts(S.settings, m);

    var h = u.pageHead('Ведомость зарплаты', 'ФОТ за ' + monthRu(m),
      '<button class="btn btn-primary" data-form="payoutRow">＋ Выдать</button>' +
      ' <button class="btn" data-act="export-screen">⤓ В Excel</button>');
    h += monthPicker();
    h += '<div class="stat-grid">' +
      u.stat('Начислено (ФОТ)', u.priv(tot.accrued), tot.people + ' чел., ' +
        u.nf(tot.shifts) + ' смен') +
      u.stat('Выдано', u.priv(tot.paid), 'из них авансом ' + money(tot.advance)) +
      u.stat('Остаток к выдаче', u.priv(tot.left),
        tot.left > 0 ? 'ещё должны людям' : 'все рассчитаны',
        tot.left > 0 ? 'c-orange' : 'c-green') +
      u.stat('Премии / удержания', u.priv(tot.bonus) + ' / ' + u.priv(tot.fine), 'за месяц') +
      '</div>';
    h += doubleWarn(m);
    h += '<div class="banner blue"><span>📅</span><span>Аванс по настройкам — ' +
      esc(dateRu(parts.advanceDate)) + ' (' + u.pct(parts.advancePct) + ' от начисленного), ' +
      'окончательный расчёт — ' + esc(dateRu(parts.finalDate)) + '.</span></div>';

    h += u.card('Ведомость', u.table('payT', [
      { title: 'Сотрудник', fn: function (r) { return esc(r.employee); } },
      { title: 'Должность', fn: function (r) { return esc(r.position || '—'); } },
      { title: 'Как считаем', fn: function (r) { return esc(r.scheme); } },
      { title: 'Смен', cls: 'num', fn: function (r) { return u.nf(r.shifts); } },
      { title: 'Часов', cls: 'num', fn: function (r) {
        return u.nf(r.hours) + (r.hoursNight ? ' <span class="c-muted">(ночь ' +
          u.nf(r.hoursNight) + ')</span>' : ''); } },
      { title: 'Начислено', cls: 'num', fn: function (r) { return u.priv(r.accrued); } },
      { title: 'Аванс', cls: 'num', fn: function (r) { return r.advance ? u.priv(r.advance) : '—'; } },
      { title: 'Выдано всего', cls: 'num', fn: function (r) { return u.priv(r.paid); } },
      { title: 'К выдаче', cls: 'num', fn: function (r) {
        return '<b class="' + (r.left > 0 ? 'c-orange' : 'c-green') + '">' + u.priv(r.left) + '</b>'; } },
      { title: '', cls: 'center', fn: function (r) {
        return r.left > 0
          ? '<button class="btn btn-sm" data-act="pay-rest" data-employee="' + esc(r.employee) +
            '">Выдать остаток</button>'
          : '<button class="btn btn-sm" data-form="payoutRow" data-employee="' + esc(r.employee) +
            '">＋</button>'; } }
    ], rows, { step: 40, empty: 'За ' + monthRu(m) + ' ни смен, ни выплат',
      total: [{ span: 5, html: 'Итого', label: '' },
        { cls: 'num', html: u.priv(tot.accrued), label: 'Начислено' },
        { cls: 'num', html: u.priv(tot.advance), label: 'Аванс' },
        { cls: 'num', html: u.priv(tot.paid), label: 'Выдано' },
        { cls: 'num', html: '<b>' + u.priv(tot.left) + '</b>', label: 'К выдаче' },
        { html: '' }] }),
      'Начислено берётся из табеля (или из оклада), выдано — из журнала выплат');

    var pl = payouts().filter(function (r) { return inYm(r, m); })
      .slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    h += u.card('Что уже выдали', u.table('payoutT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Кому', fn: function (r) { return esc(r.employee); } },
      { title: 'Вид', fn: function (r) { return u.badge(r.kind || 'Выплата', 'gray'); } },
      { title: 'Чем', fn: function (r) { return esc(r.method || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.amount); } },
      { title: 'Комментарий', fn: function (r) { return esc(r.note || ''); } },
      { title: '', cls: 'center', fn: function (r) {
        return u.rowMenu('payouts', r.id, { form: 'payoutRow' }); } }
    ], pl, { step: 30, empty: 'Выплат за месяц нет' }));
    return h;
  }

  /* --- Личные листы ------------------------------------------------------------ */
  function viewStaffCards() {
    var u = U(), m = ym();
    var rows = board(m);
    var live = E.activeStaff(staff());
    var h = u.pageHead('Личные листы', 'Что заработал каждый в ' + monthRu(m),
      '<button class="btn btn-primary" data-form="staffCard">＋ Сотрудник</button>' +
      ' <button class="btn" data-go="dicts">📚 Справочник сотрудников</button>');
    h += monthPicker();

    if (!live.length) {
      return h + '<div class="card"><div class="empty">Сотрудников пока нет.<br>' +
        'Заведите карточки — тогда посчитается табель и зарплата.</div>' +
        '<div class="card-pad"><button class="btn btn-primary" data-form="staffCard">＋ Добавить сотрудника</button></div></div>';
    }

    rows.forEach(function (r) {
      var p = personOf(r.employee) || {};
      var shifts = timesheet().filter(function (t) {
        return inYm(t, m) && E.norm(t.employee) === E.norm(r.employee);
      }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
      var pays = payouts().filter(function (t) {
        return inYm(t, m) && E.norm(t.employee) === E.norm(r.employee);
      });
      var facts = [
        ['Должность', esc(p.position || '—')],
        ['Как считаем', esc(r.scheme) + (r.salary ? ' ' + money(r.salary) : '')],
        ['Смен', u.nf(r.shifts)],
        ['Часов (из них ночью)', u.nf(r.hours) + ' (' + u.nf(r.hoursNight) + ')'],
        ['Начислено', u.priv(r.accrued)],
        ['Выдано', u.priv(r.paid)],
        ['К выдаче', '<b class="' + (r.left > 0 ? 'c-orange' : 'c-green') + '">' + u.priv(r.left) + '</b>'],
        ['Телефон', p.phone ? '<a href="tel:' + esc(p.phone) + '">' + esc(p.phone) + '</a>' : '—']
      ];
      var body = u.listOf(facts.map(function (f) {
        return u.listRow({ title: esc(f[0]), value: f[1] });
      }), '');
      body += u.table('pc-' + (p.id || E.norm(r.employee)), [
        { title: 'Дата', fn: function (t) { return esc(dateRu(t.date)); } },
        { title: 'Смена', fn: function (t) { return esc(t.shift || '—'); } },
        { title: 'Часы', cls: 'num', fn: function (t) {
          return u.nf(num(t.hoursDay)) + (num(t.hoursNight) ? ' + ' + u.nf(num(t.hoursNight)) + ' ночь' : ''); } },
        { title: 'Начислено', cls: 'num', fn: function (t) {
          return u.priv(E.timesheetCalc(t, p, S.settings).total); } }
      ], shifts, { step: 12, empty: 'Смен в этом месяце нет' });
      if (pays.length) {
        body += '<div class="sub-title">Выплаты</div>' + pays.map(function (t) {
          return u.listRow({ icon: '💵', title: esc(dateRu(t.date)) + ' · ' + esc(t.kind || 'выплата'),
            sub: esc(t.method || ''), value: u.priv(t.amount) });
        }).join('');
      }
      body += '<div class="card-pad">' +
        '<button class="btn" data-form="timesheetRow" data-employee="' + esc(r.employee) + '">＋ Смена</button> ' +
        '<button class="btn" data-form="payoutRow" data-employee="' + esc(r.employee) + '">＋ Выдать</button>' +
        (p.id ? ' <button class="btn btn-sm" data-edit="staff:' + esc(p.id) + ':staffCard">✎ Карточка</button>' : '') +
        '</div>';
      h += u.card(r.employee + (r.fired ? ' (уволен)' : ''), body,
        r.left > 0 ? 'к выдаче ' + money(r.left) : 'рассчитан');
    });
    return h;
  }

  /* ==========================================================================
     ДЕЙСТВИЯ
     ========================================================================== */
  var A = window.WM_EXTRA_ACTIONS = window.WM_EXTRA_ACTIONS || {};

  A['pay-rest'] = function (el) {
    var who = el.dataset.employee;
    var row = board().filter(function (r) { return E.norm(r.employee) === E.norm(who); })[0];
    if (!row || row.left <= 0) return 'По этому сотруднику остатка нет.';
    U().openForm('payoutRow', { date: today(), employee: row.employee,
      kind: 'Окончательный расчёт', amount: row.left });
    return null;
  };

  // Переключение месяца на зарплатных экранах
  var prevChange = window.WM_EXTRA_CHANGE;
  window.WM_EXTRA_CHANGE = function (el) {
    if (el.id === 'payMonth') { S.setSetting('payrollMonth', el.value); return true; }
    return prevChange ? prevChange(el) : false;
  };

  var VIEWS = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  VIEWS.push(
    { id: 'timesheet', icon: '🗒', name: 'Табель смен', group: 'Люди', render: viewTimesheet },
    { id: 'sched', icon: '🗓', name: 'График смен', group: 'Люди', render: viewSchedule },
    { id: 'payroll', icon: '💰', name: 'Ведомость зарплаты', group: 'Люди', render: viewPayroll },
    { id: 'staffcards', icon: '👤', name: 'Личные листы', group: 'Люди', render: viewStaffCards }
  );
})();
